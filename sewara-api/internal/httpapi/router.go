package httpapi

import (
	"log/slog"
	"net/http"

	"github.com/Rzp1010/sewara-split/sewara-api/internal/config"
	"github.com/Rzp1010/sewara-split/sewara-api/internal/db"
)

// Server memegang dependensi secara eksplisit. Tidak ada global atau singleton.
type Server struct {
	cfg config.Config
	log *slog.Logger
	db  *db.DB
}

func New(cfg config.Config, log *slog.Logger, database *db.DB) http.Handler {
	s := &Server{cfg: cfg, log: log, db: database}

	mux := http.NewServeMux()

	// Rute ditulis eksplisit per method. Penambahan route baru masuk daftar ini
	// dan harus terdaftar di docs/endpoint-matrix.md.
	mux.HandleFunc("GET /api/health", s.handleHealth)
	mux.HandleFunc("POST /api/auth/login", s.handleLogin)
	mux.HandleFunc("GET /api/auth/me", s.requireAuth(s.handleMe))
	mux.HandleFunc("GET /api/settings", s.requireAuth(s.handleSettingsGet))
	mux.HandleFunc("POST /api/settings", s.requireAuth(s.handleSettingsPost))
	mux.HandleFunc("GET /api/member-types", s.requireAuth(s.handleMemberTypesGet))
	mux.HandleFunc("POST /api/member-types", s.requireAuth(s.handleMemberTypesPost))
	mux.HandleFunc("GET /api/profiles", s.requireAuth(s.handleProfilesGet))
	mux.HandleFunc("GET /api/dashboard", s.requireAuth(s.handleDashboardGet))
	mux.HandleFunc("GET /api/inventory", s.requireAuth(s.handleInventoryGet))
	mux.HandleFunc("POST /api/inventory", s.requireAuth(s.handleInventoryPost))

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
