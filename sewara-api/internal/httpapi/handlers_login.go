package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"math"
	"net"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/Rzp1010/sewara-split/sewara-api/internal/auth"
	"github.com/Rzp1010/sewara-split/sewara-api/internal/db"
)

// Pesan berikut disalin apa adanya dari backend Next (app/api/auth/login/route.ts).
// Frontend menampilkannya langsung ke pengguna dan uji kontrak membandingkan
// string-nya, jadi jangan diperhalus tanpa mengubah keduanya.
const (
	msgLoginValidation  = "Email dan password wajib diisi."
	msgLoginCredentials = "Email atau password salah."
	msgLoginUnverified  = "Email belum diverifikasi. Periksa inbox email Anda."
	msgLoginWaiting     = "Akun Anda menunggu persetujuan admin."
	msgLoginExpired     = "Langganan berakhir. Hubungi admin untuk perpanjang."
	msgLoginRateLimit   = "Terlalu banyak percobaan dari perangkat ini. Coba lagi nanti."
)

// Ambang pembatasan laju, dari lib/api/constants.ts (RATE_LIMITS).
const (
	loginFailureWindow     = 10 * time.Minute
	loginIPFailureLimit    = 10
	loginEmailFailureLimit = 5
	maxLoginBodyBytes      = 4 << 10
)

// loginInput adalah kredensial yang sudah divalidasi.
type loginInput struct {
	email    string
	password string
}

// loginContext adalah konteks per-request untuk login.
type loginContext struct {
	now       time.Time
	ip        string
	userAgent string
	counts    db.LoginFailureCounts
	user      *db.AuthUser
	profil    *db.LoginProfile
	ownerID   *string
}

// loginRejection adalah alasan penolakan login + metadata response.
type loginRejection struct {
	status  int
	code    string
	message string
	detail  string
	extra   map[string]any
	headers map[string]string
}

// handleLogin memverifikasi kredensial lalu menerbitkan cookie sesi.
//
// Urutan pemeriksaan sengaja sama dengan backend Next: validasi → load data →
// status akun → langganan → lockout → rate limit → password → email confirmation.
func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	input, err := validateLoginInput(r)
	if err != nil {
		writeValidationError(w, msgLoginValidation, nil)
		return
	}

	ctx := s.buildLoginContext(r, input.email)
	reject := func(rej loginRejection) {
		s.logLoginAttempt(input.email, ctx.ownerID, ctx.ip, ctx.userAgent, "login_gagal", rej.detail)
		writeErrorExtra(w, rej.status, rej.code, rej.message, rej.extra, rej.headers)
	}

	if rej := checkAccountRestrictions(ctx.profil, ctx.now); rej != nil {
		reject(*rej)
		return
	}

	if ctx.counts.IP >= loginIPFailureLimit || ctx.counts.Email >= loginEmailFailureLimit {
		alasan := "email"
		if ctx.counts.IP >= loginIPFailureLimit {
			alasan = "ip"
		}
		reject(loginRejection{
			status:  http.StatusTooManyRequests,
			code:    CodeRateLimitExceeded,
			message: msgLoginRateLimit,
			detail:  "rate limit " + alasan,
			extra:   map[string]any{"retryAfterMs": int(loginFailureWindow.Milliseconds())},
			headers: map[string]string{"Retry-After": "600"},
		})
		return
	}

	if ctx.user == nil {
		reject(loginRejection{
			status:  http.StatusUnauthorized,
			code:    CodeUnauthorized,
			message: msgLoginCredentials,
			detail:  "email tidak dikenal",
		})
		return
	}

	if rej := s.verifyCredentials(r.Context(), ctx.user, ctx.profil, input.password); rej != nil {
		reject(*rej)
		return
	}

	if err := s.createLoginSession(w, r, ctx.user.ID, input.email, ctx.ownerID, ctx.ip, ctx.userAgent, ctx.now); err != nil {
		s.log.Error("gagal membuat sesi login", "err", err)
		writeError(w, http.StatusInternalServerError, CodeInternalError, "Terjadi kesalahan server. Coba lagi.")
		return
	}

	writeSuccess(w, http.StatusOK, map[string]any{"ok": true})
}

