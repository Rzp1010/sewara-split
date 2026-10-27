package httpapi

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/Rzp1010/sewara-split/sewara-api/internal/auth"
	"github.com/Rzp1010/sewara-split/sewara-api/internal/db"
)

type ctxKey int

const identityKey ctxKey = iota

// unauthorizedMsg disamakan dengan backend Next apa adanya.
// Frontend dan uji kontrak membandingkan string ini, jadi jangan diubah sendiri.
const unauthorizedMsg = "Tidak terautentikasi. Silakan login."

// authedHandler menerima identitas sebagai argumen, bukan mengambilnya dari
// context sendiri. Dengan begitu handler yang butuh login tidak mungkin lupa
// memeriksanya: tipenya tidak cocok kalau tidak dibungkus requireAuth.
type authedHandler func(http.ResponseWriter, *http.Request, db.Identity)

func (s *Server) requireAuth(next authedHandler) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		cookie, err := r.Cookie(auth.CookieName)
		if err != nil || cookie.Value == "" {
			writeError(w, http.StatusUnauthorized, CodeUnauthorized, unauthorizedMsg)
			return
		}

		hash := auth.HashToken(cookie.Value)
		session, err := s.db.FindSession(r.Context(), hash)
		if err != nil {
			if errors.Is(err, db.ErrNotFound) {
				writeError(w, http.StatusUnauthorized, CodeUnauthorized, unauthorizedMsg)
				return
			}
			s.log.Error("gagal membaca sesi", "err", err)
			writeError(w, http.StatusInternalServerError, CodeInternalError, "Terjadi kesalahan server. Coba lagi.")
			return
		}

		if session.Expired(time.Now()) {
			// Bersihkan sambil jalan supaya tabel tidak menumpuk sesi mati.
			if err := s.db.DeleteSession(r.Context(), hash); err != nil {
				s.log.Error("gagal menghapus sesi kedaluwarsa", "err", err)
			}
			writeError(w, http.StatusUnauthorized, CodeUnauthorized, unauthorizedMsg)
			return
		}

		identity, err := s.db.LoadIdentity(r.Context(), session.UserID)
		if err != nil {
			if errors.Is(err, db.ErrNotFound) {
				// Sesi ada tapi profilnya tidak: akun sudah dihapus. Perlakukan sebagai
				// tidak terautentikasi, bukan error server.
				writeError(w, http.StatusUnauthorized, CodeUnauthorized, unauthorizedMsg)
				return
			}
			s.log.Error("gagal membaca profil", "err", err)
			writeError(w, http.StatusInternalServerError, CodeInternalError, "Terjadi kesalahan server. Coba lagi.")
			return
		}

		// Akun nonaktif harus langsung kehilangan akses, tanpa menunggu sesi kedaluwarsa.
		if !identity.Active {
			writeError(w, http.StatusUnauthorized, CodeUnauthorized, unauthorizedMsg)
			return
		}

		s.db.TouchSession(r.Context(), hash)

		ctx := context.WithValue(r.Context(), identityKey, identity)
		next(w, r.WithContext(ctx), identity)
	}
}

func identityOf(r *http.Request) db.Identity {
	id, _ := r.Context().Value(identityKey).(db.Identity)
	return id
}
