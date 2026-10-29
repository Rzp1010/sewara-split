package db

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// ErrPromoDuplikat dikembalikan saat kode promo sudah ada di tenant.
var ErrPromoDuplikat = errors.New("kode promo sudah ada")

// PromoCode adalah satu kode promo tenant.
type PromoCode struct {
	ID            int64      `json:"id"`
	UserID        string     `json:"user_id"`
	Kode          string     `json:"kode"`
	DiskonPersen  float64    `json:"diskon_persen"`
	BerlakuDari   *time.Time `json:"berlaku_dari"`
	BerlakuSampai *time.Time `json:"berlaku_sampai"`
	Kuota         *int       `json:"kuota"`
	Terpakai      int        `json:"terpakai"`
	Status        string     `json:"status"`
	CreatedAt     time.Time  `json:"created_at"`
}

// ListPromo membaca semua promo tenant, diurutkan terbaru dulu.
func (db *DB) ListPromo(ctx context.Context, tenantID string) ([]PromoCode, error) {
	rows, err := db.pool.Query(ctx, `
		SELECT id, user_id, kode, diskon_persen, berlaku_dari, berlaku_sampai,
		       kuota, terpakai, status, created_at
		FROM promo_codes
		WHERE user_id = $1
		ORDER BY created_at DESC
	`, tenantID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var list []PromoCode
	for rows.Next() {
		var p PromoCode
		if err := rows.Scan(&p.ID, &p.UserID, &p.Kode, &p.DiskonPersen,
			&p.BerlakuDari, &p.BerlakuSampai, &p.Kuota, &p.Terpakai, &p.Status, &p.CreatedAt); err != nil {
			return nil, err
		}
		list = append(list, p)
	}
	return list, rows.Err()
}

// GetPromo membaca satu promo by ID milik tenant.
func (db *DB) GetPromo(ctx context.Context, tenantID string, id int64) (PromoCode, error) {
	var p PromoCode
	err := db.pool.QueryRow(ctx, `
		SELECT id, user_id, kode, diskon_persen, berlaku_dari, berlaku_sampai,
		       kuota, terpakai, status, created_at
		FROM promo_codes
		WHERE id = $1 AND user_id = $2
	`, id, tenantID).Scan(&p.ID, &p.UserID, &p.Kode, &p.DiskonPersen,
		&p.BerlakuDari, &p.BerlakuSampai, &p.Kuota, &p.Terpakai, &p.Status, &p.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return p, ErrNotFound
	}
	return p, err
}

// InsertPromo membuat promo baru. Kode duplikat per tenant dikembalikan sebagai
// ErrPromoDuplikat.
func (db *DB) InsertPromo(ctx context.Context, tenantID, kode string, diskonPersen float64,
	berlakuDari, berlakuSampai *time.Time, kuota *int, status string) (PromoCode, error) {

	var p PromoCode
	err := db.pool.QueryRow(ctx, `
		INSERT INTO promo_codes (user_id, kode, diskon_persen, berlaku_dari, berlaku_sampai, kuota, status)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		RETURNING id, user_id, kode, diskon_persen, berlaku_dari, berlaku_sampai, kuota, terpakai, status, created_at
	`, tenantID, kode, diskonPersen, berlakuDari, berlakuSampai, kuota, status).
		Scan(&p.ID, &p.UserID, &p.Kode, &p.DiskonPersen, &p.BerlakuDari, &p.BerlakuSampai,
			&p.Kuota, &p.Terpakai, &p.Status, &p.CreatedAt)

	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" && pgErr.ConstraintName == "promo_codes_user_kode" {
			return p, ErrPromoDuplikat
		}
	}
	return p, err
}

