package httpapi

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/Rzp1010/sewara-split/sewara-api/internal/auth"
	"github.com/Rzp1010/sewara-split/sewara-api/internal/db"
)

// Pesan disalin apa adanya dari backend Next; uji kontrak membandingkan string.
const (
	msgRegisterEmail   = "Format email tidak valid."
	msgRegisterPass    = "Password minimal 8 karakter."
	msgRegisterNama    = "Nama lengkap wajib diisi."
	msgRegisterGeneric = "Terjadi kesalahan. Coba lagi."
	msgResendGeneric   = "Jika email terdaftar, email verifikasi akan dikirim."
	msgResendFail      = "Email belum dapat dikirim ulang. Coba lagi nanti."
	msgResendRateLimit = "Terlalu banyak permintaan. Coba lagi nanti."
)

const maxAuthBodyBytes = 4 << 10

// reEmailSederhana = /^[^\s@]+@[^\s@]+\.[^\s@]+$/ dari app/api/auth/register/route.ts.
var reEmailSederhana = regexp.MustCompile(`^[^\s@]+@[^\s@]+\.[^\s@]+$`)

// reErrorCode memakai aturan sanitasi Next: /^[a-z0-9_:-]{1,64}$/i.
var reErrorCode = regexp.MustCompile(`^[a-zA-Z0-9_:-]{1,64}$`)

// handleRegister: POST /api/auth/register.
//
// PERHATIAN paritas: jalur error Next memakai NextResponse.json({error}) mentah,
// BUKAN amplop {ok:false,error:{...}}. Jalur sukses memakai amplop {ok:true}.
func (s *Server) handleRegister(w http.ResponseWriter, r *http.Request) {
	raw := decodeAuthBody(r.Body)
	email := strings.ToLower(strings.TrimSpace(authString(raw["email"])))
	password := authString(raw["password"])
	namaLengkap := strings.TrimSpace(authString(raw["nama_lengkap"]))
	namaBisnis := strings.TrimSpace(authString(raw["nama_bisnis"]))

	if !reEmailSederhana.MatchString(email) {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": msgRegisterEmail})
		return
	}
	if len(password) < 8 {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": msgRegisterPass})
		return
	}
	if namaLengkap == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": msgRegisterNama})
		return
	}

	hash, err := auth.HashPassword(password)
	if err != nil {
		s.log.Error("register: hash password gagal", "err", err)
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": msgRegisterGeneric})
		return
	}

	invoice := namaBisnis
	if invoice == "" {
		invoice = namaLengkap
	}

	userID, created, err := s.db.RegisterUser(r.Context(), email, hash, namaLengkap, invoice)
	if err != nil {
		s.log.Error("register: membuat akun gagal", "err", err)
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": msgRegisterGeneric})
		return
	}

	// Hanya akun baru yang dicatat & dikirimi email. Email duplikat dibalas sukses
	// tanpa efek samping (paritas Next: identities kosong â†’ sukses tanpa upsert).
	if created {
		s.db.LogAdminAction(r.Context(), email, "daftar", email, "menunggu persetujuan")
		if err := s.kirimVerifikasi(r, userID, email, ""); err != nil {
			// Akun sudah terbuat; kegagalan kirim tidak membatalkan pendaftaran.
			s.log.Error("register: kirim email verifikasi gagal", "err", err, "email", email)
		}
	}

	writeSuccess(w, http.StatusOK, map[string]any{"ok": true})
}

// handleLogout: POST /api/auth/logout (wajib sesi).
func (s *Server) handleLogout(w http.ResponseWriter, r *http.Request, me db.Identity) {
	// Paritas Next: login_logs memakai `owner_id || user_id`.
	ownerID := me.OwnerID
	if ownerID == nil {
		id := me.UserID
		ownerID = &id
	}
	if err := s.db.InsertLoginLog(r.Context(), db.LoginLog{
		Email: me.Email, OwnerID: ownerID, Event: "logout",
		IP: clientIP(r), UserAgent: r.UserAgent(),
	}); err != nil {
		s.log.Error("logout: gagal mencatat log", "err", err)
	}

	if cookie, err := r.Cookie(auth.CookieName); err == nil && cookie.Value != "" {
		if err := s.db.DeleteSession(r.Context(), auth.HashToken(cookie.Value)); err != nil {
			s.log.Error("logout: gagal menghapus sesi", "err", err)
		}
	}

	http.SetCookie(w, auth.ClearedCookie(s.cookieSecure(r)))
	writeSuccess(w, http.StatusOK, nil)
}

