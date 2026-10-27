-- 0004_sessions.sql
-- Sesi login sendiri, menggantikan Supabase Auth, plus kolom kredensial di auth.users.
--
-- Token sesi adalah 32 byte acak yang dikirim ke klien sebagai cookie HttpOnly.
-- Yang disimpan di database hanya SHA-256-nya: kalau isi tabel bocor, token yang
-- ada di sana tidak bisa dipakai untuk login.
--
-- Tabel diletakkan di schema auth, bukan public, karena dua alasan:
--   1. Semantiknya identitas, bukan data bisnis.
--   2. Isinya tidak boleh terbaca lewat jalur RLS `authenticated`. Pemeriksaan sesi
--      terjadi SEBELUM identitas diketahui, jadi memang tidak mungkin memakai konteks
--      user. Aksesnya dibatasi lewat metode sempit di paket internal/db.

ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS encrypted_password text;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS email_confirmed_at timestamptz;

CREATE TABLE IF NOT EXISTS auth.sessions (
    token_hash   bytea PRIMARY KEY,
    user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at   timestamptz NOT NULL DEFAULT now(),
    last_seen_at timestamptz NOT NULL DEFAULT now(),
    expires_at   timestamptz NOT NULL,
    user_agent   text,
    ip           text
);

-- Untuk "keluarkan semua sesi user ini" saat ganti password atau akun dinonaktifkan.
CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON auth.sessions (user_id);

-- Untuk pembersihan berkala sesi kedaluwarsa.
CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON auth.sessions (expires_at);
