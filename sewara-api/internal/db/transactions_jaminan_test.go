package db

import (
	"encoding/json"
	"testing"
)

func TestJaminanParam(t *testing.T) {
	for _, tt := range []struct {
		name    string
		raw     string
		present bool
		want    any
	}{
		{name: "array", raw: `["E-KTP"]`, present: true, want: `["E-KTP"]`},
		{name: "string lama", raw: `"E-KTP"`, present: true, want: `["E-KTP"]`},
		{name: "string berisi array", raw: `"[]"`, present: true, want: `[]`},
		{name: "kosong", raw: `""`, present: true, want: `[]`},
		{name: "null", raw: `null`, present: true, want: nil},
		{name: "absen", present: false, want: nil},
	} {
		t.Run(tt.name, func(t *testing.T) {
			in := TransactionInput{JaminanSewa: json.RawMessage(tt.raw), Present: map[string]bool{"jaminan_sewa": tt.present}}
			if got := in.jaminanParam(); got != tt.want {
				t.Fatalf("jaminanParam() = %#v, want %#v", got, tt.want)
			}
		})
	}
}
