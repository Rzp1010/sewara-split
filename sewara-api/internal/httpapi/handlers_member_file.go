package httpapi

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/Rzp1010/sewara-split/sewara-api/internal/db"
	"github.com/Rzp1010/sewara-split/sewara-api/internal/storage"
)

// Pesan disalin apa adanya dari backend Next (app/api/member/upload|photo).
// Frontend membandingkan beberapa di antaranya, jadi jangan diperhalus.
const (
	msgMemberFileTidakValid = "File, member ID, atau label tidak valid."
	msgMemberIndex          = "Index dokumen tidak valid (harus 0-4)."
	msgMemberMime           = "Jenis file tidak didukung. Gunakan JPG, PNG, atau PDF."
	msgMemberUkuran         = "Ukuran file maksimal 10 MB."
	msgMemberTidakAda       = "Member tidak ditemukan."
	msgMemberLimit          = "Maksimal 5 dokumen diizinkan."
	msgMemberKeyWajib       = "Parameter key wajib diisi."
	msgMemberAkses          = "Anda tidak memiliki akses ke file ini."
	msgMemberDokumenHilang  = "Dokumen tidak ditemukan (mungkin sudah terhapus)."
)

const (
	// batasBerkasMember meniru batas 10 MB milik Next.
	batasBerkasMember = 10 << 20
	// batasBodyMember memberi ruang header multipart di atas batas berkas.
	// Cukup besar untuk berkas 11 MiB supaya galat ukuran bisa dilaporkan
	// sebagai 400, bukan tertelan sebagai body terlalu besar.
	batasBodyMember = 12 << 20
)

// handleMemberUpload menerima satu dokumen jaminan member (JPG/PNG/PDF).
//
// Rate limit `memberUploadLimiter` dari Next belum diport: limiter-nya berbasis
// memori proses, dilarang aturan portabilitas runtime. Dicatat sebagai deviasi,
// sama seperti handler berkas lain.
//
// Urutan mengikuti Next lalu diperketat pada cek storage (deviasi sengaja):
// validasi input → cek member (404) → cek storage (503) → unggah R2 → simpan DB.
// Cek member sengaja mendahului cek storage supaya member yang tidak ada tetap
// menjawab 404 walau R2 belum dikonfigurasi — sama seperti handler pembayaran.
func (s *Server) handleMemberUpload(w http.ResponseWriter, r *http.Request, me db.Identity) {
	r.Body = http.MaxBytesReader(w, r.Body, batasBodyMember)

	file, header, err := r.FormFile("file")
	memberID := strings.TrimSpace(r.FormValue("memberId"))
	label := strings.TrimSpace(r.FormValue("label"))

	if err != nil || memberID == "" || label == "" || !labelJaminanValid(label) {
		writeValidationError(w, msgMemberFileTidakValid, nil)
		return
	}
	defer file.Close()

	docIndex, ok := validasiIndexDokumen(r.FormValue("index"))
	if !ok {
		writeValidationError(w, msgMemberIndex, nil)
		return
	}

	// MIME yang DIDEKLARASIKAN klien (file.type di Next). Tidak ada sniffing byte.
	mime := header.Header.Get("Content-Type")
	ext, ok := ekstensiDariMime(mime)
	if !ok {
		writeValidationError(w, msgMemberMime, nil)
		return
	}

	isi, err := io.ReadAll(io.LimitReader(file, batasBerkasMember+1))
	if err != nil || len(isi) > batasBerkasMember {
		writeValidationError(w, msgMemberUkuran, nil)
		return
	}

	tenantID, err := s.db.TenantID(r.Context(), me.UserID)
	if err != nil {
		s.log.Error("gagal membaca tenant id member", "err", err)
		writeError(w, http.StatusInternalServerError, CodeInternalError, "Terjadi kesalahan server. Coba lagi.")
		return
	}

	// member.id = bigint (skema Go), bukan UUID. Nilai non-numerik berarti tidak
	// ada member yang cocok → 404, sama seperti `.eq('id', memberId)` di Next.
	id, err := strconv.ParseInt(memberID, 10, 64)
	if err != nil {
		writeError(w, http.StatusNotFound, CodeNotFound, msgMemberTidakAda)
		return
	}
	member, err := s.db.GetMember(r.Context(), tenantID, id)
	if errors.Is(err, db.ErrNotFound) {
		writeError(w, http.StatusNotFound, CodeNotFound, msgMemberTidakAda)
		return
	}
	if err != nil {
		s.log.Error("gagal membaca member", "err", err, "member", id)
		writeError(w, http.StatusInternalServerError, CodeInternalError, "Terjadi kesalahan server. Coba lagi.")
		return
	}

	documents := member.FotoJaminan
	if docIndex >= len(documents) && len(documents) >= 5 {
		writeValidationError(w, msgMemberLimit, nil)
		return
	}

	if s.store == nil {
		writeError(w, http.StatusServiceUnavailable, CodeExternalServiceError, msgStorageOff)
		return
	}

	key := keyDokumenMember(tenantID, memberID, docIndex, ext)
	if err := s.store.Put(r.Context(), key, isi, mime); err != nil {
		s.log.Error("gagal mengunggah dokumen member", "err", err, "key", key)
		writeError(w, http.StatusBadGateway, CodeExternalServiceError, "Gagal mengunggah berkas. Coba lagi.")
		return
	}

	if docIndex < len(documents) {
		// Menimpa slot yang sudah ada: hapus objek lama setelah unggahan baru
		// berhasil, supaya tidak ada jendela dua-duanya hilang.
		oldPath := documents[docIndex].Path
		if oldPath != "" && oldPath != key {
			s.hapusDokumenMember(r.Context(), tenantID, oldPath)
		}
		documents[docIndex] = db.FotoJaminanMember{Label: label, Path: key}
	} else {
		documents = append(documents, db.FotoJaminanMember{Label: label, Path: key})
	}

	if _, err := s.db.SetFotoMember(r.Context(), tenantID, id, documents); err != nil {
		s.log.Error("gagal menyimpan dokumen member", "err", err, "member", id)
		writeError(w, http.StatusInternalServerError, CodeInternalError, "Terjadi kesalahan server. Coba lagi.")
		return
	}

	// Next membalas {ok,path,label} di level atas (bukan amplop {data:...}),
	// dan frontend membacanya persis begitu. Jangan dibungkus writeSuccess.
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "path": key, "label": label})
}

