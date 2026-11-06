package db

import "testing"

func TestGabungPool(t *testing.T) {
	cases := []struct {
		name    string
		p, m, r []Pelanggan
		want    int
		src     string
		member  int64
		foto    string
	}{
		{"nama hp sama", []Pelanggan{{Nama: "A", HP: "0812-3456-789", Sumber: "pelanggan"}}, nil, []Pelanggan{{Nama: "A", HP: "68123456789", Sumber: "riwayat"}}, 1, "pelanggan", 0, "pelanggan"},
		{"nama hp beda", []Pelanggan{{Nama: "A", HP: "0812", Sumber: "pelanggan"}}, nil, []Pelanggan{{Nama: "A", HP: "0813", Sumber: "riwayat"}}, 2, "pelanggan", 0, "pelanggan"},
		{"nama hp kosong", []Pelanggan{{Nama: "test blacklisy", HP: "123", Sumber: "pelanggan"}}, nil, []Pelanggan{{Nama: " test blacklisy ", Sumber: "riwayat"}}, 1, "pelanggan", 0, "pelanggan"},
		{"member menempel", []Pelanggan{{ID: 1, Nama: "A", HP: "0812", Sumber: "pelanggan"}}, []Pelanggan{{Nama: "A", HP: "0812", MemberID: 9, Foto: []FotoPelanggan{{Path: "member"}}, Sumber: "member"}}, nil, 1, "pelanggan", 9, "member"},
		{"member mandiri", nil, []Pelanggan{{Nama: "B", MemberID: 10, Foto: []FotoPelanggan{{Path: "member"}}, Sumber: "member"}}, nil, 1, "member", 10, "member"},
		{"isi field kosong", []Pelanggan{{Nama: "A", Sumber: "pelanggan"}}, nil, []Pelanggan{{Nama: "A", HP: "0812", HPNormal: "6812", Alamat: "Jl", Catatan: "Cat", Sumber: "riwayat"}}, 1, "pelanggan", 0, "pelanggan"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := GabungPool(tc.p, tc.m, tc.r)
			if len(got) != tc.want || got[0].Sumber != tc.src || got[0].MemberID != tc.member || got[0].FotoDari != tc.foto {
				t.Fatalf("got %#v", got)
			}
			if tc.name == "isi field kosong" && (got[0].HP != "0812" || got[0].Alamat != "Jl" || got[0].Catatan != "Cat") {
				t.Fatalf("fields not merged: %#v", got[0])
			}
		})
	}
}
