package httpapi

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/Rzp1010/sewara-split/sewara-api/internal/db"
)

func TestRecordTransaksi(t *testing.T) {
	inv := "INV-UJI-1"
	created := time.Date(2026, 11, 10, 9, 41, 0, 0, time.UTC)
	tx := &db.Transaction{
		ID:         77,
		NoInvoice:  &inv,
		Penyewa:    "Budi",
		Status:     "Disewa",
		TotalAkhir: 250000,
		CreatedAt:  created,
		UpdatedAt:  created,
	}

	rec := recordTransaksi(tx)
	if rec["no_invoice"] != "INV-UJI-1" {
		t.Fatalf("no_invoice=%v", rec["no_invoice"])
	}
	if rec["penyewa"] != "Budi" || rec["status"] != "Disewa" {
		t.Fatalf("record=%v", rec)
	}
	if rec["total_akhir"] != 250000.0 {
		t.Fatalf("total_akhir=%v", rec["total_akhir"])
	}
	ts, ok := rec["created_at"].(string)
	if !ok {
		t.Fatalf("created_at bukan string: %v", rec["created_at"])
	}
	if _, err := time.Parse(time.RFC3339, ts); err != nil {
		t.Fatalf("created_at bukan RFC3339: %v", err)
	}

	// Record ini harus lolos ke formatter legacy tanpa panik dan memuat invoice.
	pesan := formatPesanTransaksi("INSERT", rec)
	for _, wajib := range []string{"TRANSAKSI — INSERT", "INV-UJI-1", "Disewa", "Budi"} {
		if !strings.Contains(pesan, wajib) {
			t.Fatalf("pesan tidak memuat %q:\n%s", wajib, pesan)
		}
	}

	// Nil pointer tidak boleh membuat record berisi nilai aneh.
	if got := recordTransaksi(nil); len(got) != 0 {
		t.Fatalf("recordTransaksi(nil)=%v", got)
	}
	kosong := recordTransaksi(&db.Transaction{})
	if kosong["no_invoice"] != "" {
		t.Fatalf("no_invoice nil seharusnya string kosong: %v", kosong["no_invoice"])
	}
}

func TestFormatPesanTransaksiRingkas(t *testing.T) {
	inv := "INV-UJI/9"
	rec := recordTransaksi(&db.Transaction{
		ID: 9, NoInvoice: &inv, Penyewa: "Budi", Status: "Disewa", TotalAkhir: 10000,
		CreatedAt: time.Date(2026, 11, 10, 9, 41, 0, 0, time.UTC),
	})

	pesan := formatPesanTransaksiRingkas("INSERT", rec)
	for _, wajib := range []string{"TRANSAKSI — INSERT", "INV-UJI/9", "Disewa", "Budi", "POST /api/transactions"} {
		if !strings.Contains(pesan, wajib) {
			t.Fatalf("pesan tidak memuat %q:\n%s", wajib, pesan)
		}
	}
	// Blok JSON tidak lagi di pesan: payload-nya ikut sebagai lampiran berkas.
	for _, terlarang := range []string{"<code>", "JSON:"} {
		if strings.Contains(pesan, terlarang) {
			t.Fatalf("pesan masih memuat %q:\n%s", terlarang, pesan)
		}
	}
	if len([]rune(pesan)) > telegramCaptionLimit {
		t.Fatalf("caption %d rune melewati batas %d", len([]rune(pesan)), telegramCaptionLimit)
	}
}

func TestBerkasTransaksiBisaDiputarUlang(t *testing.T) {
	inv := "INV UJI/1"
	tx := &db.Transaction{
		ID: 11, NoInvoice: &inv, Penyewa: "Siti", Status: "Booking", TotalAkhir: 50000,
		CreatedAt: time.Date(2026, 11, 10, 8, 0, 0, 0, time.UTC),
	}
	invID := int64(101)
	sn := "SN-1"
	items := []db.TransactionItemInput{{InventoryID: &invID, ItemName: "Kamera A", Qty: 1, UnitPrice: 50000, Subtotal: 50000, SerialNumber: &sn}}
	payments := []db.TransactionPaymentInput{{PaymentMethod: "Tunai", Amount: 50000, PaymentDate: time.Date(2026, 11, 10, 8, 0, 0, 0, time.UTC)}}

	isi := berkasTransaksi(tx, items, payments)
	var ulang struct {
		Transaction json.RawMessage `json:"transaction"`
		Items       []any           `json:"items"`
		Payments    []any           `json:"payments"`
	}
	if err := json.Unmarshal(isi, &ulang); err != nil {
		t.Fatalf("berkas bukan JSON valid: %v", err)
	}
	if len(ulang.Transaction) == 0 || len(ulang.Items) != 1 || len(ulang.Payments) != 1 {
		t.Fatalf("bentuk berkas tidak lengkap: %s", isi)
	}

	// Bentuk ini harus diterima langsung oleh POST /api/transactions, yaitu lewat
	// normalisasi yang sama dengan handler.
	normal := db.NormalizeTransactionItems(ulang.Items)
	if len(normal) != 1 || normal[0].ItemName != "Kamera A" || normal[0].Qty != 1 || normal[0].UnitPrice != 50000 {
		t.Fatalf("items tidak bisa diputar ulang: %+v", normal)
	}
	var txUlang db.Transaction
	if err := json.Unmarshal(ulang.Transaction, &txUlang); err != nil {
		t.Fatalf("transaction tidak bisa diputar ulang: %v", err)
	}
	if txUlang.ID != 11 || txUlang.Penyewa != "Siti" || txUlang.Status != "Booking" {
		t.Fatalf("transaction tidak utuh: %+v", txUlang)
	}

	// Nama berkas aman dipakai di multipart.
	nama := namaBerkasTransaksi(tx)
	if strings.ContainsAny(nama, " /\\") || !strings.HasSuffix(nama, "-11.json") {
		t.Fatalf("nama berkas tidak aman: %q", nama)
	}
	if kosong := namaBerkasTransaksi(&db.Transaction{ID: 3}); kosong != "transaksi-tanpa-invoice-3.json" {
		t.Fatalf("nama berkas tanpa invoice: %q", kosong)
	}
}

func TestRecordPendaftar(t *testing.T) {
	rec := recordPendaftar("Siti Aminah", "siti@contoh.id")
	if rec["nama_lengkap"] != "Siti Aminah" || rec["email"] != "siti@contoh.id" {
		t.Fatalf("record=%v", rec)
	}
	if rec["role"] != "owner" || rec["status"] != "menunggu" {
		t.Fatalf("role/status salah: %v", rec)
	}
	ts, ok := rec["created_at"].(string)
	if !ok {
		t.Fatalf("created_at bukan string: %v", rec["created_at"])
	}
	if _, err := time.Parse(time.RFC3339, ts); err != nil {
		t.Fatalf("created_at bukan RFC3339: %v", err)
	}

	pesan := formatPesanRegistrasi("INSERT", rec)
	for _, wajib := range []string{"PENDAFTAR BARU — INSERT", "Siti Aminah", "siti@contoh.id", "owner", "menunggu"} {
		if !strings.Contains(pesan, wajib) {
			t.Fatalf("pesan tidak memuat %q:\n%s", wajib, pesan)
		}
	}
}
