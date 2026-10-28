package db

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// sqlInventoryKolom adalah daftar kolom barang inventaris yang dibaca dan
// dikembalikan. Ditulis sekali sebagai konstanta supaya SELECT dan RETURNING
// tidak bisa berbeda kolom — selisih seperti itu hanya terlihat di frontend
// sebagai field kosong, bukan sebagai error.
//
// `jenis` dan `kondisi` di-CAST ke text karena keduanya enum: dengan cast, hasil
// scan selalu string biasa dan tidak bergantung pada cara pgx memetakan OID enum.
// `"tipeSewa"` dikutip karena kolomnya memang dideklarasikan camelCase di skema,
// dan frontend membaca nama itu apa adanya.
const sqlInventoryKolom = `id, nama, jenis::text, h6, h12, h24, denda,
	       sns, komponen, created_at, updated_at, user_id::text,
	       "tipeSewa", kondisi::text, keterangan, tarif, tag, kondisi_sn`

// InventoryItem adalah satu baris katalog inventaris.
//
// Field yang nullable di skema bertipe pointer: kolom seperti `kondisi` dan
// `tipeSewa` punya DEFAULT tetapi tidak NOT NULL, jadi baris lama bisa berisi
// NULL. Tanpa pointer, satu baris NULL menggagalkan seluruh permintaan.
type InventoryItem struct {
	ID         int64           `json:"id"`
	Nama       string          `json:"nama"`
	Jenis      string          `json:"jenis"`
	H6         *float64        `json:"h6"`
	H12        *float64        `json:"h12"`
	H24        *float64        `json:"h24"`
	Denda      *string         `json:"denda"`
	Sns        json.RawMessage `json:"sns"`
	Komponen   json.RawMessage `json:"komponen"`
	CreatedAt  *time.Time      `json:"created_at"`
	UpdatedAt  *time.Time      `json:"updated_at"`
	UserID     *string         `json:"user_id"`
	TipeSewa   *string         `json:"tipeSewa"`
	Kondisi    *string         `json:"kondisi"`
	Keterangan *string         `json:"keterangan"`
	Tarif      *string         `json:"tarif"`
	Tag        *string         `json:"tag"`
	KondisiSN  json.RawMessage `json:"kondisi_sn"`
}

// InventoryRingkas adalah bentuk jawaban `?ringkas=1`: hanya id.
//
// Tipe terpisah, bukan InventoryItem dengan field lain dikosongkan, karena
// encoding/json tidak bisa membedakan "tidak diminta" dari "nilainya nol" —
// memakai InventoryItem akan mengirim h24:null dan sns:null yang tidak ada di
// kontrak backend Next.
type InventoryRingkas struct {
	ID int64 `json:"id"`
}

// rowScanner adalah bagian pgx.Row yang dipakai scanner di bawah. Dipakai supaya
// scan satu baris bisa ditulis sekali dan dipakai QueryRow maupun Rows.
type rowScanner interface {
	Scan(dest ...any) error
}

func scanInventoryItem(row rowScanner) (InventoryItem, error) {
	var it InventoryItem
	err := row.Scan(&it.ID, &it.Nama, &it.Jenis, &it.H6, &it.H12, &it.H24, &it.Denda,
		&it.Sns, &it.Komponen, &it.CreatedAt, &it.UpdatedAt, &it.UserID,
		&it.TipeSewa, &it.Kondisi, &it.Keterangan, &it.Tarif, &it.Tag, &it.KondisiSN)
	return it, err
}

// GetInventory membaca katalog inventaris tenant, diurutkan nama.
//
// ids nil berarti tanpa filter. ids kosong (tapi bukan nil) berarti "cari yang
// ini" dengan daftar kosong, dan hasilnya harus nol baris — bukan seluruh
// katalog. Perbedaan itu penting karena `?ids=` yang kosong tetap sebuah filter.
//
// Kalau ids diisi, urutan tidak ditentukan; sama seperti backend Next, pemanggil
// yang memfilter sendiri urutannya.
func (d *DB) GetInventory(ctx context.Context, userID string, ids []int64) ([]InventoryItem, error) {
	sql := "SELECT " + sqlInventoryKolom + " FROM inventory"
	var args []any
	if ids != nil {
		sql += " WHERE id = ANY($1::bigint[])"
		args = append(args, ids)
	} else {
		sql += " ORDER BY nama"
	}

	var items []InventoryItem
	err := d.InTenant(ctx, userID, func(q Querier) error {
		rows, err := q.Query(ctx, sql, args...)
		if err != nil {
			return err
		}
		defer rows.Close()

		for rows.Next() {
			it, err := scanInventoryItem(rows)
			if err != nil {
				return err
			}
			items = append(items, it)
		}
		return rows.Err()
	})
	if err != nil {
		return nil, fmt.Errorf("membaca inventory: %w", err)
	}
	return items, nil
}

