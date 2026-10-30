package db

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
)

// RegisterUser membuat akun owner baru berstatus menunggu persetujuan.
//
// Jalur sistem, bukan InTenant: dipanggil sebelum identitas diketahui. Kalau
// email sudah terdaftar, akun lama dibiarkan dan created=false supaya pemanggil
// tetap membalas sukses — paritas backend Next yang menyembunyikan duplikat
// (anti-enumeration).
//
// email_confirmed_at sengaja TIDAK diisi: verifikasi lewat token yang mengisi
// kolom itu belakangan.
func (d *DB) RegisterUser(ctx context.Context, email, passwordHash, namaLengkap, namaInvoice string) (userID string, created bool, err error) {
	err = d.inSystemTx(ctx, func(tx pgx.Tx) error {
		e := tx.QueryRow(ctx, `
			INSERT INTO auth.users (id, email, encrypted_password)
			VALUES (gen_random_uuid(), lower($1), $2)
			ON CONFLICT (email) DO NOTHING
			RETURNING id::text`, email, passwordHash).Scan(&userID)
		if errors.Is(e, pgx.ErrNoRows) {
			// Sudah ada: tidak ada baris baru yang dibuat.
			return nil
		}
		if e != nil {
			return e
		}
		created = true

		_, e = tx.Exec(ctx, `
			INSERT INTO profiles (user_id, email, role, nama_lengkap, username, nama_invoice, is_active, status, owner_id)
			VALUES ($1::uuid, $2, 'owner', $3, $4, $5, false, 'menunggu', NULL)
			ON CONFLICT (email) DO UPDATE SET user_id=EXCLUDED.user_id, role=EXCLUDED.role,
				nama_lengkap=EXCLUDED.nama_lengkap, username=EXCLUDED.username,
				nama_invoice=EXCLUDED.nama_invoice, is_active=EXCLUDED.is_active,
				status=EXCLUDED.status, owner_id=EXCLUDED.owner_id`,
			userID, email, namaLengkap, email, namaInvoice)
		return e
	})
	if err != nil {
		return "", false, fmt.Errorf("mendaftarkan user: %w", err)
	}
	return userID, created, nil
}

// ConfirmEmail menandai email sudah terverifikasi.
func (d *DB) ConfirmEmail(ctx context.Context, userID string) error {
	if _, err := d.pool.Exec(ctx, `UPDATE auth.users SET email_confirmed_at=now() WHERE id=$1::uuid`, userID); err != nil {
		return fmt.Errorf("mengonfirmasi email: %w", err)
	}
	return nil
}

// ReserveVerificationResend memanggil rate limiter di database
// (public.rpc_reserve_verification_resend). true = boleh kirim, false = kena
// limit. Tabel & RPC-nya sudah ada di baseline, jadi tidak ada migration baru.
func (d *DB) ReserveVerificationResend(ctx context.Context, email, ip string) (bool, error) {
	var allowed bool
	err := d.inSystemTx(ctx, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT public.rpc_reserve_verification_resend($1, $2)`, email, ip).Scan(&allowed)
	})
	if err != nil {
		return false, fmt.Errorf("reserve resend verifikasi: %w", err)
	}
	return allowed, nil
}
