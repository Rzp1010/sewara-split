package httpapi

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/Rzp1010/sewara-split/sewara-api/internal/db"
)

// handleInventoryGet mengembalikan katalog inventaris tenant.
//
//   - ?ids=1,2,3  hanya baris tersebut (dipakai keranjang booking)
//   - ?ringkas=1  hanya id
//
// Parameter `kolom` dari backend Next sengaja tidak didukung: nilainya
// disambung langsung ke daftar kolom SELECT, sehingga bentuk amannya hanya
// daftar putih tetap. Frontend tidak pernah memakai `kolom` untuk inventory
// (hanya untuk transactions), jadi menolak lebih jujur daripada diam-diam
// mengembalikan kolom yang tidak diminta.
func (s *Server) handleInventoryGet(w http.ResponseWriter, r *http.Request, me db.Identity) {
	q := r.URL.Query()

	if q.Get("kolom") != "" {
		writeValidationError(w, "Parameter 'kolom' tidak didukung untuk inventory.", nil)
		return
	}

	// q.Has, bukan q.Get == "": `?ids=` adalah filter kosong yang harus
	// menghasilkan nol baris. Kalau memakai nilai string, "tidak ada parameter"
	// dan "ada tapi kosong" jadi tidak bisa dibedakan dan `?ids=` diam-diam
	// mengembalikan seluruh katalog.
	var ids []int64
	if q.Has("ids") {
		parsed, err := parseInventoryIDs(q.Get("ids"))
		if err != nil {
			writeValidationError(w, "Parameter 'ids' harus berisi angka yang dipisah koma.", nil)
			return
		}
		ids = parsed
	}

	if q.Get("ringkas") == "1" {
		items, err := s.db.GetInventoryRingkas(r.Context(), me.UserID, ids)
		if err != nil {
			s.log.Error("gagal membaca inventory ringkas", "err", err)
			writeError(w, http.StatusInternalServerError, CodeInternalError, "Terjadi kesalahan server. Coba lagi.")
			return
		}
		writeSuccess(w, http.StatusOK, map[string]any{"inventory": items})
		return
	}

	items, err := s.db.GetInventory(r.Context(), me.UserID, ids)
	if err != nil {
		s.log.Error("gagal membaca inventory", "err", err)
		writeError(w, http.StatusInternalServerError, CodeInternalError, "Terjadi kesalahan server. Coba lagi.")
		return
	}
	writeSuccess(w, http.StatusOK, map[string]any{"inventory": items})
}

// handleInventoryPost menambah satu barang inventaris.
func (s *Server) handleInventoryPost(w http.ResponseWriter, r *http.Request, me db.Identity) {
	var body inventoryBody
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&body); err != nil {
		writeValidationError(w, "Body tidak valid.", nil)
		return
	}

	item, pesan := body.toItem()
	if pesan != "" {
		writeValidationError(w, pesan, nil)
		return
	}

	// Staf menulis atas nama owner-nya; id tenant ditentukan server, tidak boleh
	// datang dari body.
	tenantID, err := s.db.TenantID(r.Context(), me.UserID)
	if err != nil {
		s.log.Error("gagal membaca tenant id", "err", err)
		writeError(w, http.StatusInternalServerError, CodeInternalError, "Terjadi kesalahan server. Coba lagi.")
		return
	}

	saved, err := s.db.InsertInventory(r.Context(), me.UserID, tenantID, item)
	if err != nil {
		s.log.Error("gagal insert inventory", "err", err)
		writeError(w, http.StatusInternalServerError, CodeInternalError, "Terjadi kesalahan server. Coba lagi.")
		return
	}

	writeSuccess(w, http.StatusOK, map[string]any{"inventory": saved})
}