// GetInventoryRingkas membaca id barang inventaris saja.
//
// Dipakai pemanggil yang hanya butuh daftar pilihan. Mengirim 18 kolom untuk
// kebutuhan itu membuat respons tumbuh seiring jumlah Nomor Seri, padahal isinya
// tidak dipakai. Semantik ids sama dengan GetInventory.
func (d *DB) GetInventoryRingkas(ctx context.Context, userID string, ids []int64) ([]InventoryRingkas, error) {
	sql := "SELECT id FROM inventory"
	var args []any
	if ids != nil {
		sql += " WHERE id = ANY($1::bigint[])"
		args = append(args, ids)
	} else {
		sql += " ORDER BY nama"
	}

	var items []InventoryRingkas
	err := d.InTenant(ctx, userID, func(q Querier) error {
		rows, err := q.Query(ctx, sql, args...)
		if err != nil {
			return err
		}
		defer rows.Close()

		for rows.Next() {
			var it InventoryRingkas
			if err := rows.Scan(&it.ID); err != nil {
				return err
			}
			items = append(items, it)
		}
		return rows.Err()
	})
	if err != nil {
		return nil, fmt.Errorf("membaca inventory ringkas: %w", err)
	}
	return items, nil
}

// InsertInventory menyimpan satu barang inventaris baru dan mengembalikan baris
// tersimpan.
//
// `id` tidak pernah dikirim pemanggil: kolomnya DEFAULT nextval(inventory_id_seq),
// jadi nomor dibuat database secara atomik. Frontend lama mengirim id hasil tebak
// max+1 dan itu sempat menabrak inventory_pkey saat dua tab menyimpan bersamaan.
//
// user_id diisi tenant, bukan pemanggil: staf menulis atas nama owner-nya. RLS
// WITH CHECK pada tabel inventory menolak baris dengan user_id lain, jadi tenant
// yang salah gagal di database, bukan diam-diam tersimpan.
func (d *DB) InsertInventory(ctx context.Context, userID, tenantID string, it InventoryItem) (InventoryItem, error) {
	var result InventoryItem
	err := d.InTenant(ctx, userID, func(q Querier) error {
		row := q.QueryRow(ctx, `
			INSERT INTO inventory
				(nama, jenis, h6, h12, h24, denda, sns, komponen, user_id,
				 "tipeSewa", kondisi, keterangan, tarif, tag, kondisi_sn)
			VALUES ($1, $2::text::enum_jenis_inventory, $3, $4, $5, $6, $7, $8, $9::uuid,
			        $10, $11::text::enum_kondisi_inventory, $12, $13, $14, $15)
			RETURNING `+sqlInventoryKolom,
			it.Nama, it.Jenis, it.H6, it.H12, it.H24, it.Denda, it.Sns, it.Komponen, tenantID,
			it.TipeSewa, it.Kondisi, it.Keterangan, it.Tarif, it.Tag, it.KondisiSN)

		saved, err := scanInventoryItem(row)
		if err != nil {
			return err
		}
		result = saved
		return nil
	})
	if err != nil {
		return InventoryItem{}, fmt.Errorf("insert inventory: %w", err)
	}
	return result, nil
}

// ErrPaketDipakai berarti isi paket tidak boleh diubah karena paketnya dipakai
// transaksi berstatus Booking atau Disewa.
var ErrPaketDipakai = errors.New("paket dipakai booking aktif")

// ErrInventoryDipakai berarti barang tidak boleh dihapus karena sudah tercatat
// di transaksi mana pun.
var ErrInventoryDipakai = errors.New("inventaris dipakai transaksi")

// SetClause adalah satu kolom yang diubah beserta nilai barunya.
// Arg nil berarti kolom diisi NULL.
type SetClause struct {
	Kolom string
	Arg   any
}

