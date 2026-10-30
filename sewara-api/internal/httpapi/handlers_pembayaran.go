package httpapi

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"path"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/Rzp1010/sewara-split/sewara-api/internal/db"
)

const prefixBuktiBayar = "bukti-bayar/"

var bulanPembayaranPattern = regexp.MustCompile(`^\d{4}-\d{2}$`)

type riwayatBayar struct {
	Bukti   string `json:"bukti"`
	Tanggal string `json:"tanggal"`
	Tgl     string `json:"tgl"`
}
type pembayaranLegacy struct {
	Riwayat []riwayatBayar `json:"riwayatBayar"`
}

func bulanValida(s string) bool {
	if !bulanPembayaranPattern.MatchString(s) {
		return false
	}
	m := s[5:]
	return m >= "01" && m <= "12"
}
func monthString(y int, m time.Month) string {
	return time.Date(y, m, 1, 0, 0, 0, 0, time.UTC).Format("2006-01")
}
func bulanWIB(now time.Time) time.Time  { return now.In(time.FixedZone("WIB", 7*3600)) }
func reminderWindow(now time.Time) bool { d := bulanWIB(now).Day(); return d >= 8 && d <= 15 }
func bulanReminder(now time.Time, jumlahTarget, jumlahSebelum int) (string, int) {
	w := bulanWIB(now)
	target := monthString(w.Year(), w.Month()-2)
	fallback := monthString(w.Year(), w.Month()-3)
	if jumlahTarget > 0 {
		return target, jumlahTarget
	}
	return fallback, jumlahSebelum
}
func purgeCutoff(now time.Time) time.Time {
	w := bulanWIB(now)
	wall := time.Date(w.Year(), w.Month()-2, 1, 0, 0, 0, 0, time.FixedZone("WIB", 7*3600))
	return wall
}
func entryDate(e riwayatBayar) string {
	if e.Tanggal != "" {
		return e.Tanggal
	}
	return e.Tgl
}
func entriesForMonth(ts []db.PembayaranTransaksi, bulan string) []zipEntry {
	var entries []zipEntry
	for _, t := range ts {
		var p pembayaranLegacy
		_ = json.Unmarshal(t.Pembayaran, &p)
		var hits []riwayatBayar
		for _, e := range p.Riwayat {
			if e.Bukti != "" && strings.HasPrefix(entryDate(e), bulan) {
				hits = append(hits, e)
			}
		}
		sort.SliceStable(hits, func(i, j int) bool { return entryDate(hits[i]) < entryDate(hits[j]) })
		base := firstNonempty(ptrValue(t.NoInvoice), ptrValue(t.IDTransaksi), fmt.Sprint(t.ID))
		base = sanitizeFilename(base)
		penyewa := sanitizeFilename(t.Penyewa)
		for i, e := range hits {
			suffix := ""
			if i > 0 {
				suffix = fmt.Sprintf(" (%d)", i+1)
			}
			ext := strings.ToLower(path.Ext(strings.SplitN(e.Bukti, "?", 2)[0]))
			if ext == "" {
				ext = ".jpg"
			}
			entries = append(entries, zipEntry{key: e.Bukti, name: base + " - " + penyewa + suffix + ext})
		}
	}
	return entries
}

type zipEntry struct{ key, name string }

