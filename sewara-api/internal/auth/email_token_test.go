package auth

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"strings"
	"testing"
	"time"
)

// b64 menyandikan payload mentah sama seperti produksi (base64url tanpa padding).
func b64(payload string) string {
	return base64.RawURLEncoding.EncodeToString([]byte(payload))
}

// b64Sig menghitung tanda tangan HMAC-SHA256 atas payload lalu menyandikannya.
func b64Sig(secret, payload string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(payload))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

func TestEmailTokenSignVerify(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	exp := now.Add(time.Hour)
	tok := SignEmailToken("rahasia", "user-123", exp)

	if got, ok := VerifyEmailToken("rahasia", tok, now); !ok || got != "user-123" {
		t.Fatalf("token sah ditolak: got=%q ok=%v", got, ok)
	}
}

func TestEmailTokenMenolakTandaTanganSalah(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	tok := SignEmailToken("rahasia", "user-123", now.Add(time.Hour))

	if _, ok := VerifyEmailToken("rahasia-lain", tok, now); ok {
		t.Fatal("secret salah harus ditolak")
	}

	parts := strings.SplitN(tok, ".", 2)
	tampered := parts[0] + "." + parts[1][:len(parts[1])-1] + "X"
	if _, ok := VerifyEmailToken("rahasia", tampered, now); ok {
		t.Fatal("tanda tangan diubah harus ditolak")
	}
}

func TestEmailTokenMenolakPayloadRusak(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	for _, tc := range []struct {
		nama  string
		token string
	}{
		{"tanpa pemisah", "aGVsbG8"},
		{"payload bukan base64", "!!!.###"},
		{"payload tanpa pipa", b64("tanpapipa") + "." + b64Sig("rahasia", "tanpapipa")},
		{"expiry bukan angka", b64("user|abc") + "." + b64Sig("rahasia", "user|abc")},
		{"user kosong", b64("|9999999999") + "." + b64Sig("rahasia", "|9999999999")},
	} {
		t.Run(tc.nama, func(t *testing.T) {
			if _, ok := VerifyEmailToken("rahasia", tc.token, now); ok {
				t.Fatalf("token rusak diterima: %q", tc.token)
			}
		})
	}
}

func TestEmailTokenMenolakKedaluwarsa(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	tok := SignEmailToken("rahasia", "user-123", now.Add(-time.Second))

	if _, ok := VerifyEmailToken("rahasia", tok, now); ok {
		t.Fatal("token kedaluwarsa harus ditolak")
	}
	// Tepat pada batas: now == exp juga kedaluwarsa (now.Before(exp) false).
	tokTepat := SignEmailToken("rahasia", "user-123", now)
	if _, ok := VerifyEmailToken("rahasia", tokTepat, now); ok {
		t.Fatal("token tepat pada expiry harus ditolak")
	}
}
