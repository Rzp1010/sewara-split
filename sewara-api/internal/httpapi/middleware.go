package httpapi

import (
	"net/http"
	"runtime/debug"
	"time"
)

// statusRecorder diperlukan karena http.ResponseWriter tidak menyimpan status.
type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (r *statusRecorder) WriteHeader(status int) {
	r.status = status
	r.ResponseWriter.WriteHeader(status)
}

func (r *statusRecorder) Write(b []byte) (int, error) {
	if r.status == 0 {
		r.status = http.StatusOK
	}
	return r.ResponseWriter.Write(b)
}

func (s *Server) logRequests(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rec := &statusRecorder{ResponseWriter: w}

		next.ServeHTTP(rec, r)

		if rec.status == 0 {
			rec.status = http.StatusOK
		}
		s.log.Info("request",
			"method", r.Method,
			"path", r.URL.Path,
			"status", rec.status,
			"dur_ms", time.Since(start).Milliseconds(),
		)
	})
}

// recoverPanic mencegah satu handler yang panik menjatuhkan proses.
// Stack trace dicatat, klien hanya menerima envelope error standar.
func (s *Server) recoverPanic(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if v := recover(); v != nil {
				s.log.Error("panic pada handler",
					"path", r.URL.Path,
					"panic", v,
					"stack", string(debug.Stack()),
				)
				writeError(w, http.StatusInternalServerError, CodeInternalError, "Terjadi kesalahan server. Coba lagi.")
			}
		}()
		next.ServeHTTP(w, r)
	})
}
