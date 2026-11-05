package db

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
)

const chatMessageColumns = `id::text AS id, trx_id::text AS trx_id, user_id::text AS user_id,
	author_id::text AS author_id, author_nama, author_role, pesan, to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS created_at`

func (d *DB) ListChatMessages(ctx context.Context, userID, trxID string, limit int) ([]map[string]any, error) {
	var out []map[string]any
	tenantID, err := d.TenantID(ctx, userID)
	if err != nil {
		return nil, err
	}
	// trxID kosong = seluruh pesan tenant (ruang gabungan). Dikirim sebagai NULL
	// supaya cast ::uuid tidak pernah melihat string kosong.
	var trx any
	if trxID != "" {
		trx = trxID
	}
	err = d.InTenant(ctx, userID, func(q Querier) error {
		rows, err := queryRowsAsMaps(ctx, q, `SELECT `+chatMessageColumns+` FROM chat_messages
			WHERE user_id=$3::uuid AND ($1::uuid IS NULL OR trx_id = $1::uuid)
			ORDER BY created_at DESC LIMIT $2`, trx, limit, tenantID)
		out = rows
		return err
	})
	return out, err
}

func (d *DB) InsertChatMessage(ctx context.Context, userID, trxID, authorNama, authorRole, pesan string) ([]map[string]any, error) {
	tenantID, err := d.TenantID(ctx, userID)
	if err != nil {
		return nil, err
	}
	var out []map[string]any
	err = d.InTenant(ctx, userID, func(q Querier) error {
		var trx any
		if trxID != "" {
			trx = trxID
		}
		rows, err := queryRowsAsMaps(ctx, q, `INSERT INTO chat_messages (user_id,trx_id,author_id,author_nama,author_role,pesan)
			VALUES ($1::uuid,$2::uuid,$3::uuid,$4,$5,$6) RETURNING `+chatMessageColumns, tenantID, trx, userID, authorNama, authorRole, pesan)
		out = rows
		return err
	})
	return out, err
}

func (d *DB) DeleteChatMessage(ctx context.Context, userID, role, id string) error {
	err := d.InTenant(ctx, userID, func(q Querier) error {
		var authorID string
		err := q.QueryRow(ctx, `SELECT author_id::text FROM chat_messages WHERE id=$1::uuid`, id).Scan(&authorID)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		// Pemanggil: penulis sendiri, atau owner/superadmin tenant.
		if authorID != userID && role != "owner" && role != "superadmin" {
			return errors.New("forbidden")
		}
		_, err = q.Exec(ctx, `DELETE FROM chat_messages WHERE id=$1::uuid`, id)
		return err
	})
	return err
}

func (d *DB) ChatUnread(ctx context.Context, userID string) (map[string]any, error) {
	result := map[string]any{"room": 0, "perTrx": map[string]int{}, "total": 0}
	err := d.InTenant(ctx, userID, func(q Querier) error {
		rows, err := queryRowsAsMaps(ctx, q, `SELECT m.trx_id::text AS trx_id, count(*)::int AS n
			FROM chat_messages m LEFT JOIN chat_reads r ON r.user_id=$1::uuid AND r.scope=CASE WHEN m.trx_id IS NULL THEN 'room' ELSE 'trx:'||m.trx_id::text END
			WHERE m.author_id <> $1::uuid AND (r.last_read_at IS NULL OR m.created_at > r.last_read_at)
			GROUP BY m.trx_id`, userID)
		if err != nil {
			return err
		}
		per := map[string]int{}
		total := 0
		for _, row := range rows {
			n := row["n"].(int32)
			total += int(n)
			if row["trx_id"] == nil {
				result["room"] = int(n)
			} else {
				per[row["trx_id"].(string)] = int(n)
			}
		}
		result["perTrx"], result["total"] = per, total
		return nil
	})
	return result, err
}

func (d *DB) MarkChatRead(ctx context.Context, userID, trxID string) error {
	scope := "room"
	if trxID != "" {
		scope = "trx:" + trxID
	}
	return d.InTenant(ctx, userID, func(q Querier) error {
		_, err := q.Exec(ctx, `INSERT INTO chat_reads(user_id,scope,last_read_at) VALUES($1::uuid,$2,now()) ON CONFLICT(user_id,scope) DO UPDATE SET last_read_at=now()`, userID, scope)
		return err
	})
}
