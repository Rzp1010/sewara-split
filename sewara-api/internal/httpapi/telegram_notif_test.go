package httpapi

import (
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
