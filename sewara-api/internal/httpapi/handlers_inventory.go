package httpapi

import (
	"encoding/json"
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
