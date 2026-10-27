package db

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

// AuthUser adalah bagian auth.users yang dibutuhkan proses login.
//
// EncryptedPassword boleh NULL: akun yang mendaftar lewat undangan atau login
// sosial belum tentu punya password. Pemanggil wajib memperlakukannya sebagai
// "tidak bisa login dengan password", bukan sebagai error database.
type AuthUser struct {
	ID                string
	Email             string
	EncryptedPassword *string
	EmailConfirmedAt  *time.Time
}

// AuthUserByEmail mencari kredensial berdasarkan email.
//
// Jalur sistem, bukan InTenant: auth.users tidak punya RLS dan memang dibaca
// sebelum identitas diketahui. Yang dikembalikan hanya kredensial; seluruh
// keputusan otorisasi tetap di lapisan atas.
func (d *DB) AuthUserByEmail(ctx context.Context, email string) (AuthUser, error) {
	var u AuthUser
	err := d.pool.QueryRow(ctx, `
		SELECT id::text, email, encrypted_password, email_confirmed_at
		FROM auth.users
		WHERE lower(email) = lower($1)
		LIMIT 1`, email).
		Scan(&u.ID, &u.Email, &u.EncryptedPassword, &u.EmailConfirmedAt)

	if errors.Is(err, pgx.ErrNoRows) {
		return AuthUser{}, ErrNotFound
	}
	if err != nil {
		return AuthUser{}, fmt.Errorf("membaca kredensial: %w", err)
	}
	return u, nil
}

// UpdatePasswordHash dipakai kalau hash lama perlu dinaikkan biayanya
// (rehash saat login). Belum dipanggil sampai terbukti perlu.
func (d *DB) UpdatePasswordHash(ctx context.Context, userID, hash string) error {
	if _, err := d.pool.Exec(ctx, `UPDATE auth.users SET encrypted_password = $2 WHERE id = $1::uuid`, userID, hash); err != nil {
		return fmt.Errorf("memperbarui hash password: %w", err)
	}
	return nil
}

// LoginProfile adalah potongan profiles yang menentukan boleh-tidaknya login.
// Field waktu memakai pointer supaya NULL tetap berarti "tidak ada penalti".
type LoginProfile struct {
	UserID          string
	OwnerID         *string
	Status          *string
	Active          bool
	SubscribedUntil *time.Time
	CooldownUntil   *time.Time
	LockedUntil     *time.Time
}

