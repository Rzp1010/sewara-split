package db

import (
	"testing"
	"time"
)

func ptrTime(t time.Time) *time.Time { return &t }

func ptrSN(s string) *string { return &s }

func TestKetersediaan(t *testing.T) {
	invID := int64(8)
	mulai := time.Date(2026, 11, 3, 10, 0, 0, 0, time.UTC)
	selesai := mulai.Add(2 * time.Hour)
	fmtItem := func(qty int) TransactionItem {
		tipe := "satuan"
		return TransactionItem{InventoryID: &invID, ItemType: &tipe, Qty: qty}
	}
	fmtItemSN := func(sn string) TransactionItem {
		it := fmtItem(1)
		it.SerialNumber = ptrSN(sn)
		return it
	}
	paketID := int64(30)
	kompID := int64(31)
	fmtPaket := func(qtyPaket int) TransactionItem {
		tipe := "bundling"
		return TransactionItem{InventoryID: &paketID, ItemType: &tipe, Qty: qtyPaket}
	}
	defs := map[int64][]komponenDef{paketID: {{ID: kompID, Qty: 2, Nama: "Komponen"}}}
	tigaUnit := []string{"K1", "K2", "K3"}
	tests := []struct {
		name        string
		unitInv     []string
		transaksi   []transaksiBeban
		idBarang    int64
		defs        map[int64][]komponenDef
		kecuali     int64
		wantFree    int
		wantAllowed bool
	}{
		{"stok 3, booking pesan 1", tigaUnit, []transaksiBeban{{id: 1, status: "Booking", mulai: ptrTime(mulai), selesai: ptrTime(selesai), items: []TransactionItem{fmtItem(1)}}}, invID, nil, 0, 2, true},
		{"stok 3, booking pesan 3", tigaUnit, []transaksiBeban{{id: 1, status: "Booking", mulai: ptrTime(mulai), selesai: ptrTime(selesai), items: []TransactionItem{fmtItem(3)}}}, invID, nil, 0, 0, false},
		{"periode tidak bertumpuk", tigaUnit, []transaksiBeban{{id: 1, status: "Disewa", mulai: ptrTime(selesai), selesai: ptrTime(selesai.Add(time.Hour)), items: []TransactionItem{fmtItem(3)}}}, invID, nil, 0, 3, true},
		{"update abaikan dirinya", tigaUnit, []transaksiBeban{{id: 9, status: "Booking", mulai: ptrTime(mulai), selesai: ptrTime(selesai), items: []TransactionItem{fmtItem(3)}}}, invID, nil, 9, 3, true},
		{"S/N yang sudah dicabut dari sns tetap dihitung", []string{"K2", "K3"}, []transaksiBeban{{id: 1, status: "Booking", mulai: ptrTime(mulai), selesai: ptrTime(selesai), items: []TransactionItem{fmtItemSN("K1")}}}, invID, nil, 0, 2, true},
		{"paket tanpa S/N ikut mengurangi komponen", []string{"C1", "C2", "C3"}, []transaksiBeban{{id: 1, status: "Booking", mulai: ptrTime(mulai), selesai: ptrTime(selesai), items: []TransactionItem{fmtPaket(1)}}}, kompID, defs, 0, 1, true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			bebas := unitBebas(tt.unitInv, tt.transaksi, tt.idBarang, tt.kecuali, mulai, selesai, tt.defs)
			if bebas != tt.wantFree {
				t.Fatalf("unitBebas()=%d, want %d", bebas, tt.wantFree)
			}
			if (1 <= bebas) != tt.wantAllowed {
				t.Fatalf("boleh=%v, want %v", 1 <= bebas, tt.wantAllowed)
			}
		})
	}
}
