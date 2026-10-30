package auth

import (
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"strconv"
	"strings"
	"time"
)

// Token verifikasi email bersifat stateless: tidak ada tabel token, tidak ada
// migration. Payloadnya `userID|unixExpiry` dan ditandatangani HMAC-SHA256
// dengan EMAIL_TOKEN_SECRET. Verifikasi hanya membutuhkan rahasia + waktu
// sekarang, jadi tidak ada state yang perlu dibersihkan.
//
// Token dikirim lewat query string, jadi penyandiannya base64url tanpa padding
// (aman sebagai URL) dan hasilnya `<payload>.<signature>`.

// SignEmailToken membuat token verifikasi untuk userID yang kedaluwarsa pada exp.
func SignEmailToken(secret, userID string, exp time.Time) string {
	payload := userID + "|" + strconv.FormatInt(exp.Unix(), 10)
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(payload))
	return base64.RawURLEncoding.EncodeToString([]byte(payload)) +
		"." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

// VerifyEmailToken memeriksa tanda tangan, bentuk payload, dan masa berlaku.
//
// Menolak (ok=false) kalau: token tanpa pemisah, base64 rusak, tanda tangan
// tidak cocok, payload tidak berisi `userID|expiry`, atau sudah kedaluwarsa.
// Perbandingan tanda tangan memakai ConstantTimeCompare supaya tidak bocor
// lewat waktu eksekusi.
func VerifyEmailToken(secret, token string, now time.Time) (string, bool) {
	enc, sigEnc, ok := strings.Cut(token, ".")
	if !ok {
		return "", false
	}
	payloadBytes, err := base64.RawURLEncoding.DecodeString(enc)
	if err != nil {
		return "", false
	}
	sig, err := base64.RawURLEncoding.DecodeString(sigEnc)
	if err != nil {
		return "", false
	}

	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(payloadBytes)
	if subtle.ConstantTimeCompare(mac.Sum(nil), sig) != 1 {
		return "", false
	}

	userID, expStr, ok := strings.Cut(string(payloadBytes), "|")
	if !ok || userID == "" {
		return "", false
	}
	expUnix, err := strconv.ParseInt(expStr, 10, 64)
	if err != nil {
		return "", false
	}
	if !now.Before(time.Unix(expUnix, 0)) {
		return "", false
	}
	return userID, true
}
