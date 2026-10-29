package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"

	"github.com/Rzp1010/sewara-split/sewara-api/internal/db"
)

// GET /api/transaction-items
//   ?transaction_id=x     item satu transaksi
//   ?transaction_ids=a,b  dikelompokkan per transaksi
//   ?all=1                ringkasan semua item tenant (default)
func (s *Server) handleTransactionItemsGet(w http.ResponseWriter, r *http.Request, user db.Identity) {
	q := r.URL.Query()

	if tid := q.Get("transaction_id"); tid != "" {
		if _, err := strconv.ParseInt(tid, 10, 64); err != nil {
			writeError(w, http.StatusBadRequest, CodeValidationError, "transaction_id harus berupa angka.")
			return
		}
		items, err := db.GetTransactionItems(s.db, r.Context(), user.UserID, "single", tid)
		if err != nil {
			writeError(w, http.StatusInternalServerError, CodeDatabaseError, "Gagal membaca item transaksi.")
			return
		}
		writeSuccess(w, http.StatusOK, map[string]any{"items": items})
		return
	}

	if tids := q.Get("transaction_ids"); tids != "" {
		grouped, err := db.GetTransactionItems(s.db, r.Context(), user.UserID, "bulk", tids)
		if err != nil {
			writeError(w, http.StatusInternalServerError, CodeDatabaseError, "Gagal membaca item transaksi.")
			return
		}
		writeSuccess(w, http.StatusOK, map[string]any{"itemsByTransaction": grouped})
		return
	}

	items, err := db.GetTransactionItems(s.db, r.Context(), user.UserID, "all", "")
	if err != nil {
		writeError(w, http.StatusInternalServerError, CodeDatabaseError, "Gagal membaca item transaksi.")
		return
	}
	writeSuccess(w, http.StatusOK, map[string]any{"items": items})
}

// POST /api/transaction-items — ganti seluruh item satu transaksi.
// Body: { transaction_id, items, user_id? } — user_id diabaikan.
func (s *Server) handleTransactionItemsPost(w http.ResponseWriter, r *http.Request, user db.Identity) {
	var body struct {
		TransactionID int                      `json:"transaction_id"`
		Items         []map[string]any         `json:"items"`
		UserID        *string                  `json:"user_id"`
	}

	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, CodeValidationError, "Body JSON tidak valid.")
		return
	}
	if body.TransactionID == 0 {
		writeError(w, http.StatusBadRequest, CodeValidationError, "transaction_id wajib diisi.")
		return
	}

	err := db.ReplaceTransactionItems(s.db, r.Context(), user.UserID, body.TransactionID, body.Items)
	if err != nil {
		if errors.Is(err, db.ErrNotFound) {
			writeError(w, http.StatusNotFound, CodeNotFound, "Transaksi tidak ditemukan atau bukan milik tenant Anda.")
			return
		}
		writeError(w, http.StatusInternalServerError, CodeDatabaseError, "Gagal menyimpan item transaksi.")
		return
	}

	writeSuccess(w, http.StatusOK, map[string]any{"ok": true})
}
