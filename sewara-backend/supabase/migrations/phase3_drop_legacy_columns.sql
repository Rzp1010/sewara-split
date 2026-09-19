-- Phase 3: Drop Legacy CamelCase Columns from Transactions
-- Date: 2026-08-28
-- Project: Sewara (obhvrzholszhjnpvmnna)
-- 
-- ⚠️ WARNING: This migration is IRREVERSIBLE
-- Backup recommended before execution
--
-- Changes:
-- Drop 12 legacy camelCase columns from transactions table
-- These columns were duplicates created in Phase 1 for backward compatibility
-- Application code now uses snake_case columns exclusively
--
-- Rollback: NONE (must restore from backup)

BEGIN;

-- =====================================================
-- Pre-flight: Verify snake_case columns exist
-- =====================================================

DO $$
DECLARE
  missing_columns TEXT[];
BEGIN
  -- Check all required snake_case columns exist
  SELECT ARRAY_AGG(col) INTO missing_columns
  FROM (
    VALUES 
      ('no_invoice'),
      ('hp_penyewa'),
      ('alamat_penyewa'),
      ('jaminan_sewa'),
      ('waktu_ambil_rencana'),
      ('waktu_kembali_rencana'),
      ('waktu_ambil_aktual'),
      ('waktu_kembali_aktual'),
      ('durasi_teks'),
      ('total_akhir')
  ) AS required(col)
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'transactions'
      AND column_name = required.col
  );
  
  IF array_length(missing_columns, 1) > 0 THEN
    RAISE EXCEPTION 'Missing required snake_case columns: %', missing_columns;
  END IF;
  
  RAISE NOTICE '✅ All snake_case columns verified';
END $$;

-- =====================================================
-- Drop Legacy CamelCase Columns
-- =====================================================

-- Drop 12 legacy columns
ALTER TABLE transactions DROP COLUMN IF EXISTS "noInvoice";
ALTER TABLE transactions DROP COLUMN IF EXISTS "hpPenyewa";
ALTER TABLE transactions DROP COLUMN IF EXISTS "alamatPenyewa";
ALTER TABLE transactions DROP COLUMN IF EXISTS "jaminanSewa";
ALTER TABLE transactions DROP COLUMN IF EXISTS "waktuAmbilRencana";
ALTER TABLE transactions DROP COLUMN IF EXISTS "waktuKembaliRencana";
ALTER TABLE transactions DROP COLUMN IF EXISTS "waktuAmbilAktual";
ALTER TABLE transactions DROP COLUMN IF EXISTS "waktuKembaliAktual";
ALTER TABLE transactions DROP COLUMN IF EXISTS "durasiTeks";
ALTER TABLE transactions DROP COLUMN IF EXISTS "biayaDasar";
ALTER TABLE transactions DROP COLUMN IF EXISTS "dendaTambahan";
ALTER TABLE transactions DROP COLUMN IF EXISTS "totalAkhir";

-- Note: riwayatDilayani is kept (JSONB, still used as-is)

-- =====================================================
-- Verification
-- =====================================================

DO $$
DECLARE
  row_count INTEGER;
  remaining_camel INTEGER;
BEGIN
  -- Verify row count unchanged
  SELECT COUNT(*) INTO row_count FROM transactions;
  
  IF row_count != 53 THEN
    RAISE WARNING 'Row count changed! Expected 53, got %', row_count;
  END IF;
  
  -- Verify camelCase columns are gone
  SELECT COUNT(*) INTO remaining_camel
  FROM information_schema.columns
  WHERE table_name = 'transactions'
    AND column_name IN (
      'noInvoice', 'hpPenyewa', 'alamatPenyewa', 'jaminanSewa',
      'waktuAmbilRencana', 'waktuKembaliRencana', 'waktuAmbilAktual', 'waktuKembaliAktual',
      'durasiTeks', 'biayaDasar', 'dendaTambahan', 'totalAkhir'
    );
  
  IF remaining_camel > 0 THEN
    RAISE EXCEPTION 'Some camelCase columns still exist! Count: %', remaining_camel;
  END IF;
  
  RAISE NOTICE '✅ transactions row count: %', row_count;
  RAISE NOTICE '✅ Legacy camelCase columns dropped: 12';
  RAISE NOTICE '✅ Remaining camelCase columns: 0';
END $$;

COMMIT;

-- =====================================================
-- Post-Migration Notes
-- =====================================================

-- Space saved: ~12 columns * 53 rows * avg 50 bytes = ~31 KB
-- (minimal, but cleaner schema)

-- Columns retained (canonical snake_case):
-- - no_invoice
-- - hp_penyewa
-- - alamat_penyewa
-- - jaminan_sewa
-- - waktu_ambil_rencana
-- - waktu_kembali_rencana
-- - waktu_ambil_aktual
-- - waktu_kembali_aktual
-- - durasi_teks
-- - total_akhir
-- - member_id (new in Phase 1)
-- - created_by (new in Phase 1)
-- - updated_by (new in Phase 1)

-- Next steps:
-- 1. Build test: npm run build
-- 2. Local test: npm run dev
-- 3. Deploy: git commit + npx vercel --prod --yes