// handleMemberPhoto menyajikan dokumen member dari bucket.
//
// Dipakai sebagai `src` gambar/tautan PDF di frontend: responsnya byte mentah
// dengan header cache, bukan amplop JSON. Tidak menyentuh DB (Next juga tidak).
func (s *Server) handleMemberPhoto(w http.ResponseWriter, r *http.Request, me db.Identity) {
	key := strings.TrimSpace(r.URL.Query().Get("key"))
	if key == "" {
		writeValidationError(w, msgMemberKeyWajib, nil)
		return
	}

	tenantID, err := s.db.TenantID(r.Context(), me.UserID)
	if err != nil {
		s.log.Error("gagal membaca tenant id member", "err", err)
		writeError(w, http.StatusInternalServerError, CodeInternalError, "Terjadi kesalahan server. Coba lagi.")
		return
	}

	// Guard prefix diperiksa sebelum cek store: 403 harus konsisten walau R2
	// belum dikonfigurasi (dev tanpa R2).
	if !strings.HasPrefix(key, tenantID+"/") {
		writeError(w, http.StatusForbidden, CodeForbidden, msgMemberAkses)
		return
	}

	if s.store == nil {
		writeError(w, http.StatusServiceUnavailable, CodeExternalServiceError, msgStorageOff)
		return
	}

	isi, err := s.store.Get(r.Context(), key)
	if errors.Is(err, storage.ErrNotFound) {
		writeError(w, http.StatusNotFound, CodeNotFound, msgMemberDokumenHilang)
		return
	}
	if err != nil {
		s.log.Error("gagal membaca dokumen member", "err", err, "key", key)
		writeError(w, http.StatusBadGateway, CodeExternalServiceError, "Gagal membaca berkas. Coba lagi.")
		return
	}

	w.Header().Set("Content-Type", mimeDariEkstensi(ekstensiPath(key)))
	w.Header().Set("Cache-Control", "private, max-age=3600")
	w.Header().Set("Content-Disposition", "inline")
	w.WriteHeader(http.StatusOK)
	if _, err := w.Write(isi); err != nil {
		s.log.Error("gagal mengirim dokumen member", "err", err)
	}
}

// hapusDokumenMember membersihkan objek dokumen member lama (best effort).
// Guard prefix mencegah path aneh menghapus objek tenant lain.
func (s *Server) hapusDokumenMember(ctx context.Context, tenantID, key string) {
	if s.store == nil || key == "" {
		return
	}
	if !strings.HasPrefix(key, tenantID+"/") {
		s.log.Warn("hapus dokumen member dilewati: path di luar area tenant", "path", key)
		return
	}
	if err := s.store.Delete(ctx, key); err != nil {
		s.log.Error("gagal menghapus dokumen member lama", "err", err, "path", key)
	}
}

// ---------- helper murni (diuji terpisah, tanpa storage) ----------

// validasiIndexDokumen menerima 0-4. String kosong, non-numerik, atau di luar
// rentang ditolak — meniru cek `isNaN(index) || Number(index) < 0 || > 4` Next.
func validasiIndexDokumen(raw string) (int, bool) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return 0, false
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n < 0 || n > 4 {
		return 0, false
	}
	return n, true
}

// keyDokumenMember meniru `${ownerId}/${memberId}/doc-${index}.${ext}` Next.
func keyDokumenMember(tenantID, memberID string, index int, ext string) string {
	return fmt.Sprintf("%s/%s/doc-%d.%s", tenantID, memberID, index, ext)
}
