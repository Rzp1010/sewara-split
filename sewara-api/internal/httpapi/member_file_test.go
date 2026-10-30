package httpapi

import "testing"

func TestValidasiIndexDokumen(t *testing.T) {
	for _, tc := range []struct {
		in     string
		wantN  int
		wantOK bool
	}{
		{"0", 0, true},
		{"4", 4, true},
		{" 2 ", 2, true},
		{"5", 0, false},
		{"-1", 0, false},
		{"abc", 0, false},
		{"", 0, false},
		{"2.5", 0, false},
	} {
		n, ok := validasiIndexDokumen(tc.in)
		if ok != tc.wantOK || (ok && n != tc.wantN) {
			t.Fatalf("validasiIndexDokumen(%q) = %d,%v; mau %d,%v", tc.in, n, ok, tc.wantN, tc.wantOK)
		}
	}
}

func TestKeyDokumenMember(t *testing.T) {
	for _, tc := range []struct{ tenant, member, ext, want string }{
		{"a0000000-0000-0000-0000-000000000001", "17", "png", "a0000000-0000-0000-0000-000000000001/17/doc-0.png"},
		{"t", "3", "pdf", "t/3/doc-4.pdf"},
	} {
		index := 0
		if tc.ext == "pdf" {
			index = 4
		}
		if got := keyDokumenMember(tc.tenant, tc.member, index, tc.ext); got != tc.want {
			t.Fatalf("keyDokumenMember = %q; mau %q", got, tc.want)
		}
	}
}

func TestEkstensiDariMimeMember(t *testing.T) {
	for _, tc := range []struct {
		mime string
		ext  string
		ok   bool
	}{
		{"image/jpeg", "jpg", true},
		{"image/png", "png", true},
		{"application/pdf", "pdf", true},
		{"image/gif", "", false},
		{"image/webp", "", false},
	} {
		ext, ok := ekstensiDariMime(tc.mime)
		if ext != tc.ext || ok != tc.ok {
			t.Fatalf("ekstensiDariMime(%q) = %q,%v; mau %q,%v", tc.mime, ext, ok, tc.ext, tc.ok)
		}
	}
}

func TestMimeDariEkstensiMember(t *testing.T) {
	for _, tc := range []struct{ ext, want string }{
		{"png", "image/png"},
		{"webp", "image/webp"},
		{"pdf", "application/pdf"},
		{"jpg", "image/jpeg"},
		{"jpeg", "image/jpeg"},
		{"bin", "application/octet-stream"},
	} {
		if got := mimeDariEkstensi(tc.ext); got != tc.want {
			t.Fatalf("mimeDariEkstensi(%q) = %q; mau %q", tc.ext, got, tc.want)
		}
	}
}

func TestLabelJaminanMember(t *testing.T) {
	for _, label := range []string{"KTP", "SIM", "NPWP", "Kartu Keluarga", "Lainnya"} {
		if !labelJaminanValid(label) {
			t.Fatalf("label %q seharusnya valid", label)
		}
	}
	for _, label := range []string{"", "ktp", "Foto"} {
		if labelJaminanValid(label) {
			t.Fatalf("label %q seharusnya ditolak", label)
		}
	}
}
