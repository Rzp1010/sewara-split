package db

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

// Identity adalah profil user yang sudah login: cukup untuk menjawab "siapa ini,
// role-nya apa, masih aktif atau tidak". Field opsional memakai pointer supaya
// NULL di database tetap NULL di JSON, bukan string kosong.
type Identity struct {
	UserID          string
	Email           string
	NamaLengkap     string
	Username        *string
	NamaInvoice     *string
	Role            string
	OwnerID         *string
	Active          bool
	Status          *string
	SubscribedUntil *time.Time
}

// LoadIdentity membaca profil user yang sedang login lewat jalur tenant biasa.
//
// Sengaja TIDAK memakai query sistem: policy `profiles_select_allowed` mengizinkan
// user membaca barisnya sendiri, jadi RLS sekaligus berfungsi sebagai pemeriksaan
// bahwa id yang dipakai memang milik user itu.
func (d *DB) LoadIdentity(ctx context.Context, userID string) (Identity, error) {
	var id Identity
	err := d.InTenant(ctx, userID, func(q Querier) error {
		return q.QueryRow(ctx, `
			SELECT user_id::text, email, nama_lengkap, username, nama_invoice,
			       role, owner_id::text, is_active, status, subscribed_until
			FROM profiles
			WHERE user_id = $1::uuid`, userID).
			Scan(&id.UserID, &id.Email, &id.NamaLengkap, &id.Username, &id.NamaInvoice,
				&id.Role, &id.OwnerID, &id.Active, &id.Status, &id.SubscribedUntil)
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return Identity{}, ErrNotFound
	}
	if err != nil {
		return Identity{}, fmt.Errorf("membaca profil: %w", err)
	}
	return id, nil
}