func ptrValue(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}
func firstNonempty(a ...string) string {
	for _, s := range a {
		if s != "" {
			return s
		}
	}
	return ""
}
func sanitizeFilename(s string) string {
	r := strings.NewReplacer("\\", " ", "/", " ", ":", " ", "*", " ", "?", " ", "\"", " ", "<", " ", ">", " ", "|", " ", "\r", " ", "\n", " ")
	return strings.Join(strings.Fields(r.Replace(s)), " ")
}
func countPaymentMonth(ts []db.PembayaranTransaksi, bulan string) int {
	n := 0
	for _, t := range ts {
		var p pembayaranLegacy
		_ = json.Unmarshal(t.Pembayaran, &p)
		for _, e := range p.Riwayat {
			if e.Bukti != "" && strings.HasPrefix(entryDate(e), bulan) {
				n++
			}
		}
	}
	return n
}
func (s *Server) pembayaranTransaksi(w http.ResponseWriter, r *http.Request, me db.Identity) (string, []db.PembayaranTransaksi, bool) {
	tenant, err := s.db.TenantID(r.Context(), me.UserID)
	if err != nil {
		s.log.Error("gagal membaca tenant pembayaran", "err", err)
		writeError(w, 500, CodeInternalError, "Terjadi kesalahan server. Coba lagi.")
		return "", nil, false
	}
	ts, err := s.db.ListPembayaranTransaksi(r.Context(), me.UserID)
	if err != nil {
		s.log.Error("gagal membaca transaksi pembayaran", "err", err)
		writeError(w, 500, CodeInternalError, "Terjadi kesalahan server. Coba lagi.")
		return "", nil, false
	}
	return tenant, ts, true
}
func (s *Server) handlePembayaranExport(w http.ResponseWriter, r *http.Request, me db.Identity) {
	bulan := r.URL.Query().Get("bulan")
	if !bulanValida(bulan) {
		writeValidationError(w, "Parameter bulan tidak valid. Format: YYYY-MM.", nil)
		return
	}
	_, ts, ok := s.pembayaranTransaksi(w, r, me)
	if !ok {
		return
	}
	entries := entriesForMonth(ts, bulan)
	if len(entries) == 0 {
		writeJSON(w, 200, map[string]any{"ok": false, "message": "Tidak ada bukti bayar untuk bulan tersebut."})
		return
	}
	if s.store == nil {
		writeError(w, 503, CodeExternalServiceError, msgStorageOff)
		return
	}
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	folder := "bukti-bayar-" + bulan + "/"
	skipped := 0
	for _, e := range entries {
		b, err := s.store.Get(r.Context(), e.key)
		if err != nil {
			skipped++
			s.log.Warn("bukti bayar export: file di-skip", "path", e.key, "err", err)
			continue
		}
		f, err := zw.Create(folder + e.name)
		if err != nil {
			s.log.Error("gagal membuat ZIP pembayaran", "err", err)
			writeError(w, 500, CodeInternalError, "Terjadi kesalahan server. Coba lagi.")
			return
		}
		if _, err = f.Write(b); err != nil {
			s.log.Error("gagal menulis ZIP pembayaran", "err", err)
			writeError(w, 500, CodeInternalError, "Terjadi kesalahan server. Coba lagi.")
			return
		}
	}
	if err := zw.Close(); err != nil {
		writeError(w, 500, CodeInternalError, "Terjadi kesalahan server. Coba lagi.")
		return
	}
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=bukti-bayar-%s.zip", bulan))
	w.Header().Set("X-Skipped-Count", fmt.Sprint(skipped))
	w.WriteHeader(200)
	_, _ = w.Write(buf.Bytes())
}
func (s *Server) handlePembayaranPhoto(w http.ResponseWriter, r *http.Request, me db.Identity) {
	key := r.URL.Query().Get("path")
	if key == "" {
		writeValidationError(w, "Parameter path wajib diisi.", nil)
		return
	}
	tenant, err := s.db.TenantID(r.Context(), me.UserID)
	if err != nil {
		s.log.Error("gagal membaca tenant pembayaran", "err", err)
		writeError(w, 500, CodeInternalError, "Terjadi kesalahan server. Coba lagi.")
		return
	}
	if !strings.HasPrefix(key, prefixBuktiBayar+tenant+"/") {
		writeValidationError(w, "Path tidak valid.", nil)
		return
	}
	if s.store == nil {
		writeError(w, 503, CodeExternalServiceError, msgStorageOff)
		return
	}
	b, err := s.store.Get(r.Context(), key)
	if err != nil {
		writeError(w, 404, CodeNotFound, "Bukti tidak ditemukan (mungkin sudah terhapus otomatis).")
		return
	}
	ext := strings.ToLower(path.Ext(key))
	mime := "image/jpeg"
	if ext == ".png" {
		mime = "image/png"
	} else if ext == ".webp" {
		mime = "image/webp"
	}
	w.Header().Set("Content-Type", mime)
	w.Header().Set("Cache-Control", "private, max-age=3600")
	w.Header().Set("Content-Disposition", "inline")
	w.WriteHeader(200)
	_, _ = w.Write(b)
}
func (s *Server) handlePembayaranPurge(w http.ResponseWriter, r *http.Request) {
	if s.cfg.PurgeSecret == "" || r.Header.Get("x-purge-secret") != s.cfg.PurgeSecret {
		writeJSON(w, 401, map[string]any{"ok": false, "message": "Unauthorized"})
		return
	}
	if s.store == nil {
		writeError(w, 503, CodeExternalServiceError, msgStorageOff)
		return
	}
	cutoff := purgeCutoff(time.Now())
	n, err := s.store.DeleteOlderThan(r.Context(), prefixBuktiBayar, cutoff)
	if err != nil {
		s.log.Error("gagal purge bukti bayar", "err", err)
		writeError(w, 502, CodeExternalServiceError, "Gagal menghapus berkas. Coba lagi.")
		return
	}
	s.log.Info("purge bukti bayar selesai", "deleted", n, "cutoff", cutoff.UTC().Format(time.RFC3339Nano))
	writeJSON(w, 200, map[string]any{"ok": true, "deleted": n, "cutoff": cutoff.UTC().Format(time.RFC3339Nano)})
}
func (s *Server) handlePembayaranReminder(w http.ResponseWriter, r *http.Request, me db.Identity) {
	now := time.Now()
	if !reminderWindow(now) {
		writeSuccess(w, 200, map[string]any{"show": false})
		return
	}
	tenant, ts, ok := s.pembayaranTransaksi(w, r, me)
	if !ok {
		return
	}
	wib := bulanWIB(now)
	target := monthString(wib.Year(), wib.Month()-2)
	fallback := monthString(wib.Year(), wib.Month()-3)
	n1 := countPaymentMonth(ts, target)
	n2 := countPaymentMonth(ts, fallback)
	bulan, n := bulanReminder(now, n1, n2)
	setting, err := s.db.GetSettingByKey(r.Context(), me.UserID, "bukti_backup_ack")
	if err != nil {
		s.log.Error("gagal membaca ack bukti bayar", "err", err)
		writeError(w, 500, CodeInternalError, "Terjadi kesalahan server. Coba lagi.")
		return
	}
	ack := ""
	if setting != nil && setting.Value != nil {
		ack = db.UnquoteSetting(setting.Value)
	}
	purgeTanggal := monthString(wib.Year(), wib.Month()) + "-15"
	_ = tenant
	writeSuccess(w, 200, map[string]any{"show": ack != bulan && (n1 > 0 || n2 > 0), "bulan": bulan, "purgeTanggal": purgeTanggal, "jumlah": n})
}
func (s *Server) handlePembayaranAck(w http.ResponseWriter, r *http.Request, me db.Identity) {
	var body struct {
		Bulan string `json:"bulan"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&body); err != nil || !bulanValida(body.Bulan) {
		writeValidationError(w, "Parameter bulan tidak valid. Format: YYYY-MM.", nil)
		return
	}
	tenant, err := s.db.TenantID(r.Context(), me.UserID)
	if err != nil {
		s.log.Error("gagal membaca tenant pembayaran", "err", err)
		writeError(w, 500, CodeInternalError, "Terjadi kesalahan server. Coba lagi.")
		return
	}
	if err = s.db.UpsertPembayaranAck(r.Context(), me.UserID, tenant, body.Bulan, time.Now()); err != nil {
		s.log.Error("gagal menyimpan ack bukti bayar", "err", err)
		writeError(w, 500, CodeInternalError, "Terjadi kesalahan server. Coba lagi.")
		return
	}
	writeSuccess(w, 200, map[string]any{"ok": true})
}
func (s *Server) handlePembayaranUpload(w http.ResponseWriter, r *http.Request, me db.Identity) {
	r.Body = http.MaxBytesReader(w, r.Body, 6<<20)
	file, header, err := r.FormFile("file")
	if err != nil {
		writeValidationError(w, "File atau transaksi ID tidak valid.", nil)
		return
	}
	defer file.Close()
	transaksiID := strings.TrimSpace(r.FormValue("transaksiId"))
	// transactions.id adalah bigint (dikirim frontend sebagai string angka).
	// Kosong/bukan angka → 400, sama seperti Next untuk kasus setara.
	idTransaksi, err := strconv.ParseInt(transaksiID, 10, 64)
	if err != nil {
		writeValidationError(w, "File atau transaksi ID tidak valid.", nil)
		return
	}
	isi, err := io.ReadAll(io.LimitReader(file, (5<<20)+1))
	if err != nil {
		writeValidationError(w, "File atau transaksi ID tidak valid.", nil)
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
	case "image/jpeg":
		ext = "jpg"
	case "image/png":
		ext = "png"
	case "image/webp":
		ext = "webp"
	default:
		writeValidationError(w, "Jenis file tidak didukung. Gunakan JPG, PNG, atau WebP.", nil)
		return
	}
	tenant, err := s.db.TenantID(r.Context(), me.UserID)
	if err != nil {
		s.log.Error("gagal membaca tenant pembayaran", "err", err)
		writeError(w, 500, CodeInternalError, "Terjadi kesalahan server. Coba lagi.")
		return
	}
	ada, err := s.db.TransaksiMilikTenant(r.Context(), me.UserID, tenant, idTransaksi)
	if err != nil {
		s.log.Error("gagal memeriksa transaksi bukti bayar", "err", err)
		writeError(w, 500, CodeInternalError, "Terjadi kesalahan server. Coba lagi.")
		return
	}
	if !ada {
		writeError(w, 404, CodeNotFound, "Transaksi tidak ditemukan.")
		return
	}
	if s.store == nil {
		writeError(w, 503, CodeExternalServiceError, msgStorageOff)
		return
	}
	key := fmt.Sprintf("bukti-bayar/%s/%s/pay-%d.%s", tenant, transaksiID, time.Now().UnixMilli(), ext)
	if err := s.store.Put(r.Context(), key, isi, mime); err != nil {
		s.log.Error("gagal mengunggah bukti bayar", "err", err)
		writeError(w, 502, CodeExternalServiceError, "Gagal mengunggah berkas. Coba lagi.")
		return
	}
	writeSuccess(w, 200, map[string]any{"path": key})
}

// Fungsi murni di atas memisahkan aturan tanggal dari storage/DB untuk uji deterministik.
