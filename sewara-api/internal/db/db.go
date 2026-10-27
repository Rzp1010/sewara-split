// Package db adalah satu-satunya jalan ke Postgres.
//
// Aturan yang dijaga di sini: *pgxpool.Pool tidak pernah keluar dari paket ini.
// Kode di luar wajib lewat salah satu dari dua pintu:
//
//  1. InTenant — untuk seluruh data bisnis. Membuka transaksi, menurunkan role ke
//     `authenticated`, memasang konteks user, sehingga RLS berlaku.
//  2. Metode sempit untuk auth (session.go, identity.go) — dipakai sebelum identitas
//     diketahui, karena itu tidak bisa memakai konteks user.
//
// Kalau suatu saat ada handler yang butuh query yang tidak tercakup keduanya,
// jawabannya adalah menambah metode di sini, bukan mengekspos pool.
package db

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ErrNotFound dipakai supaya lapisan HTTP bisa membedakan "tidak ada" dari
// "database bermasalah" tanpa memeriksa pgx.ErrNoRows.
var ErrNotFound = errors.New("data tidak ditemukan")

type DB struct {
	pool *pgxpool.Pool
}

func Open(ctx context.Context, url string) (*DB, error) {
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		return nil, fmt.Errorf("DATABASE_URL tidak valid: %w", err)
	}

	// Batas eksplisit: VPS hanya 1 GB, dan Postgres punya max_connections terbatas.
	// Angka kecil membuat antrean terlihat sebagai latensi, bukan sebagai kehabisan memori.
	cfg.MaxConns = 10
	cfg.MinConns = 1
	cfg.MaxConnLifetime = 30 * time.Minute
	cfg.MaxConnIdleTime = 5 * time.Minute

	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("membuka pool koneksi: %w", err)
	}

	// Gagal cepat: konfigurasi database yang salah harus terlihat saat start,
	// bukan pada request pertama yang datang.
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("koneksi ke database: %w", err)
	}

	return &DB{pool: pool}, nil
}

func (d *DB) Close() { d.pool.Close() }

// Querier sengaja dibatasi ke tiga operasi yang memang dipakai handler.
// Transaksi dan kontrolnya tetap dipegang paket ini.
type Querier interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
}

// InTenant menjalankan fn di dalam satu transaksi dengan konteks user terpasang.
//
// Kenapa SET LOCAL, bukan SET: SET LOCAL hanya berlaku sampai transaksi selesai,
// jadi konteks tidak bisa tertinggal di koneksi pool dan terbawa ke request lain.
//
// Kenapa ini aman meski lupa dipakai: role `authenticated` tidak bisa melewati RLS,
// dan tanpa app.user_id, auth.uid() bernilai NULL sehingga policy tidak mencocokkan
// baris apa pun. Kelupaan menghasilkan nol baris, bukan kebocoran.
func (d *DB) InTenant(ctx context.Context, userID string, fn func(Querier) error) error {
	tx, err := d.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("memulai transaksi: %w", err)
	}
	// Rollback setelah Commit yang berhasil adalah no-op, jadi aman dipanggil selalu.
	defer func() { _ = tx.Rollback(ctx) }()

	if _, err := tx.Exec(ctx, "SELECT set_config('app.user_id', $1, true)", userID); err != nil {
		return fmt.Errorf("memasang konteks user: %w", err)
	}
	if _, err := tx.Exec(ctx, "SET LOCAL ROLE authenticated"); err != nil {
		return fmt.Errorf("menurunkan role ke authenticated: %w", err)
	}

	if err := fn(tx); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
