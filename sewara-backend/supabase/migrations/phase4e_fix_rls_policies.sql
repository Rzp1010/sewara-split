-- Phase 4E Hotfix: Add RLS Policies for Normalized Tables
-- Date: 2026-08-28 11:50 UTC
-- Issue: new row violates row-level security policy
-- 
-- Root cause: transaction_items, transaction_payments, inventory_units
-- created without RLS policies

BEGIN;

-- =====================================================
-- Enable RLS on normalized tables
-- =====================================================

ALTER TABLE transaction_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE transaction_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_units ENABLE ROW LEVEL SECURITY;

-- =====================================================
-- transaction_items policies
-- =====================================================

-- Allow authenticated users to read their own transaction items
CREATE POLICY "Users can view own transaction items"
  ON transaction_items
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Allow authenticated users to insert their own transaction items
CREATE POLICY "Users can insert own transaction items"
  ON transaction_items
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Allow authenticated users to update their own transaction items
CREATE POLICY "Users can update own transaction items"
  ON transaction_items
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Allow authenticated users to delete their own transaction items
CREATE POLICY "Users can delete own transaction items"
  ON transaction_items
  FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

-- =====================================================
-- transaction_payments policies
-- =====================================================

CREATE POLICY "Users can view own transaction payments"
  ON transaction_payments
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert own transaction payments"
  ON transaction_payments
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own transaction payments"
  ON transaction_payments
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can delete own transaction payments"
  ON transaction_payments
  FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

-- =====================================================
-- inventory_units policies
-- =====================================================

CREATE POLICY "Users can view own inventory units"
  ON inventory_units
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert own inventory units"
  ON inventory_units
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own inventory units"
  ON inventory_units
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can delete own inventory units"
  ON inventory_units
  FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

-- =====================================================
-- Verification
-- =====================================================

DO $$
DECLARE
  v_policies INTEGER;
BEGIN
  -- Count policies created (3 tables × 4 policies = 12)
  SELECT COUNT(*) INTO v_policies
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename IN ('transaction_items', 'transaction_payments', 'inventory_units');
  
  IF v_policies != 12 THEN
    RAISE WARNING 'Expected 12 policies, found %', v_policies;
  ELSE
    RAISE NOTICE '✅ 12 RLS policies created (4 per table)';
  END IF;
  
  -- Verify RLS enabled
  SELECT COUNT(*) INTO v_policies
  FROM pg_tables
  WHERE schemaname = 'public'
    AND tablename IN ('transaction_items', 'transaction_payments', 'inventory_units')
    AND rowsecurity = true;
  
  IF v_policies != 3 THEN
    RAISE EXCEPTION 'RLS not enabled on all tables!';
  ELSE
    RAISE NOTICE '✅ RLS enabled on 3 tables';
  END IF;
END $$;

COMMIT;

-- =====================================================
-- Post-Fix Notes
-- =====================================================

-- After running this:
-- 1. Refresh app (hard reload: Ctrl+Shift+R)
-- 2. Try create transaction again
-- 3. Should work without RLS error
