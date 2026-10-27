package db

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

// Session adalah hasil pencarian token di auth.sessions. Yang disimpan hanya
// hash token, jadi nilai token asli tidak pernah bisa dibaca kembali dari database.
type Session struct {
	UserID    string
	ExpiresAt time.Time
}

func (s Session) Expired(now time.Time) bool { return !now.Before(s.ExpiresAt) }

func (d *DB) CreateSession(ctx context.Context, tokenHash []byte, userID string, expiresAt time.Time, userAgent, ip string) error {
	_, err := d.pool.Exec(ctx, `
		INSERT INTO auth.sessions (token_hash, user_id, expires_at, user_agent, ip)
		VALUES ($1, $2::uuid, $3, $4, $5)`,
		tokenHash, userID, expiresAt, nullIfEmpty(userAgent), nullIfEmpty(ip))
	if err != nil {
		return fmt.Errorf("menyimpan sesi: %w", err)
	}
	return nil
}

// FindSession mengembalikan sesi yang cocok, atau ErrNotFound.
func (d *DB) FindSession(ctx context.Context, tokenHash []byte) (Session, error) {
	var s Session
	err := d.pool.QueryRow(ctx, `
		SELECT user_id::text, expires_at
		FROM auth.sessions
		WHERE token_hash = $1`, tokenHash).Scan(&s.UserID, &s.ExpiresAt)

	if errors.Is(err, pgx.ErrNoRows) {
		return Session{}, ErrNotFound
	}
	if err != nil {
		return Session{}, fmt.Errorf("membaca sesi: %w", err)
	}
	return s, nil
}

// TouchSession mencatat aktivitas terakhir. Kegagalan di sini tidak boleh
// menggagalkan request: ini hanya informasi, bukan syarat keamanan.
func (d *DB) TouchSession(ctx context.Context, tokenHash []byte) {
	_, _ = d.pool.Exec(ctx, `UPDATE auth.sessions SET last_seen_at = now() WHERE token_hash = $1`, tokenHash)
}

func (d *DB) DeleteSession(ctx context.Context, tokenHash []byte) error {
	if _, err := d.pool.Exec(ctx, `DELETE FROM auth.sessions WHERE token_hash = $1`, tokenHash); err != nil {
		return fmt.Errorf("menghapus sesi: %w", err)
	}
	return nil
}

// DeleteExpiredSessions dipanggil berkala; tanpa ini tabel tumbuh tanpa batas.
func (d *DB) DeleteExpiredSessions(ctx context.Context) (int64, error) {
	tag, err := d.pool.Exec(ctx, `DELETE FROM auth.sessions WHERE expires_at < now()`)
	if err != nil {
		return 0, fmt.Errorf("membersihkan sesi kedaluwarsa: %w", err)
	}
	return tag.RowsAffected(), nil
}

func nullIfEmpty(s string) any {
	if s == "" {
		return nil
	}
	return s
}
