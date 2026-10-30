package db

import (
	"context"
	"fmt"
	"time"
)

// Setting adalah satu pasangan key-value per tenant.
// Value disimpan sebagai text (JSON string), sama seperti backend Next.
type Setting struct {
	UserID    string    `json:"user_id"`
	Key       string    `json:"key"`
	Value     *string   `json:"value"`
	UpdatedAt time.Time `json:"updated_at"`
}

// GetSettings membaca semua setting tenant. Filter key dilakukan di handler.
func (d *DB) GetSettings(ctx context.Context, userID string) ([]Setting, error) {
	var settings []Setting
	err := d.InTenant(ctx, userID, func(q Querier) error {
		rows, err := q.Query(ctx, `
			SELECT user_id::text, key, value, updated_at
			FROM settings
			ORDER BY key`)
		if err != nil {
			return err
		}
		defer rows.Close()

		for rows.Next() {
			var s Setting
			if err := rows.Scan(&s.UserID, &s.Key, &s.Value, &s.UpdatedAt); err != nil {
				return err
			}
			settings = append(settings, s)
		}
		return rows.Err()
	})
	if err != nil {
		return nil, fmt.Errorf("membaca settings: %w", err)
	}
	return settings, nil
}

// GetSettingByKey membaca satu setting milik user (tenant) tertentu. Tidak
// ditemukan bukan error — return nil.
//
// Scope `user_id` eksplisit, bukan sekadar RLS: backend Next selalu menambah
// `.eq('user_id', ...)` saat membaca satu key (settings GET memakai
// `getTenantId`, telegram/test memakai id pemanggil, invoice header memakai
// `getTenantId`, dan lib/services/telegram.ts memakai service-role + `.eq`).
// Tanpa filter ini, RLS masih mengizinkan lebih dari satu baris terlihat (baris
// milik staf sendiri + baris owner tenant-nya), jadi baris yang terambil tidak
// deterministik.
func (d *DB) GetSettingByKey(ctx context.Context, userID, key string) (*Setting, error) {
	var s Setting
	err := d.InTenant(ctx, userID, func(q Querier) error {
		return q.QueryRow(ctx, `
			SELECT user_id::text, key, value, updated_at
			FROM settings
			WHERE user_id = $1::uuid AND key = $2`, userID, key).
			Scan(&s.UserID, &s.Key, &s.Value, &s.UpdatedAt)
	})
	if err != nil {
		if err.Error() == "no rows in result set" {
			return nil, nil
		}
		return nil, fmt.Errorf("membaca setting key=%s: %w", key, err)
	}
	return &s, nil
}

// UpsertSettings menulis satu atau banyak setting sekaligus.
// Backend Next menerima array atau single object; kita terima array saja (handler wrap kalau perlu).
func (d *DB) UpsertSettings(ctx context.Context, userID string, settings []Setting) ([]Setting, error) {
	if len(settings) == 0 {
		return []Setting{}, nil
	}

	var result []Setting
	err := d.InTenant(ctx, userID, func(q Querier) error {
		for _, s := range settings {
			var inserted Setting
			err := q.QueryRow(ctx, `
				INSERT INTO settings (user_id, key, value, updated_at)
				VALUES ($1::uuid, $2, $3, $4)
				ON CONFLICT (user_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at
				RETURNING user_id::text, key, value, updated_at`,
				userID, s.Key, s.Value, s.UpdatedAt).
				Scan(&inserted.UserID, &inserted.Key, &inserted.Value, &inserted.UpdatedAt)
			if err != nil {
				return fmt.Errorf("upsert setting key=%s: %w", s.Key, err)
			}
			result = append(result, inserted)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return result, nil
}
