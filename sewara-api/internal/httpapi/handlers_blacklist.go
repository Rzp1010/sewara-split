package httpapi

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"

	"github.com/Rzp1010/sewara-split/sewara-api/internal/db"
	"github.com/Rzp1010/sewara-split/sewara-api/internal/storage"
)

// Pesan-pesan ini disalin apa adanya dari backend Next. Frontend membandingkan
// teksnya di beberapa tempat, jadi jangan diperhalus tanpa mengubah frontend.
const (
	msgBlacklistOwner    = "Hanya owner yang boleh mengelola blacklist."
	msgBlacklistNotFound = "Entri blacklist tidak ditemukan."
	msgStorageOff        = "Penyimpanan berkas belum dikonfigurasi di server ini."
)

// CodeBlacklistDuplikat dipakai handler POST saat pasangan nama+HP sudah ada.
// Frontend mempercabangkan berdasarkan kode, bukan pesan.
const CodeBlacklistDuplikat = "BLACKLIST_DUPLIKAT"

var uuidPattern = regexp.MustCompile(
	`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

// handleBlacklistGet mengembalikan seluruh entri blacklist tenant.
func (s *Server) handleBlacklistGet(w http.ResponseWriter, r *http.Request, me db.Identity) {
	entries, err := s.db.ListBlacklist(r.Context(), me.UserID)
	if err != nil {
		s.log.Error("gagal membaca blacklist", "err", err)
		writeError(w, http.StatusInternalServerError, CodeInternalError, "Terjadi kesalahan server. Coba lagi.")
		return
	}
	writeSuccess(w, http.StatusOK, map[string]any{"blacklist": entries})
}

// blacklistBody adalah isi permintaan POST dan PATCH.
//
// Semua field pointer supaya PATCH bisa membedakan "tidak dikirim" dari "dikirim
// kosong": bedanya menentukan apakah kolom ikut diubah.
type blacklistBody struct {
	Nama        *string         `json:"nama"`
	HP          *string         `json:"hp"`
	Alamat      *string         `json:"alamat"`
	Alasan      *string         `json:"alasan"`
	TransaksiID *string         `json:"transaksiId"`
	MemberID    *string         `json:"memberId"`
	FotoJaminan json.RawMessage `json:"fotoJaminan"`
}

// handleBlacklistPost menambah entri blacklist.
//
// Urutannya mengikuti Next: baris disimpan dulu dengan foto kosong, baru berkas
// disalin, lalu kolom foto diperbarui. Dengan begitu baris tidak pernah menunjuk
// berkas yang belum ada, dan kegagalan salin hanya berarti foto hilang — bukan
// entri gagal dibuat.
func (s *Server) handleBlacklistPost(w http.ResponseWriter, r *http.Request, me db.Identity) {
	// Gate role dijalankan sebelum body dibaca: staf tidak perlu tahu isi
	// validasinya, dan body besar tidak diparse untuk permintaan yang pasti ditolak.
	if !isOwnerRole(me.Role) {
		writeError(w, http.StatusForbidden, CodeForbidden, msgBlacklistOwner)
		return
	}

	var body blacklistBody
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&body); err != nil {
		writeValidationError(w, "Body tidak valid.", nil)
		return
	}

	nama := strings.TrimSpace(ptrStr(body.Nama))
	if nama == "" {
		writeValidationError(w, "Nama wajib diisi.", nil)
		return
	}

	alasan := strings.TrimSpace(ptrStr(body.Alasan))
	if alasan == "" {
		writeValidationError(w, "Alasan wajib diisi.", nil)
		return
	}

	hp := strings.TrimSpace(ptrStr(body.HP))
	if hp == "" {
		writeValidationError(w, "HP wajib diisi (blacklist memakai pasangan nama + HP).", nil)
		return
	}

	transaksiID, pesan := uuidAtauNil(body.TransaksiID, "transaksiId")
	if pesan != "" {
		writeValidationError(w, pesan, nil)
		return
	}
	memberID, pesan := uuidAtauNil(body.MemberID, "memberId")
	if pesan != "" {
		writeValidationError(w, pesan, nil)
		return
	}

	// POST tidak memvalidasi bentuk tiap foto (sama seperti Next): hanya jumlah.
	foto := parseFotoLonggar(body.FotoJaminan)
	if len(foto) > 5 {
		writeValidationError(w, "Maksimal 5 foto jaminan.", nil)
		return
	}

	tenantID, err := s.db.TenantID(r.Context(), me.UserID)
	if err != nil {
		s.log.Error("gagal membaca tenant id", "err", err)
		writeError(w, http.StatusInternalServerError, CodeInternalError, "Terjadi kesalahan server. Coba lagi.")
		return
	}

	entry := db.BlacklistEntry{
		Nama:        nama,
		HP:          &hp,
		Alamat:      body.Alamat,
		Alasan:      alasan,
		TransaksiID: transaksiID,
		MemberID:    memberID,
		FotoJaminan: []db.FotoJaminan{},
	}

	saved, err := s.db.InsertBlacklist(r.Context(), me.UserID, tenantID, entry)
	if errors.Is(err, db.ErrBlacklistDuplikat) {
		writeError(w, http.StatusConflict, CodeBlacklistDuplikat, "Penyewa ini sudah ada di blacklist.")
		return
	}
	if err != nil {
		s.log.Error("gagal menyimpan blacklist", "err", err)
		writeError(w, http.StatusInternalServerError, CodeInternalError, "Terjadi kesalahan server. Coba lagi.")
		return
	}

	// Salin foto jaminan member ke area blacklist supaya bukti tetap beku walau
	// berkas member nanti berubah atau dihapus.
	if salinan := s.salinFotoJaminan(r.Context(), tenantID, saved.ID, foto); len(salinan) > 0 {
		updated, err := s.db.SetFotoBlacklist(r.Context(), me.UserID, saved.ID, salinan)
		if err != nil {
			s.log.Error("gagal menyimpan foto jaminan blacklist", "err", err, "entry", saved.ID)
		} else {
			saved = updated
		}
	}

	writeSuccess(w, http.StatusCreated, map[string]any{"entry": saved})
}

// handleBlacklistPatch mengubah sebagian kolom satu entri.
func (s *Server) handleBlacklistPatch(w http.ResponseWriter, r *http.Request, me db.Identity) {
	if !isOwnerRole(me.Role) {
		writeError(w, http.StatusForbidden, CodeForbidden, msgBlacklistOwner)
		return
	}

	id := r.PathValue("id")

	var body blacklistBody
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&body); err != nil {
		writeValidationError(w, "Body tidak valid.", nil)
		return
	}

	sets := make([]db.SetClause, 0, 6)

	if body.Nama != nil {
		nama := strings.TrimSpace(*body.Nama)
		if nama == "" {
			writeValidationError(w, "Nama tidak boleh kosong.", nil)
			return
		}
		sets = append(sets, db.SetClause{Kolom: "nama", Arg: nama})
	}

	if body.Alasan != nil {
		alasan := strings.TrimSpace(*body.Alasan)
		if alasan == "" {
			writeValidationError(w, "Alasan tidak boleh kosong.", nil)
			return
		}
		sets = append(sets, db.SetClause{Kolom: "alasan", Arg: alasan})
	}

	if body.HP != nil {
		hp := strings.TrimSpace(*body.HP)
		if hp == "" {
			writeValidationError(w, "HP wajib diisi (blacklist memakai pasangan nama + HP).", nil)
			return
		}
		sets = append(sets, db.SetClause{Kolom: "hp", Arg: hp})
	}

	if body.Alamat != nil {
		alamat := *body.Alamat
		sets = append(sets, db.SetClause{Kolom: "alamat", Arg: alamat})
	}

	transaksiID, pesan := uuidAtauNil(body.TransaksiID, "transaksiId")
	if pesan != "" {
		writeValidationError(w, pesan, nil)
		return
	}
	if body.TransaksiID != nil {
		sets = append(sets, db.SetClause{Kolom: "transaksi_id", Arg: transaksiID})
	}

	memberID, pesan := uuidAtauNil(body.MemberID, "memberId")
	if pesan != "" {
		writeValidationError(w, pesan, nil)
		return
	}
	if body.MemberID != nil {
		sets = append(sets, db.SetClause{Kolom: "member_id", Arg: memberID})
	}

	tenantID, err := s.db.TenantID(r.Context(), me.UserID)
	if err != nil {
		s.log.Error("gagal membaca tenant id", "err", err)
		writeError(w, http.StatusInternalServerError, CodeInternalError, "Terjadi kesalahan server. Coba lagi.")
		return
	}

	var fotoBaru []db.FotoJaminan
	fotoBerubah := body.FotoJaminan != nil
	if fotoBerubah {
		fotoBaru, pesan = parseFotoKetat(body.FotoJaminan, tenantID)
		if pesan != "" {
			writeValidationError(w, pesan, nil)
			return
		}
		sets = append(sets, db.SetClause{Kolom: "foto_jaminan", Arg: jsonFotoUntukSQL(fotoBaru)})
	}

	if len(sets) == 0 {
		writeValidationError(w, "Tidak ada perubahan.", nil)
		return
	}

	var lama db.BlacklistEntry
	if fotoBerubah {
		lama, err = s.db.GetBlacklist(r.Context(), me.UserID, id)
		if errors.Is(err, db.ErrNotFound) {
			writeError(w, http.StatusNotFound, CodeNotFound, msgBlacklistNotFound)
			return
		}
		if err != nil {
			s.log.Error("gagal membaca blacklist", "err", err)
			writeError(w, http.StatusInternalServerError, CodeInternalError, "Terjadi kesalahan server. Coba lagi.")
			return
		}
	}

	updated, err := s.db.UpdateBlacklist(r.Context(), me.UserID, id, sets)
	if errors.Is(err, db.ErrNotFound) {
		writeError(w, http.StatusNotFound, CodeNotFound, msgBlacklistNotFound)
		return
	}
	if err != nil {
		s.log.Error("gagal memperbarui blacklist", "err", err)
		writeError(w, http.StatusInternalServerError, CodeInternalError, "Terjadi kesalahan server. Coba lagi.")
		return
	}

	if fotoBerubah {
		s.hapusFotoJaminan(r.Context(), tenantID, fotoTidakDipakai(lama.FotoJaminan, fotoBaru))
	}

	writeSuccess(w, http.StatusOK, map[string]any{"entry": updated})
}

// handleBlacklistDelete menghapus satu entri beserta berkasnya.
func (s *Server) handleBlacklistDelete(w http.ResponseWriter, r *http.Request, me db.Identity) {
	if !isOwnerRole(me.Role) {
		writeError(w, http.StatusForbidden, CodeForbidden, msgBlacklistOwner)
		return
	}

	id := r.PathValue("id")

	deleted, err := s.db.DeleteBlacklist(r.Context(), me.UserID, id)
	if errors.Is(err, db.ErrNotFound) {
		writeError(w, http.StatusNotFound, CodeNotFound, msgBlacklistNotFound)
		return
	}
	if err != nil {
		s.log.Error("gagal menghapus blacklist", "err", err)
		writeError(w, http.StatusInternalServerError, CodeInternalError, "Terjadi kesalahan server. Coba lagi.")
		return
	}

	tenantID, err := s.db.TenantID(r.Context(), me.UserID)
	if err != nil {
		s.log.Error("gagal membaca tenant id", "err", err)
	} else {
		s.hapusFotoJaminan(r.Context(), tenantID, deleted.FotoJaminan)
	}

	writeSuccess(w, http.StatusOK, map[string]any{"ok": true})
}

// handleBlacklistCheck menjawab "apakah penyewa ini pernah diblacklist".
//
// Sifatnya notifikasi: hasil cocok TIDAK memblokir booking. Frontend hanya
// menampilkan peringatan, jadi jawaban selalu 200 — termasuk saat tidak cocok.
func (s *Server) handleBlacklistCheck(w http.ResponseWriter, r *http.Request, me db.Identity) {
	q := r.URL.Query()

	match, err := s.db.FindBlacklistMatch(r.Context(), me.UserID, q.Get("nama"), q.Get("hp"))
	if err != nil {
		s.log.Error("gagal memeriksa blacklist", "err", err)
		writeError(w, http.StatusInternalServerError, CodeInternalError, "Terjadi kesalahan server. Coba lagi.")
		return
	}

	if match == nil {
		writeSuccess(w, http.StatusOK, map[string]any{
			"hit":    false,
			"nama":   nil,
			"alasan": nil,
		})
		return
	}

	writeSuccess(w, http.StatusOK, map[string]any{
		"hit":    true,
		"nama":   match.Nama,
		"alasan": match.Alasan,
	})
}

// handleBlacklistUpload menerima satu dokumen jaminan (JPG/PNG/PDF).
//
// Rate limit dari backend Next belum diport: limiter-nya berbasis memori proses,
// dan itu dilarang aturan portabilitas (tidak konsisten antar instance). Dicatat
// sebagai pekerjaan tersendiri, bukan dilewati diam-diam.
func (s *Server) handleBlacklistUpload(w http.ResponseWriter, r *http.Request, me db.Identity) {
	if s.store == nil {
		writeError(w, http.StatusServiceUnavailable, CodeExternalServiceError, msgStorageOff)
		return
	}

	// Batas body sedikit di atas batas berkas untuk memberi ruang header multipart.
	r.Body = http.MaxBytesReader(w, r.Body, 6<<20)

	file, header, err := r.FormFile("file")
	if err != nil {
		writeValidationError(w, "File atau entry ID tidak valid.", nil)
		return
	}
	defer file.Close()

	entryID := strings.TrimSpace(r.FormValue("entryId"))
	if entryID == "" || !uuidPattern.MatchString(entryID) {
		writeValidationError(w, "File atau entry ID tidak valid.", nil)
		return
	}

	label := strings.TrimSpace(r.FormValue("label"))
	if label == "" {
		label = "Lainnya"
	}
	if !labelJaminanValid(label) {
		writeValidationError(w, "Label dokumen tidak valid.", nil)
		return
	}

	isi, err := io.ReadAll(io.LimitReader(file, 5<<20+1))
	if err != nil {
		writeValidationError(w, "File atau entry ID tidak valid.", nil)
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
	ext, ok := ekstensiDariMime(mime)
	if !ok {
		writeValidationError(w, "Jenis file tidak didukung. Gunakan JPG, PNG, atau PDF.", nil)
		return
	}

	tenantID, err := s.db.TenantID(r.Context(), me.UserID)
	if err != nil {
		s.log.Error("gagal membaca tenant id", "err", err)
		writeError(w, http.StatusInternalServerError, CodeInternalError, "Terjadi kesalahan server. Coba lagi.")
		return
	}

	entry, err := s.db.GetBlacklist(r.Context(), me.UserID, entryID)
	if errors.Is(err, db.ErrNotFound) {
		writeError(w, http.StatusNotFound, CodeNotFound, msgBlacklistNotFound)
		return
	}
	if err != nil {
		s.log.Error("gagal membaca blacklist", "err", err)
		writeError(w, http.StatusInternalServerError, CodeInternalError, "Terjadi kesalahan server. Coba lagi.")
		return
	}

	// Label yang sama berarti mengganti dokumen, bukan menambah — jadi batas 5
	// hanya berlaku untuk label baru.
	var lama *db.FotoJaminan
	for i := range entry.FotoJaminan {
		if entry.FotoJaminan[i].Label == label {
			lama = &entry.FotoJaminan[i]
			break
		}
	}
	if lama == nil && len(entry.FotoJaminan) >= 5 {
		writeValidationError(w, "Maksimal 5 dokumen diizinkan.", nil)
		return
	}

	key := fmt.Sprintf("blacklist/%s/%s/%s.%s", tenantID, entryID, slugLabel(label), ext)
	if err := s.store.Put(r.Context(), key, isi, mime); err != nil {
		s.log.Error("gagal mengunggah dokumen jaminan", "err", err, "key", key)
		writeError(w, http.StatusBadGateway, CodeExternalServiceError, "Gagal mengunggah berkas. Coba lagi.")
		return
	}

	// Hapus berkas lama hanya setelah unggahan baru berhasil, supaya tidak ada
	// jendela waktu dengan dokumen yang hilang dua-duanya.
	if lama != nil && lama.Path != key {
		s.hapusSatuFoto(r.Context(), tenantID, lama.Path)
	}

	baru := make([]db.FotoJaminan, 0, len(entry.FotoJaminan)+1)
	diganti := false
	for _, f := range entry.FotoJaminan {
		if f.Label == label {
			baru = append(baru, db.FotoJaminan{Label: label, Path: key})
			diganti = true
			continue
		}
		baru = append(baru, f)
	}
	if !diganti {
		baru = append(baru, db.FotoJaminan{Label: label, Path: key})
	}

	if _, err := s.db.SetFotoBlacklist(r.Context(), me.UserID, entryID, baru); err != nil {
		s.log.Error("gagal menyimpan daftar foto jaminan", "err", err, "entry", entryID)
		writeError(w, http.StatusInternalServerError, CodeInternalError, "Terjadi kesalahan server. Coba lagi.")
		return
	}

	writeSuccess(w, http.StatusOK, map[string]any{"path": key, "label": label})
}

// handleBlacklistHeader menyajikan berkas jaminan dari bucket.
//
// Dipakai sebagai `src` gambar dan tautan PDF di frontend, jadi responsnya byte
// mentah dengan header cache — bukan envelope JSON.
func (s *Server) handleBlacklistHeader(w http.ResponseWriter, r *http.Request, me db.Identity) {
	key := strings.TrimSpace(r.URL.Query().Get("path"))
	if key == "" {
		writeValidationError(w, "Parameter path wajib diisi.", nil)
		return
	}

	tenantID, err := s.db.TenantID(r.Context(), me.UserID)
	if err != nil {
		s.log.Error("gagal membaca tenant id", "err", err)
		writeError(w, http.StatusInternalServerError, CodeInternalError, "Terjadi kesalahan server. Coba lagi.")
		return
	}

	// Guard prefix diperiksa sebelum cek store: 403 harus dikembalikan
	// bahkan saat storage belum dikonfigurasi (dev tanpa R2).
	if !strings.HasPrefix(key, "blacklist/"+tenantID+"/") {
		writeError(w, http.StatusForbidden, CodeForbidden, "Anda tidak memiliki akses ke file ini.")
		return
	}

	if s.store == nil {
		writeError(w, http.StatusServiceUnavailable, CodeExternalServiceError, msgStorageOff)
		return
	}

	isi, err := s.store.Get(r.Context(), key)
	if errors.Is(err, storage.ErrNotFound) {
		writeError(w, http.StatusNotFound, CodeNotFound, "Foto tidak ditemukan (mungkin sudah terhapus).")
		return
	}
	if err != nil {
		s.log.Error("gagal membaca berkas jaminan", "err", err, "key", key)
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
		s.log.Error("gagal mengirim berkas jaminan", "err", err)
	}
}

// ---------- helper ----------

func ptrStr(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

// jsonFotoUntukSQL mengubah daftar foto menjadi teks JSON untuk parameter
// `$n::jsonb`. Harus string, bukan []byte: pgx mengirim []byte sebagai bytea dan
// Postgres menolak cast bytea -> jsonb.
func jsonFotoUntukSQL(foto []db.FotoJaminan) string {
	if foto == nil {
		foto = []db.FotoJaminan{}
	}
	b, err := json.Marshal(foto)
	if err != nil {
		return "[]"
	}
	return string(b)
}

// uuidAtauNil menormalkan nilai id relasi.
//
// Frontend mengirim null, "", atau bahkan string "null" untuk "tidak ada" —
// ketiganya harus menjadi SQL NULL, bukan error. Nilai lain wajib UUID.
func uuidAtauNil(v *string, field string) (*string, string) {
	if v == nil {
		return nil, ""
	}
	s := strings.TrimSpace(*v)
	if s == "" || s == "null" {
		return nil, ""
	}
	if !uuidPattern.MatchString(s) {
		return nil, field + " harus berupa UUID yang valid."
	}
	return &s, ""
}

// parseFotoLonggar dipakai POST: bentuk tiap elemen tidak divalidasi, hanya
// dipakai kalau memang array. Elemen yang tidak lengkap akan terbuang sendiri
// oleh salinFotoJaminan karena path-nya tidak valid.
func parseFotoLonggar(raw json.RawMessage) []db.FotoJaminan {
	if len(raw) == 0 || string(raw) == "null" {
		return []db.FotoJaminan{}
	}
	var foto []db.FotoJaminan
	if err := json.Unmarshal(raw, &foto); err != nil {
		return []db.FotoJaminan{}
	}
	if foto == nil {
		return []db.FotoJaminan{}
	}
	return foto
}

// parseFotoKetat dipakai PATCH: setiap elemen wajib punya label dan path yang
// sudah berada di area blacklist tenant.
func parseFotoKetat(raw json.RawMessage, tenantID string) ([]db.FotoJaminan, string) {
	var foto []db.FotoJaminan
	if err := json.Unmarshal(raw, &foto); err != nil {
		return nil, "Foto jaminan harus berupa array."
	}
	if len(foto) > 5 {
		return nil, "Maksimal 5 foto jaminan."
	}

	prefix := "blacklist/" + tenantID + "/"
	for _, f := range foto {
		if strings.TrimSpace(f.Label) == "" || !strings.HasPrefix(f.Path, prefix) {
			return nil, "Setiap foto harus memiliki label dan path blacklist tenant yang valid."
		}
	}
	return foto, ""
}

// salinFotoJaminan menyalin berkas dari area member ke area blacklist.
//
// Path yang sudah berada di area blacklist dipertahankan. Path di area tenant
// (berkas member) disalin supaya bukti tetap beku. Path lain diabaikan. Semua
// kegagalan hanya dicatat: satu foto gagal tidak boleh menggagalkan pembuatan
// entri — sama seperti backend Next.
func (s *Server) salinFotoJaminan(ctx context.Context, tenantID, entryID string, foto []db.FotoJaminan) []db.FotoJaminan {
	if s.store == nil || len(foto) == 0 {
		if s.store == nil && len(foto) > 0 {
			s.log.Warn("foto jaminan tidak disalin: storage belum dikonfigurasi", "entry", entryID)
		}
		return nil
	}

	prefixBlacklist := "blacklist/" + tenantID + "/"
	prefixMember := tenantID + "/"

	hasil := make([]db.FotoJaminan, 0, len(foto))
	for i, f := range foto {
		if strings.HasPrefix(f.Path, prefixBlacklist) {
			hasil = append(hasil, f)
			continue
		}
		if !strings.HasPrefix(f.Path, prefixMember) {
			s.log.Warn("foto jaminan dilewati: path di luar area tenant", "path", f.Path)
			continue
		}

		ext := ekstensiPath(f.Path)
		if ext == "" {
			ext = "bin"
		}
		tujuan := fmt.Sprintf("blacklist/%s/%s/doc-%d.%s", tenantID, entryID, i, ext)

		isi, err := s.store.Get(ctx, f.Path)
		if err != nil {
			s.log.Error("gagal membaca foto jaminan member", "err", err, "path", f.Path)
			continue
		}
		if err := s.store.Put(ctx, tujuan, isi, mimeDariEkstensi(ext)); err != nil {
			s.log.Error("gagal menyalin foto jaminan", "err", err, "tujuan", tujuan)
			continue
		}
		hasil = append(hasil, db.FotoJaminan{Label: f.Label, Path: tujuan})
	}
	return hasil
}

// hapusFotoJaminan membersihkan berkas yang tidak lagi dipakai entri.
func (s *Server) hapusFotoJaminan(ctx context.Context, tenantID string, foto []db.FotoJaminan) {
	for _, f := range foto {
		s.hapusSatuFoto(ctx, tenantID, f.Path)
	}
}

// hapusSatuFoto hanya menghapus berkas di area blacklist tenant ini. Guard
// prefix mencegah path aneh dari data lama menghapus objek tenant lain.
func (s *Server) hapusSatuFoto(ctx context.Context, tenantID, key string) {
	if s.store == nil || key == "" {
		return
	}
	if !strings.HasPrefix(key, "blacklist/"+tenantID+"/") {
		s.log.Warn("hapus foto dilewati: path di luar area blacklist tenant", "path", key)
		return
	}
	if err := s.store.Delete(ctx, key); err != nil {
		// Best effort: berkas sisa tidak merusak data, hanya memakan ruang.
		s.log.Error("gagal menghapus berkas jaminan", "err", err, "path", key)
	}
}

// fotoTidakDipakai mengembalikan foto lama yang tidak ada lagi di daftar baru.
func fotoTidakDipakai(lama, baru []db.FotoJaminan) []db.FotoJaminan {
	if len(lama) == 0 {
		return nil
	}
	dipertahankan := make(map[string]bool, len(baru))
	for _, f := range baru {
		dipertahankan[f.Path] = true
	}
	var sisa []db.FotoJaminan
	for _, f := range lama {
		if !dipertahankan[f.Path] {
			sisa = append(sisa, f)
		}
	}
	return sisa
}

func labelJaminanValid(label string) bool {
	switch label {
	case "KTP", "Kartu Keluarga", "SIM", "NPWP", "Lainnya":
		return true
	}
	return false
}

// slugLabel membuat nama objek yang aman: huruf kecil, spasi jadi tanda hubung.
func slugLabel(label string) string {
	return strings.ReplaceAll(strings.ToLower(label), " ", "-")
}

// ekstensiDariMime memetakan tipe yang diterima ke ekstensi objek.
func ekstensiDariMime(mime string) (string, bool) {
	switch mime {
	case "image/jpeg":
		return "jpg", true
	case "image/png":
		return "png", true
	case "application/pdf":
		return "pdf", true
	}
	return "", false
}

func ekstensiPath(p string) string {
	i := strings.LastIndexByte(p, '.')
	if i < 0 || i == len(p)-1 {
		return ""
	}
	return strings.ToLower(p[i+1:])
}

// mimeDariEkstensi dipakai saat menyajikan berkas: browser butuh tipe yang benar
// supaya PDF tampil inline, bukan terunduh sebagai biner.
func mimeDariEkstensi(ext string) string {
	switch ext {
	case "png":
		return "image/png"
	case "jpg", "jpeg":
		return "image/jpeg"
	case "webp":
		return "image/webp"
	case "pdf":
		return "application/pdf"
	}
	return "application/octet-stream"
}
