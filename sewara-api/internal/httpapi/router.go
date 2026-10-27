package httpapi

import (
	"log/slog"
	"net/http"

	"github.com/Rzp1010/sewara-split/sewara-api/internal/config"
)

// Server memegang dependensi secara eksplisit. Tidak ada global atau singleton.
// W1 menambahkan db *tenant.DB di sini.
type Server struct {
	cfg config.Config
	log *slog.Logger
}

func New(cfg config.Config, log *slog.Logger) http.Handler {
	s := &Server{cfg: cfg, log: log}

	mux := http.NewServeMux()

	// Rute ditulis eksplisit per method. Penambahan route baru masuk daftar ini
	// dan harus terdaftar di docs/endpoint-matrix.md.
	mux.HandleFunc("GET /api/health", s.handleHealth)

	// Fallback supaya 404 tetap memakai envelope standar, bukan teks polos.
	mux.HandleFunc("/", s.handleNotFound)

	return s.recoverPanic(s.logRequests(mux))
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	writeSuccess(w, http.StatusOK, map[string]string{
		"status": "ok",
		"env":    s.cfg.Env,
	})
}

func (s *Server) handleNotFound(w http.ResponseWriter, r *http.Request) {
	writeError(w, http.StatusNotFound, CodeNotFound, "Endpoint tidak ditemukan.")
}