// handleAuthCallback: GET /api/auth/callback.
//
// Beda dari Next (yang memakai `code` Supabase): di sini parameter verifikasi
// adalah `token`. Callback TIDAK membuat sesi â€” akun hasil register masih
// menunggu persetujuan superadmin, jadi login belum bisa dipakai.
func (s *Server) handleAuthCallback(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	token := q.Get("token")
	queryError := q.Get("error")
	errorCode := q.Get("error_code")

	if queryError != "" || errorCode != "" {
		// Paritas Next: `error_code` HANYA diambil dari parameter `error_code`,
		// tidak pernah diturunkan dari `error` (lihat resultRedirect() di
		// app/api/auth/callback/route.ts).
		s.redirectResult(w, r, true, errorCode)
		return
	}
	if token == "" {
		s.redirectResult(w, r, false, "")
		return
	}

	userID, ok := auth.VerifyEmailToken(s.cfg.EmailTokenSecret, token, time.Now())
	if !ok {
		s.redirectResult(w, r, true, "")
		return
	}
	if err := s.db.ConfirmEmail(r.Context(), userID); err != nil {
		s.log.Error("callback: konfirmasi email gagal", "err", err)
		s.redirectResult(w, r, true, "")
		return
	}
	s.redirectResult(w, r, false, "")
}

// redirectResult mengarahkan ke FRONTEND_URL. gagal â†’ `/?error=verification`
// (dengan error_code bila lolos sanitasi); selain itu `/auth/callback/success`.
func (s *Server) redirectResult(w http.ResponseWriter, r *http.Request, gagal bool, errorCode string) {
	base := s.cfg.FrontendURL
	if base == "" {
		base = "http://localhost:3000"
	}
	base = strings.TrimRight(base, "/")

	target := base + "/auth/callback/success"
	if gagal {
		u, err := url.Parse(base + "/")
		if err != nil {
			target = base + "/?error=verification"
		} else {
			qv := u.Query()
			qv.Set("error", "verification")
			if code, ok := sanitizeErrorCode(errorCode); ok {
				qv.Set("error_code", code)
			}
			u.RawQuery = qv.Encode()
			target = u.String()
		}
	}
	http.Redirect(w, r, target, http.StatusTemporaryRedirect)
}

// handleResendVerification: POST /api/auth/resend-verification.
//
// Balasan selalu generik untuk input tak valid / email tak dikenal (anti-enumeration).
func (s *Server) handleResendVerification(w http.ResponseWriter, r *http.Request) {
	raw := decodeAuthBody(r.Body)
	email := strings.ToLower(strings.TrimSpace(authString(raw["email"])))
	redirectTo := authString(raw["redirectTo"])

	if !reEmailSederhana.MatchString(email) {
		writeSuccess(w, http.StatusOK, resendGeneric())
		return
	}

	ip := forwardedIP(r)
	allowed, err := s.db.ReserveVerificationResend(r.Context(), email, ip)
	if err != nil {
		s.log.Error("resend: rate limiter gagal", "err", err)
		writeError(w, http.StatusInternalServerError, CodeInternalError, msgResendFail)
		return
	}
	if !allowed {
		writeError(w, http.StatusTooManyRequests, CodeRateLimitExceeded, msgResendRateLimit)
		return
	}

	user, err := s.db.AuthUserByEmail(r.Context(), email)
	if err != nil {
		if errors.Is(err, db.ErrNotFound) {
			// Email tak terdaftar â†’ tetap balas generik.
			writeSuccess(w, http.StatusOK, resendGeneric())
			return
		}
		s.log.Error("resend: membaca user gagal", "err", err)
		writeError(w, http.StatusInternalServerError, CodeInternalError, msgResendFail)
		return
	}

	if err := s.kirimVerifikasi(r, user.ID, email, redirectTo); err != nil {
		s.log.Error("resend: kirim email gagal", "err", err, "email", email)
		writeError(w, http.StatusBadGateway, CodeExternalServiceError, msgResendFail)
		return
	}
	writeSuccess(w, http.StatusOK, resendGeneric())
}

