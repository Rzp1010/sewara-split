-- 0002_grants.sql
-- Hak akses untuk role `authenticated`.
--
-- Kenapa perlu: di Supabase, GRANT ke `authenticated` sudah dipasang otomatis.
-- Di Postgres biasa tidak ada, sehingga tanpa file ini semua query sebagai
-- `authenticated` gagal dengan "permission denied" — dan uji RLS jadi tidak sah
-- karena penolakannya berasal dari izin, bukan dari policy.
--
-- Model yang dipakai sama dengan Supabase: role diberi izin penuh di level tabel,
-- lalu RLS yang menyaring baris. Aman secara default karena policy memakai
-- auth.uid(); kalau konteks request tidak diset, auth.uid() bernilai NULL dan
-- tidak ada baris yang cocok.

GRANT USAGE ON SCHEMA public TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;

-- Tabel dan sequence yang dibuat setelah migrasi ini juga harus ikut.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT USAGE, SELECT ON SEQUENCES TO authenticated;