// inventoryBody adalah isi permintaan POST /api/inventory.
//
// Field yang tidak dikirim dibiarkan nil lalu diisi default kolom oleh toItem.
// `id` sengaja tidak dideklarasikan: kalau frontend mengirimnya, nilainya
// diabaikan — nomor urut milik database.
//
// `denda` bertipe RawMessage karena kolomnya text tetapi frontend mengirim angka
// (hasil parseInt) di form dan CSV. Kalau dideklarasikan *string, jalur input
// yang mengirim angka gagal decode dan permintaan ditolak sebagai "body tidak
// valid" — pesan yang menyesatkan untuk data yang sebenarnya sah.
type inventoryBody struct {
	Nama       string          `json:"nama"`
	Jenis      string          `json:"jenis"`
	TipeSewa   *string         `json:"tipeSewa"`
	H6         *float64        `json:"h6"`
	H12        *float64        `json:"h12"`
	H24        *float64        `json:"h24"`
	Denda      json.RawMessage `json:"denda"`
	Tag        *string         `json:"tag"`
	Kondisi    *string         `json:"kondisi"`
	Keterangan *string         `json:"keterangan"`
	Sns        json.RawMessage `json:"sns"`
	Komponen   json.RawMessage `json:"komponen"`
	KondisiSN  json.RawMessage `json:"kondisi_sn"`
}

// kondisiInventory adalah nilai yang diterima enum_kondisi_inventory.
var kondisiInventory = map[string]bool{
	"Sangat Baik":  true,
	"Baik":         true,
	"Rusak Ringan": true,
	"Rusak Berat":  true,
}

// toItem memvalidasi isi permintaan dan mengisi default.
//
// Pesan kosong berarti valid. Validasi di sini hanya untuk hal yang juga dipaksa
// skema: nama NOT NULL, serta jenis dan kondisi yang berupa enum. Tanpa ini
// pelanggaran enum keluar sebagai 500 dari database; dengan ini pemanggil
// menerima 400 beserta alasannya.
//
// `tipeSewa` sengaja TIDAK divalidasi terhadap daftar nilai: kolomnya text biasa,
// dan mengunci daftar di kode akan menolak nilai lama yang mungkin masih ada di
// data tenant.
func (b inventoryBody) toItem() (db.InventoryItem, string) {
	nama := strings.TrimSpace(b.Nama)
	if nama == "" {
		return db.InventoryItem{}, "Nama barang wajib diisi."
	}
	if b.Jenis != "satuan" && b.Jenis != "bundling" {
		return db.InventoryItem{}, "Jenis barang harus 'satuan' atau 'bundling'."
	}

	kondisi := strOr(b.Kondisi, "Baik")
	if !kondisiInventory[*kondisi] {
		return db.InventoryItem{}, "Kondisi barang tidak dikenal."
	}

	denda, err := jsonText(b.Denda)
	if err != nil {
		return db.InventoryItem{}, "Denda harus berupa teks atau angka."
	}

	return db.InventoryItem{
		Nama:       nama,
		Jenis:      b.Jenis,
		H6:         floatOr(b.H6, 0),
		H12:        floatOr(b.H12, 0),
		H24:        floatOr(b.H24, 0),
		Denda:      denda,
		Tag:        b.Tag,
		Kondisi:    kondisi,
		Keterangan: strOr(b.Keterangan, "-"),
		TipeSewa:   strOr(b.TipeSewa, "fleksibel"),
		Sns:        jsonbOr(b.Sns, "[]"),
		Komponen:   jsonbOr(b.Komponen, "[]"),
		KondisiSN:  jsonbOr(b.KondisiSN, "{}"),
	}, ""
}

