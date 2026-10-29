package httpapi

import (
	"encoding/json"
	"io"
	"net/http"

	"github.com/Rzp1010/sewara-split/sewara-api/internal/db"
)

// handleMemberTypesGet mengembalikan semua tipe member tenant.
func (s *Server) handleMemberTypesGet(w http.ResponseWriter, r *http.Request, me db.Identity) {
	types, err := s.db.GetMemberTypes(r.Context(), me.UserID)
	if err != nil {
		s.log.Error("gagal membaca member_types", "err", err)
		writeError(w, http.StatusInternalServerError, CodeInternalError, "Terjadi kesalahan server. Coba lagi.")
		return
	}
	writeSuccess(w, http.StatusOK, map[string]any{"memberTypes": types})
}

// handleMemberTypesPost membuat tipe member baru.
func (s *Server) handleMemberTypesPost(w http.ResponseWriter, r *http.Request, me db.Identity) {
	var body struct {
		Nama               string          `json:"nama"`
		DiskonPersen       float64         `json:"diskon_persen"`
		Status             string          `json:"status"`
		DiskonDurasiAturan json.RawMessage `json:"diskon_durasi_aturan"`
	}

	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&body); err != nil {
		writeValidationError(w, "Body tidak valid.", nil)
		return
	}

	if body.Nama == "" {
		writeValidationError(w, "Nama wajib diisi.", nil)
		return
	}

	if body.Status == "" {
		body.Status = "aktif"
	}

	if body.DiskonDurasiAturan == nil {
		body.DiskonDurasiAturan = json.RawMessage("[]")
	}

	mt := db.MemberType{
		UserID:             me.UserID,
		Nama:               body.Nama,
		DiskonPersen:       body.DiskonPersen,
		Status:             body.Status,
		DiskonDurasiAturan: body.DiskonDurasiAturan,
	}

	result, err := s.db.InsertMemberType(r.Context(), me.UserID, mt)
	if err != nil {
		s.log.Error("gagal insert member_type", "err", err)
		writeError(w, http.StatusInternalServerError, CodeInternalError, "Terjadi kesalahan server. Coba lagi.")
		return
	}

	writeSuccess(w, http.StatusOK, map[string]any{"memberType": result})
}

// handleMemberTypesPatch mengubah tipe member tenant.
func (s *Server) handleMemberTypesPatch(w http.ResponseWriter, r *http.Request, me db.Identity) {
	id := r.PathValue("id")
	if id == "" {
		writeValidationError(w, "ID wajib diisi.", nil)
		return
	}

	var body map[string]any
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&body); err != nil {
		writeValidationError(w, "Body tidak valid.", nil)
		return
	}

	delete(body, "user_id")
	delete(body, "id")

	if len(body) == 0 {
		writeValidationError(w, "Tidak ada perubahan.", nil)
		return
	}

	if nama, ok := body["nama"].(string); ok && nama == "" {
		writeValidationError(w, "Nama tidak boleh kosong.", nil)
		return
	}

	result, err := s.db.UpdateMemberType(r.Context(), me.UserID, id, body)
	if err != nil {
		s.log.Error("gagal update member_type", "err", err, "id", id)
		writeError(w, http.StatusInternalServerError, CodeInternalError, "Terjadi kesalahan server. Coba lagi.")
		return
	}

	if result == nil {
		writeError(w, http.StatusNotFound, CodeNotFound, "Tipe member tidak ditemukan.")
		return
	}

	writeSuccess(w, http.StatusOK, map[string]any{"memberType": result})
}

// handleMemberTypesDelete menghapus tipe member tenant.
func (s *Server) handleMemberTypesDelete(w http.ResponseWriter, r *http.Request, me db.Identity) {
	id := r.PathValue("id")
	if id == "" {
		writeValidationError(w, "ID wajib diisi.", nil)
		return
	}

	if err := s.db.DeleteMemberType(r.Context(), me.UserID, id); err != nil {
		s.log.Error("gagal delete member_type", "err", err, "id", id)
		writeError(w, http.StatusInternalServerError, CodeInternalError, "Terjadi kesalahan server. Coba lagi.")
		return
	}

	writeSuccess(w, http.StatusOK, map[string]any{"ok": true})
}
