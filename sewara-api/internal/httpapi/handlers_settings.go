package httpapi

import (
	"encoding/json"
	"io"
	"net/http"
	"time"

	"github.com/Rzp1010/sewara-split/sewara-api/internal/db"
)

// Key yang boleh ditulis staf (non-owner/superadmin). Key lain → 403.
var keyStaf = map[string]bool{
	"kalender_selesai": true,
	"bukti_backup_ack": true,
}

// Key privat yang disembunyikan dari staf pada GET. Owner/superadmin bebas.
var keyPrivat = map[string]bool{
	"telegram_login_notif":     true,
	"webhook_sheets":           true,
	"invoice_prefix":           true,
	"invoice_digit":            true,
	"invoice_mulai":            true,
	"invoice_counter":          true,
	"cari_sembunyikan_riwayat": true,
}

func isOwnerRole(role string) bool {
	return role == "owner" || role == "superadmin"
}

// handleSettingsGet mengembalikan semua setting atau satu setting by key.
// Staf tidak melihat KEY_PRIVAT (diberi null), owner/superadmin melihat semua.
func (s *Server) handleSettingsGet(w http.ResponseWriter, r *http.Request, me db.Identity) {
	key := r.URL.Query().Get("key")
	owner := isOwnerRole(me.Role)

	if key != "" {
		// GET /api/settings?key=xxx
		if !owner && keyPrivat[key] {
			// Staf minta key privat → return null, bukan 403 (pola Next).
			writeSuccess(w, http.StatusOK, map[string]any{"setting": nil})
			return
		}

		setting, err := s.db.GetSettingByKey(r.Context(), me.UserID, key)
		if err != nil {
			s.log.Error("gagal membaca setting by key", "err", err, "key", key)
			writeError(w, http.StatusInternalServerError, CodeInternalError, "Terjadi kesalahan server. Coba lagi.")
			return
		}
		writeSuccess(w, http.StatusOK, map[string]any{"setting": setting})
		return
	}

	// GET /api/settings (semua)
	settings, err := s.db.GetSettings(r.Context(), me.UserID)
	if err != nil {
		s.log.Error("gagal membaca settings", "err", err)
		writeError(w, http.StatusInternalServerError, CodeInternalError, "Terjadi kesalahan server. Coba lagi.")
		return
	}

	// Filter key privat untuk staf.
	if !owner {
		filtered := []db.Setting{}
		for _, st := range settings {
			if !keyPrivat[st.Key] {
				filtered = append(filtered, st)
			}
		}
		settings = filtered
	}

	writeSuccess(w, http.StatusOK, map[string]any{"settings": settings})
}

// handleSettingsPost upsert satu atau banyak setting.
// Body bisa single object atau array; staf hanya boleh tulis KEY_STAF.
func (s *Server) handleSettingsPost(w http.ResponseWriter, r *http.Request, me db.Identity) {
	owner := isOwnerRole(me.Role)

	var body json.RawMessage
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&body); err != nil {
		writeValidationError(w, "Body tidak valid.", nil)
		return
	}

	// Coba parse sebagai array dulu; kalau gagal, wrap sebagai array 1 elemen.
	var rows []map[string]any
	if err := json.Unmarshal(body, &rows); err != nil {
		var single map[string]any
		if err := json.Unmarshal(body, &single); err != nil {
			writeValidationError(w, "Body harus object atau array.", nil)
			return
		}
		rows = []map[string]any{single}
	}

	// Staf hanya boleh tulis key di KEY_STAF; key lain → 403.
	if !owner {
		izin := []map[string]any{}
		adaTerlarang := false
		for _, row := range rows {
			k, ok := row["key"].(string)
			if !ok || k == "" {
				continue
			}
			if keyStaf[k] {
				izin = append(izin, row)
			} else {
				adaTerlarang = true
			}
		}
		if len(izin) == 0 && adaTerlarang {
			writeError(w, http.StatusForbidden, CodeForbidden, "Hanya owner yang boleh mengubah pengaturan ini.")
			return
		}
		rows = izin
	}

	if len(rows) == 0 {
		writeSuccess(w, http.StatusOK, map[string]any{"settings": []db.Setting{}})
		return
	}

	// Convert ke db.Setting. Value dikirim sebagai string JSON (pola Next).
	settings := []db.Setting{}
	now := time.Now()
	for _, row := range rows {
		k, ok := row["key"].(string)
		if !ok || k == "" {
			continue
		}

		var val *string
		if v, ok := row["value"]; ok && v != nil {
			// Kalau sudah string, pakai langsung; kalau object/array, stringify.
			if str, ok := v.(string); ok {
				val = &str
			} else {
				b, _ := json.Marshal(v)
				s := string(b)
				val = &s
			}
		}

		updatedAt := now
		if ts, ok := row["updated_at"].(string); ok {
			if parsed, err := time.Parse(time.RFC3339, ts); err == nil {
				updatedAt = parsed
			}
		}

		settings = append(settings, db.Setting{
			UserID:    me.UserID,
			Key:       k,
			Value:     val,
			UpdatedAt: updatedAt,
		})
	}

	result, err := s.db.UpsertSettings(r.Context(), me.UserID, settings)
	if err != nil {
		s.log.Error("gagal upsert settings", "err", err)
		writeError(w, http.StatusInternalServerError, CodeInternalError, "Terjadi kesalahan server. Coba lagi.")
		return
	}

	writeSuccess(w, http.StatusOK, map[string]any{"settings": result})
}
