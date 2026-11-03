package db

import (
	"encoding/json"
	"testing"
)

func TestJsonbApaSaja(t *testing.T) {
	for _, tt := range []struct{ name, raw, want string }{
		{name: "objek printilan", raw: `{"mode":"dicentang","terpilih":["Tri pod"]}`, want: `{"mode":"dicentang","terpilih":["Tri pod"]}`},
		{name: "array lama", raw: `["Tri pod"]`, want: `["Tri pod"]`},
		{name: "kosong", raw: ``, want: `[]`},
	} {
		t.Run(tt.name, func(t *testing.T) {
			if got := string(jsonbApaSaja(json.RawMessage(tt.raw), "[]")); got != tt.want {
				t.Fatalf("jsonbApaSaja() = %s, want %s", got, tt.want)
			}
		})
	}
}