// Package auth mengurus token sesi dan cookie. Tidak ada ketergantungan ke
// penyedia identitas eksternal: token dibuat di sini, hash-nya disimpan sendiri.
package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"net/http"
	"time"
)

// CookieName sengaja tidak memakai awalan `sb-` (Supabase) supaya cookie lama
// dari masa sebelumnya tidak pernah terbaca sebagai sesi yang sah.
const CookieName = "sewara_session"

// 32 byte = 256 bit entropi. Token dikirim sebagai base64url tanpa padding (43 karakter).
const tokenBytes = 32

// NewToken membuat token baru beserta hash yang disimpan di database.
//
// Yang dikirim ke klien hanya token mentah; database hanya menyimpan hash-nya.
// Dengan begitu isi tabel tidak bisa dipakai untuk membajak sesi.
func NewToken() (token string, hash []byte, err error) {
	buf := make([]byte, tokenBytes)
	if _, err := rand.Read(buf); err != nil {
		return "", nil, fmt.Errorf("membuat token sesi: %w", err)
	}
	token = base64.RawURLEncoding.EncodeToString(buf)
	return token, HashToken(token), nil
}

// HashToken menghasilkan SHA-256 dari token mentah.
// SHA-256 cukup di sini (bukan bcrypt) karena token punya entropi penuh 256 bit,
// bukan password yang bisa ditebak.
func HashToken(token string) []byte {
	sum := sha256.Sum256([]byte(token))
	return sum[:]
}

// Cookie membentuk cookie sesi. HttpOnly selalu aktif: JavaScript tidak boleh
// bisa membaca token, sehingga XSS tidak langsung berarti pengambilalihan sesi.
func Cookie(token string, ttl time.Duration, secure bool) *http.Cookie {
	return &http.Cookie{
		Name:     CookieName,
		Value:    token,
		Path:     "/",
		HttpOnly: true,
		Secure:   secure,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   int(ttl.Seconds()),
	}
}

// ClearedCookie dipakai saat logout: nilai kosong dengan MaxAge negatif
// memerintahkan browser menghapusnya.
func ClearedCookie(secure bool) *http.Cookie {
	return &http.Cookie{
		Name:     CookieName,
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		Secure:   secure,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   -1,
	}
}