// LoadLoginProfile membaca profil lewat jalur tenant biasa.
//
// Profil dibaca sebelum password diverifikasi — sama seperti backend Next — jadi
// konteks user di sini belum membuktikan apa pun. Aman karena RLS hanya
// mengizinkan user membaca barisnya sendiri (atau bawahannya, kalau dia owner).
func (d *DB) LoadLoginProfile(ctx context.Context, userID string) (LoginProfile, error) {
	var p LoginProfile
	err := d.InTenant(ctx, userID, func(q Querier) error {
		return q.QueryRow(ctx, `
			SELECT user_id::text, owner_id::text, status, is_active,
			       subscribed_until, cooldown_until, locked_until
			FROM profiles
			WHERE user_id = $1::uuid`, userID).
			Scan(&p.UserID, &p.OwnerID, &p.Status, &p.Active,
				&p.SubscribedUntil, &p.CooldownUntil, &p.LockedUntil)
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return LoginProfile{}, ErrNotFound
	}
	if err != nil {
		return LoginProfile{}, fmt.Errorf("membaca profil login: %w", err)
	}
	return p, nil
}

// Tangga penalti, disalin dari lib/api/login-lockout.ts (PLAN_KEAMANAN_LOGIN Fitur A).
// Angka ini menentukan kapan akun didiamkan dan berapa lama; jangan diubah tanpa
// mengubah dokumen rencananya juga.
const (
	penaltyCooldownMulai = 3
	penaltyCooldownDua   = 6
	penaltyLockMulai     = 9
)

// RegisterLoginFailure mencatat satu percobaan gagal dan menerapkan tangga penalti.
//
// Dua langkah dalam satu transaksi: RPC menaikkan penghitung (dengan peluruhan 24
// jam), lalu Go memutuskan penaltinya. Pembagian ini disengaja — RPC yang sudah
// ada dipertahankan sebagai satu-satunya penulis failed_login, sedangkan ambang
// penalti tetap di kode supaya bisa dibaca dan diuji tanpa masuk ke database.
func (d *DB) RegisterLoginFailure(ctx context.Context, userID string) (int, error) {
	var failed int
	err := d.inSystemTx(ctx, func(tx pgx.Tx) error {
		if err := tx.QueryRow(ctx,
			`SELECT public.rpc_register_login_failure($1::uuid)`, userID).Scan(&failed); err != nil {
			return fmt.Errorf("menaikkan penghitung gagal login: %w", err)
		}

		switch {
		case failed >= penaltyLockMulai:
			_, err := tx.Exec(ctx, `
				UPDATE profiles
				SET locked_until = now() + interval '30 minutes', cooldown_until = NULL
				WHERE user_id = $1::uuid`, userID)
			return err
		case failed >= penaltyCooldownDua:
			_, err := tx.Exec(ctx, `
				UPDATE profiles
				SET cooldown_until = now() + interval '2 minutes'
				WHERE user_id = $1::uuid`, userID)
			return err
		case failed >= penaltyCooldownMulai:
			_, err := tx.Exec(ctx, `
				UPDATE profiles
				SET cooldown_until = now() + interval '1 minute'
				WHERE user_id = $1::uuid`, userID)
			return err
		}
		return nil
	})
	if err != nil {
		return failed, fmt.Errorf("mencatat kegagalan login: %w", err)
	}
	return failed, nil
}

// ResetLoginFailures dipanggil setelah login berhasil: semua penalti lunas.
func (d *DB) ResetLoginFailures(ctx context.Context, userID string) error {
	if _, err := d.pool.Exec(ctx, `
		UPDATE profiles
		SET failed_login = 0, last_failed_at = NULL, cooldown_until = NULL, locked_until = NULL
		WHERE user_id = $1::uuid`, userID); err != nil {
		return fmt.Errorf("mereset penalti login: %w", err)
	}
	return nil
}

// LoginLog adalah satu baris catatan percobaan login.
type LoginLog struct {
	Email     string
	OwnerID   *string
	Event     string // "login_gagal" atau "login_sukses"
	Detail    *string
	IP        string
	UserAgent string
}

// InsertLoginLog menulis jejak login. Tabel ini juga menjadi sumber pembatasan
// laju, jadi penulisan tidak boleh dilewati saat jalur gagal.
func (d *DB) InsertLoginLog(ctx context.Context, e LoginLog) error {
	_, err := d.pool.Exec(ctx, `
		INSERT INTO login_logs (email, owner_id, event, detail, ip, user_agent)
		VALUES ($1, $2::uuid, $3, $4, $5, $6)`,
		e.Email, e.OwnerID, e.Event, e.Detail, nullIfEmpty(e.IP), nullIfEmpty(e.UserAgent))
	if err != nil {
		return fmt.Errorf("menulis log login: %w", err)
	}
	return nil
}

// LoginFailureCounts adalah jumlah kegagalan dalam satu jendela waktu.
type LoginFailureCounts struct {
	IP    int
	Email int
}

// CountRecentLoginFailures menghitung kegagalan per IP dan per email dalam satu query.
//
// Satu query, bukan dua: keduanya membaca tabel dan jendela waktu yang sama.
// IP kosong (mis. request tanpa X-Forwarded-For) tidak mencocokkan baris apa pun.
func (d *DB) CountRecentLoginFailures(ctx context.Context, email, ip string, since time.Time) (LoginFailureCounts, error) {
	var c LoginFailureCounts
	err := d.pool.QueryRow(ctx, `
		SELECT count(*) FILTER (WHERE ip IS NOT NULL AND ip = $2),
		       count(*) FILTER (WHERE email = $3)
		FROM login_logs
		WHERE event = 'login_gagal' AND created_at >= $1`, since, ip, email).
		Scan(&c.IP, &c.Email)
	if err != nil {
		return LoginFailureCounts{}, fmt.Errorf("menghitung kegagalan login: %w", err)
	}
	return c, nil
}