// kolomBolehDiubah adalah daftar putih kolom yang boleh muncul di SET.
//
// Nama kolom disusun menjadi SQL, jadi nilainya wajib berasal dari daftar ini —
// bukan dari input pemanggil. Kolom yang sengaja tidak ada di sini:
// id (identitas baris), user_id (milik tenant, bukan klien), created_at dan
// updated_at (diurus database).
var kolomBolehDiubah = map[string]bool{
	"nama":       true,
	"jenis":      true,
	"h6":         true,
	"h12":        true,
	"h24":        true,
	"denda":      true,
	"sns":        true,
	"komponen":   true,
	"tipeSewa":   true,
	"kondisi":    true,
	"keterangan": true,
	"tarif":      true,
	"tag":        true,
	"kondisi_sn": true,
}

// castKolom menambahkan CAST untuk kolom yang tipenya bukan text biasa.
//
// Enum di-CAST lewat text supaya nilai yang dikirim Go diketik sebagai text
// lalu diterjemahkan Postgres ke enum; tanpa itu tipe parameter bergantung pada
// pemetaan OID enum oleh driver.
var castKolom = map[string]string{
	"jenis":   "::text::enum_jenis_inventory",
	"kondisi": "::text::enum_kondisi_inventory",
}

// UpdateInventory menerapkan perubahan pada satu barang milik tenant.
//
// komponenBaru bukan nil berarti pemanggil ikut mengirim isi paket. Dalam kasus
// itu guard "paket sedang dipakai" dijalankan di transaksi yang sama dengan
// UPDATE, sehingga tidak ada celah antara pemeriksaan dan penulisan.
//
// Mengembalikan ErrNotFound kalau baris tidak ada atau milik tenant lain, dan
// ErrPaketDipakai kalau isi paket berubah saat dipakai booking aktif.
func (d *DB) UpdateInventory(ctx context.Context, userID, tenantID string, id int64, sets []SetClause, komponenBaru json.RawMessage) (InventoryItem, error) {
	if len(sets) == 0 {
		return InventoryItem{}, errors.New("tidak ada kolom yang diubah")
	}

	var result InventoryItem
	err := d.InTenant(ctx, userID, func(q Querier) error {
		if komponenBaru != nil {
			if err := pastikanKomponenBolehDiubah(ctx, q, tenantID, id, komponenBaru); err != nil {
				return err
			}
		}

		bagianSet, args, err := susunSet(sets)
		if err != nil {
			return err
		}
		args = append(args, id, tenantID)
		idParam := len(args) - 1
		tenantParam := len(args)

		sql := fmt.Sprintf(
			"UPDATE inventory SET %s WHERE id = $%d AND user_id = $%d::uuid RETURNING %s",
			bagianSet, idParam, tenantParam, sqlInventoryKolom)

		saved, err := scanInventoryItem(q.QueryRow(ctx, sql, args...))
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		result = saved
		return nil
	})
	if err != nil {
		return InventoryItem{}, err
	}
	return result, nil
}

// DeleteInventory menghapus satu atau beberapa barang inventaris.
//
// Preflight ke transaction_items dilakukan di transaksi yang sama dengan DELETE,
// jadi hasilnya atomik: kalau satu barang saja sudah dipakai transaksi, tidak ada
// yang terhapus. Backend Next hanya melakukan preflight ini di bulk-delete;
// di sini jalur satu-id ikut memakainya supaya keduanya berperilaku sama.
//
// Baris milik tenant lain tidak dihapus dan tidak menghasilkan error — RLS yang
// menyaringnya, dan DELETE yang mengenai nol baris bukan kegagalan.
func (d *DB) DeleteInventory(ctx context.Context, userID string, ids []int64) error {
	if len(ids) == 0 {
		return nil
	}

	err := d.InTenant(ctx, userID, func(q Querier) error {
		var dipakai bool
		if err := q.QueryRow(ctx, `
			SELECT EXISTS (SELECT 1 FROM transaction_items WHERE inventory_id = ANY($1::bigint[]))`,
			ids).Scan(&dipakai); err != nil {
			return err
		}
		if dipakai {
			return ErrInventoryDipakai
		}

		_, err := q.Exec(ctx, `DELETE FROM inventory WHERE id = ANY($1::bigint[])`, ids)
		return err
	})
	if err != nil {
		return err
	}
	return nil
}

