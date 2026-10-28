package httpapi

import (
	"net/http"

	"github.com/Rzp1010/sewara-split/sewara-api/internal/db"
)

// handleProfilesGet mengembalikan daftar profil (sdm/manajemen), atau satu profil
// kalau `?email=` diisi.
//
// Cakupan baris ditentukan RLS, bukan filter di handler: staf hanya melihat dirinya
// dan atasannya, superadmin melihat semua. Handler sengaja tidak menambah filter
// peran sendiri — kalau policy berubah, perilaku ikut berubah di satu tempat.
func (s *Server) handleProfilesGet(w http.ResponseWriter, r *http.Request, me db.Identity) {
	email := r.URL.Query().Get("email")

	if email != "" {
		profil, err := s.db.GetProfileByEmail(r.Context(), me.UserID, email)
		if err != nil {
			s.log.Error("gagal membaca profil by email", "err", err, "email", email)
			writeError(w, http.StatusInternalServerError, CodeInternalError, "Terjadi kesalahan server. Coba lagi.")
			return
		}
		writeSuccess(w, http.StatusOK, map[string]any{"profile": profil})
		return
	}

	profiles, err := s.db.GetProfiles(r.Context(), me.UserID)
	if err != nil {
		s.log.Error("gagal membaca profiles", "err", err)
		writeError(w, http.StatusInternalServerError, CodeInternalError, "Terjadi kesalahan server. Coba lagi.")
		return
	}
	writeSuccess(w, http.StatusOK, map[string]any{"profiles": profiles})
}
