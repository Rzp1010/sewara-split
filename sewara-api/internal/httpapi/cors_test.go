package httpapi

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestCorsOriginDiizinkan(t *testing.T) {
	dipanggil := false
	h := cors([]string{"http://localhost:3002"}, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		dipanggil = true
		w.WriteHeader(http.StatusOK)
	}))

	// Preflight: dijawab middleware, handler tidak boleh jalan.
	req := httptest.NewRequest(http.MethodOptions, "/api/pelanggan", nil)
	req.Header.Set("Origin", "http://localhost:3002")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("preflight status = %d, mau %d", rec.Code, http.StatusNoContent)
	}
	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "http://localhost:3002" {
		t.Fatalf("Allow-Origin = %q", got)
	}
	if got := rec.Header().Get("Access-Control-Allow-Credentials"); got != "true" {
		t.Fatalf("Allow-Credentials = %q", got)
	}
	if got := rec.Header().Get("Access-Control-Allow-Methods"); got == "" {
		t.Fatal("Allow-Methods kosong")
	}
	if dipanggil {
		t.Fatal("handler jalan pada preflight")
	}

	// Permintaan biasa: handler jalan + header CORS ikut.
	req = httptest.NewRequest(http.MethodGet, "/api/pelanggan", nil)
	req.Header.Set("Origin", "http://localhost:3002")
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if !dipanggil {
		t.Fatal("handler tidak jalan pada GET")
	}
	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "http://localhost:3002" {
		t.Fatalf("Allow-Origin GET = %q", got)
	}
}

func TestCorsOriginAsingDitolak(t *testing.T) {
	dipanggil := false
	h := cors([]string{"http://localhost:3002"}, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		dipanggil = true
	}))
	req := httptest.NewRequest(http.MethodGet, "/api/pelanggan", nil)
	req.Header.Set("Origin", "http://jahat.example")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if !dipanggil {
		t.Fatal("handler harus tetap jalan; penolakan dilakukan browser")
	}
	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "" {
		t.Fatalf("origin asing tidak boleh diizinkan, dapat %q", got)
	}
}

func TestCorsMatiTanpaDaftarOrigin(t *testing.T) {
	dipanggil := false
	h := cors(nil, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		dipanggil = true
	}))
	req := httptest.NewRequest(http.MethodOptions, "/api/pelanggan", nil)
	req.Header.Set("Origin", "http://localhost:3002")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if !dipanggil {
		t.Fatal("tanpa daftar origin, middleware harus tembus langsung")
	}
	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "" {
		t.Fatalf("header CORS muncul padahal mati: %q", got)
	}
}
