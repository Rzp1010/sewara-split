package db

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
)

// ManajemenCounts dihitung lintas tenant lewat jalur sistem.
func (d *DB) ManajemenCounts(ctx context.Context) (map[string]int, error) {
	m := map[string]int{}
	var owner, ownerOn, ownerOff, staff, staffOn, staffOff, all int
	err := d.inSystemTx(ctx, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT count(*) FILTER(WHERE role='owner'), count(*) FILTER(WHERE role='owner' AND is_active), count(*) FILTER(WHERE role='owner' AND NOT is_active), count(*) FILTER(WHERE role IN ('cs','gudang')), count(*) FILTER(WHERE role IN ('cs','gudang') AND is_active), count(*) FILTER(WHERE role IN ('cs','gudang') AND NOT is_active), count(*) FROM profiles`).Scan(&owner, &ownerOn, &ownerOff, &staff, &staffOn, &staffOff, &all)
	})
	m["totalOwner"], m["ownerAktif"], m["ownerNonaktif"], m["totalStaf"], m["stafAktif"], m["stafNonaktif"], m["totalAkun"] = owner, ownerOn, ownerOff, staff, staffOn, staffOff, all
	return m, err
}
func (d *DB) ListAdminLogs(ctx context.Context, userID string) ([]map[string]any, error) {
	var out []map[string]any
	err := d.InTenant(ctx, userID, func(q Querier) error {
		var e error
		out, e = queryRowsAsMaps(ctx, q, `SELECT actor_email,aksi,target_email,detail,created_at FROM admin_logs ORDER BY created_at DESC LIMIT 500`)
		return e
	})
	return out, err
}
func (d *DB) CreateAdminProfile(ctx context.Context, callerID, id, email, role, name, username, invoice string, ownerID *string) error {
	return d.InTenant(ctx, callerID, func(q Querier) error {
		_, e := q.Exec(ctx, `INSERT INTO profiles(user_id,email,role,nama_lengkap,username,nama_invoice,is_active,owner_id) VALUES($1::uuid,$2,$3,$4,$5,$6,true,$7::uuid) ON CONFLICT(email) DO UPDATE SET user_id=EXCLUDED.user_id,role=EXCLUDED.role,nama_lengkap=EXCLUDED.nama_lengkap,username=EXCLUDED.username,nama_invoice=EXCLUDED.nama_invoice,is_active=EXCLUDED.is_active,owner_id=EXCLUDED.owner_id`, id, email, role, name, username, invoice, ownerID)
		return e
	})
}
func (d *DB) AdminUpdate(ctx context.Context, userID, email, field string, value any) error {
	allowed := map[string]bool{"role": true, "is_active": true, "status": true, "owner_id": true, "subscribed_until": true, "locked_until": true, "failed_login": true, "cooldown_until": true, "last_failed_at": true, "nama_lengkap": true, "username": true, "nama_invoice": true}
	if !allowed[field] {
		return fmt.Errorf("field admin tidak valid")
	}
	return d.InTenant(ctx, userID, func(q Querier) error {
		_, e := q.Exec(ctx, `UPDATE profiles SET `+field+`=$1 WHERE email=$2`, value, email)
		return e
	})
}
func (d *DB) UnlockAdmin(ctx context.Context, userID, target string) error {
	return d.InTenant(ctx, userID, func(q Querier) error {
		_, e := q.Exec(ctx, `UPDATE profiles SET locked_until=NULL,failed_login=0,cooldown_until=NULL,last_failed_at=NULL WHERE user_id=$1::uuid`, target)
		return e
	})
}
func (d *DB) DeleteUserData(ctx context.Context, userID, targetEmail string, ids []string) error {
	return d.InTenant(ctx, userID, func(q Querier) error { _, e := q.Exec(ctx, `SELECT rpc_hapus_data_user($1)`, targetEmail); return e })
}
func (d *DB) StaffIDs(ctx context.Context, callerID, ownerID string) ([]string, error) {
	var ids []string
	err := d.InTenant(ctx, callerID, func(q Querier) error {
		rows, e := q.Query(ctx, `SELECT user_id::text FROM profiles WHERE owner_id=$1::uuid`, ownerID)
		if e != nil {
			return e
		}
		defer rows.Close()
		for rows.Next() {
			var id string
			if e = rows.Scan(&id); e != nil {
				return e
			}
			ids = append(ids, id)
		}
		return rows.Err()
	})
	return ids, err
}

type TenantCounts struct{ Inventory, Transactions, Logs int }

func (d *DB) WipeTenant(ctx context.Context, userID string) (TenantCounts, error) {
	var c TenantCounts
	err := d.InTenant(ctx, userID, func(q Querier) error {
		if e := q.QueryRow(ctx, `SELECT count(*) FROM inventory WHERE user_id=$1::uuid`, userID).Scan(&c.Inventory); e != nil {
			return e
		}
		if e := q.QueryRow(ctx, `SELECT count(*) FROM transactions WHERE user_id=$1::uuid`, userID).Scan(&c.Transactions); e != nil {
			return e
		}
		if e := q.QueryRow(ctx, `SELECT count(*) FROM activity_logs WHERE user_id=$1::uuid`, userID).Scan(&c.Logs); e != nil {
			return e
		}
		for _, t := range []string{"transactions", "inventory", "activity_logs", "members", "member_types", "promo_codes"} {
			if _, e := q.Exec(ctx, `DELETE FROM `+t+` WHERE user_id=$1::uuid`, userID); e != nil {
				return e
			}
		}
		var value string
		if e := q.QueryRow(ctx, `SELECT value FROM settings WHERE user_id=$1::uuid AND key='invoice_mulai'`, userID).Scan(&value); e != nil && e != pgx.ErrNoRows {
			return e
		}
		start := 1
		if _, e := fmt.Sscan(value, &start); e != nil {
			start = 1
		}
		_, e := q.Exec(ctx, `INSERT INTO settings(user_id,key,value,updated_at) VALUES($1::uuid,'invoice_counter',$2,now()) ON CONFLICT(user_id,key) DO UPDATE SET value=EXCLUDED.value,updated_at=now()`, userID, fmt.Sprint(start-1))
		return e
	})
	return c, err
}
