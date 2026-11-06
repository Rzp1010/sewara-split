package httpapi

import (
	"net/http"
	"strings"
)

// cors mengizinkan frontend yang beda origin (dev: UI :3002, API :4000) memakai
// API ini. Daftar origin kosong = middleware tidak dipasang, jadi produksi
// (nginx menyajikan UI + API dalam satu origin) tidak berubah perilakunya.
//
// Origin dicocokkan persis, bukan prefix, karena Allow-Credentials aktif:
// cookie sesi ikut terkirim, jadi asal permintaan harus diketahui pasti.
func cors(origins []string, next http.Handler) http.Handler {
	if len(origins) == 0 {
		return next
	}
	izin := make(map[string]bool, len(origins))
	for _, o := range origins {
		izin[o] = true
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin == "" || !izin[origin] {
			next.ServeHTTP(w, r)
			return
		}
		h := w.Header()
		h.Set("Access-Control-Allow-Origin", origin)
		h.Set("Access-Control-Allow-Credentials", "true")
		h.Add("Vary", "Origin")
		if r.Method == http.MethodOptions {
			h.Set("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
			h.Set("Access-Control-Allow-Headers", strings.Join([]string{"Content-Type", "X-Requested-With"}, ", "))
			h.Set("Access-Control-Max-Age", "600")
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}
