package db

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

// Profile adalah data user yang bisa dibaca lintas tenant (owner/superadmin).
//
// Tag JSON wajib snake_case: frontend memakai nama field itu apa adanya, dan
// backend Next mengirimnya dalam bentuk yang sama. Tanpa tag, encoding/json
// memakai nama field Go (PascalCase) dan frontend berhenti menemukan datanya.
type Profile struct {
	UserID          string     `json:"user_id"`
	Email           string     `json:"email"`
	NamaLengkap     string     `json:"nama_lengkap"`
	Username        *string    `json:"username"`
	Role            string     `json:"role"`
	OwnerID         *string    `json:"owner_id"`
	Active          bool       `json:"is_active"`
	Status          *string    `json:"status"`
	SubscribedUntil *time.Time `json:"subscribed_until"`
}

// GetProfiles membaca daftar profil yang boleh dilihat pemanggil.
//
// RLS policy `profiles_select_allowed` yang menentukan cakupannya: user biasa
// hanya melihat dirinya + atasan (owner_id = dirinya kalau dia owner); superadmin
// melihat semua. Jadi SELECT tanpa filter tambahan isinya sudah benar per peran.
func (d *DB) GetProfiles(ctx context.Context, userID string) ([]Profile, error) {
	var profiles []Profile
	err := d.InTenant(ctx, userID, func(q Querier) error {
		rows, err := q.Query(ctx, `
			SELECT user_id::text, email, nama_lengkap, username, role,
			       owner_id::text, is_active, status, subscribed_until
			FROM profiles
			ORDER BY nama_lengkap`)
		if err != nil {
			return err
		}
		defer rows.Close()

		for rows.Next() {
			var p Profile
			if err := rows.Scan(&p.UserID, &p.Email, &p.NamaLengkap, &p.Username, &p.Role,
				&p.OwnerID, &p.Active, &p.Status, &p.SubscribedUntil); err != nil {
				return err
			}
			profiles = append(profiles, p)
		}
		return rows.Err()
	})
	if err != nil {
		return nil, fmt.Errorf("membaca profiles: %w", err)
	}
	return profiles, nil
}

// GetProfileByEmail membaca satu profil berdasarkan email. Nil = tidak ada.
// Tetap lewat InTenant, jadi RLS berlaku: email tenant lain tidak akan terlihat.
func (d *DB) GetProfileByEmail(ctx context.Context, userID, email string) (*Profile, error) {
	var p Profile
	err := d.InTenant(ctx, userID, func(q Querier) error {
		return q.QueryRow(ctx, `
			SELECT user_id::text, email, nama_lengkap, username, role,
			       owner_id::text, is_active, status, subscribed_until
			FROM profiles
			WHERE lower(email) = lower($1)`, email).
			Scan(&p.UserID, &p.Email, &p.NamaLengkap, &p.Username, &p.Role,
				&p.OwnerID, &p.Active, &p.Status, &p.SubscribedUntil)
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("membaca profil by email: %w", err)
	}
	return &p, nil
}