// parseInventoryIDs membaca `?ids=1,2,3`.
//
// Selalu mengembalikan slice yang bukan nil: pemanggil hanya memanggilnya saat
// parameter ada, dan pada db nil berarti "tanpa filter". Untuk `?ids=` kosong,
// slice kosong itulah yang membuat query menghasilkan nol baris.
func parseInventoryIDs(raw string) ([]int64, error) {
	bagian := strings.Split(raw, ",")
	ids := make([]int64, 0, len(bagian))
	for _, b := range bagian {
		b = strings.TrimSpace(b)
		if b == "" {
			continue
		}
		id, err := strconv.ParseInt(b, 10, 64)
		if err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, nil
}

// strOr mengembalikan v, atau def kalau v nil atau string kosong.
//
// String kosong diperlakukan sebagai "tidak dikirim" karena kolom tujuan punya
// DEFAULT di skema, dan `kondisi` berupa enum yang akan menolak "".
func strOr(v *string, def string) *string {
	if v == nil || *v == "" {
		return &def
	}
	return v
}

// floatOr mengembalikan v, atau def kalau v nil. Dipakai untuk tarif yang
// DEFAULT-nya 0 di skema.
func floatOr(v *float64, def float64) *float64 {
	if v == nil {
		return &def
	}
	return v
}

// jsonbOr mengembalikan raw, atau JSON default kalau kosong/null.
//
// JSON `null` dinormalkan ke default supaya hasilnya SQL NULL saja, bukan JSON
// null di dalam kolom jsonb — dua hal berbeda yang sama-sama tampak "kosong" di
// frontend tetapi berbeda saat di-query.
func jsonbOr(raw json.RawMessage, def string) json.RawMessage {
	isi := strings.TrimSpace(string(raw))
	if isi == "" || isi == "null" {
		return json.RawMessage(def)
	}
	return raw
}

// jsonText mengubah nilai JSON apa pun menjadi teks untuk kolom text.
//
// Angka dikembalikan apa adanya sebagai literal ("0", "5000") karena begitulah
// PostgREST menyimpannya saat backend Next menerima angka. String dibaca lewat
// decoder supaya escape (`\"`, `\n`) tidak ikut tersimpan mentah.
func jsonText(raw json.RawMessage) (*string, error) {
	isi := strings.TrimSpace(string(raw))
	if isi == "" || isi == "null" {
		return nil, nil
	}
	if strings.HasPrefix(isi, `"`) {
		var s string
		if err := json.Unmarshal(raw, &s); err != nil {
			return nil, err
		}
		return &s, nil
	}
	return &isi, nil
}

// handleInventoryPatch menerapkan perubahan sebagian pada satu barang.
//
// Body dibaca sebagai map, bukan struct, karena PATCH harus membedakan tiga hal
// yang tidak bisa diwakili satu tipe field: kolom tidak dikirim (jangan disentuh),
// kolom dikirim null (kosongkan), dan kolom dikirim nilai (isi).
func (s *Server) handleInventoryPatch(w http.ResponseWriter, r *http.Request, me db.Identity) {
	id, ok := parseInventoryPathID(w, r)
	if !ok {
		return
	}

	var body map[string]json.RawMessage
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&body); err != nil {
		writeValidationError(w, "Body tidak valid.", nil)
		return
	}

	sets, komponen, pesan := buildInventoryPatch(body)
	if pesan != "" {
		writeValidationError(w, pesan, nil)
		return
	}
	if len(sets) == 0 {
		writeValidationError(w, "Tidak ada kolom yang diubah.", nil)
		return
	}

	tenantID, err := s.db.TenantID(r.Context(), me.UserID)
	if err != nil {
		s.log.Error("gagal membaca tenant id", "err", err)
		writeError(w, http.StatusInternalServerError, CodeInternalError, "Terjadi kesalahan server. Coba lagi.")
		return
	}

	saved, err := s.db.UpdateInventory(r.Context(), me.UserID, tenantID, id, sets, komponen)
	if err != nil {
		s.writeInventoryError(w, err)
		return
	}

	writeSuccess(w, http.StatusOK, map[string]any{"inventory": saved})
}

// handleInventoryDelete menghapus satu barang. Membalas 200 juga ketika tidak
// ada baris yang terhapus (sudah tidak ada, atau milik tenant lain): DELETE yang
// idempoten, sama seperti backend Next, dan frontend memperlakukannya sebagai
// "selesai" lalu memuat ulang daftar.
func (s *Server) handleInventoryDelete(w http.ResponseWriter, r *http.Request, me db.Identity) {
	id, ok := parseInventoryPathID(w, r)
	if !ok {
		return
	}

	if err := s.db.DeleteInventory(r.Context(), me.UserID, []int64{id}); err != nil {
		s.writeInventoryError(w, err)
		return
	}

	writeSuccess(w, http.StatusOK, map[string]any{"ok": true})
}

