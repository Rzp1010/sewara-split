package httpapi

import (
	"net/http"
	"strings"
	"testing"
)

func TestSanitizeErrorCode(t *testing.T) {
	for _, tc := range []struct {
		nama string
		in   string
		want string
		ok   bool
	}{
		{"snake", "access_denied", "access_denied", true},
		{"campuran", "OTP_expired", "OTP_expired", true},
		{"titikdua strip", "a:b-c", "a:b-c", true},
		{"kosong", "", "", false},
		{"65 karakter", strings.Repeat("a", 65), "", false},
		{"64 karakter", strings.Repeat("a", 64), strings.Repeat("a", 64), true},
		{"spasi", "has space", "", false},
		{"titik", "dot.dot", "", false},
	} {
		t.Run(tc.nama, func(t *testing.T) {
			got, ok := sanitizeErrorCode(tc.in)
			if ok != tc.ok || got != tc.want {
				t.Fatalf("sanitizeErrorCode(%q)=(%q,%v) want (%q,%v)", tc.in, got, ok, tc.want, tc.ok)
			}
		})
	}
}

func TestForwardedIP(t *testing.T) {
	r := &http.Request{Header: http.Header{}}
	r.Header.Set("X-Forwarded-For", "1.2.3.4, 5.6.7.8")
	if got := forwardedIP(r); got != "1.2.3.4" {
		t.Fatalf("forwardedIP multi=%q want 1.2.3.4", got)
	}

	r2 := &http.Request{Header: http.Header{}}
	r2.Header.Set("X-Forwarded-For", "  9.9.9.9  ")
	if got := forwardedIP(r2); got != "9.9.9.9" {
		t.Fatalf("forwardedIP spasi=%q want 9.9.9.9", got)
	}

	r3 := &http.Request{Header: http.Header{}}
	if got := forwardedIP(r3); got != "unknown" {
		t.Fatalf("forwardedIP kosong=%q want unknown", got)
	}
}

func TestAuthString(t *testing.T) {
	for _, tc := range []struct {
		in   any
		want string
	}{
		{nil, ""},
		{"abc", "abc"},
		{float64(12), "12"},
		{true, "true"},
	} {
		if got := authString(tc.in); got != tc.want {
			t.Fatalf("authString(%v)=%q want %q", tc.in, got, tc.want)
		}
	}
}
