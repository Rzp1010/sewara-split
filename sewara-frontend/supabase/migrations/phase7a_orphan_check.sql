-- Phase 7A: Orphan Detection Before Foreign Keys
-- Date: 2026-08-28 12:12 UTC
-- Project: Sewara (obhvrzholszhjnpvmnna)
--
-- Goal: Detect orphan rows before adding FK constraints
-- Duration: 10 minutes

-- =====================================================
-- 1. Check transaction_items orphans
-- =====================================================

-- 1.1 Items without valid transaction
SELECT 
  'transaction_items → transactions' as check_name,
  COUNT(*) as orphan_count
FROM transaction_items ti
WHERE NOT EXISTS (
  SELECT 1 FROM transactions t WHERE t.id = ti.transaction_id
);
-- Expected: 0

-- 1.2 Items without valid inventory (NULL allowed)
SELECT 
  'transaction_items → inventory' as check_name,
  COUNT(*) as orphan_count
FROM transaction_items ti
WHERE ti.inventory_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM inventory i WHERE i.id = ti.inventory_id
  );
-- Expected: 0

-- =====================================================
-- 2. Check transaction_payments orphans
-- =====================================================

SELECT 
  'transaction_payments → transactions' as check_name,
  COUNT(*) as orphan_count
FROM transaction_payments tp
WHERE NOT EXISTS (
  SELECT 1 FROM transactions t WHERE t.id = tp.transaction_id
);
-- Expected: 0

-- =====================================================
-- 3. Check inventory_units orphans
-- =====================================================

SELECT 
  'inventory_units → inventory' as check_name,
  COUNT(*) as orphan_count
FROM inventory_units iu
WHERE NOT EXISTS (
  SELECT 1 FROM inventory i WHERE i.id = iu.inventory_id
);
-- Expected: 0

-- =====================================================
-- 4. Check transactions.member_id orphans
-- =====================================================

SELECT 
  'transactions.member_id → members' as check_name,
  COUNT(*) as orphan_count
FROM transactions t
WHERE t.member_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM members m WHERE m.id = t.member_id
  );
-- Expected: 0

-- =====================================================
-- 5. Check members.tipe_id orphans
-- =====================================================

SELECT 
  'members.tipe_id → member_types' as check_name,
  COUNT(*) as orphan_count
FROM members m
WHERE m.tipe_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM member_types mt WHERE mt.id = m.tipe_id
  );
-- Expected: 0

-- =====================================================
-- 6. Summary Report
-- =====================================================

SELECT 
  'Total orphan checks' as metric,
  5 as checks_run,
  (
    SELECT COUNT(*) FROM transaction_items ti
    WHERE NOT EXISTS (SELECT 1 FROM transactions t WHERE t.id = ti.transaction_id)
  ) +
  (
    SELECT COUNT(*) FROM transaction_items ti
    WHERE ti.inventory_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM inventory i WHERE i.id = ti.inventory_id)
  ) +
  (
    SELECT COUNT(*) FROM transaction_payments tp
    WHERE NOT EXISTS (SELECT 1 FROM transactions t WHERE t.id = tp.transaction_id)
  ) +
  (
    SELECT COUNT(*) FROM inventory_units iu
    WHERE NOT EXISTS (SELECT 1 FROM inventory i WHERE i.id = iu.inventory_id)
  ) +
  (
    SELECT COUNT(*) FROM transactions t
    WHERE t.member_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM members m WHERE m.id = t.member_id)
  ) +
  (
    SELECT COUNT(*) FROM members m
    WHERE m.tipe_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM member_types mt WHERE mt.id = m.tipe_id)
  ) as total_orphans;

-- Expected: total_orphans = 0

-- =====================================================
-- 7. If orphans found, show details
-- =====================================================

-- Uncomment if needed to debug orphans:

-- SELECT 'Orphan transaction_items' as issue, ti.*
-- FROM transaction_items ti
-- WHERE NOT EXISTS (SELECT 1 FROM transactions t WHERE t.id = ti.transaction_id)
-- LIMIT 5;

-- SELECT 'Orphan transaction_payments' as issue, tp.*
-- FROM transaction_payments tp
-- WHERE NOT EXISTS (SELECT 1 FROM transactions t WHERE t.id = tp.transaction_id)
-- LIMIT 5;

-- SELECT 'Orphan inventory_units' as issue, iu.*
-- FROM inventory_units iu
-- WHERE NOT EXISTS (SELECT 1 FROM inventory i WHERE i.id = iu.inventory_id)
-- LIMIT 5;
