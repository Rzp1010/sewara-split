package db

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// errUnitTidakCukup ditangkap handler menjadi HTTP 409.
var ErrUnitTidakCukup = errors.New("unit bebas tidak cukup")

type bebanItem struct {
	idBarang int64
	qty      int
}

type transaksiBeban struct {
	id      int64
	status  string
	mulai   *time.Time
	selesai *time.Time
	items   []TransactionItem
}

type komponenDef struct {
	ID   int64  `json:"idBarang"`
	Qty  int    `json:"qty"`
	Nama string `json:"nama"`
}

// komponenDari mengambil definisi komponen paket. Sumber utama: definisi di
// inventory (dipakai juga untuk transaksi tanpa S/N terpasang). Cadangan: isi
// assigned_components (bentuk lama yang ikut menyimpan idBarang/qty).
func komponenDari(item TransactionItem, defs map[int64][]komponenDef) []komponenDef {
	if item.InventoryID != nil {
		if k, ada := defs[*item.InventoryID]; ada && len(k) > 0 {
			return k
		}
	}
	var mentah []komponenDef
	_ = json.Unmarshal(item.AssignedComponents, &mentah)
	var hasil []komponenDef
	for _, k := range mentah {
		if k.ID != 0 {
			hasil = append(hasil, k)
		}
	}
	return hasil
}

// hitungBebanItem mengembalikan beban inventory per item transaksi.
func hitungBebanItem(item TransactionItem, defs map[int64][]komponenDef) []bebanItem {
	qtySN := func(s *string) int {
		if s == nil {
			return 0
		}
		n := 0
		for _, sn := range strings.Split(*s, ", ") {
			if strings.TrimSpace(sn) != "" {
				n++
			}
		}
		return n
	}
	jenis := "satuan"
	if item.ItemType != nil {
		jenis = *item.ItemType
	}
	if jenis == "satuan" && item.InventoryID != nil {
		qty := qtySN(item.SerialNumber)
		if qty == 0 {
			qty = item.Qty
		}
		return []bebanItem{{idBarang: *item.InventoryID, qty: qty}}
	}
	if jenis != "bundling" {
		return nil
	}
	var assigned []struct {
		ID int64    `json:"idKomp"`
		SN []string `json:"sns"`
	}
	_ = json.Unmarshal(item.AssignedComponents, &assigned)
	var hasil []bebanItem
	for _, k := range komponenDari(item, defs) {
		qty := item.Qty * k.Qty
		for _, a := range assigned {
			if a.ID == k.ID && len(a.SN) > 0 {
				qty = len(a.SN)
				break
			}
		}
		hasil = append(hasil, bebanItem{idBarang: k.ID, qty: qty})
	}
	return hasil
}

func serialItemUntukBarang(item TransactionItem, idBarang int64) []string {
	jenis := "satuan"
	if item.ItemType != nil {
		jenis = *item.ItemType
	}
	var sns []string
	if jenis == "satuan" && item.InventoryID != nil && *item.InventoryID == idBarang && item.SerialNumber != nil {
		for _, sn := range strings.Split(*item.SerialNumber, ", ") {
			if sn = strings.TrimSpace(sn); sn != "" {
				sns = append(sns, sn)
			}
		}
	} else if jenis == "bundling" {
		var assigned []struct {
			ID int64    `json:"idKomp"`
			SN []string `json:"sns"`
		}
		_ = json.Unmarshal(item.AssignedComponents, &assigned)
		for _, a := range assigned {
			if a.ID == idBarang {
				sns = append(sns, a.SN...)
			}
		}
	}
	return sns
}

// unitBebas menghitung sisa unit pada rentang waktu.
//
// `unitInv` = isi `inventory.sns`, yaitu daftar unit BEBAS (booking yang
// disimpan mencabut S/N-nya dari daftar itu). Karena itu kepemilikan
// direkonstruksi: S/N inventaris ∪ S/N yang masih dirujuk transaksi aktif.
func unitBebas(unitInv []string, transaksi []transaksiBeban, idBarang, kecualiId int64, mulai, selesai time.Time, defs map[int64][]komponenDef) int {
	owned := make(map[string]struct{})
	for _, sn := range unitInv {
		if sn = strings.TrimSpace(sn); sn != "" {
			owned[sn] = struct{}{}
		}
	}
	for _, t := range transaksi {
		if t.status != "Booking" && t.status != "Disewa" {
			continue
		}
		for _, it := range t.items {
			for _, sn := range serialItemUntukBarang(it, idBarang) {
				if sn = strings.TrimSpace(sn); sn != "" {
					owned[sn] = struct{}{}
				}
			}
		}
	}
	beban := 0
	for _, t := range transaksi {
		if t.id == kecualiId || (t.status != "Booking" && t.status != "Disewa") {
			continue
		}
		if t.mulai != nil && !t.mulai.Before(selesai) {
			continue
		}
		if t.selesai != nil && !mulai.Before(*t.selesai) {
			continue
		}
		for _, it := range t.items {
			for _, b := range hitungBebanItem(it, defs) {
				if b.idBarang == idBarang {
					beban += b.qty
				}
			}
		}
	}
	return len(owned) - beban
}