// handleInventoryBulkDelete menghapus beberapa barang sekaligus.
//
// Semua-atau-tidak-sama-sekali: kalau satu barang sudah dipakai transaksi, tidak
// ada yang terhapus. Frontend memakai jalur ini untuk hapus satu item juga,
// jadi perilakunya dibuat sama dengan handleInventoryDelete.
func (s *Server) handleInventoryBulkDelete(w http.ResponseWriter, r *http.Request, me db.Identity) {
	var body struct {
		IDs []int64 `json:"ids"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&body); err != nil {
		writeValidationError(w, "Body tidak valid.", nil)
		return
	}

	if err := s.db.DeleteInventory(r.Context(), me.UserID, body.IDs); err != nil {
		s.writeInventoryError(w, err)
		return
	}

	writeSuccess(w, http.StatusOK, map[string]any{"ok": true})
}

// writeInventoryError menerjemahkan error lapisan db menjadi respons HTTP.
//
// Pesan dan kode untuk PAKET_IN_USE / INVENTORY_IN_USE disalin dari backend Next:
// frontend mencocokkan `error.code === "INVENTORY_IN_USE"` dan menampilkan
// message server apa adanya.
func (s *Server) writeInventoryError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, db.ErrNotFound):
		writeError(w, http.StatusNotFound, CodeNotFound, "Inventaris tidak ditemukan.")
	case errors.Is(err, db.ErrPaketDipakai):
		writeError(w, http.StatusConflict, CodePaketInUse,
			"Isi paket tidak bisa diubah selama dipakai booking aktif (Booking/Disewa).")
	case errors.Is(err, db.ErrInventoryDipakai):
		writeError(w, http.StatusConflict, CodeInventoryInUse,
			"Inventaris tidak dapat dihapus karena sudah digunakan dalam transaksi.")
	default:
		s.log.Error("operasi inventaris gagal", "err", err)
		writeError(w, http.StatusInternalServerError, CodeInternalError, "Terjadi kesalahan server. Coba lagi.")
	}
}

// parseInventoryPathID membaca {id} dari path. Yang bukan angka ditolak sebelum
// menyentuh database.
func parseInventoryPathID(w http.ResponseWriter, r *http.Request) (int64, bool) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeValidationError(w, "Id inventaris harus berupa angka.", nil)
		return 0, false
	}
	return id, true
}

// buildInventoryPatch mengubah body PATCH menjadi daftar kolom yang berubah.
//
// Yang dikembalikan: daftar SET, isi `komponen` (nil kalau tidak dikirim, dipakai
// db untuk guard paket), dan pesan validasi (kosong berarti valid).
//
// Kolom `id`, `user_id`, `created_at`, dan `updated_at` diabaikan tanpa error:
// frontend mengirim seluruh baris, dan backend Next juga membuang `user_id`
// diam-diam. Kolom lain yang tidak dikenal justru ditolak supaya salah ketik
// tidak lewat sebagai "tidak ada yang berubah".
func buildInventoryPatch(body map[string]json.RawMessage) ([]db.SetClause, json.RawMessage, string) {
	dikenal := map[string]bool{
		"id": true, "user_id": true, "created_at": true, "updated_at": true,
		"nama": true, "jenis": true, "kondisi": true, "tipeSewa": true,
		"denda": true, "tag": true, "keterangan": true, "tarif": true,
		"h6": true, "h12": true, "h24": true,
		"sns": true, "komponen": true, "kondisi_sn": true,
	}
	for kunci := range body {
		if !dikenal[kunci] {
			return nil, nil, "Kolom '" + kunci + "' tidak dikenal."
		}
	}

	sets := make([]db.SetClause, 0, len(body))

	if raw, ada := body["nama"]; ada {
		nama, err := jsonText(raw)
		if err != nil || nama == nil || strings.TrimSpace(*nama) == "" {
			return nil, nil, "Nama barang wajib diisi."
		}
		sets = append(sets, db.SetClause{Kolom: "nama", Arg: strings.TrimSpace(*nama)})
	}

	if raw, ada := body["jenis"]; ada {
		jenis, err := jsonText(raw)
		if err != nil || jenis == nil || (*jenis != "satuan" && *jenis != "bundling") {
			return nil, nil, "Jenis barang harus 'satuan' atau 'bundling'."
		}
		sets = append(sets, db.SetClause{Kolom: "jenis", Arg: *jenis})
	}

	if raw, ada := body["kondisi"]; ada {
		kondisi, err := jsonText(raw)
		if err != nil {
			return nil, nil, "Kondisi barang tidak dikenal."
		}
		if kondisi != nil && !kondisiInventory[*kondisi] {
			return nil, nil, "Kondisi barang tidak dikenal."
		}
		sets = append(sets, db.SetClause{Kolom: "kondisi", Arg: nilaiAtauNull(kondisi)})
	}

	for _, kunci := range []string{"tipeSewa", "tag", "keterangan", "tarif"} {
		raw, ada := body[kunci]
		if !ada {
			continue
		}
		teks, err := jsonText(raw)
		if err != nil {
			return nil, nil, "Kolom '" + kunci + "' harus berupa teks atau null."
		}
		sets = append(sets, db.SetClause{Kolom: kunci, Arg: nilaiAtauNull(teks)})
	}

	if raw, ada := body["denda"]; ada {
		denda, err := jsonText(raw)
		if err != nil {
			return nil, nil, "Denda harus berupa teks atau angka."
		}
		sets = append(sets, db.SetClause{Kolom: "denda", Arg: nilaiAtauNull(denda)})
	}

	for _, kunci := range []string{"h6", "h12", "h24"} {
		raw, ada := body[kunci]
		if !ada {
			continue
		}
		angka, err := jsonNumber(raw)
		if err != nil {
			return nil, nil, "Kolom '" + kunci + "' harus berupa angka atau null."
		}
		sets = append(sets, db.SetClause{Kolom: kunci, Arg: angka})
	}

	if raw, ada := body["sns"]; ada {
		sets = append(sets, db.SetClause{Kolom: "sns", Arg: jsonbOr(raw, "[]")})
	}

	var komponen json.RawMessage
	if raw, ada := body["komponen"]; ada {
		if pesan := validasiKomponen(raw); pesan != "" {
			return nil, nil, pesan
		}
		komponen = jsonbOr(raw, "[]")
		sets = append(sets, db.SetClause{Kolom: "komponen", Arg: komponen})
	}

	if raw, ada := body["kondisi_sn"]; ada {
		sets = append(sets, db.SetClause{Kolom: "kondisi_sn", Arg: jsonbOr(raw, "{}")})
	}

	return sets, komponen, ""
}

// validasiKomponen memeriksa isi paket. Pesannya disalin dari backend Next.
func validasiKomponen(raw json.RawMessage) string {
	if strings.TrimSpace(string(raw)) == "null" {
		return ""
	}

	var daftar []json.RawMessage
	if err := json.Unmarshal(raw, &daftar); err != nil {
		return "Komponen harus berupa array."
	}

	for _, entri := range daftar {
		var c map[string]json.RawMessage
		if err := json.Unmarshal(entri, &c); err != nil || c == nil {
			return "Setiap komponen wajib punya idBarang dan qty > 0."
		}

		idBarang, ada := c["idBarang"]
		if !ada || strings.TrimSpace(string(idBarang)) == "null" {
			return "Setiap komponen wajib punya idBarang dan qty > 0."
		}

		qty, err := jsonNumber(c["qty"])
		if err != nil || qty == nil {
			return "Setiap komponen wajib punya idBarang dan qty > 0."
		}
		if q, ok := qty.(float64); !ok || !(q > 0) {
			return "Setiap komponen wajib punya idBarang dan qty > 0."
		}

		if nama, ada := c["nama"]; ada {
			isi := strings.TrimSpace(string(nama))
			if isi != "null" && !strings.HasPrefix(isi, `"`) {
				return "Nama komponen harus berupa teks."
			}
		}
	}

	return ""
}

// nilaiAtauNull mengubah *string menjadi nilai untuk database: nil jadi NULL,
// selain itu string biasa.
func nilaiAtauNull(v *string) any {
	if v == nil {
		return nil
	}
	return *v
}

// jsonNumber membaca angka atau null dari JSON. Dipakai untuk kolom numeric.
func jsonNumber(raw json.RawMessage) (any, error) {
	isi := strings.TrimSpace(string(raw))
	if isi == "" || isi == "null" {
		return nil, nil
	}
	nilai, err := strconv.ParseFloat(strings.Trim(isi, `"`), 64)
	if err != nil {
		return nil, err
	}
	return nilai, nil
}
