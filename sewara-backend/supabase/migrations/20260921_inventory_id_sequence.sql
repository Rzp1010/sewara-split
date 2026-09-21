-- Migration: inventory_id_sequence
-- Tanggal: 2026-09-21
-- Bug: POST /api/inventory return 500 "duplicate key value violates unique constraint inventory_pkey"
-- Root-cause: inventory.id column_default = 0 (bukan auto-increment) -> semua insert dapat id=0
-- Project: obhvrzholszhjnpvmnna (Sewara)
-- Catatan: sudah dijalankan manual di SQL Editor production, file ini untuk replay ke DB lain (tester/backup)

CREATE SEQUENCE IF NOT EXISTS inventory_id_seq;

SELECT setval('inventory_id_seq', (SELECT COALESCE(MAX(id), 0) FROM inventory) + 1);

ALTER TABLE inventory ALTER COLUMN id SET DEFAULT nextval('inventory_id_seq');

ALTER SEQUENCE inventory_id_seq OWNED BY inventory.id;

-- Verify:
-- SELECT column_default FROM information_schema.columns
-- WHERE table_name = 'inventory' AND column_name = 'id';
-- Expected: nextval('inventory_id_seq'::regclass)