// validateLoginInput memeriksa body request dan mengembalikan kredensial yang sudah dibersihkan.
func validateLoginInput(r *http.Request) (loginInput, error) {
	var body struct {
		Email    *string `json:"email"`
		Password *string `json:"password"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, maxLoginBodyBytes)).Decode(&body); err != nil {
		return loginInput{}, err
	}
	if body.Email == nil || body.Password == nil {
		return loginInput{}, errors.New("field kosong")
	}
	email := strings.ToLower(strings.TrimSpace(*body.Email))
	if !looksLikeEmail(email) {
		return loginInput{}, errors.New("email tidak valid")
	}
	return loginInput{email: email, password: *body.Password}, nil
}

// buildLoginContext memuat semua data yang dibutuhkan untuk keputusan login.
func (s *Server) buildLoginContext(r *http.Request, email string) loginContext {
	now := time.Now()
	ip := clientIP(r)
	userAgent := r.UserAgent()

	counts, err := s.db.CountRecentLoginFailures(r.Context(), email, ip, now.Add(-loginFailureWindow))
	if err != nil {
		s.log.Error("gagal menghitung percobaan login", "err", err)
		counts = db.LoginFailureCounts{}
	}

	user, userErr := s.db.AuthUserByEmail(r.Context(), email)
	var userPtr *db.AuthUser
	if userErr == nil {
		userPtr = &user
	} else if !errors.Is(userErr, db.ErrNotFound) {
		s.log.Error("gagal membaca kredensial", "err", userErr)
	}

	var profil *db.LoginProfile
	var ownerID *string
	if userPtr != nil {
		p, err := s.db.LoadLoginProfile(r.Context(), user.ID)
		switch {
		case err == nil:
			profil = &p
			ownerID = p.OwnerID
		case errors.Is(err, db.ErrNotFound):
			s.log.Warn("akun tanpa profil", "email", email)
		default:
			s.log.Error("gagal membaca profil login", "err", err)
		}
	}

	return loginContext{
		now:       now,
		ip:        ip,
		userAgent: userAgent,
		counts:    counts,
		user:      userPtr,
		profil:    profil,
		ownerID:   ownerID,
	}
}

// checkAccountRestrictions memeriksa status/langganan/lockout/cooldown. Nil = lolos.
func checkAccountRestrictions(profil *db.LoginProfile, now time.Time) *loginRejection {
	if profil == nil {
		return nil
	}

	if profil.Status != nil && *profil.Status == "menunggu" {
		return &loginRejection{
			status:  http.StatusForbidden,
			code:    CodeForbidden,
			message: msgLoginWaiting,
			detail:  "akun menunggu persetujuan",
		}
	}

	if profil.SubscribedUntil != nil && profil.SubscribedUntil.Before(now) {
		return &loginRejection{
			status:  http.StatusUnauthorized,
			code:    CodeUnauthorized,
			message: msgLoginExpired,
			detail:  "langganan berakhir",
		}
	}

	if !profil.Active {
		return &loginRejection{
			status:  http.StatusUnauthorized,
			code:    CodeUnauthorized,
			message: msgLoginCredentials,
			detail:  "akun nonaktif",
		}
	}

	if menit, terkunci := sisaMenit(profil.LockedUntil, now); terkunci {
		jam := profil.LockedUntil.In(time.Local).Format("15.04")
		return &loginRejection{
			status:  http.StatusLocked,
			code:    CodeAccountLocked,
			message: "Akun terkunci. Coba lagi sekitar " + jam + " (" + strconv.Itoa(menit) + " menit) atau hubungi atasan.",
			detail:  "akun terkunci",
			extra:   map[string]any{"retryAfterMs": menit * 60 * 1000},
			headers: map[string]string{"Retry-After": strconv.Itoa(menit * 60)},
		}
	}

	if menit, jeda := sisaMenit(profil.CooldownUntil, now); jeda {
		return &loginRejection{
			status:  http.StatusTooManyRequests,
			code:    CodeAccountCooldown,
			message: "Terlalu banyak percobaan. Coba lagi dalam " + strconv.Itoa(menit) + " menit.",
			detail:  "terlalu banyak percobaan",
			extra:   map[string]any{"retryAfterMs": menit * 60 * 1000},
			headers: map[string]string{"Retry-After": strconv.Itoa(menit * 60)},
		}
	}

	return nil
}

// verifyCredentials memeriksa password + email confirmation. Nil = lolos.
func (s *Server) verifyCredentials(ctx context.Context, user *db.AuthUser, profil *db.LoginProfile, password string) *loginRejection {
	if user.EncryptedPassword == nil || !auth.VerifyPassword(*user.EncryptedPassword, password) {
		if profil != nil {
			if _, err := s.db.RegisterLoginFailure(ctx, profil.UserID); err != nil {
				s.log.Error("gagal mencatat kegagalan login", "err", err)
			}
		}
		return &loginRejection{
			status:  http.StatusUnauthorized,
			code:    CodeUnauthorized,
			message: msgLoginCredentials,
			detail:  "password salah",
		}
	}

	if user.EmailConfirmedAt == nil {
		return &loginRejection{
			status:  http.StatusForbidden,
			code:    CodeForbidden,
			message: msgLoginUnverified,
			detail:  "email belum diverifikasi",
		}
	}

	return nil
}

// createLoginSession membuat token + cookie, lalu memulai pekerjaan pasca-login.
func (s *Server) createLoginSession(w http.ResponseWriter, r *http.Request, userID, email string, ownerID *string, ip, userAgent string, now time.Time) error {
	token, hash, err := auth.NewToken()
	if err != nil {
		return err
	}

	if err := s.db.CreateSession(r.Context(), hash, userID, now.Add(s.cfg.SessionTTL), userAgent, ip); err != nil {
		return err
	}

	http.SetCookie(w, auth.Cookie(token, s.cfg.SessionTTL, s.cookieSecure(r)))

	go s.afterLoginSuccess(userID, email, ownerID, ip, userAgent)

	return nil
}

// afterLoginSuccess melunasi penalti dan mencatat keberhasilan.
func (s *Server) afterLoginSuccess(userID, email string, ownerID *string, ip, userAgent string) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := s.db.ResetLoginFailures(ctx, userID); err != nil {
		s.log.Error("gagal mereset penalti login", "err", err)
	}

	// Paritas backend Next: login sukses memakai `owner_id || user_id`. Owner tidak
	// punya owner_id, jadi jejaknya harus memakai user_id sendiri supaya halaman
	// log login tenant menampilkan aktivitas login owner.
	if ownerID == nil {
		ownerID = &userID
	}

	detail := "login berhasil"
	if err := s.db.InsertLoginLog(ctx, db.LoginLog{
		Email: email, OwnerID: ownerID, Event: "login_sukses",
		Detail: &detail, IP: ip, UserAgent: userAgent,
	}); err != nil {
		s.log.Error("gagal mencatat login sukses", "err", err)
	}
}

// logLoginAttempt menulis satu baris login_logs. Ditulis sinkron karena baris ini
// yang dihitung pembatasan laju pada percobaan berikutnya.
func (s *Server) logLoginAttempt(email string, ownerID *string, ip, userAgent, event, detail string) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	if err := s.db.InsertLoginLog(ctx, db.LoginLog{
		Email: email, OwnerID: ownerID, Event: event, Detail: &detail,
		IP: ip, UserAgent: userAgent,
	}); err != nil {
		s.log.Error("gagal mencatat percobaan login", "err", err, "event", event)
	}
}

// sisaMenit mengubah batas waktu penalti menjadi sisa menit yang dibulatkan ke atas.
func sisaMenit(until *time.Time, now time.Time) (int, bool) {
	if until == nil || !until.After(now) {
		return 0, false
	}
	menit := int(math.Ceil(until.Sub(now).Minutes()))
	if menit < 1 {
		menit = 1
	}
	return menit, true
}

// clientIP mengambil IP asli di balik nginx/Cloudflare.
func clientIP(r *http.Request) string {
	if v := r.Header.Get("X-Forwarded-For"); v != "" {
		first, _, _ := strings.Cut(v, ",")
		if ip := strings.TrimSpace(first); ip != "" {
			return ip
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

// cookieSecure menandai cookie Secure kalau koneksi ke klien memang HTTPS.
func (s *Server) cookieSecure(r *http.Request) bool {
	return s.cfg.CookieSecure || r.TLS != nil || strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https")
}

// looksLikeEmail adalah pemeriksaan bentuk minimum, bukan validasi RFC.
func looksLikeEmail(s string) bool {
	at := strings.IndexByte(s, '@')
	if at <= 0 || at == len(s)-1 {
		return false
	}
	domain := s[at+1:]
	return strings.Contains(domain, ".") && !strings.Contains(domain, "@") && !strings.ContainsAny(s, " \t\r\n")
}
