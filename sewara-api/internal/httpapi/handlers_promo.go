package httpapi

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/Rzp1010/sewara-split/sewara-api/internal/db"
)

// handlePromoGet membaca daftar promo tenant, sekaligus menandai yang kadaluarsa.
func (s *Server) handlePromoGet(w http.ResponseWriter, r *http.Request, me db.Identity) {
	tenantID, err := s.db.TenantID(r.Context(), me.UserID)
	if err != nil {
		s.log.Error("gagal membaca tenant id", "err", err)
		writeError(w, http.StatusInternalServerError, CodeInternalError, "Terjadi kesalahan server. Coba lagi.")
		return
	}

	// Tandai promo expired dulu supaya list yang dikembalikan konsisten.
	if err := s.db.TandaiPromoExpired(r.Context(), tenantID, time.Now()); err != nil {
		s.log.Error("gagal menandai promo expired", "err", err)
		// Tidak fatal — lanjut baca list.
	}

	list, err := s.db.ListPromo(r.Context(), tenantID)
	if err != nil {
		s.log.Error("gagal membaca promo", "err", err)
		writeError(w, http.StatusInternalServerError, CodeInternalError, "Terjadi kesalahan server. Coba lagi.")
		return
	}

	writeSuccess(w, http.StatusOK, map[string]any{"promos": list})
}