// UpdatePromo mengubah field promo. Field yang tidak diisi (nil/zero) tidak diubah.
// Kode duplikat dikembalikan sebagai ErrPromoDuplikat.
func (db *DB) UpdatePromo(ctx context.Context, tenantID string, id int64,
	kode *string, diskonPersen *float64, berlakuDari, berlakuSampai **time.Time,
	kuota **int, status *string) (PromoCode, error) {

	// Baca dulu untuk merge field yang tidak diubah.
	lama, err := db.GetPromo(ctx, tenantID, id)
	if err != nil {
		return lama, err
	}

	if kode != nil {
		lama.Kode = *kode
	}
	if diskonPersen != nil {
		lama.DiskonPersen = *diskonPersen
	}
	if berlakuDari != nil {
		lama.BerlakuDari = *berlakuDari
	}
	if berlakuSampai != nil {
		lama.BerlakuSampai = *berlakuSampai
	}
	if kuota != nil {
		lama.Kuota = *kuota
	}
	if status != nil {
		lama.Status = *status
	}

	err = db.pool.QueryRow(ctx, `
		UPDATE promo_codes
		SET kode = $3, diskon_persen = $4, berlaku_dari = $5, berlaku_sampai = $6,
		    kuota = $7, status = $8
		WHERE id = $1 AND user_id = $2
		RETURNING id, user_id, kode, diskon_persen, berlaku_dari, berlaku_sampai, kuota, terpakai, status, created_at
	`, id, tenantID, lama.Kode, lama.DiskonPersen, lama.BerlakuDari, lama.BerlakuSampai,
		lama.Kuota, lama.Status).
		Scan(&lama.ID, &lama.UserID, &lama.Kode, &lama.DiskonPersen, &lama.BerlakuDari,
			&lama.BerlakuSampai, &lama.Kuota, &lama.Terpakai, &lama.Status, &lama.CreatedAt)

	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return lama, ErrNotFound
		}
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" && pgErr.ConstraintName == "promo_codes_user_kode" {
			return lama, ErrPromoDuplikat
		}
	}
	return lama, err
}

// DeletePromo menghapus promo milik tenant.
func (db *DB) DeletePromo(ctx context.Context, tenantID string, id int64) error {
	tag, err := db.pool.Exec(ctx, `
		DELETE FROM promo_codes WHERE id = $1 AND user_id = $2
	`, id, tenantID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// SudahKadaluarsa memeriksa apakah promo lewat tanggal berlaku_sampai atau kuota
// sudah habis. Dipakai validate dan use.
func SudahKadaluarsa(p PromoCode, now time.Time) bool {
	if p.BerlakuSampai != nil && !now.Before(*p.BerlakuSampai) {
		return true
	}
	if p.Kuota != nil && p.Terpakai >= *p.Kuota {
		return true
	}
	return false
}

// UsePromo menaikkan counter terpakai dengan guard concurrency. Return ErrNotFound
// kalau update tidak menyentuh baris (race condition atau promo tidak aktif).
func (db *DB) UsePromo(ctx context.Context, id int64, currentTerpakai int) error {
	var tag pgconn.CommandTag
	var err error

	// UPDATE dengan WHERE terpakai=current supaya dua pemakaian bersamaan tidak
	// saling menimpa. Kalau kuota ada, tambahkan guard terpakai < kuota.
	tag, err = db.pool.Exec(ctx, `
		UPDATE promo_codes
		SET terpakai = terpakai + 1
		WHERE id = $1
		  AND status = 'aktif'
		  AND terpakai = $2
		  AND (kuota IS NULL OR terpakai < kuota)
	`, id, currentTerpakai)

	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// SetPromoExpired mengubah status promo menjadi 'expired'.
func (db *DB) SetPromoExpired(ctx context.Context, id int64) error {
	_, err := db.pool.Exec(ctx, `
		UPDATE promo_codes SET status = 'expired' WHERE id = $1 AND status = 'aktif'
	`, id)
	return err
}

// TandaiPromoExpired mengubah status promo menjadi 'expired' kalau tanggal/kuota
// sudah lewat. Dipanggil saat GET list supaya daftar selalu konsisten dengan
// logika kadaluarsa.
func (db *DB) TandaiPromoExpired(ctx context.Context, tenantID string, now time.Time) error {
	_, err := db.pool.Exec(ctx, `
		UPDATE promo_codes
		SET status = 'expired'
		WHERE user_id = $1
		  AND status = 'aktif'
		  AND (
		    (berlaku_sampai IS NOT NULL AND $2 >= berlaku_sampai)
		    OR (kuota IS NOT NULL AND terpakai >= kuota)
		  )
	`, tenantID, now)
	return err
}
