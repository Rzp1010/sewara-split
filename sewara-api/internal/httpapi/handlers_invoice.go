package httpapi

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/Rzp1010/sewara-split/sewara-api/internal/db"
	"github.com/Rzp1010/sewara-split/sewara-api/internal/storage"
)

func (s *Server) handleInvoiceCounterPost(w http.ResponseWriter, r *http.Request, me db.Identity) {
	tenantID, err := s.db.TenantID(r.Context(), me.UserID)
	if err != nil {
		s.log.Error("gagal membaca tenant id invoice", "err", err)
		writeError(w, http.StatusInternalServerError, CodeInternalError, "Terjadi kesalahan server. Coba lagi.")
		return
	}
	nomor, err := s.db.NextInvoiceNumber(r.Context(), tenantID)
	if err != nil {
		s.log.Error("gagal membuat nomor invoice", "err", err)
		writeError(w, http.StatusInternalServerError, CodeInternalError, "Terjadi kesalahan server. Coba lagi.")
		return
	}
	writeSuccess(w, http.StatusOK, map[string]any{"no_invoice": nomor})
}

func (s *Server) handleInvoiceHeaderGet(w http.ResponseWriter, r *http.Request, me db.Identity) {
	tenantID, err := s.db.TenantID(r.Context(), me.UserID)
	if err != nil {
		s.log.Error("gagal membaca tenant id invoice", "err", err)
		writeError(w, http.StatusInternalServerError, CodeInternalError, "Terjadi kesalahan server. Coba lagi.")
		return
	}
	setting, err := s.db.GetSettingByKey(r.Context(), tenantID, "invoice_header")
	if err != nil {
		s.log.Error("gagal membaca setting header invoice", "err", err)
		writeError(w, http.StatusInternalServerError, CodeInternalError, "Terjadi kesalahan server. Coba lagi.")
		return
	}
	var key string
	if setting != nil {
		key = db.UnquoteSetting(setting.Value)
	}
	if key == "" {
		writeError(w, http.StatusNotFound, CodeNotFound, "Header invoice belum diatur.")
		return
	}
	if !strings.HasPrefix(key, "headers/"+tenantID+".") {
		writeError(w, http.StatusForbidden, CodeForbidden, "Anda tidak memiliki akses ke file ini.")
		return
	}
	if s.store == nil {
		writeError(w, http.StatusServiceUnavailable, CodeExternalServiceError, msgStorageOff)
		return
	}
	isi, err := s.store.Get(r.Context(), key)
	if errors.Is(err, storage.ErrNotFound) {
		writeError(w, http.StatusNotFound, CodeNotFound, "Header invoice tidak ditemukan (mungkin sudah terhapus).")
		return
	}
	if err != nil {
		s.log.Error("gagal membaca header invoice", "err", err, "key", key)
		writeError(w, http.StatusBadGateway, CodeExternalServiceError, "Gagal membaca berkas. Coba lagi.")
		return
	}
	sum := sha256.Sum256(isi)
	w.Header().Set("Content-Type", mimeDariEkstensi(ekstensiPath(key)))
	w.Header().Set("Cache-Control", "private, max-age=0, must-revalidate")
	w.Header().Set("ETag", `"`+hex.EncodeToString(sum[:])[:32]+`"`)
	w.Header().Set("Content-Disposition", "inline")
	w.WriteHeader(http.StatusOK)
	if _, err := w.Write(isi); err != nil {
		s.log.Error("gagal mengirim header invoice", "err", err)
	}
}

func (s *Server) handleInvoiceHeaderPost(w http.ResponseWriter, r *http.Request, me db.Identity) {
	if s.store == nil {
		writeError(w, http.StatusServiceUnavailable, CodeExternalServiceError, msgStorageOff)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 6<<20)
	file, header, err := r.FormFile("file")
	if err != nil {
		writeValidationError(w, "File tidak valid.", nil)
		return
	}
	defer file.Close()
	isi, err := io.ReadAll(io.LimitReader(file, 5<<20+1))
	if err != nil {
		writeValidationError(w, "File tidak valid.", nil)
		return
	}
	if len(isi) > 5<<20 {
		writeValidationError(w, "Ukuran file maksimal 5 MB.", nil)
		return
	}
	mime := header.Header.Get("Content-Type")
	if mime == "" {
		mime = http.DetectContentType(isi)
	}
	ext := ""
	switch mime {
	case "image/png":
		ext = "png"
	case "image/jpeg":
		ext = "jpg"
	case "image/webp":
		ext = "webp"
	default:
		writeValidationError(w, "Jenis file tidak didukung. Gunakan PNG, JPG, atau WEBP.", nil)
		return
	}
	tenantID, err := s.db.TenantID(r.Context(), me.UserID)
	if err != nil {
		s.log.Error("gagal membaca tenant id invoice", "err", err)
		writeError(w, http.StatusInternalServerError, CodeInternalError, "Terjadi kesalahan server. Coba lagi.")
		return
	}
	key := fmt.Sprintf("headers/%s.%s", tenantID, ext)
	if err := s.store.Put(r.Context(), key, isi, mime); err != nil {
		s.log.Error("gagal mengunggah header invoice", "err", err, "key", key)
		writeError(w, http.StatusBadGateway, CodeExternalServiceError, "Gagal mengunggah berkas. Coba lagi.")
		return
	}
	writeSuccess(w, http.StatusOK, map[string]any{"path": key})
}

func (s *Server) handleInvoiceHeaderDelete(w http.ResponseWriter, r *http.Request, me db.Identity) {
	key := r.URL.Query().Get("path")
	if key == "" {
		writeValidationError(w, "Parameter path wajib diisi.", nil)
		return
	}
	tenantID, err := s.db.TenantID(r.Context(), me.UserID)
	if err != nil {
		s.log.Error("gagal membaca tenant id invoice", "err", err)
		writeError(w, http.StatusInternalServerError, CodeInternalError, "Terjadi kesalahan server. Coba lagi.")
		return
	}
	if !strings.HasPrefix(key, "headers/"+tenantID+".") {
		writeError(w, http.StatusForbidden, CodeForbidden, "Anda tidak memiliki akses ke file ini.")
		return
	}
	if s.store == nil {
		writeError(w, http.StatusServiceUnavailable, CodeExternalServiceError, msgStorageOff)
		return
	}
	if err := s.store.Delete(r.Context(), key); err != nil && !errors.Is(err, storage.ErrNotFound) {
		s.log.Error("gagal menghapus header invoice", "err", err, "key", key)
		writeError(w, http.StatusBadGateway, CodeExternalServiceError, "Gagal menghapus berkas. Coba lagi.")
		return
	}
	writeSuccess(w, http.StatusOK, map[string]any{"ok": true})
}
