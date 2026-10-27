package httpapi

import (
	"net/http"
	"time"

	"github.com/Rzp1010/sewara-split/sewara-api/internal/db"
)

// meUser adalah bentuk respons GET /api/auth/me.
//
// Nama field disamakan dengan backend Next (app/api/auth/me/route.ts): id dan email
// dari identitas, sisanya dari tabel profiles. Field opsional tetap dikirim sebagai
// null, bukan dihilangkan, karena frontend membacanya langsung.
type meUser struct {
	ID              string     `json:"id"`
	Email           string     `json:"email"`
	NamaLengkap     string     `json:"nama_lengkap"`
	Username        *string    `json:"username"`
	NamaInvoice     *string    `json:"nama_invoice"`
	Role            string     `json:"role"`
	OwnerID         *string    `json:"owner_id"`
	IsActive        bool       `json:"is_active"`
	Status          *string    `json:"status"`
	SubscribedUntil *time.Time `json:"subscribed_until"`
}

// handleMe menjawab "siapa saya" untuk klien yang sudah punya sesi.
//
// Beda kecil yang disengaja dari backend Next: kalau baris profilnya tidak ada,
// Next tetap membalas 200 dengan id+email saja. Di sini dibalas 401, karena user
// tanpa profil tidak bisa memakai route apa pun — membiarkannya "login" hanya
// memindahkan kegagalan ke tempat yang lebih membingungkan.
func (s *Server) handleMe(w http.ResponseWriter, r *http.Request, me db.Identity) {
	writeSuccess(w, http.StatusOK, map[string]any{
		"user": meUser{
			ID:              me.UserID,
			Email:           me.Email,
			NamaLengkap:     me.NamaLengkap,
			Username:        me.Username,
			NamaInvoice:     me.NamaInvoice,
			Role:            me.Role,
			OwnerID:         me.OwnerID,
			IsActive:        me.Active,
			Status:          me.Status,
			SubscribedUntil: me.SubscribedUntil,
		},
	})
}