func cekKetersediaanTransaksi(ctx context.Context, tx pgx.Tx, tenantID string, input TransactionInput, items []TransactionItemInput) error {
	// Update parent memakai kolom yang lama bila waktu/status tak dikirim.
	var mulaiLama, selesaiLama *time.Time
	var statusLama string
	if err := tx.QueryRow(ctx, `SELECT waktu_ambil_rencana, waktu_kembali_rencana, status::text FROM transactions WHERE id=$1 AND user_id=$2 FOR UPDATE`, input.ID, tenantID).Scan(&mulaiLama, &selesaiLama, &statusLama); err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return fmt.Errorf("baca waktu transaksi: %w", err)
	}
	mulai, selesai := mulaiLama, selesaiLama
	if input.WaktuAmbilRencana != nil {
		mulai = input.WaktuAmbilRencana
	}
	if input.WaktuKembaliRencana != nil {
		selesai = input.WaktuKembaliRencana
	}
	status := input.Status
	if status == "" {
		status = statusLama
	}
	if status == "" {
		status = "Booking"
	}
	if (status != "Booking" && status != "Disewa") || mulai == nil || selesai == nil || len(items) == 0 {
		return nil
	}

	bebanDiminta := map[int64]int{}
	namaBarang := map[int64]string{}
	for _, in := range items {
		if in.InventoryID == nil {
			continue
		}
		tipe := "satuan"
		if in.ItemType != nil {
			tipe = *in.ItemType
		}
		if tipe == "satuan" {
			b := hitungBebanItem(TransactionItem{InventoryID: in.InventoryID, ItemType: in.ItemType, Qty: in.Qty, SerialNumber: in.SerialNumber}, nil)
			for _, x := range b {
				bebanDiminta[x.idBarang] += x.qty
				namaBarang[x.idBarang] = in.ItemName
			}
		} else if tipe == "bundling" {
			var raw json.RawMessage
			if err := tx.QueryRow(ctx, "SELECT komponen FROM inventory WHERE id=$1 AND user_id=$2", *in.InventoryID, tenantID).Scan(&raw); err != nil {
				return fmt.Errorf("baca komponen paket: %w", err)
			}
			var komponen []struct {
				ID   int64  `json:"idBarang"`
				Qty  int    `json:"qty"`
				Nama string `json:"nama"`
			}
			if err := json.Unmarshal(raw, &komponen); err != nil {
				return fmt.Errorf("baca komponen paket: %w", err)
			}
			var assigned []struct {
				ID int64    `json:"idKomp"`
				SN []string `json:"sns"`
			}
			_ = json.Unmarshal(in.AssignedComponents, &assigned)
			for _, k := range komponen {
				qty := in.Qty * k.Qty
				for _, a := range assigned {
					if a.ID == k.ID && len(a.SN) > 0 {
						qty = len(a.SN)
						break
					}
				}
				bebanDiminta[k.ID] += qty
				namaBarang[k.ID] = k.Nama
			}
		}
	}
	if len(bebanDiminta) == 0 {
		return nil
	}
	// Kunci inventaris tenant secara konsisten untuk serialisasi booking bersamaan.
	ids := make([]int64, 0, len(bebanDiminta))
	for id := range bebanDiminta {
		ids = append(ids, id)
	}
	rows, err := tx.Query(ctx, `SELECT id, nama, sns FROM inventory WHERE id=ANY($1::bigint[]) AND user_id=$2 ORDER BY id FOR UPDATE`, ids, tenantID)
	if err != nil {
		return fmt.Errorf("kunci unit inventory: %w", err)
	}
	ownedSN, names := map[int64]map[string]struct{}{}, map[int64]string{}
	for rows.Next() {
		var id int64
		var nama string
		var sns json.RawMessage
		if err := rows.Scan(&id, &nama, &sns); err != nil {
			rows.Close()
			return err
		}
		var daftar []string
		_ = json.Unmarshal(sns, &daftar)
		ownedSN[id] = make(map[string]struct{}, len(daftar))
		for _, sn := range daftar {
			if sn = strings.TrimSpace(sn); sn != "" {
				ownedSN[id][sn] = struct{}{}
			}
		}
		names[id] = nama
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	rows.Close()
	var txs []transaksiBeban
	tr, err := tx.Query(ctx, `SELECT id,status::text,waktu_ambil_rencana,waktu_kembali_rencana FROM transactions WHERE user_id=$1 AND status IN ('Booking','Disewa') AND id<>$2`, tenantID, input.ID)
	if err != nil {
		return fmt.Errorf("baca transaksi bertumpuk: %w", err)
	}
	var idsTx []int64
	for tr.Next() {
		var t transaksiBeban
		if err := tr.Scan(&t.id, &t.status, &t.mulai, &t.selesai); err != nil {
			tr.Close()
			return err
		}
		txs = append(txs, t)
		idsTx = append(idsTx, t.id)
	}
	if err := tr.Err(); err != nil {
		tr.Close()
		return err
	}
	tr.Close()
	if len(idsTx) > 0 {
		r, err := tx.Query(ctx, `SELECT transaction_id,inventory_id,item_name,item_type::text,qty,serial_number,assigned_components FROM transaction_items WHERE user_id=$1 AND transaction_id=ANY($2::bigint[])`, tenantID, idsTx)
		if err != nil {
			return fmt.Errorf("baca item transaksi: %w", err)
		}
		byID := make(map[int64]int, len(txs))
		for i := range txs {
			byID[txs[i].id] = i
		}
		for r.Next() {
			var tid int64
			var it TransactionItem
			if err := r.Scan(&tid, &it.InventoryID, &it.ItemName, &it.ItemType, &it.Qty, &it.SerialNumber, &it.AssignedComponents); err != nil {
				r.Close()
				return err
			}
			txs[byID[tid]].items = append(txs[byID[tid]].items, it)
			// Untuk satuan, inventory_id langsung memberi barang. Untuk bundling,
			// assigned_components merujuk barang komponen secara langsung.
			if it.InventoryID != nil && it.ItemType != nil && *it.ItemType == "satuan" {
				id := *it.InventoryID
				if ownedSN[id] == nil {
					ownedSN[id] = map[string]struct{}{}
				}
				for _, sn := range serialItemUntukBarang(it, id) {
					if sn = strings.TrimSpace(sn); sn != "" {
						ownedSN[id][sn] = struct{}{}
					}
				}
			}
			if it.ItemType != nil && *it.ItemType == "bundling" {
				var assigned []struct {
					ID int64    `json:"idKomp"`
					SN []string `json:"sns"`
				}
				_ = json.Unmarshal(it.AssignedComponents, &assigned)
				for _, a := range assigned {
					if ownedSN[a.ID] == nil {
						ownedSN[a.ID] = map[string]struct{}{}
					}
					for _, sn := range a.SN {
						if sn = strings.TrimSpace(sn); sn != "" {
							ownedSN[a.ID][sn] = struct{}{}
						}
					}
				}
			}
		}
		if err := r.Err(); err != nil {
			r.Close()
			return err
		}
		r.Close()
	}
	// Definisi komponen paket pada transaksi lama diperlukan untuk menghitung
	// beban transaksi yang belum memilih S/N (assigned_components kosong).
	var idPaketLama []int64
	for _, t := range txs {
		for _, it := range t.items {
			if it.InventoryID == nil {
				continue
			}
			if it.ItemType != nil && *it.ItemType == "bundling" {
				idPaketLama = append(idPaketLama, *it.InventoryID)
			}
		}
	}
	defs := map[int64][]komponenDef{}
	if len(idPaketLama) > 0 {
		dr, err := tx.Query(ctx, `SELECT id, komponen FROM inventory WHERE user_id=$1 AND id=ANY($2::bigint[])`, tenantID, idPaketLama)
		if err != nil {
			return fmt.Errorf("baca komponen paket lama: %w", err)
		}
		for dr.Next() {
			var id int64
			var raw json.RawMessage
			if err := dr.Scan(&id, &raw); err != nil {
				dr.Close()
				return err
			}
			var komponen []komponenDef
			if err := json.Unmarshal(raw, &komponen); err == nil {
				defs[id] = komponen
			}
		}
		if err := dr.Err(); err != nil {
			dr.Close()
			return err
		}
		dr.Close()
	}
	for id, qty := range bebanDiminta {
		unitSN := make([]string, 0, len(ownedSN[id]))
		for sn := range ownedSN[id] {
			unitSN = append(unitSN, sn)
		}
		free := unitBebas(unitSN, txs, id, input.ID, *mulai, *selesai, defs)
		if qty > free {
			name := names[id]
			if name == "" {
				name = namaBarang[id]
			}
			return fmt.Errorf("%w: Unit bebas tidak cukup untuk %s (sisa %d).", ErrUnitTidakCukup, name, free)
		}
	}
	return nil
}