func resendGeneric() map[string]any {
	return map[string]any{"ok": true, "message": msgResendGeneric}
}

// kirimVerifikasi membangun tautan verifikasi lalu mengirimnya lewat s.mailer.
func (s *Server) kirimVerifikasi(r *http.Request, userID, email, redirectTo string) error {
	if s.mailer == nil {
		return errors.New("pengirim email tidak dikonfigurasi")
	}
	token := auth.SignEmailToken(s.cfg.EmailTokenSecret, userID, time.Now().Add(s.cfg.EmailTokenTTL))
	return s.mailer.SendVerification(r.Context(), email, s.verificationLink(r, redirectTo, token))
}

// verificationLink membangun `<base>/api/auth/callback?token=<token>`.
func (s *Server) verificationLink(r *http.Request, redirectTo, token string) string {
	u, err := url.Parse(s.verificationBase(r, redirectTo))
	if err != nil {
		return s.verificationBase(r, redirectTo) + "?token=" + url.QueryEscape(token)
	}
	q := u.Query()
	q.Set("token", token)
	u.RawQuery = q.Encode()
	return u.String()
}

// verificationBase menentukan basis tautan.
//
// redirectTo dipakai hanya kalau origin-nya sama dengan FRONTEND_URL. Kalau
// FRONTEND_URL kosong, origin yang dibandingkan adalah origin request. Bila
// tidak ada, fallback ke PUBLIC_API_URL; kalau itu pun kosong, diturunkan dari
// request (skema + host).
func (s *Server) verificationBase(r *http.Request, redirectTo string) string {
	allowedOrigin := ""
	if s.cfg.FrontendURL != "" {
		if u, err := url.Parse(s.cfg.FrontendURL); err == nil {
			allowedOrigin = u.Scheme + "://" + u.Host
		}
	}
	if redirectTo != "" {
		if c, err := url.Parse(redirectTo); err == nil && c.IsAbs() {
			if allowedOrigin == "" {
				allowedOrigin = requestOrigin(r)
			}
			if c.Scheme+"://"+c.Host == allowedOrigin {
				return strings.TrimRight(redirectTo, "/")
			}
		}
	}
	if s.cfg.PublicAPIURL != "" {
		return s.cfg.PublicAPIURL + "/api/auth/callback"
	}
	return requestOrigin(r) + "/api/auth/callback"
}

// requestOrigin menurunkan origin dari request; menghormati X-Forwarded-Proto di
// balik nginx/Cloudflare.
func requestOrigin(r *http.Request) string {
	scheme := "http"
	if r.TLS != nil || strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https") {
		scheme = "https"
	}
	return scheme + "://" + r.Host
}

// sanitizeErrorCode menerapkan aturan Next: hanya /^[a-z0-9_:-]{1,64}$/i yang lolos.
func sanitizeErrorCode(s string) (string, bool) {
	if s == "" || !reErrorCode.MatchString(s) {
		return "", false
	}
	return s, true
}

// forwardedIP mengambil IP pertama X-Forwarded-For; fallback "unknown" (paritas Next).
func forwardedIP(r *http.Request) string {
	if v := r.Header.Get("X-Forwarded-For"); v != "" {
		first, _, _ := strings.Cut(v, ",")
		if ip := strings.TrimSpace(first); ip != "" {
			return ip
		}
	}
	return "unknown"
}

// decodeAuthBody meniru `await request.json().catch(() => null)`: JSON rusak
// diperlakukan sebagai objek kosong, bukan error.
func decodeAuthBody(body io.Reader) map[string]any {
	var raw map[string]any
	_ = json.NewDecoder(io.LimitReader(body, maxAuthBodyBytes)).Decode(&raw)
	return raw
}

// authString meniru `String(x || "")`: null/nihil â†’ "", string apa adanya,
// tipe lain dikonversi ke bentuk teksnya.
func authString(v any) string {
	switch t := v.(type) {
	case nil:
		return ""
	case string:
		return t
	default:
		return fmt.Sprint(t)
	}
}