// handlePromoPost membuat promo baru. Kode otomatis uppercase + trimmed.
func (s *Server) handlePromoPost(w http.ResponseWriter, r *http.Request, me db.Identity) {
	var req struct {
		Kode          string     `json:"kode"`
		DiskonPersen  float64    `json:"diskon_persen"`
		BerlakuDari   *time.Time `json:"berlaku_dari"`
		BerlakuSampai *time.Time `json:"berlaku_sampai"`
		Kuota         *int       `json:"kuota"`
		Status        string     `json:"status"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&req); err != nil {
		writeValidationError(w, "Body tidak valid.", nil)
		return
	}

	kode := strings.TrimSpace(strings.ToUpper(req.Kode))
	if kode == "" {
		writeValidationError(w, "Kode promo wajib diisi.", nil)
		return
	}
	if req.DiskonPersen < 0 || req.DiskonPersen > 100 {
		writeValidationError(w, "Diskon harus 0-100.", nil)
		return
	}
	if req.Kuota != nil && *req.Kuota < 0 {
		writeValidationError(w, "Kuota tidak boleh negatif.", nil)
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

	promo, err := s.db.InsertPromo(r.Context(), tenantID, kode, req.DiskonPersen,
		req.BerlakuDari, req.BerlakuSampai, req.Kuota, status)
	if errors.Is(err, db.ErrPromoDuplikat) {
		writeError(w, http.StatusConflict, "PROMO_DUPLIKAT", "Kode promo sudah ada.")
		return
	}
	if err != nil {
		s.log.Error("gagal membuat promo", "err", err)
		writeError(w, http.StatusInternalServerError, CodeInternalError, "Terjadi kesalahan server. Coba lagi.")
		return
	}

	writeSuccess(w, http.StatusCreated, map[string]any{"promo": promo})
}

// handlePromoPatch mengubah promo milik tenant.
func (s *Server) handlePromoPatch(w http.ResponseWriter, r *http.Request, me db.Identity) {
	idStr := r.PathValue("id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		writeError(w, http.StatusNotFound, CodeNotFound, "Promo tidak ditemukan.")
		return
	}

	var req struct {
		Kode          *string     `json:"kode"`
		DiskonPersen  *float64    `json:"diskon_persen"`
		BerlakuDari   **time.Time `json:"berlaku_dari"`
		BerlakuSampai **time.Time `json:"berlaku_sampai"`
		Kuota         **int       `json:"kuota"`
		Status        *string     `json:"status"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&req); err != nil {
		writeValidationError(w, "Body tidak valid.", nil)
		return
	}

	// Validasi field yang diubah.
	if req.Kode != nil {
		kode := strings.TrimSpace(strings.ToUpper(*req.Kode))
		if kode == "" {
			writeValidationError(w, "Kode promo tidak boleh kosong.", nil)
			return
		}
		req.Kode = &kode
	}
	if req.DiskonPersen != nil && (*req.DiskonPersen < 0 || *req.DiskonPersen > 100) {
		writeValidationError(w, "Diskon harus 0-100.", nil)
		return
	}
	if req.Kuota != nil && *req.Kuota != nil && **req.Kuota < 0 {
		writeValidationError(w, "Kuota tidak boleh negatif.", nil)
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

	promo, err := s.db.UpdatePromo(r.Context(), tenantID, id, req.Kode, req.DiskonPersen,
		req.BerlakuDari, req.BerlakuSampai, req.Kuota, req.Status)
	if errors.Is(err, db.ErrNotFound) {
		writeError(w, http.StatusNotFound, CodeNotFound, "Promo tidak ditemukan.")
		return
	}
	if errors.Is(err, db.ErrPromoDuplikat) {
		writeError(w, http.StatusConflict, "PROMO_DUPLIKAT", "Kode promo sudah ada.")
		return
	}
	if err != nil {
		s.log.Error("gagal mengubah promo", "err", err)
		writeError(w, http.StatusInternalServerError, CodeInternalError, "Terjadi kesalahan server. Coba lagi.")
		return
	}

	writeSuccess(w, http.StatusOK, map[string]any{"promo": promo})
}

// handlePromoDelete menghapus promo milik tenant.
func (s *Server) handlePromoDelete(w http.ResponseWriter, r *http.Request, me db.Identity) {
	idStr := r.PathValue("id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		writeError(w, http.StatusNotFound, CodeNotFound, "Promo tidak ditemukan.")
		return
	}

	tenantID, err := s.db.TenantID(r.Context(), me.UserID)
	if err != nil {
		s.log.Error("gagal membaca tenant id", "err", err)
		writeError(w, http.StatusInternalServerError, CodeInternalError, "Terjadi kesalahan server. Coba lagi.")
		return
	}

	if err := s.db.DeletePromo(r.Context(), tenantID, id); errors.Is(err, db.ErrNotFound) {
		writeError(w, http.StatusNotFound, CodeNotFound, "Promo tidak ditemukan.")
		return
	} else if err != nil {
		s.log.Error("gagal menghapus promo", "err", err)
		writeError(w, http.StatusInternalServerError, CodeInternalError, "Terjadi kesalahan server. Coba lagi.")
		return
	}

	writeSuccess(w, http.StatusOK, map[string]any{"ok": true})
}

// handlePromoValidate memeriksa apakah promo valid (ditemukan, aktif, belum expired).
// Respons selalu 200 dengan {valid, promo?, error?} — bukan HTTP error.
func (s *Server) handlePromoValidate(w http.ResponseWriter, r *http.Request, me db.Identity) {
	var req struct {
		ID int64 `json:"id"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&req); err != nil {
		writeValidationError(w, "Body tidak valid.", nil)
		return
	}

	tenantID, err := s.db.TenantID(r.Context(), me.UserID)
	if err != nil {
		s.log.Error("gagal membaca tenant id", "err", err)
		writeError(w, http.StatusInternalServerError, CodeInternalError, "Terjadi kesalahan server. Coba lagi.")
		return
	}

	promo, err := s.db.GetPromo(r.Context(), tenantID, req.ID)
	if errors.Is(err, db.ErrNotFound) {
		writeSuccess(w, http.StatusOK, map[string]any{
			"valid": false,
			"error": "Kode promo tidak ditemukan",
		})
		return
	}
	if err != nil {
		s.log.Error("gagal membaca promo", "err", err)
		writeError(w, http.StatusInternalServerError, CodeInternalError, "Terjadi kesalahan server. Coba lagi.")
		return
	}

	if db.SudahKadaluarsa(promo, time.Now()) {
		if promo.Status == "aktif" {
			_ = s.db.SetPromoExpired(r.Context(), req.ID)
			promo.Status = "expired"
		}
		writeSuccess(w, http.StatusOK, map[string]any{
			"valid": false,
			"error": "Kode promo sudah kedaluwarsa",
			"promo": promo,
		})
		return
	}

	if promo.Status != "aktif" {
		writeSuccess(w, http.StatusOK, map[string]any{
			"valid": false,
			"error": "Kode promo nonaktif",
			"promo": promo,
		})
		return
	}

	writeSuccess(w, http.StatusOK, map[string]any{"valid": true, "promo": promo})
}

// handlePromoUse menaikkan counter terpakai dengan concurrency guard.
func (s *Server) handlePromoUse(w http.ResponseWriter, r *http.Request, me db.Identity) {
	var req struct {
		ID int64 `json:"id"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&req); err != nil {
		writeValidationError(w, "Body tidak valid.", nil)
		return
	}

	tenantID, err := s.db.TenantID(r.Context(), me.UserID)
	if err != nil {
		s.log.Error("gagal membaca tenant id", "err", err)
		writeError(w, http.StatusInternalServerError, CodeInternalError, "Terjadi kesalahan server. Coba lagi.")
		return
	}

	promo, err := s.db.GetPromo(r.Context(), tenantID, req.ID)
	if errors.Is(err, db.ErrNotFound) {
		writeError(w, http.StatusNotFound, CodeNotFound, "Kode promo tidak ditemukan.")
		return
	}
	if err != nil {
		s.log.Error("gagal membaca promo", "err", err)
		writeError(w, http.StatusInternalServerError, CodeInternalError, "Terjadi kesalahan server. Coba lagi.")
		return
	}

	if db.SudahKadaluarsa(promo, time.Now()) {
		if promo.Status == "aktif" {
			_ = s.db.SetPromoExpired(r.Context(), req.ID)
		}
		writeError(w, http.StatusConflict, "PROMO_EXPIRED", "Kode promo sudah kedaluwarsa.")
		return
	}

	if promo.Status != "aktif" {
		writeError(w, http.StatusConflict, "PROMO_INACTIVE", "Kode promo nonaktif.")
		return
	}

	current := promo.Terpakai
	if err := s.db.UsePromo(r.Context(), req.ID, current); errors.Is(err, db.ErrNotFound) {
		writeError(w, http.StatusConflict, "PROMO_QUOTA_EXCEEDED", "Kuota kode promo habis atau promo sudah tidak aktif.")
		return
	} else if err != nil {
		s.log.Error("gagal menggunakan promo", "err", err)
		writeError(w, http.StatusInternalServerError, CodeInternalError, "Terjadi kesalahan server. Coba lagi.")
		return
	}

	// Tandai expired kalau kuota habis setelah increment.
	if promo.Kuota != nil && current+1 >= *promo.Kuota {
		_ = s.db.SetPromoExpired(r.Context(), req.ID)
	}

	writeSuccess(w, http.StatusOK, map[string]any{"ok": true})
}
