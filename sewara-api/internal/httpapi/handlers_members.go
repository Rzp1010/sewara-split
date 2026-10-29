package httpapi

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"

	"github.com/Rzp1010/sewara-split/sewara-api/internal/db"
)

// handleMembersGet membaca daftar member + join tipe.
func (s *Server) handleMembersGet(w http.ResponseWriter, r *http.Request, me db.Identity) {
	tenantID, err := s.db.TenantID(r.Context(), me.UserID)
	if err != nil {
		s.log.Error("gagal membaca tenant id", "err", err)
		writeError(w, http.StatusInternalServerError, CodeInternalError, "Terjadi kesalahan server. Coba lagi.")
		return
	}

	list, err := s.db.ListMembers(r.Context(), tenantID)
	if err != nil {
		s.log.Error("gagal membaca members", "err", err)
		writeError(w, http.StatusInternalServerError, CodeInternalError, "Terjadi kesalahan server. Coba lagi.")
		return
	}

	writeSuccess(w, http.StatusOK, map[string]any{"members": list})
}

// handleMembersPost membuat member baru.
func (s *Server) handleMembersPost(w http.ResponseWriter, r *http.Request, me db.Identity) {
	var req struct {
		Nama         string                    `json:"nama"`
		HP           string                    `json:"hp"`
		Alamat       string                    `json:"alamat"`
		DiskonPersen float64                   `json:"diskon_persen"`
		Status       string                    `json:"status"`
		TipeID       *int64                    `json:"tipe_id"`
		Email        *string                   `json:"email"`
		Catatan      *string                   `json:"catatan"`
		FotoJaminan  []db.FotoJaminanMember    `json:"foto_jaminan"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&req); err != nil {
		writeValidationError(w, "Body tidak valid.", nil)
		return
	}

	if req.Nama == "" {
		writeValidationError(w, "Nama wajib diisi.", nil)
		return
	}
	if req.DiskonPersen < 0 || req.DiskonPersen > 100 {
		writeValidationError(w, "Diskon harus 0-100.", nil)
		return
	}
	status := req.Status
	if status == "" {
		status = "aktif"
	}
	if status != "aktif" && status != "nonaktif" {
		writeValidationError(w, "Status harus 'aktif' atau 'nonaktif'.", nil)
		return
	}

	tenantID, err := s.db.TenantID(r.Context(), me.UserID)
	if err != nil {
		s.log.Error("gagal membaca tenant id", "err", err)
		writeError(w, http.StatusInternalServerError, CodeInternalError, "Terjadi kesalahan server. Coba lagi.")
		return
	}

	member, err := s.db.InsertMember(r.Context(), tenantID, req.Nama, req.HP, req.Alamat,
		req.DiskonPersen, status, req.TipeID, req.Email, req.Catatan, req.FotoJaminan)
	if err != nil {
		s.log.Error("gagal membuat member", "err", err)
		writeError(w, http.StatusInternalServerError, CodeInternalError, "Terjadi kesalahan server. Coba lagi.")
		return
	}

	writeSuccess(w, http.StatusCreated, map[string]any{"member": member})
}

// handleMembersPatch mengubah member milik tenant.
func (s *Server) handleMembersPatch(w http.ResponseWriter, r *http.Request, me db.Identity) {
	idStr := r.PathValue("id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		writeError(w, http.StatusNotFound, CodeNotFound, "Member tidak ditemukan.")
		return
	}

	var req struct {
		Nama         *string                   `json:"nama"`
		HP           *string                   `json:"hp"`
		Alamat       *string                   `json:"alamat"`
		DiskonPersen *float64                  `json:"diskon_persen"`
		Status       *string                   `json:"status"`
		TipeID       **int64                   `json:"tipe_id"`
		Email        **string                  `json:"email"`
		Catatan      **string                  `json:"catatan"`
		FotoJaminan  *[]db.FotoJaminanMember   `json:"foto_jaminan"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&req); err != nil {
		writeValidationError(w, "Body tidak valid.", nil)
		return
	}

	if req.Nama != nil && *req.Nama == "" {
		writeValidationError(w, "Nama tidak boleh kosong.", nil)
		return
	}
	if req.DiskonPersen != nil && (*req.DiskonPersen < 0 || *req.DiskonPersen > 100) {
		writeValidationError(w, "Diskon harus 0-100.", nil)
		return
	}
	if req.Status != nil && *req.Status != "aktif" && *req.Status != "nonaktif" {
		writeValidationError(w, "Status harus 'aktif' atau 'nonaktif'.", nil)
		return
	}

	tenantID, err := s.db.TenantID(r.Context(), me.UserID)
	if err != nil {
		s.log.Error("gagal membaca tenant id", "err", err)
		writeError(w, http.StatusInternalServerError, CodeInternalError, "Terjadi kesalahan server. Coba lagi.")
		return
	}

	member, err := s.db.UpdateMember(r.Context(), tenantID, id, req.Nama, req.HP, req.Alamat,
		req.DiskonPersen, req.Status, req.TipeID, req.Email, req.Catatan, req.FotoJaminan)
	if errors.Is(err, db.ErrNotFound) {
		writeError(w, http.StatusNotFound, CodeNotFound, "Member tidak ditemukan.")
		return
	}
	if err != nil {
		s.log.Error("gagal mengubah member", "err", err)
		writeError(w, http.StatusInternalServerError, CodeInternalError, "Terjadi kesalahan server. Coba lagi.")
		return
	}

	writeSuccess(w, http.StatusOK, map[string]any{"member": member})
}

// handleMembersDelete menghapus member milik tenant.
func (s *Server) handleMembersDelete(w http.ResponseWriter, r *http.Request, me db.Identity) {
	idStr := r.PathValue("id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		writeError(w, http.StatusNotFound, CodeNotFound, "Member tidak ditemukan.")
		return
	}

	tenantID, err := s.db.TenantID(r.Context(), me.UserID)
	if err != nil {
		s.log.Error("gagal membaca tenant id", "err", err)
		writeError(w, http.StatusInternalServerError, CodeInternalError, "Terjadi kesalahan server. Coba lagi.")
		return
	}

	if err := s.db.DeleteMember(r.Context(), tenantID, id); errors.Is(err, db.ErrNotFound) {
		writeError(w, http.StatusNotFound, CodeNotFound, "Member tidak ditemukan.")
		return
	} else if err != nil {
		s.log.Error("gagal menghapus member", "err", err)
		writeError(w, http.StatusInternalServerError, CodeInternalError, "Terjadi kesalahan server. Coba lagi.")
		return
	}

	writeSuccess(w, http.StatusOK, map[string]any{"ok": true})
}
