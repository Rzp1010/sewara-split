-- ============================================================================
-- Phase 9 Verification Queries
-- ============================================================================
-- Run after executing phase9_saas_infrastructure.sql
-- Expected results noted in comments

-- 1. Count SaaS tables
SELECT COUNT(*) as saas_tables 
FROM information_schema.tables 
WHERE table_schema = 'public' AND table_name LIKE 'sewara_%';
-- Expected: 8

-- 2. Count permission tables
SELECT COUNT(*) as permission_tables 
FROM information_schema.tables 
WHERE table_schema = 'public' 
  AND table_name IN ('permissions', 'role_permissions', 'staff_permissions');
-- Expected: 3

-- 3. Count new enum types
SELECT COUNT(*) as new_enums
FROM pg_type 
WHERE typname IN ('enum_subscription_status', 'enum_subscription_event', 'enum_permission_category');
-- Expected: 3

-- 4. Total enum types (including Phase 8)
SELECT COUNT(*) as total_enums
FROM pg_type 
WHERE typname LIKE 'enum_%';
-- Expected: 9 (6 from Phase 8 + 3 from Phase 9)

-- 5. Verify default plans
SELECT id, name, slug, price_monthly, trial_days, display_order 
FROM sewara_plans 
ORDER BY display_order;
-- Expected: 3 rows (Starter, Pro, Business)

-- 6. Verify plan features per plan
SELECT p.name, COUNT(pf.id) as feature_count
FROM sewara_plans p
LEFT JOIN sewara_plan_features pf ON p.id = pf.plan_id
GROUP BY p.id, p.name
ORDER BY p.display_order;
-- Expected: Starter=5, Pro=5, Business=5

-- 7. Verify permissions by category
SELECT category, COUNT(*) as perm_count
FROM permissions 
GROUP BY category 
ORDER BY category;
-- Expected: inventory=4, member=4, report=2, setting=2, staff=4, transaction=4

-- 8. Verify role permissions count
SELECT role, COUNT(*) as perm_count
FROM role_permissions 
GROUP BY role 
ORDER BY role;
-- Expected: cs=8, gudang=5, owner=20, supervisor=17

-- 9. Verify RLS policies on new tables
SELECT tablename, COUNT(*) as policy_count
FROM pg_policies
WHERE schemaname = 'public'
  AND (tablename LIKE 'sewara_%' OR tablename IN ('permissions', 'role_permissions', 'staff_permissions'))
GROUP BY tablename
ORDER BY tablename;
-- Expected: ~18 policies total across 11 tables

-- 10. Test helper functions exist
SELECT proname 
FROM pg_proc 
WHERE proname IN ('has_permission', 'get_feature_limit');
-- Expected: 2 rows

-- 11. List all SaaS tables
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' AND table_name LIKE 'sewara_%'
ORDER BY table_name;
-- Expected: 8 tables

-- 12. List all permission tables
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
  AND table_name IN ('permissions', 'role_permissions', 'staff_permissions')
ORDER BY table_name;
-- Expected: 3 tables

-- 13. Sample plan data
SELECT * FROM sewara_plans ORDER BY display_order;

-- 14. Sample permissions
SELECT code, name, category FROM permissions ORDER BY category, code LIMIT 10;

-- 15. Check RLS enabled
SELECT tablename, rowsecurity 
FROM pg_tables 
WHERE schemaname = 'public' 
  AND (tablename LIKE 'sewara_%' OR tablename IN ('permissions', 'role_permissions', 'staff_permissions'))
ORDER BY tablename;
-- Expected: rowsecurity = true for all

-- ============================================================================
-- Summary Check (Run this last)
-- ============================================================================
SELECT 
  'SaaS Tables' as check_type,
  (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name LIKE 'sewara_%') as actual,
  8 as expected,
  CASE WHEN (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name LIKE 'sewara_%') = 8 THEN '✓ PASS' ELSE '✗ FAIL' END as status
UNION ALL
SELECT 
  'Permission Tables',
  (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('permissions', 'role_permissions', 'staff_permissions')),
  3,
  CASE WHEN (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('permissions', 'role_permissions', 'staff_permissions')) = 3 THEN '✓ PASS' ELSE '✗ FAIL' END
UNION ALL
SELECT 
  'New Enum Types',
  (SELECT COUNT(*) FROM pg_type WHERE typname IN ('enum_subscription_status', 'enum_subscription_event', 'enum_permission_category')),
  3,
  CASE WHEN (SELECT COUNT(*) FROM pg_type WHERE typname IN ('enum_subscription_status', 'enum_subscription_event', 'enum_permission_category')) = 3 THEN '✓ PASS' ELSE '✗ FAIL' END
UNION ALL
SELECT 
  'Default Plans',
  (SELECT COUNT(*) FROM sewara_plans),
  3,
  CASE WHEN (SELECT COUNT(*) FROM sewara_plans) = 3 THEN '✓ PASS' ELSE '✗ FAIL' END
UNION ALL
SELECT 
  'Default Permissions',
  (SELECT COUNT(*) FROM permissions),
  20,
  CASE WHEN (SELECT COUNT(*) FROM permissions) = 20 THEN '✓ PASS' ELSE '✗ FAIL' END
UNION ALL
SELECT 
  'Helper Functions',
  (SELECT COUNT(*) FROM pg_proc WHERE proname IN ('has_permission', 'get_feature_limit')),
  2,
  CASE WHEN (SELECT COUNT(*) FROM pg_proc WHERE proname IN ('has_permission', 'get_feature_limit')) = 2 THEN '✓ PASS' ELSE '✗ FAIL' END;
