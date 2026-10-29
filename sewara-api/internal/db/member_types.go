package db

import (
	"context"
	"encoding/json"
	"fmt"
	"time"
)

// MemberType adalah tipe member (Reguler, VIP, dst) per tenant.
// Tag JSON snake_case wajib: frontend membaca nama field ini apa adanya.
type MemberType struct {
	ID                 int64           `json:"id"`
	UserID             string          `json:"user_id"`
	Nama               string          `json:"nama"`
	DiskonPersen       float64         `json:"diskon_persen"`
	Status             string          `json:"status"`
	CreatedAt          time.Time       `json:"created_at"`
	DiskonDurasiAturan json.RawMessage `json:"diskon_durasi_aturan"`
}

// GetMemberTypes membaca semua tipe member tenant, diurutkan nama.
func (d *DB) GetMemberTypes(ctx context.Context, userID string) ([]MemberType, error) {
	var types []MemberType
	err := d.InTenant(ctx, userID, func(q Querier) error {
		rows, err := q.Query(ctx, `
			SELECT id, user_id::text, nama, diskon_persen, status, created_at, diskon_durasi_aturan
			FROM member_types
			ORDER BY nama`)
		if err != nil {
			return err
		}
		defer rows.Close()

		for rows.Next() {
			var mt MemberType
			if err := rows.Scan(&mt.ID, &mt.UserID, &mt.Nama, &mt.DiskonPersen, &mt.Status, &mt.CreatedAt, &mt.DiskonDurasiAturan); err != nil {
				return err
			}
			types = append(types, mt)
		}
		return rows.Err()
	})
	if err != nil {
		return nil, fmt.Errorf("membaca member_types: %w", err)
	}
	return types, nil
}

// InsertMemberType membuat tipe member baru.
func (d *DB) InsertMemberType(ctx context.Context, userID string, mt MemberType) (MemberType, error) {
	var result MemberType
	err := d.InTenant(ctx, userID, func(q Querier) error {
		return q.QueryRow(ctx, `
			INSERT INTO member_types (user_id, nama, diskon_persen, status, diskon_durasi_aturan)
			VALUES ($1::uuid, $2, $3, $4, $5)
			RETURNING id, user_id::text, nama, diskon_persen, status, created_at, diskon_durasi_aturan`,
			userID, mt.Nama, mt.DiskonPersen, mt.Status, mt.DiskonDurasiAturan).
			Scan(&result.ID, &result.UserID, &result.Nama, &result.DiskonPersen, &result.Status, &result.CreatedAt, &result.DiskonDurasiAturan)
	})
	if err != nil {
		return MemberType{}, fmt.Errorf("insert member_type: %w", err)
	}
	return result, nil
}

// UpdateMemberType mengubah tipe member. Return nil jika tidak ditemukan atau bukan milik tenant.
func (d *DB) UpdateMemberType(ctx context.Context, userID, id string, fields map[string]any) (*MemberType, error) {
	var result MemberType
	err := d.InTenant(ctx, userID, func(q Querier) error {
		setClauses := ""
		args := []any{id}
		i := 2
		for k, v := range fields {
			if setClauses != "" {
				setClauses += ", "
			}
			setClauses += fmt.Sprintf("%s = $%d", k, i)
			args = append(args, v)
			i++
		}

		query := fmt.Sprintf(`
			UPDATE member_types
			SET %s
			WHERE id = $1
			RETURNING id, user_id::text, nama, diskon_persen, status, created_at, diskon_durasi_aturan`, setClauses)

		return q.QueryRow(ctx, query, args...).
			Scan(&result.ID, &result.UserID, &result.Nama, &result.DiskonPersen, &result.Status, &result.CreatedAt, &result.DiskonDurasiAturan)
	})
	if err != nil {
		if err.Error() == "no rows in result set" {
			return nil, nil
		}
		return nil, fmt.Errorf("update member_type: %w", err)
	}
	return &result, nil
}

// DeleteMemberType menghapus tipe member. Idempoten: tidak error jika tidak ditemukan.
func (d *DB) DeleteMemberType(ctx context.Context, userID, id string) error {
	return d.InTenant(ctx, userID, func(q Querier) error {
		_, err := q.Exec(ctx, `DELETE FROM member_types WHERE id = $1`, id)
		return err
	})
}
