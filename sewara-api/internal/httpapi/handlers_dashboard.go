package httpapi

import (
	"net/http"
	"time"

	"github.com/Rzp1010/sewara-split/sewara-api/internal/db"
)

// handleDashboardGet mengembalikan rekap status dan pembayaran untuk dashboard.
//
// Rentang tanggal opsional: `?mulai=` dan `?akhir=` (timestamp). Keduanya
// diteruskan mentah ke RPC, yang sudah menangani NULL sebagai "tanpa batas".
func (s *Server) handleDashboardGet(w http.ResponseWriter, r *http.Request, me db.Identity) {
	tenantID, err := s.db.TenantID(r.Context(), me.UserID)
	if err != nil {
		s.log.Error("gagal membaca tenant id", "err", err)
		writeError(w, http.StatusInternalServerError, CodeInternalError, "Terjadi kesalahan server. Coba lagi.")
		return
	}

	var mulai, akhir *string
	if v := r.URL.Query().Get("mulai"); v != "" {
		if _, err := time.Parse(time.RFC3339, v); err != nil {
			writeValidationError(w, "Format tanggal 'mulai' tidak valid (pakai RFC3339).", nil)
			return
		}
		mulai = &v
	}
	if v := r.URL.Query().Get("akhir"); v != "" {
		if _, err := time.Parse(time.RFC3339, v); err != nil {
			writeValidationError(w, "Format tanggal 'akhir' tidak valid (pakai RFC3339).", nil)
			return
		}
		akhir = &v
	}

	stats, err := s.db.DashboardStats(r.Context(), me.UserID, tenantID, mulai, akhir)
	if err != nil {
		s.log.Error("gagal membaca statistik dashboard", "err", err)
		writeError(w, http.StatusInternalServerError, CodeInternalError, "Terjadi kesalahan server. Coba lagi.")
		return
	}

	writeSuccess(w, http.StatusOK, map[string]any{
		"rekapStatus": stats.RekapStatus,
		"pembayaran":  stats.Pembayaran,
	})
}
