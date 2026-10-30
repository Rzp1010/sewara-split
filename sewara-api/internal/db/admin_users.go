package db

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"
)

// AdminProfile menyimpan atribut target yang dipakai gerbang admin.
type AdminProfile struct {
	UserID          string
	Email           string
	Role            string
	OwnerID         *string
	Active          bool
	SubscribedUntil *time.Time
}

func (d *DB) AdminUsers(ctx context.Context, caller Identity) ([]map[string]any, error) {
	var out []map[string]any
	err := d.InTenant(ctx, caller.UserID, func(q Querier) error {
		query := `SELECT user_id::text AS user_id, email, nama_lengkap, username, role, owner_id::text AS owner_id, is_active, status, subscribed_until, created_at FROM profiles`
		var args []any
		if caller.Role == "owner" {
			query += ` WHERE owner_id = $1::uuid`
			args = append(args, caller.UserID)
		}
		query += ` ORDER BY created_at DESC`
		var err error
		out, err = queryRowsAsMaps(ctx, q, query, args...)
		if err != nil {
			return err
		}
		if caller.Role == "superadmin" {
			counts := map[string]int{}
			for _, row := range out {
				owner, _ := row["owner_id"].(string)
				role, _ := row["role"].(string)
				if owner != "" && role != "owner" {
					counts[owner]++
				}
			}
			for _, row := range out {
				if row["role"] == "owner" {
					row["jumlah_staff"] = counts[row["user_id"].(string)]
				}
			}
		}
		return nil
	})
	return out, err
}

func (d *DB) CreateAuthUser(ctx context.Context, email, hash string) (string, error) {
	var id string
	err := d.inSystemTx(ctx, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `INSERT INTO auth.users (id,email,encrypted_password,email_confirmed_at) VALUES (gen_random_uuid(),lower($1),$2,now()) RETURNING id::text`, email, hash).Scan(&id)
	})
	return id, err
}
func (d *DB) DeleteAuthUsers(ctx context.Context, ids []string) (int64, error) {
	var n int64
	err := d.inSystemTx(ctx, func(tx pgx.Tx) error {
		tag, e := tx.Exec(ctx, `DELETE FROM auth.users WHERE id = ANY($1::uuid[])`, ids)
		n = tag.RowsAffected()
		return e
	})
	return n, err
}
func (d *DB) UpdateAdminPassword(ctx context.Context, id, hash string) error {
	return d.UpdatePasswordHash(ctx, id, hash)
}
func (d *DB) LogAdminAction(ctx context.Context, actor, action, target, detail string) {
	_, _ = d.pool.Exec(ctx, `INSERT INTO admin_logs(actor_email,aksi,target_email,detail) VALUES($1,$2,$3,$4)`, actor, action, target, detail)
}
func (d *DB) AdminProfileByEmailSystem(ctx context.Context, email string) (AdminProfile, error) {
	var p AdminProfile
	err := d.inSystemTx(ctx, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT user_id::text,email,role,owner_id::text,is_active,subscribed_until FROM profiles WHERE email=$1`, email).Scan(&p.UserID, &p.Email, &p.Role, &p.OwnerID, &p.Active, &p.SubscribedUntil)
	})
	if err == pgx.ErrNoRows {
		return AdminProfile{}, ErrNotFound
	}
	return p, err
}
