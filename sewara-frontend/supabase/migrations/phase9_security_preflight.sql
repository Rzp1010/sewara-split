-- ============================================================================
-- Phase 9 Security Preflight: read-only production schema audit
-- ============================================================================
-- Run against production database (Supabase SQL Editor or psql).
-- This file contains SELECT / WITH statements only. It does not modify schema,
-- data, RLS, policies, constraints, indexes, defaults, or types.
--
-- Expected interpretation:
--   * Type/default output is the production source of truth; do not infer types
--     from migration history. BIGINT IDs are returned without casts.
--   * mismatch_count and orphan_count should be zero before any integrity
--     migration. Non-zero rows require data repair or an explicit migration plan.
--   * Sample columns contain IDs only, never customer names, phones, addresses,
--     invoice details, or other sensitive fields.
--   * FK output shows exact catalog definitions, including composite keys.
--   * RLS output should show rowsecurity = true and expected policies for all
--     seven tables. Review policy definitions for tenant isolation, not only count.
--
-- Target tables: inventory, transactions, transaction_items,
-- transaction_payments, inventory_units, members, member_types.
-- ============================================================================

-- 1. Actual ID and tenant-column types, nullability, and defaults.
SELECT table_name,
       ordinal_position,
       column_name,
       data_type,
       udt_schema,
       udt_name,
       is_nullable,
       column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('inventory', 'transactions', 'transaction_items',
                     'transaction_payments', 'inventory_units', 'members',
                     'member_types')
  AND (column_name = 'id' OR column_name = 'user_id')
ORDER BY table_name, ordinal_position;

-- 2. Actual FK constraints and exact definitions on target tables.
SELECT n.nspname AS table_schema,
       child.relname AS table_name,
       con.conname AS constraint_name,
       pg_get_constraintdef(con.oid, true) AS constraint_definition,
       parent_ns.nspname AS referenced_schema,
       parent.relname AS referenced_table,
       CASE con.confupdtype WHEN 'a' THEN 'NO ACTION' WHEN 'r' THEN 'RESTRICT'
            WHEN 'c' THEN 'CASCADE' WHEN 'n' THEN 'SET NULL' WHEN 'd' THEN 'SET DEFAULT' END AS on_update,
       CASE con.confdeltype WHEN 'a' THEN 'NO ACTION' WHEN 'r' THEN 'RESTRICT'
            WHEN 'c' THEN 'CASCADE' WHEN 'n' THEN 'SET NULL' WHEN 'd' THEN 'SET DEFAULT' END AS on_delete
FROM pg_constraint con
JOIN pg_class child ON child.oid = con.conrelid
JOIN pg_namespace n ON n.oid = child.relnamespace
JOIN pg_class parent ON parent.oid = con.confrelid
JOIN pg_namespace parent_ns ON parent_ns.oid = parent.relnamespace
WHERE con.contype = 'f'
  AND n.nspname = 'public'
  AND child.relname IN ('inventory', 'transactions', 'transaction_items',
                        'transaction_payments', 'inventory_units', 'members',
                        'member_types')
ORDER BY child.relname, con.conname;

-- 3. Cross-tenant child/parent mismatches. Expected: every mismatch_count = 0.
WITH checks AS (
  SELECT 'transaction_items.user_id != transactions.user_id' AS check_name,
         ti.id AS child_id, ti.transaction_id AS parent_id
  FROM public.transaction_items ti JOIN public.transactions t ON t.id = ti.transaction_id
  WHERE ti.user_id IS DISTINCT FROM t.user_id
  UNION ALL
  SELECT 'transaction_items.user_id != inventory.user_id', ti.id, ti.inventory_id
  FROM public.transaction_items ti JOIN public.inventory i ON i.id = ti.inventory_id
  WHERE ti.inventory_id IS NOT NULL AND ti.user_id IS DISTINCT FROM i.user_id
  UNION ALL
  SELECT 'transaction_payments.user_id != transactions.user_id', tp.id, tp.transaction_id
  FROM public.transaction_payments tp JOIN public.transactions t ON t.id = tp.transaction_id
  WHERE tp.user_id IS DISTINCT FROM t.user_id
  UNION ALL
  SELECT 'inventory_units.user_id != inventory.user_id', iu.id, iu.inventory_id
  FROM public.inventory_units iu JOIN public.inventory i ON i.id = iu.inventory_id
  WHERE iu.user_id IS DISTINCT FROM i.user_id
  UNION ALL
  SELECT 'transactions.user_id != members.user_id', t.id, t.member_id
  FROM public.transactions t JOIN public.members m ON m.id = t.member_id
  WHERE t.member_id IS NOT NULL AND t.user_id IS DISTINCT FROM m.user_id
  UNION ALL
  SELECT 'members.user_id != member_types.user_id', m.id, m.tipe_id
  FROM public.members m JOIN public.member_types mt ON mt.id = m.tipe_id
  WHERE m.tipe_id IS NOT NULL AND m.user_id IS DISTINCT FROM mt.user_id
)
SELECT check_name, COUNT(*) AS mismatch_count,
       (ARRAY_AGG(child_id ORDER BY child_id) FILTER (WHERE child_id IS NOT NULL))[1:10] AS sample_child_ids,
       (ARRAY_AGG(parent_id ORDER BY parent_id) FILTER (WHERE parent_id IS NOT NULL))[1:10] AS sample_parent_ids
FROM checks GROUP BY check_name ORDER BY check_name;

