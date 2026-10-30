package httpapi

import (
	"strings"
	"testing"
)

func TestFormatRupiah(t *testing.T) {
	for _, tc := range []struct {
		in   any
		want string
	}{
		{nil, "Rp0"},
		{float64(0), "Rp0"},
		{float64(10000), "Rp10.000"},
		{float64(1000000), "Rp1.000.000"},
		{float64(-2500), "Rp-2.500"},
		{"bukan-angka", "Rp0"},
	} {
		if got := formatRupiah(tc.in); got != tc.want {
			t.Errorf("formatRupiah(%v)=%q want %q", tc.in, got, tc.want)
		}
	}
}

func TestFormatPesanTransaksi(t *testing.T) {
	record := map[string]any{
		"no_invoice":   "INV-1",
		"nama_penyewa": "Budi",
		"status":       "Booking",
		"total_akhir":  float64(10000),
		"created_at":   "2026-01-10T08:00:00Z",
	}
	want := "🆕 *TRANSAKSI — INSERT*\n" +
		strings.Repeat("—", 28) + "\n" +
		"Invoice  : INV-1\n" +
		"Penyewa  : Budi\n" +
		"Status   : Booking\n" +
		"Total    : Rp10.000\n" +
		"Waktu    : 10/01/26, 08.00\n" +
		"\n<b>JSON:</b>\n<code>" +
		`{"created_at":"2026-01-10T08:00:00Z","nama_penyewa":"Budi","no_invoice":"INV-1","status":"Booking","total_akhir":10000}` +
		"</code>"
	if got := formatPesanTransaksi("INSERT", record); got != want {
		t.Errorf("formatPesanTransaksi mismatch:\ngot : %q\nwant: %q", got, want)
	}
}

func TestFormatPesanTransaksiFallbackField(t *testing.T) {
	// total_akhir null → jatuh ke total ?? biaya; field kosong → "-".
	record := map[string]any{
		"id":         float64(7),
		"total":      float64(5000),
		"created_at": "2026-01-10T08:00:00Z",
	}
	got := formatPesanTransaksi("DELETE", record)
	if !strings.Contains(got, "🗑️ *TRANSAKSI — DELETE*") {
		t.Errorf("emoji/label DELETE salah: %q", got)
	}
	if !strings.Contains(got, "Invoice  : -\n") || !strings.Contains(got, "Total    : Rp5.000\n") {
		t.Errorf("fallback field salah: %q", got)
	}
}

func TestFormatPesanRegistrasi(t *testing.T) {
	record := map[string]any{
		"nama_lengkap": "Siti",
		"email":        "siti@example.com",
		"role":         "owner",
		"status":       "menunggu",
		"created_at":   "2026-01-10T08:00:00Z",
	}
	want := "🆕 *PENDAFTAR BARU — INSERT*\n" +
		strings.Repeat("—", 28) + "\n" +
		"Nama     : Siti\n" +
		"Email    : siti@example.com\n" +
		"Role     : owner\n" +
		"Status   : menunggu\n" +
		"Waktu    : 10/01/26, 08.00\n" +
		"\n<b>JSON:</b>\n<code>" +
		`{"created_at":"2026-01-10T08:00:00Z","email":"siti@example.com","nama_lengkap":"Siti","role":"owner","status":"menunggu"}` +
		"</code>"
	if got := formatPesanRegistrasi("INSERT", record); got != want {
		t.Errorf("formatPesanRegistrasi mismatch:\ngot : %q\nwant: %q", got, want)
	}
}

func TestParseTelegramWebhook(t *testing.T) {
	for _, tc := range []struct {
		nama string
		body string
		ok   bool
	}{
		{"valid", `{"table":"transactions","type":"INSERT","record":{"id":1}}`, true},
		{"tanpa record", `{"table":"transactions","type":"DELETE"}`, true},
		{"record null", `{"table":"x","type":"UPDATE","record":null}`, true},
		{"table kosong", `{"table":"","type":"INSERT"}`, false},
		{"tanpa table", `{"type":"INSERT"}`, false},
		{"type tak dikenal", `{"table":"transactions","type":"BOGUS"}`, false},
		{"tanpa type", `{"table":"transactions"}`, false},
		{"record bukan objek", `{"table":"transactions","type":"INSERT","record":"x"}`, false},
		{"old_record bukan objek", `{"table":"transactions","type":"INSERT","old_record":3}`, false},
		{"body bukan json", `bukan-json`, false},
	} {
		t.Run(tc.nama, func(t *testing.T) {
			got, ok := parseTelegramWebhook(strings.NewReader(tc.body))
			if ok != tc.ok {
				t.Fatalf("ok=%v want %v (body=%s)", ok, tc.ok, tc.body)
			}
			if ok && got.Table == "" {
				t.Fatalf("table kosong pada hasil valid")
			}
		})
	}
}

func TestTransaksiDeleteTanpaRecord(t *testing.T) {
	if !transaksiDeleteTanpaRecord("DELETE", map[string]any{}) {
		t.Error("DELETE tanpa record harus di-skip")
	}
	if transaksiDeleteTanpaRecord("DELETE", map[string]any{"id": 1}) {
		t.Error("DELETE dengan id tidak boleh di-skip")
	}
	if transaksiDeleteTanpaRecord("DELETE", map[string]any{"no_invoice": "INV-1"}) {
		t.Error("DELETE dengan no_invoice tidak boleh di-skip")
	}
	if transaksiDeleteTanpaRecord("INSERT", map[string]any{}) {
		t.Error("INSERT tidak boleh di-skip")
	}
}
