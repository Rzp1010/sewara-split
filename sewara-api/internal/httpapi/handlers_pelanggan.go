package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/Rzp1010/sewara-split/sewara-api/internal/db"
	"github.com/Rzp1010/sewara-split/sewara-api/internal/storage"
)

func hasPrefixPelanggan(tenant, key string) bool { return strings.HasPrefix(key, tenant+"/pelanggan/") }
func (s *Server) handlePelangganGet(w http.ResponseWriter, r *http.Request, me db.Identity) {
	p, e := db.ListPelanggan(r.Context(), s.db, me.UserID)
	if e != nil {
		s.log.Error("gagal membaca pelanggan", "err", e)
		writeError(w, 500, CodeInternalError, "Terjadi kesalahan server. Coba lagi.")
		return
	}
	writeSuccess(w, 200, map[string]any{"pelanggan": p})
}
func (s *Server) handlePelangganPost(w http.ResponseWriter, r *http.Request, me db.Identity) {
	var in struct {
		Nama   string `json:"nama"`
		Email  string `json:"email"`
		HP     string `json:"hp"`
		Alamat string `json:"alamat"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&in); err != nil {
		writeValidationError(w, "Body tidak valid.", nil)
		return
	}
	if strings.TrimSpace(in.Nama) == "" {
		writeValidationError(w, "Nama wajib diisi.", nil)
		return
	}
	in.Email = strings.TrimSpace(in.Email)
	if len(in.Email) > 254 || (in.Email != "" && !strings.Contains(in.Email, "@")) {
		writeValidationError(w, "Email tidak valid (maksimum 254 karakter dan harus mengandung @).", nil)
		return
	}
	p, e := s.db.UpsertPelanggan(r.Context(), me.UserID, in.Nama, in.Email, in.HP, in.Alamat)
	if errors.Is(e, db.ErrPelangganDuplikat) {
		writeError(w, 409, CodeAlreadyExists, db.ErrPelangganDuplikat.Error()+".")
		return
	}
	if e != nil {
		s.log.Error("gagal menyimpan pelanggan", "err", e)
		writeError(w, 500, CodeInternalError, "Terjadi kesalahan server. Coba lagi.")
		return
	}
	writeSuccess(w, 200, map[string]any{"pelanggan": p})
}
func keyDokumenPelanggan(tenantID, pelangganID string, index int, ext string) string {
	return tenantID + "/pelanggan/" + pelangganID + "/doc-" + strconv.Itoa(index) + "." + ext
}
func (s *Server) handlePelangganUpload(w http.ResponseWriter, r *http.Request, me db.Identity) {
	r.Body = http.MaxBytesReader(w, r.Body, 12<<20)
	f, h, e := r.FormFile("file")
	id := strings.TrimSpace(r.FormValue("pelangganId"))
	label := strings.TrimSpace(r.FormValue("label"))
	if e != nil || id == "" || label == "" || !labelJaminanValid(label) {
		writeValidationError(w, msgMemberFileTidakValid, nil)
		return
	}
	defer f.Close()
	n, ok := validasiIndexDokumen(r.FormValue("index"))
	if !ok {
		writeValidationError(w, msgMemberIndex, nil)
		return
	}
	ext, ok := ekstensiDariMime(h.Header.Get("Content-Type"))
	if !ok {
		writeValidationError(w, msgMemberMime, nil)
		return
	}
	b, e := io.ReadAll(io.LimitReader(f, (10<<20)+1))
	if e != nil || len(b) > 10<<20 {
		writeValidationError(w, msgMemberUkuran, nil)
		return
	}
	num, e := strconv.ParseInt(id, 10, 64)
	if e != nil {
		writeError(w, 404, CodeNotFound, "Pelanggan tidak ditemukan.")
		return
	}
	p, e := s.db.GetPelanggan(r.Context(), me.UserID, num)
	if errors.Is(e, db.ErrNotFound) {
		writeError(w, 404, CodeNotFound, "Pelanggan tidak ditemukan.")
		return
	}
	if e != nil {
		writeError(w, 500, CodeInternalError, "Terjadi kesalahan server. Coba lagi.")
		return
	}
	if n >= len(p.Foto) && len(p.Foto) >= 5 {
		writeValidationError(w, msgMemberLimit, nil)
		return
	}
	if s.store == nil {
		writeError(w, 503, CodeExternalServiceError, msgStorageOff)
		return
	}
	tenant, e := s.db.TenantID(r.Context(), me.UserID)
	if e != nil {
		writeError(w, 500, CodeInternalError, "Terjadi kesalahan server. Coba lagi.")
		return
	}
	key := keyDokumenPelanggan(tenant, id, n, ext)
	mime := h.Header.Get("Content-Type")
	if e = s.store.Put(r.Context(), key, b, mime); e != nil {
		writeError(w, 502, CodeExternalServiceError, "Gagal mengunggah berkas. Coba lagi.")
		return
	}
	if n < len(p.Foto) {
		old := p.Foto[n].Path
		if old != "" && old != key {
			s.hapusObjekPelanggan(r.Context(), tenant, old)
		}
		p.Foto[n] = db.FotoPelanggan{Label: label, Path: key}
	} else {
		p.Foto = append(p.Foto, db.FotoPelanggan{Label: label, Path: key})
	}
	if _, e = s.db.SetFotoPelanggan(r.Context(), me.UserID, num, p.Foto); e != nil {
		writeError(w, 500, CodeInternalError, "Terjadi kesalahan server. Coba lagi.")
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true, "path": key, "label": label})
}
func (s *Server) hapusObjekPelanggan(ctx context.Context, tenant, key string) {
	if s.store != nil && strings.HasPrefix(key, tenant+"/pelanggan/") {
		if e := s.store.Delete(ctx, key); e != nil {
			s.log.Error("gagal menghapus dokumen pelanggan lama", "err", e)
		}
	}
}
func (s *Server) handlePelangganPhoto(w http.ResponseWriter, r *http.Request, me db.Identity) {
	key := strings.TrimSpace(r.URL.Query().Get("key"))
	if key == "" {
		writeValidationError(w, msgMemberKeyWajib, nil)
		return
	}
	tenant, e := s.db.TenantID(r.Context(), me.UserID)
	if e != nil {
		writeError(w, 500, CodeInternalError, "Terjadi kesalahan server. Coba lagi.")
		return
	}
	if !hasPrefixPelanggan(tenant, key) {
		writeError(w, 403, CodeForbidden, msgMemberAkses)
		return
	}
	if s.store == nil {
		writeError(w, 503, CodeExternalServiceError, msgStorageOff)
		return
	}
	b, e := s.store.Get(r.Context(), key)
	if errors.Is(e, storage.ErrNotFound) {
		writeError(w, 404, CodeNotFound, msgMemberDokumenHilang)
		return
	}
	if e != nil {
		writeError(w, 502, CodeExternalServiceError, "Gagal membaca berkas. Coba lagi.")
		return
	}
	w.Header().Set("Content-Type", mimeDariEkstensi(ekstensiPath(key)))
	w.Header().Set("Cache-Control", "private, max-age=3600")
	w.Header().Set("Content-Disposition", "inline")
	w.WriteHeader(200)
	_, _ = w.Write(b)
}
