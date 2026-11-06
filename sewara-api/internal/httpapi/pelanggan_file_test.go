package httpapi

import "testing"

func TestKeyDokumenPelanggan(t *testing.T) {
	if got := keyDokumenPelanggan("tenant-a", "17", 2, "png"); got != "tenant-a/pelanggan/17/doc-2.png" {
		t.Fatalf("key = %q", got)
	}
}
func TestValidasiDokumenPelanggan(t *testing.T) {
	if !labelJaminanValid("KTP") || labelJaminanValid("Foto") {
		t.Fatal("validasi label keliru")
	}
	if n, ok := validasiIndexDokumen("4"); !ok || n != 4 {
		t.Fatal("index 4 harus valid")
	}
	if _, ok := validasiIndexDokumen("5"); ok {
		t.Fatal("index 5 harus ditolak")
	}
}
func TestGuardPrefixPhotoPelanggan(t *testing.T) {
	tenant, key := "tenant-a", "tenant-b/pelanggan/1/doc-0.jpg"
	if hasPrefixPelanggan(tenant, key) {
		t.Fatal("key tenant lain lolos")
	}
	if !hasPrefixPelanggan(tenant, "tenant-a/pelanggan/1/doc-0.jpg") {
		t.Fatal("key tenant sendiri ditolak")
	}
}
