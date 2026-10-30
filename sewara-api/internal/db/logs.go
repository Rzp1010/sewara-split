package db

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
)

// Kolom activity_logs dipilih eksplisit (bukan `*`) supaya bentuk JSON stabil
// dan uuid di-cast ke text — pgx mengembalikan uuid sebagai [16]byte.
const activityLogColumns = `id, "time", aksi, sn, nama_barang, id_barang, created_at,
	user_id::text AS user_id, waktu, aktivitas, detail, catatan, pelayan, trx_info`

// ListActivityLogs membaca log aktivitas tenant, terbaru dulu.
//
// Isolasi tenant dari RLS (`access_own_or_owner_logs`), jadi tidak ada filter
// user_id manual di sini. Rentang tanggal opsional lewat startDate/endDate.
func (d *DB) ListActivityLogs(ctx context.Context, userID, startDate, endDate string, offset, limit int) ([]map[string]any, error) {
	var out []map[string]any
	err := d.InTenant(ctx, userID, func(q Querier) error {
		rows, err := queryRowsAsMaps(ctx, q, `
			SELECT `+activityLogColumns+`
			FROM activity_logs
			WHERE ($1 = '' OR created_at >= $1::timestamptz)
			  AND ($2 = '' OR created_at <= $2::timestamptz)
			ORDER BY id DESC
			OFFSET $3 LIMIT $4`, startDate, endDate, offset, limit)
		if err != nil {
			return err
		}
		out = rows
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("membaca log aktivitas: %w", err)
	}
	return out, nil
}

// InsertActivityLogs menyimpan satu atau banyak log. `id` kiriman klien diabaikan
// (diisi sequence); user_id diisi tenant pemanggil.
//
// Satu INSERT per baris: frontend mengirim 1 baris, dan jumlah baris per request
// kecil. Ganti ke unnest kalau nanti ada pemanggil yang mengirim ratusan.
func (d *DB) InsertActivityLogs(ctx context.Context, userID string, rows []map[string]any) ([]map[string]any, error) {
	tenantID, err := d.TenantID(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("membaca tenant id: %w", err)
	}

	var out []map[string]any
	err = d.InTenant(ctx, userID, func(q Querier) error {
		for _, row := range rows {
			inserted, err := queryRowsAsMaps(ctx, q, `
				INSERT INTO activity_logs (waktu, aktivitas, detail, catatan, pelayan, trx_info, user_id)
				VALUES ($1, $2, $3, $4, $5, $6, $7)
				RETURNING `+activityLogColumns,
				logString(row, "waktu"), logString(row, "aktivitas"), logString(row, "detail"),
				logString(row, "catatan"), logString(row, "pelayan"), logString(row, "trx_info"),
				tenantID)
			if err != nil {
				return err
			}
			out = append(out, inserted...)
		}
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("menyimpan log aktivitas: %w", err)
	}
	return out, nil
}

// DeleteActivityLogs menghapus log tenant: ids diutamakan, lalu olderThanDays,
// lalu (keduanya kosong) hapus semua. RLS membatasi ke tenant pemanggil, jadi
// DELETE tanpa WHERE pun hanya menyentuh baris tenant ini.
func (d *DB) DeleteActivityLogs(ctx context.Context, userID string, ids []int64, olderThanDays int) (int64, error) {
	var deleted int64
	err := d.InTenant(ctx, userID, func(q Querier) error {
		run := func(sql string, args ...any) error {
			tag, err := q.Exec(ctx, sql, args...)
			if err != nil {
				return err
			}
			deleted = tag.RowsAffected()
			return nil
		}
		switch {
		case len(ids) > 0:
			return run(`DELETE FROM activity_logs WHERE id = ANY($1)`, ids)
		case olderThanDays > 0:
			return run(`DELETE FROM activity_logs WHERE created_at < now() - make_interval(days => $1)`, olderThanDays)
		default:
			return run(`DELETE FROM activity_logs`)
		}
	})
	if err != nil {
		return 0, fmt.Errorf("menghapus log aktivitas: %w", err)
	}
	return deleted, nil
}

// ListLoginLogs membaca catatan login. Tabel login_logs hanya mengaktifkan RLS
// tanpa policy, jadi akses lewat jalur sistem — sama seperti backend Next dulu
// memakai service role — dan penyaringan tenant dilakukan eksplisit di sini.
func (d *DB) ListLoginLogs(ctx context.Context, semua bool, ownerID string, offset, limit int) ([]map[string]any, error) {
	const kolom = `id, email, event, detail, ip, user_agent, created_at`

	var out []map[string]any
	err := d.inSystemTx(ctx, func(tx pgx.Tx) error {
		var rows []map[string]any
		var err error
		if semua {
			rows, err = queryRowsAsMaps(ctx, tx,
				`SELECT `+kolom+` FROM login_logs ORDER BY created_at DESC, id DESC OFFSET $1 LIMIT $2`,
				offset, limit)
		} else {
			rows, err = queryRowsAsMaps(ctx, tx,
				`SELECT `+kolom+` FROM login_logs WHERE owner_id = $1::uuid ORDER BY created_at DESC, id DESC OFFSET $2 LIMIT $3`,
				ownerID, offset, limit)
		}
		out = rows
		return err
	})
	if err != nil {
		return nil, fmt.Errorf("membaca log login: %w", err)
	}
	return out, nil
}

// queryRowsAsMaps mengembalikan baris sebagai map kolom→nilai. Dipakai tabel log
// yang bentuknya longgar supaya tidak perlu struct besar untuk kolom legacy.
func queryRowsAsMaps(ctx context.Context, q Querier, sql string, args ...any) ([]map[string]any, error) {
	rows, err := q.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	kolom := rows.FieldDescriptions()
	out := []map[string]any{}
	for rows.Next() {
		vals, err := rows.Values()
		if err != nil {
			return nil, err
		}
		m := make(map[string]any, len(kolom))
		for i, fd := range kolom {
			m[string(fd.Name)] = vals[i]
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// logString mengambil nilai string dari payload log; hilang → NULL.
func logString(row map[string]any, key string) any {
	if v, ok := row[key].(string); ok {
		return v
	}
	return nil
}