// susunSet menyusun bagian SET beserta argumennya, dengan penomoran parameter
// berurutan dari 1. `updated_at` selalu ikut diperbarui: kolomnya tidak punya
// trigger, dan pemanggil berhak menganggap "tersimpan" berarti waktunya berubah.
func susunSet(sets []SetClause) (string, []any, error) {
	bagian := make([]string, 0, len(sets)+1)
	args := make([]any, 0, len(sets)+2)

	for _, s := range sets {
		if !kolomBolehDiubah[s.Kolom] {
			// Tidak bisa terjadi lewat handler; penjaga untuk pemanggil db berikutnya.
			return "", nil, fmt.Errorf("kolom inventory tidak boleh diubah: %s", s.Kolom)
		}
		args = append(args, s.Arg)
		bagian = append(bagian, fmt.Sprintf(`"%s" = $%d%s`, s.Kolom, len(args), castKolom[s.Kolom]))
	}
	bagian = append(bagian, "updated_at = now()")

	return strings.Join(bagian, ", "), args, nil
}

// pastikanKomponenBolehDiubah menolak perubahan isi paket kalau paket itu
// dipakai transaksi berstatus Booking atau Disewa.
//
// Isi yang sama persis tetap boleh disimpan ulang: frontend mengirim seluruh
// baris saat menyimpan, jadi tanpa pengecualian ini setiap penyimpanan paket
// yang sedang dipakai akan ditolak.
func pastikanKomponenBolehDiubah(ctx context.Context, q Querier, tenantID string, id int64, komponenBaru json.RawMessage) error {
	var sekarang json.RawMessage
	err := q.QueryRow(ctx, `SELECT komponen FROM inventory WHERE id = $1 AND user_id = $2::uuid`,
		id, tenantID).Scan(&sekarang)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}

	sama, err := komponenSama(sekarang, komponenBaru)
	if err != nil {
		return err
	}
	if sama {
		return nil
	}

	var dipakai bool
	if err := q.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1
			FROM transaction_items ti
			JOIN transactions t ON t.id = ti.transaction_id
			WHERE ti.inventory_id = $1 AND t.status IN ('Booking', 'Disewa')
		)`, id).Scan(&dipakai); err != nil {
		return err
	}
	if dipakai {
		return ErrPaketDipakai
	}
	return nil
}

// komponenSama melaporkan apakah dua isi `komponen` sama sebagai himpunan.
func komponenSama(a, b json.RawMessage) (bool, error) {
	kanonikA, err := komponenKanonik(a)
	if err != nil {
		return false, fmt.Errorf("membaca komponen tersimpan: %w", err)
	}
	kanonikB, err := komponenKanonik(b)
	if err != nil {
		return false, fmt.Errorf("membaca komponen baru: %w", err)
	}
	if len(kanonikA) != len(kanonikB) {
		return false, nil
	}
	for i := range kanonikA {
		if kanonikA[i] != kanonikB[i] {
			return false, nil
		}
	}
	return true, nil
}

// komponenKanonik mengubah isi `komponen` menjadi daftar string terurut, supaya
// dua daftar bisa dibandingkan tanpa peduli urutan penulisan.
//
// Hanya idBarang dan qty yang ikut, sama seperti backend Next: nama barang
// tersimpan di komponen tetapi bukan bagian dari definisi paket, sehingga
// mengganti nama barang tidak boleh dianggap mengubah isi paket.
func komponenKanonik(raw json.RawMessage) ([]string, error) {
	var isi []map[string]json.RawMessage
	if err := json.Unmarshal(raw, &isi); err != nil {
		return nil, err
	}

	hasil := make([]string, 0, len(isi))
	for _, c := range isi {
		hasil = append(hasil, teksJSON(c["idBarang"])+"|"+angkaJSON(c["qty"]))
	}
	sort.Strings(hasil)
	return hasil, nil
}

// teksJSON meniru `String(x ?? ”)` di JS: string dibaca tanpa kutipnya, angka
// dan boolean dikembalikan apa adanya, null atau kosong menjadi "".
func teksJSON(raw json.RawMessage) string {
	isi := strings.TrimSpace(string(raw))
	if isi == "" || isi == "null" {
		return ""
	}
	if strings.HasPrefix(isi, `"`) {
		var s string
		if err := json.Unmarshal(raw, &s); err == nil {
			return s
		}
		return ""
	}
	return isi
}

// angkaJSON menormalkan qty supaya `2`, `2.0`, dan `"2"` (string) menghasilkan
// teks yang sama, meniru `Number(x) || 0` di JS.
func angkaJSON(raw json.RawMessage) string {
	isi := strings.TrimSpace(string(raw))
	if isi == "" || isi == "null" {
		return "0"
	}
	isi = strings.Trim(isi, `"`)
	v, err := strconv.ParseFloat(isi, 64)
	if err != nil {
		return "0"
	}
	return strconv.FormatFloat(v, 'f', -1, 64)
}
