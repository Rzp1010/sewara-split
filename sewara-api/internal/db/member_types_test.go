package db

import (
	"errors"
	"strings"
	"testing"
)

// Kunci JSON tidak boleh disambung ke SQL: apa pun yang bukan kolom member_types
// harus ditolak sebelum query dibentuk.
func TestSusunSetMemberTypeTolakKolomAsing(t *testing.T) {
	kasus := []string{
		"nama = (SELECT count(*)::text FROM profiles)",
		"nama = $2 WHERE true --",
		"user_id",
		"password",
	}
	for _, k := range kasus {
		_, _, err := susunSetMemberType("1", map[string]any{k: 1})
		var asing ErrKolomMemberTypeAsing
		if !errors.As(err, &asing) {
			t.Fatalf("kunci %q seharusnya ditolak, err=%v", k, err)
		}
		if asing.Kolom != k {
			t.Fatalf("kolom dilaporkan %q, mau %q", asing.Kolom, k)
		}
	}
}

func TestSusunSetMemberTypeKolomSah(t *testing.T) {
	set, args, err := susunSetMemberType("7", map[string]any{"nama": "VIP", "diskon_persen": 10})
	if err != nil {
		t.Fatalf("kolom sah ditolak: %v", err)
	}
	if len(args) != 3 || args[0] != "7" {
		t.Fatalf("args tidak sesuai: %v", args)
	}
	for _, potongan := range []string{"nama = $", "diskon_persen = $"} {
		if !strings.Contains(set, potongan) {
			t.Fatalf("klausa SET %q tidak memuat %q", set, potongan)
		}
	}
}