-- 4. Orphans for same FK relationships. Expected: every orphan_count = 0.
WITH checks AS (
  SELECT 'transaction_items.transaction_id -> transactions.id' AS check_name, ti.id AS child_id
  FROM public.transaction_items ti LEFT JOIN public.transactions t ON t.id = ti.transaction_id WHERE t.id IS NULL
  UNION ALL
  SELECT 'transaction_items.inventory_id -> inventory.id', ti.id
  FROM public.transaction_items ti LEFT JOIN public.inventory i ON i.id = ti.inventory_id WHERE ti.inventory_id IS NOT NULL AND i.id IS NULL
  UNION ALL
  SELECT 'transaction_payments.transaction_id -> transactions.id', tp.id
  FROM public.transaction_payments tp LEFT JOIN public.transactions t ON t.id = tp.transaction_id WHERE t.id IS NULL
  UNION ALL
  SELECT 'inventory_units.inventory_id -> inventory.id', iu.id
  FROM public.inventory_units iu LEFT JOIN public.inventory i ON i.id = iu.inventory_id WHERE i.id IS NULL
  UNION ALL
  SELECT 'transactions.member_id -> members.id', t.id
  FROM public.transactions t LEFT JOIN public.members m ON m.id = t.member_id WHERE t.member_id IS NOT NULL AND m.id IS NULL
  UNION ALL
  SELECT 'members.tipe_id -> member_types.id', m.id
  FROM public.members m LEFT JOIN public.member_types mt ON mt.id = m.tipe_id WHERE m.tipe_id IS NOT NULL AND mt.id IS NULL
)
SELECT check_name, COUNT(*) AS orphan_count,
       (ARRAY_AGG(child_id ORDER BY child_id))[1:10] AS sample_child_ids
FROM checks GROUP BY check_name ORDER BY check_name;

-- 5. RLS enabled status and policy definitions.
SELECT schemaname, tablename, rowsecurity, false AS force_row_security
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('inventory', 'transactions', 'transaction_items', 'transaction_payments', 'inventory_units', 'members', 'member_types')
ORDER BY tablename;

SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('inventory', 'transactions', 'transaction_items', 'transaction_payments', 'inventory_units', 'members', 'member_types')
ORDER BY tablename, policyname;

-- 6. Existing unique constraints/indexes usable as tenant-aware FK targets.
SELECT ns.nspname AS schema_name, rel.relname AS table_name, idx.relname AS index_name,
       i.indisunique, i.indisprimary, pg_get_indexdef(i.indexrelid) AS index_definition
FROM pg_index i
JOIN pg_class rel ON rel.oid = i.indrelid
JOIN pg_class idx ON idx.oid = i.indexrelid
JOIN pg_namespace ns ON ns.oid = rel.relnamespace
WHERE ns.nspname = 'public'
  AND rel.relname IN ('inventory', 'transactions', 'transaction_items', 'transaction_payments', 'inventory_units', 'members', 'member_types')
  AND i.indisunique
ORDER BY rel.relname, idx.relname;

-- 7. Compact summary. Expected status = PASS for every row.
WITH summary AS (
  SELECT 'cross_tenant_mismatches' AS check_group, COUNT(*) AS failure_count FROM (
    SELECT ti.id FROM public.transaction_items ti JOIN public.transactions t ON t.id=ti.transaction_id WHERE ti.user_id IS DISTINCT FROM t.user_id
    UNION ALL SELECT ti.id FROM public.transaction_items ti JOIN public.inventory i ON i.id=ti.inventory_id WHERE ti.inventory_id IS NOT NULL AND ti.user_id IS DISTINCT FROM i.user_id
    UNION ALL SELECT tp.id FROM public.transaction_payments tp JOIN public.transactions t ON t.id=tp.transaction_id WHERE tp.user_id IS DISTINCT FROM t.user_id
    UNION ALL SELECT iu.id FROM public.inventory_units iu JOIN public.inventory i ON i.id=iu.inventory_id WHERE iu.user_id IS DISTINCT FROM i.user_id
    UNION ALL SELECT t.id FROM public.transactions t JOIN public.members m ON m.id=t.member_id WHERE t.member_id IS NOT NULL AND t.user_id IS DISTINCT FROM m.user_id
    UNION ALL SELECT m.id FROM public.members m JOIN public.member_types mt ON mt.id=m.tipe_id WHERE m.tipe_id IS NOT NULL AND m.user_id IS DISTINCT FROM mt.user_id
  ) x
  UNION ALL
  SELECT 'orphans', COUNT(*) FROM (
    SELECT ti.id FROM public.transaction_items ti LEFT JOIN public.transactions t ON t.id=ti.transaction_id WHERE t.id IS NULL
    UNION ALL SELECT ti.id FROM public.transaction_items ti LEFT JOIN public.inventory i ON i.id=ti.inventory_id WHERE ti.inventory_id IS NOT NULL AND i.id IS NULL
    UNION ALL SELECT tp.id FROM public.transaction_payments tp LEFT JOIN public.transactions t ON t.id=tp.transaction_id WHERE t.id IS NULL
    UNION ALL SELECT iu.id FROM public.inventory_units iu LEFT JOIN public.inventory i ON i.id=iu.inventory_id WHERE i.id IS NULL
    UNION ALL SELECT t.id FROM public.transactions t LEFT JOIN public.members m ON m.id=t.member_id WHERE t.member_id IS NOT NULL AND m.id IS NULL
    UNION ALL SELECT m.id FROM public.members m LEFT JOIN public.member_types mt ON mt.id=m.tipe_id WHERE m.tipe_id IS NOT NULL AND mt.id IS NULL
  ) x
)
SELECT check_group, failure_count, CASE WHEN failure_count = 0 THEN 'PASS' ELSE 'FAIL' END AS status
FROM summary ORDER BY check_group;
