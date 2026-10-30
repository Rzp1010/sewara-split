package httpapi

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/Rzp1010/sewara-split/sewara-api/internal/db"
)

// GET /api/logs — daftar log aktivitas tenant (terbaru dulu).
// Query: startDate, endDate (created_at), offset (0), limit (200).
func (s *Server) handleLogsGet(w http.ResponseWriter, r *http.Request, user db.Identity) {
	q := r.URL.Query()
	logs, err := s.db.ListActivityLogs(r.Context(), user.UserID,
		q.Get("startDate"), q.Get("endDate"),
		atoiMin0(q.Get("offset"), 0), atoiMin0(q.Get("limit"), 200))
	if err != nil {
		writeError(w, http.StatusInternalServerError, CodeDatabaseError, "Gagal membaca log aktivitas.")
		return
	}
	writeSuccess(w, http.StatusOK, map[string]any{"logs": logs})
}

// POST /api/logs — simpan satu atau banyak log. Body boleh objek atau array.
// `id` kiriman klien diabaikan; user_id diisi tenant pemanggil.
func (s *Server) handleLogsPost(w http.ResponseWriter, r *http.Request, user db.Identity) {
	var raw json.RawMessage
	if err := json.NewDecoder(r.Body).Decode(&raw); err != nil {
		writeError(w, http.StatusBadRequest, CodeValidationError, "Body JSON tidak valid.")
		return
	}

	rows, err := decodeLogRows(raw)
	if err != nil {
		writeError(w, http.StatusBadRequest, CodeValidationError, "Body log harus objek atau array objek.")
		return
	}
	logs, err := s.db.InsertActivityLogs(r.Context(), user.UserID, rows)
	if err != nil {
		writeError(w, http.StatusInternalServerError, CodeDatabaseError, "Gagal menyimpan log aktivitas.")
		return
	}
	writeSuccess(w, http.StatusOK, map[string]any{"logs": logs})
}

// DELETE /api/logs — hapus log tenant.
// Body: {ids:[...]} | {olderThanDays:n} | {} (hapus semua).
func (s *Server) handleLogsDelete(w http.ResponseWriter, r *http.Request, user db.Identity) {
	var body struct {
		IDs           []int64 `json:"ids"`
		OlderThanDays int     `json:"olderThanDays"`
	}
	// Body kosong sah (artinya hapus semua), jadi kegagalan decode diabaikan.
	_ = json.NewDecoder(r.Body).Decode(&body)

	deleted, err := s.db.DeleteActivityLogs(r.Context(), user.UserID, body.IDs, body.OlderThanDays)
	if err != nil {
		writeError(w, http.StatusInternalServerError, CodeDatabaseError, "Gagal menghapus log aktivitas.")
		return
	}
	writeSuccess(w, http.StatusOK, map[string]any{"ok": true, "deleted": deleted})
}

// GET /api/logs/login — catatan login. Owner melihat tenant sendiri,
// superadmin melihat semua; staf lain 403 (paritas requireRole Next).
func (s *Server) handleLogsLoginGet(w http.ResponseWriter, r *http.Request, user db.Identity) {
	if user.Role != "owner" && user.Role != "superadmin" {
		writeError(w, http.StatusForbidden, CodeForbidden, "Hanya owner atau superadmin yang boleh melihat log login.")
		return
	}
	q := r.URL.Query()
	logs, err := s.db.ListLoginLogs(r.Context(), user.Role == "superadmin", user.UserID,
		atoiMin0(q.Get("offset"), 0), atoiMin0(q.Get("limit"), 50))
	if err != nil {
		writeError(w, http.StatusInternalServerError, CodeDatabaseError, "Gagal membaca log login.")
		return
	}
	writeSuccess(w, http.StatusOK, map[string]any{"logs": logs})
}

// decodeLogRows menerima body objek tunggal maupun array objek.
func decodeLogRows(raw json.RawMessage) ([]map[string]any, error) {
	var arr []map[string]any
	if err := json.Unmarshal(raw, &arr); err == nil {
		return arr, nil
	}
	var one map[string]any
	if err := json.Unmarshal(raw, &one); err != nil {
		return nil, err
	}
	return []map[string]any{one}, nil
}

// atoiMin0 mengurai bilangan bulat non-negatif; gagal/kosong → nilai default.
func atoiMin0(s string, def int) int {
	if n, err := strconv.Atoi(s); err == nil && n >= 0 {
		return n
	}
	return def
}
