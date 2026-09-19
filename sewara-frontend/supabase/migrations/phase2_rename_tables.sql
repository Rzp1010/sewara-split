-- Phase 2: Rename Tables to Canonical Names
-- Date: 2026-08-28
-- Project: Sewara (obhvrzholszhjnpvmnna)
-- 
-- Changes:
-- 1. member_templates → member_types (more semantic)
-- 2. logs → activity_logs (avoid conflict with system logs)
--
-- Rollback: ALTER TABLE member_types RENAME TO member_templates;
--           ALTER TABLE activity_logs RENAME TO logs;

BEGIN;

-- =====================================================
-- 1. Rename member_templates → member_types
-- =====================================================

ALTER TABLE member_templates RENAME TO member_types;

-- Update sequence if exists
ALTER SEQUENCE IF EXISTS member_templates_id_seq 
  RENAME TO member_types_id_seq;

-- Update primary key constraint name
ALTER INDEX IF EXISTS member_templates_pkey 
  RENAME TO member_types_pkey;

-- Update foreign key constraint names (if any exist)
-- Note: Check information_schema.table_constraints for actual names
-- ALTER TABLE <referencing_table> RENAME CONSTRAINT <old_fk_name> TO <new_fk_name>;

-- =====================================================
-- 2. Rename logs → activity_logs
-- =====================================================

ALTER TABLE logs RENAME TO activity_logs;

-- Update sequence if exists
ALTER SEQUENCE IF EXISTS logs_id_seq 
  RENAME TO activity_logs_id_seq;

-- Update primary key constraint name
ALTER INDEX IF EXISTS logs_pkey 
  RENAME TO activity_logs_pkey;

-- Update indexes (check existing indexes first)
ALTER INDEX IF EXISTS idx_logs_user_id 
  RENAME TO idx_activity_logs_user_id;

ALTER INDEX IF EXISTS idx_logs_created_at 
  RENAME TO idx_activity_logs_created_at;

-- =====================================================
-- 3. Verification
-- =====================================================

DO $$
DECLARE
  mt_count INTEGER;
  log_count INTEGER;
  old_tables_exist INTEGER;
BEGIN
  -- Count rows in renamed tables
  SELECT COUNT(*) INTO mt_count FROM member_types;
  SELECT COUNT(*) INTO log_count FROM activity_logs;
  
  -- Check old table names don't exist
  SELECT COUNT(*) INTO old_tables_exist
  FROM information_schema.tables
  WHERE table_schema = 'public'
    AND table_name IN ('member_templates', 'logs');
  
  -- Verify expectations
  IF mt_count != 2 THEN
    RAISE EXCEPTION 'member_types row count mismatch! Expected 2, got %', mt_count;
  END IF;
  
  IF log_count != 140 THEN
    RAISE WARNING 'activity_logs row count changed. Expected 140, got %', log_count;
  END IF;
  
  IF old_tables_exist > 0 THEN
    RAISE EXCEPTION 'Old table names still exist! Check member_templates or logs';
  END IF;
  
  RAISE NOTICE '✅ member_types: % rows', mt_count;
  RAISE NOTICE '✅ activity_logs: % rows', log_count;
  RAISE NOTICE '✅ Old table names removed';
END $$;

COMMIT;

-- =====================================================
-- Post-Migration Notes
-- =====================================================

-- Next steps:
-- 1. Update application code:
--    - src/lib/db.js: member_templates → member_types, logs → activity_logs
--    - All dashboard pages using these tables
--    - API routes if any
-- 2. Test build: npm run build
-- 3. Test locally: npm run dev
-- 4. Deploy: npx vercel --prod --yes
