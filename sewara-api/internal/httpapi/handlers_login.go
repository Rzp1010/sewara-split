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
	// Body login tidak butuh ruang besar; batas ini menutup kiriman sampah.
	maxLoginBodyBytes = 4 << 10
)

// handleLogin memverifikasi kredensial lalu menerbitkan cookie sesi.
//
// Urutan pemeriksaan sengaja sama dengan backend Next: status akun, langganan,
// pembatasan laju, baru password. Mengubah urutannya mengubah pesan yang dilihat
// pengguna, jadi urutan ini adalah bagian dari kontrak, bukan selera.
func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Email    *string `json:"email"`
		Password *string `json:"password"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, maxLoginBodyBytes)).Decode(&body); err != nil {
		writeValidationError(w, msgLoginValidation, nil)
		return
	}
	// Pointer, bukan string: field yang tidak dikirim harus bisa dibedakan dari
	// string kosong. Zod di backend lama juga membedakan keduanya.
	if body.Email == nil || body.Password == nil {
		writeValidationError(w, msgLoginValidation, nil)
		return
	}
	email := strings.ToLower(strings.TrimSpace(*body.Email))
	if !looksLikeEmail(email) {
		writeValidationError(w, msgLoginValidation, nil)
		return
	}

	now := time.Now()
	ip := clientIP(r)
	userAgent := r.UserAgent()

	counts, err := s.db.CountRecentLoginFailures(r.Context(), email, ip, now.Add(-loginFailureWindow))
	if err != nil {
		// Pembatasan laju adalah lapisan tambahan. Database yang tersendat tidak
		// boleh membuat pengguna sah tidak bisa masuk sama sekali.
		s.log.Error("gagal menghitung percobaan login", "err", err)
		counts = db.LoginFailureCounts{}
	}

	user, userErr := s.db.AuthUserByEmail(r.Context(), email)
	if userErr != nil && !errors.Is(userErr, db.ErrNotFound) {
		s.log.Error("gagal membaca kredensial", "err", userErr)
		writeError(w, http.StatusInternalServerError, CodeInternalError, "Terjadi kesalahan server. Coba lagi.")
		return
	}

	var profil *db.LoginProfile
	if userErr == nil {
		p, err := s.db.LoadLoginProfile(r.Context(), user.ID)
		switch {
		case err == nil:
			profil = &p
		case errors.Is(err, db.ErrNotFound):
			// Kredensial ada, profil tidak. Akun setengah jadi: tanpa profil tidak
			// ada satu pun route yang bisa dipakai, jadi sesi tidak perlu diterbitkan.
			s.log.Warn("akun tanpa profil", "email", email)
		default:
			s.log.Error("gagal membaca profil login", "err", err)
			writeError(w, http.StatusInternalServerError, CodeInternalError, "Terjadi kesalahan server. Coba lagi.")
			return
		}
	}

	var ownerID *string
	if profil != nil {
		ownerID = profil.OwnerID
	}

	// reject mencatat percobaan lalu membalas. Semua penolakan lewat sini supaya
	// jejak login_logs tidak bisa terlewat di salah satu cabang — tabel itu juga
	// yang menjadi dasar pembatasan laju berikutnya.
	reject := func(status int, code, message, detail string, extra map[string]any, headers map[string]string) {
		s.logLoginAttempt(email, ownerID, ip, userAgent, "login_gagal", detail)
		writeErrorExtra(w, status, code, message, extra, headers)
	}

	if profil != nil {
		if profil.Status != nil && *profil.Status == "menunggu" {
			reject(http.StatusForbidden, CodeForbidden, msgLoginWaiting, "akun menunggu persetujuan", nil, nil)
			return
		}
		if profil.SubscribedUntil != nil && profil.SubscribedUntil.Before(now) {
			reject(http.StatusUnauthorized, CodeUnauthorized, msgLoginExpired, "langganan berakhir", nil, nil)
			return
		}
		if !profil.Active {
			// Pesan sengaja sama dengan password salah: menonaktifkan akun tidak
			// perlu diumumkan ke orang yang mencoba masuk.
			reject(http.StatusUnauthorized, CodeUnauthorized, msgLoginCredentials, "akun nonaktif", nil, nil)
			return
		}
		if menit, terkunci := sisaMenit(profil.LockedUntil, now); terkunci {
			jam := profil.LockedUntil.In(time.Local).Format("15.04")
			pesan := "Akun terkunci. Coba lagi sekitar " + jam + " (" + strconv.Itoa(menit) + " menit) atau hubungi atasan."
			reject(http.StatusLocked, CodeAccountLocked, pesan, "akun terkunci",
				map[string]any{"retryAfterMs": menit * 60 * 1000},
				map[string]string{"Retry-After": strconv.Itoa(menit * 60)})
			return
		}
		if menit, jeda := sisaMenit(profil.CooldownUntil, now); jeda {
			pesan := "Terlalu banyak percobaan. Coba lagi dalam " + strconv.Itoa(menit) + " menit."
			reject(http.StatusTooManyRequests, CodeAccountCooldown, pesan, "terlalu banyak percobaan",
				map[string]any{"retryAfterMs": menit * 60 * 1000},
				map[string]string{"Retry-After": strconv.Itoa(menit * 60)})
			return
		}
	}

	if counts.IP >= loginIPFailureLimit || counts.Email >= loginEmailFailureLimit {
		alasan := "email"
		if counts.IP >= loginIPFailureLimit {
			alasan = "ip"
		}
		reject(http.StatusTooManyRequests, CodeRateLimitExceeded, msgLoginRateLimit, "rate limit "+alasan,
			map[string]any{"retryAfterMs": int(loginFailureWindow.Milliseconds())},
			map[string]string{"Retry-After": "600"})
		return
	}

	if userErr != nil {
		reject(http.StatusUnauthorized, CodeUnauthorized, msgLoginCredentials, "email tidak dikenal", nil, nil)
		return
	}

	// Password diperiksa sebelum status verifikasi email: Supabase pun membalas
	// "Email not confirmed" hanya kalau passwordnya benar, sehingga pesan itu
	// tidak bisa dipakai menebak password orang lain.
	if user.EncryptedPassword == nil || !auth.VerifyPassword(*user.EncryptedPassword, *body.Password) {
		if profil != nil {
			if _, err := s.db.RegisterLoginFailure(r.Context(), profil.UserID); err != nil {
				s.log.Error("gagal mencatat kegagalan login", "err", err)
			}
		}
		reject(http.StatusUnauthorized, CodeUnauthorized, msgLoginCredentials, "password salah", nil, nil)
		return
	}

	if user.EmailConfirmedAt == nil {
		reject(http.StatusForbidden, CodeForbidden, msgLoginUnverified, "email belum diverifikasi", nil, nil)
		return
	}

	token, hash, err := auth.NewToken()
	if err != nil {
		s.log.Error("gagal membuat token sesi", "err", err)
		writeError(w, http.StatusInternalServerError, CodeInternalError, "Terjadi kesalahan server. Coba lagi.")
		return
	}

	if err := s.db.CreateSession(r.Context(), hash, user.ID, now.Add(s.cfg.SessionTTL), userAgent, ip); err != nil {
		s.log.Error("gagal menyimpan sesi", "err", err)
		writeError(w, http.StatusInternalServerError, CodeInternalError, "Terjadi kesalahan server. Coba lagi.")
		return
	}

	http.SetCookie(w, auth.Cookie(token, s.cfg.SessionTTL, s.cookieSecure(r)))

	// Pekerjaan pasca-login tidak menahan respons: kalau gagal, pengguna tetap
	// sudah masuk dan kegagalannya hanya kehilangan satu baris catatan.
	go s.afterLoginSuccess(user.ID, email, ownerID, ip, userAgent)

	writeSuccess(w, http.StatusOK, map[string]any{"ok": true})
}

// afterLoginSuccess melunasi penalti dan mencatat keberhasilan.
func (s *Server) afterLoginSuccess(userID, email string, ownerID *string, ip, userAgent string) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := s.db.ResetLoginFailures(ctx, userID); err != nil {
		s.log.Error("gagal mereset penalti login", "err", err)
	}

	detail := "login berhasil"
	if err := s.db.InsertLoginLog(ctx, db.LoginLog{
		Email: email, OwnerID: ownerID, Event: "login_sukses",
		Detail: &detail, IP: ip, UserAgent: userAgent,
	}); err != nil {
		s.log.Error("gagal mencatat login sukses", "err", err)
	}

	// Catatan: notifikasi Telegram login belum dipindahkan. Backend lama
	// mengirimnya lewat lib/services/telegram.ts; penggantinya masuk W2 bersama
	// pengiriman email (lihat docs/rencana-migrasi-go-2026-10-27.md).
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
// Batas waktu yang sudah lewat (atau kosong) berarti tidak ada penalti.
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
// Tanpa X-Forwarded-For (mis. saat pengembangan langsung), RemoteAddr dipakai.
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
// Di produksi nilai ini sudah benar dari config; header dipakai untuk kasus
// nginx yang meneruskan HTTP ke aplikasi.
func (s *Server) cookieSecure(r *http.Request) bool {
	return s.cfg.CookieSecure || r.TLS != nil || strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https")
}

// looksLikeEmail adalah pemeriksaan bentuk minimum, bukan validasi RFC.
// Tujuannya menolak masukan yang jelas salah tanpa menolak alamat sah yang aneh.
func looksLikeEmail(s string) bool {
	at := strings.IndexByte(s, '@')
	if at <= 0 || at == len(s)-1 {
		return false
	}
	domain := s[at+1:]
	return strings.Contains(domain, ".") && !strings.Contains(domain, "@") && !strings.ContainsAny(s, " \t\r\n")
}
