package db

import "testing"

func TestNormalisasiHP(t *testing.T) {
	cases := []struct{ input, want string }{
		{"0812-3456-789", "8123456789"},
		{"+62 812 3456 789", "8123456789"},
		{"628123456789", "8123456789"},
		{"8123456789", "8123456789"},
		{"021-5551234", "215551234"},
		{"62215551234", "215551234"},
		{"08123456789", "8123456789"},
		{"", ""},
		{"123", "123"},
	}
	for _, tc := range cases {
		t.Run(tc.input, func(t *testing.T) {
			if got := NormalisasiHP(tc.input); got != tc.want {
				t.Fatalf("NormalisasiHP(%q) = %q, want %q", tc.input, got, tc.want)
			}
		})
	}
}
