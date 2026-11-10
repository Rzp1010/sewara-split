package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/Rzp1010/sewara-split/sewara-api/internal/db"
)

// trxId = id transaksi bigint (numerik). Menerima angka JSON mentah maupun
// string, karena klien lama bisa mengirim number.
func trxIDFromRaw(raw json.RawMessage) string {
	s := strings.Trim(strings.TrimSpace(string(raw)), `"`)
	if s == "null" {
		return ""
	}
	return s
}

func parseTrxID(s string) (*int64, bool) {
	if s == "" {
		return nil, true
	}
	n, err := strconv.ParseInt(s, 10, 64)
	if err != nil || n <= 0 {
		return nil, false
	}
	return &n, true
}

func chatMessageJSON(row map[string]any) map[string]any {
	return map[string]any{"id": row["id"], "trxId": row["trx_id"], "userId": row["user_id"], "authorId": row["author_id"], "authorNama": row["author_nama"], "authorRole": row["author_role"], "pesan": row["pesan"], "createdAt": row["created_at"]}
}

func (s *Server) handleChatGet(w http.ResponseWriter, r *http.Request, user db.Identity) {
	trx, ok := parseTrxID(strings.TrimSpace(r.URL.Query().Get("trxId")))
	if !ok {
		writeError(w, http.StatusBadRequest, CodeValidationError, "trxId tidak valid.")
		return
	}
	rows, err := s.db.ListChatMessages(r.Context(), user.UserID, trx, atoiMin0(r.URL.Query().Get("limit"), 200))
	if err != nil {
		writeError(w, 500, CodeDatabaseError, "Gagal membaca chat.")
		return
	}
	out := make([]map[string]any, 0, len(rows))
	for _, row := range rows {
		out = append(out, chatMessageJSON(row))
	}
	writeSuccess(w, 200, map[string]any{"messages": out})
}
func (s *Server) handleChatPost(w http.ResponseWriter, r *http.Request, user db.Identity) {
	var b struct {
		TrxID json.RawMessage `json:"trxId"`
		Pesan string          `json:"pesan"`
	}
	limitBody(w, r, bodySedang)
	if json.NewDecoder(r.Body).Decode(&b) != nil {
		writeError(w, 400, CodeValidationError, "Body JSON tidak valid.")
		return
	}
	b.Pesan = strings.TrimSpace(b.Pesan)
	trx, ok := parseTrxID(trxIDFromRaw(b.TrxID))
	if b.Pesan == "" || len([]rune(b.Pesan)) > 2000 || !ok {
		writeError(w, 400, CodeValidationError, "Pesan atau trxId tidak valid.")
		return
	}
	rows, err := s.db.InsertChatMessage(r.Context(), user.UserID, trx, user.NamaLengkap, user.Role, b.Pesan)
	if err != nil {
		writeError(w, 500, CodeDatabaseError, "Gagal menyimpan pesan.")
		return
	}
	writeSuccess(w, 200, map[string]any{"message": chatMessageJSON(rows[0])})
}
func (s *Server) handleChatDelete(w http.ResponseWriter, r *http.Request, user db.Identity) {
	id := r.PathValue("id")
	if !validUUID(id) {
		writeError(w, 404, CodeNotFound, "Pesan tidak ditemukan.")
		return
	}
	err := s.db.DeleteChatMessage(r.Context(), user.UserID, user.Role, id)
	if errors.Is(err, db.ErrNotFound) {
		writeError(w, 404, CodeNotFound, "Pesan tidak ditemukan.")
		return
	}
	if err != nil && err.Error() == "forbidden" {
		writeError(w, 403, CodeForbidden, "Tidak boleh menghapus pesan ini.")
		return
	}
	if err != nil {
		writeError(w, 500, CodeDatabaseError, "Gagal menghapus pesan.")
		return
	}
	writeSuccess(w, 200, map[string]any{"ok": true})
}
func (s *Server) handleChatUnread(w http.ResponseWriter, r *http.Request, user db.Identity) {
	v, e := s.db.ChatUnread(r.Context(), user.UserID)
	if e != nil {
		writeError(w, 500, CodeDatabaseError, "Gagal membaca unread chat.")
		return
	}
	writeSuccess(w, 200, v)
}
func (s *Server) handleChatRead(w http.ResponseWriter, r *http.Request, user db.Identity) {
	var b struct {
		TrxID json.RawMessage `json:"trxId"`
	}
	limitBody(w, r, bodyKecil)
	if json.NewDecoder(r.Body).Decode(&b) != nil {
		writeError(w, 400, CodeValidationError, "Body JSON tidak valid.")
		return
	}
	trx, ok := parseTrxID(trxIDFromRaw(b.TrxID))
	if !ok {
		writeError(w, 400, CodeValidationError, "trxId tidak valid.")
		return
	}
	if e := s.db.MarkChatRead(r.Context(), user.UserID, trx); e != nil {
		writeError(w, 500, CodeDatabaseError, "Gagal menandai chat dibaca.")
		return
	}
	writeSuccess(w, 200, map[string]any{"ok": true})
}

func validUUID(s string) bool {
	if len(s) != 36 {
		return false
	}
	for i, c := range s {
		if i == 8 || i == 13 || i == 18 || i == 23 {
			if c != '-' {
				return false
			}
			continue
		}
		if !(c >= '0' && c <= '9' || c >= 'a' && c <= 'f' || c >= 'A' && c <= 'F') {
			return false
		}
	}
	return true
}
