package httpapi

import (
	"log/slog"
	"net/http"

	"github.com/Rzp1010/sewara-split/sewara-api/internal/config"
	"github.com/Rzp1010/sewara-split/sewara-api/internal/db"
	"github.com/Rzp1010/sewara-split/sewara-api/internal/storage"
)

// Server memegang dependensi secara eksplisit. Tidak ada global atau singleton.
type Server struct {
	cfg   config.Config
	log   *slog.Logger
	db    *db.DB
	store *storage.Store
}

func New(cfg config.Config, log *slog.Logger, database *db.DB, store *storage.Store) http.Handler {
	s := &Server{cfg: cfg, log: log, db: database, store: store}

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
	mux.HandleFunc("PATCH /api/member-types/{id}", s.requireAuth(s.handleMemberTypesPatch))
	mux.HandleFunc("DELETE /api/member-types/{id}", s.requireAuth(s.handleMemberTypesDelete))
	mux.HandleFunc("GET /api/profiles", s.requireAuth(s.handleProfilesGet))
	mux.HandleFunc("GET /api/dashboard", s.requireAuth(s.handleDashboardGet))
	mux.HandleFunc("GET /api/inventory", s.requireAuth(s.handleInventoryGet))
	mux.HandleFunc("POST /api/inventory", s.requireAuth(s.handleInventoryPost))
	mux.HandleFunc("POST /api/inventory/bulk-delete", s.requireAuth(s.handleInventoryBulkDelete))
	mux.HandleFunc("PATCH /api/inventory/{id}", s.requireAuth(s.handleInventoryPatch))
	mux.HandleFunc("DELETE /api/inventory/{id}", s.requireAuth(s.handleInventoryDelete))

	// Blacklist. `check` didaftarkan sebelum `{id}` supaya path statis tidak
	// tertangkap sebagai id — ServeMux memilih pola paling spesifik, tapi urutan
	// tulis yang eksplisit membuat niatnya terbaca.
	mux.HandleFunc("GET /api/blacklist", s.requireAuth(s.handleBlacklistGet))
	mux.HandleFunc("POST /api/blacklist", s.requireAuth(s.handleBlacklistPost))
	mux.HandleFunc("GET /api/blacklist/check", s.requireAuth(s.handleBlacklistCheck))
	mux.HandleFunc("POST /api/blacklist/upload", s.requireAuth(s.handleBlacklistUpload))
	mux.HandleFunc("GET /api/blacklist/header", s.requireAuth(s.handleBlacklistHeader))
	mux.HandleFunc("PATCH /api/blacklist/{id}", s.requireAuth(s.handleBlacklistPatch))
	mux.HandleFunc("DELETE /api/blacklist/{id}", s.requireAuth(s.handleBlacklistDelete))

	// Promo.
	mux.HandleFunc("GET /api/promo", s.requireAuth(s.handlePromoGet))
	mux.HandleFunc("POST /api/promo", s.requireAuth(s.handlePromoPost))
	mux.HandleFunc("POST /api/promo/validate", s.requireAuth(s.handlePromoValidate))
	mux.HandleFunc("POST /api/promo/use", s.requireAuth(s.handlePromoUse))
	mux.HandleFunc("PATCH /api/promo/{id}", s.requireAuth(s.handlePromoPatch))
	mux.HandleFunc("DELETE /api/promo/{id}", s.requireAuth(s.handlePromoDelete))

	// Members.
	mux.HandleFunc("GET /api/members", s.requireAuth(s.handleMembersGet))
	mux.HandleFunc("POST /api/members", s.requireAuth(s.handleMembersPost))
	mux.HandleFunc("PATCH /api/members/{id}", s.requireAuth(s.handleMembersPatch))
	mux.HandleFunc("DELETE /api/members/{id}", s.requireAuth(s.handleMembersDelete))

	// Transactions.
	mux.HandleFunc("GET /api/transactions", s.requireAuth(s.handleTransactionsGet))
	mux.HandleFunc("POST /api/transactions", s.requireAuth(s.handleTransactionsPost))
	mux.HandleFunc("GET /api/transactions/{id}", s.requireAuth(s.handleTransactionsDetailGet))
	mux.HandleFunc("PATCH /api/transactions/{id}", s.requireAuth(s.handleTransactionsDetailPatch))

	// Transaction items.
	mux.HandleFunc("GET /api/transaction-items", s.requireAuth(s.handleTransactionItemsGet))
	mux.HandleFunc("POST /api/transaction-items", s.requireAuth(s.handleTransactionItemsPost))

	// Logs. `GET /api/logs/login` tidak bentrok dengan `GET /api/logs`:
	// ServeMux mencocokkan pola tanpa trailing slash secara eksak.
	mux.HandleFunc("GET /api/logs", s.requireAuth(s.handleLogsGet))
	mux.HandleFunc("POST /api/logs", s.requireAuth(s.handleLogsPost))
	mux.HandleFunc("DELETE /api/logs", s.requireAuth(s.handleLogsDelete))
	mux.HandleFunc("GET /api/logs/login", s.requireAuth(s.handleLogsLoginGet))

	// Manajemen (dashboard/admin). `GET /api/admin/logs` tidak bentrok dengan
	// `GET /api/admin/users` — pola ServeMux eksak tanpa trailing slash.
	mux.HandleFunc("GET /api/dashboard/manajemen", s.requireAuth(s.handleManajemenGet))
	mux.HandleFunc("GET /api/admin/users", s.requireAuth(s.handleAdminUsersGet))
	mux.HandleFunc("POST /api/admin/users", s.requireAuth(s.handleAdminUsersPost))
	mux.HandleFunc("PATCH /api/admin/users", s.requireAuth(s.handleAdminUsersPatch))
	mux.HandleFunc("DELETE /api/admin/users", s.requireAuth(s.handleAdminUsersDelete))
	mux.HandleFunc("GET /api/admin/logs", s.requireAuth(s.handleAdminLogsGet))
	mux.HandleFunc("POST /api/admin/data", s.requireAuth(s.handleAdminDataPost))

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
