package db

import (
	"context"
	"encoding/json"
	"fmt"
	"time"
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
