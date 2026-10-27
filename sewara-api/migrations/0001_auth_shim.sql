-- 0001_auth_shim.sql
-- Pengganti minimal untuk objek Supabase yang dipakai skema Sewara.
--
-- Kenapa ini ada: skema hasil dump memakai 97 referensi auth.uid(), 5 auth.jwt(),
-- 10 FK ke auth.users, dan 26 policy dengan role `authenticated`. Tanpa objek ini
-- skema tidak bisa dimuat di Postgres biasa.
--
-- Pendekatan: kita TIDAK menghapus policy. Kita memiliki schema `auth` sendiri dan
-- mengisi konteks request lewat GUC yang di-set oleh Go (SET LOCAL di dalam transaksi).
-- Dengan begitu seluruh aturan RLS tetap berfungsi sebagai lapis kedua isolasi.

CREATE SCHEMA IF NOT EXISTS auth;

-- Cermin minimal auth.users. Kolom tambahan (encrypted_password, email_confirmed_at)
-- ditambahkan di migrasi auth nanti saat migrasi akun dari Supabase.
CREATE TABLE IF NOT EXISTS auth.users (
    id         uuid PRIMARY KEY,
    email      text UNIQUE,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- Role yang dirujuk policy. NOLOGIN: tidak ada yang bisa login langsung.
DO $$
DECLARE
    r text;
BEGIN
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role']
    LOOP
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
            EXECUTE format('CREATE ROLE %I NOLOGIN', r);
        END IF;
    END LOOP;
END
$$;

-- auth.uid(): id user dari GUC app.user_id.
-- Go men-set ini dengan SET LOCAL di dalam transaksi yang sama dengan query,
-- sehingga tidak bocor antar request lewat koneksi pool.
CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
    SELECT nullif(current_setting('app.user_id', true), '')::uuid
$$;

-- auth.jwt(): payload minimal untuk percabangan role/service_role di RPC.
CREATE OR REPLACE FUNCTION auth.jwt()
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
    SELECT coalesce(nullif(current_setting('app.jwt', true), '')::jsonb, '{}'::jsonb)
$$;

INSERT INTO public.schema_migrations (filename)
VALUES ('0001_auth_shim.sql')
ON CONFLICT (filename) DO NOTHING;
