-- Ledger migrasi schema (anti-drift, lihat AGENTS.md "Aturan DB").
-- Tabel ini WAJIB ada di SEMUA project DB sewara (dev maupun produksi).
-- Tiap file migration yang dijalankan mengakhiri dirinya dengan
--   INSERT INTO schema_migrations (filename) VALUES ('<nama file>');
-- Status DB = isi tabel ini, bukan ingatan siapa pun.
--
-- Cara cek drift saat rilis:
--   SELECT filename FROM schema_migrations ORDER BY filename;   -- di DB produksi
-- bandingkan dengan daftar file di supabase/migrations/. Selisihnya = yang belum jalan.

BEGIN;

CREATE TABLE IF NOT EXISTS schema_migrations (
  filename   text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

COMMIT;

-- Ledger mencatat dirinya sendiri:
INSERT INTO schema_migrations (filename) VALUES ('20260928_schema_migrations_ledger.sql');
