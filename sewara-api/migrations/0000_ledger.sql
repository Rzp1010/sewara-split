-- 0000_ledger.sql
-- Ledger migrasi untuk Postgres self-hosted. Nama tabel dan konvensi sama dengan
-- yang sudah dipakai di Supabase (AGENTS.md: setiap file migration mencatat dirinya).
-- Tidak ada perubahan skema yang boleh jalan tanpa file ini.

CREATE TABLE IF NOT EXISTS public.schema_migrations (
    filename   text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.schema_migrations (filename)
VALUES ('0000_ledger.sql')
ON CONFLICT (filename) DO NOTHING;
