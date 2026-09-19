-- Phase 8 Cleanup: Drop Existing Enums (if any from failed attempts)
-- Run this FIRST before running phase8_enums_optimizations.sql

BEGIN;

-- Drop enums if they exist (from failed previous attempts)
DROP TYPE IF EXISTS enum_status_transaksi CASCADE;
DROP TYPE IF EXISTS enum_jenis_inventory CASCADE;
DROP TYPE IF EXISTS enum_metode_bayar CASCADE;
DROP TYPE IF EXISTS enum_status_aktif CASCADE;
DROP TYPE IF EXISTS enum_status_unit CASCADE;
DROP TYPE IF EXISTS enum_kondisi_inventory CASCADE;

-- Verify all dropped
DO $$
DECLARE
  v_enum_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_enum_count
  FROM pg_type
  WHERE typname LIKE 'enum_%'
    AND typnamespace = 'public'::regnamespace;
  
  IF v_enum_count > 0 THEN
    RAISE WARNING 'Still have % enum types remaining', v_enum_count;
  ELSE
    RAISE NOTICE '✅ All enum types dropped, ready for clean Phase 8';
  END IF;
END $$;

COMMIT;
