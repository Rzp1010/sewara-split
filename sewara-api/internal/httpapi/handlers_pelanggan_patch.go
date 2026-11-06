package httpapi

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/Rzp1010/sewara-split/sewara-api/internal/db"
)

func (s *Server) handlePelangganPatch(w http.ResponseWriter, r *http.Request, me db.Identity) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id <= 0 {
		writeError(w, 404, CodeNotFound, "Pelanggan tidak ditemukan.")
		return
	}
	var raw map[string]json.RawMessage
	if err = json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&raw); err != nil {
		writeValidationError(w, "Body tidak valid.", nil)
		return
	}
	old, err := s.db.GetPelanggan(r.Context(), me.UserID, id)
	if errors.Is(err, db.ErrNotFound) {
		writeError(w, 404, CodeNotFound, "Pelanggan tidak ditemukan.")
		return
	}
	if err != nil {
		s.log.Error("gagal membaca pelanggan", "err", err)
		writeError(w, 500, CodeInternalError, "Terjadi kesalahan server. Coba lagi.")
		return
	}
	nama, email, hp, alamat, catatan := old.Nama, old.Email, old.HP, old.Alamat, old.Catatan
	if v, ok := raw["nama"]; ok {
		if json.Unmarshal(v, &nama) != nil || strings.TrimSpace(nama) == "" {
			writeValidationError(w, "Nama pelanggan wajib diisi.", nil)
			return
		}
		nama = strings.TrimSpace(nama)
	}
	if v, ok := raw["email"]; ok {
		if json.Unmarshal(v, &email) != nil {
			writeValidationError(w, "Email tidak valid.", nil)
			return
		}
		email = strings.TrimSpace(email)
		if len(email) > 254 || (email != "" && !strings.Contains(email, "@")) {
			writeValidationError(w, "Email tidak valid (maksimum 254 karakter dan harus mengandung @).", nil)
			return
		}
	}
	if v, ok := raw["hp"]; ok {
		if json.Unmarshal(v, &hp) != nil {
			writeValidationError(w, "hp tidak valid.", nil)
			return
		}
		hp = strings.TrimSpace(hp)
	}
	if v, ok := raw["alamat"]; ok {
		if json.Unmarshal(v, &alamat) != nil {
			writeValidationError(w, "alamat tidak valid.", nil)
			return
		}
	}
	if v, ok := raw["catatan"]; ok {
		if json.Unmarshal(v, &catatan) != nil {
			writeValidationError(w, "catatan tidak valid.", nil)
			return
		}
	}
	foto := old.Foto
	var bekas []db.FotoPelanggan
	var tenant string
	if v, ok := raw["foto"]; ok {
		var f []db.FotoPelanggan
		if json.Unmarshal(v, &f) != nil || f == nil || len(f) > 5 {
			writeValidationError(w, "Foto pelanggan tidak valid.", nil)
			return
		}
		var e error
		tenant, e = s.db.TenantID(r.Context(), me.UserID)
		if e != nil {
			writeError(w, 500, CodeInternalError, "Terjadi kesalahan server. Coba lagi.")
			return
		}
		var items []map[string]json.RawMessage
		if json.Unmarshal(v, &items) != nil || len(items) != len(f) {
			writeValidationError(w, "Foto pelanggan tidak valid.", nil)
			return
		}
		for i, item := range items {
			var label, path string
			if len(item) != 2 || json.Unmarshal(item["label"], &label) != nil || json.Unmarshal(item["path"], &path) != nil || !labelJaminanValid(label) || !hasPrefixPelanggan(tenant, path) {
				writeValidationError(w, "Foto pelanggan tidak valid.", nil)
				return
			}
			f[i] = db.FotoPelanggan{Label: label, Path: path}
		}
		foto = f
		bekas = old.Foto
	}
	p, err := s.db.UpdatePelanggan(r.Context(), me.UserID, id, nama, email, hp, alamat, catatan, foto, raw["foto"] != nil)
	if errors.Is(err, db.ErrNotFound) {
		writeError(w, 404, CodeNotFound, "Pelanggan tidak ditemukan.")
		return
	}
	if err != nil {
		s.log.Error("gagal memperbarui pelanggan", "err", err)
		writeError(w, 500, CodeInternalError, "Terjadi kesalahan server. Coba lagi.")
		return
	}
	// Hapus objek R2 hanya setelah perubahan DB berhasil, supaya baris yang masih
	// menunjuk berkas tidak pernah kehilangan isinya.
	for _, prior := range bekas {
		masihDipakai := false
		for _, next := range p.Foto {
			if prior.Path == next.Path {
				masihDipakai = true
				break
			}
		}
		if !masihDipakai {
			s.hapusObjekPelanggan(r.Context(), tenant, prior.Path)
		}
	}
	writeSuccess(w, 200, map[string]any{"pelanggan": p})
}
