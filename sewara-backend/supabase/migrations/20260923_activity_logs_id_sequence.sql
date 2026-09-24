-- Migration: activity_logs_id_sequence
-- Tanggal: 2026-09-23
-- Bug: POST /api/logs return 500 "duplicate key value violates unique constraint activity_logs_pkey"
-- Root-cause: activity_logs.id column_default = 0 (bukan auto-increment) -> semua insert tanpa id dapat id=0
-- Dipicu fitur kondisi SN: dua log dibuat sekaligus (Masuk + Ubah Kondisi) -> bentrok.
-- Project: obhvrzholszhjnpvmnna (Sewara)
-- Pola sama dengan 20260921_inventory_id_sequence.sql

CREATE SEQUENCE IF NOT EXISTS public.activity_logs_id_seq;

SELECT setval('activity_logs_id_seq', (SELECT COALESCE(MAX(id), 0) FROM activity_logs) + 1);

ALTER TABLE activity_logs ALTER COLUMN id SET DEFAULT nextval('activity_logs_id_seq');

ALTER SEQUENCE activity_logs_id_seq OWNED BY activity_logs.id;

-- Verify:
-- SELECT column_default FROM information_schema.columns
-- WHERE table_name = 'activity_logs' AND column_name = 'id';
-- Expected: nextval('activity_logs_id_seq'::regclass)
