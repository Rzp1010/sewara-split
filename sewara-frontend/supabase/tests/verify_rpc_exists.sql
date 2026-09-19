-- ================================================================
-- VERIFICATION: Check RPC function save_transaction_atomic exists
-- Database: obhvrzholszhjnpvmnna (sewara-apps)
-- Date: 2026-09-05
-- ================================================================

-- 1. Check if function exists in pg_proc
SELECT 
  p.proname AS function_name,
  n.nspname AS schema_name,
  pg_get_function_identity_arguments(p.oid) AS arguments,
  CASE p.provolatile
    WHEN 'i' THEN 'IMMUTABLE'
    WHEN 's' THEN 'STABLE'
    WHEN 'v' THEN 'VOLATILE'
  END AS volatility,
  CASE p.prosecdef
    WHEN true THEN 'SECURITY DEFINER'
    WHEN false THEN 'SECURITY INVOKER'
  END AS security,
  p.proacl AS acl_permissions
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public'
  AND p.proname LIKE '%transaction%'
ORDER BY p.proname;

-- 2. Check function definition if exists
SELECT 
  routine_name,
  routine_type,
  routine_definition
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name LIKE '%transaction%';

-- 3. List all available RPC functions (PostgREST cache)
SELECT 
  p.proname AS function_name,
  pg_get_function_identity_arguments(p.oid) AS arguments
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public'
  AND p.prokind = 'f'  -- functions only (not procedures)
ORDER BY p.proname;

-- 4. Check migration history
SELECT 
  version,
  name,
  executed_at
FROM supabase_migrations.schema_migrations
WHERE name LIKE '%transaction%'
   OR name LIKE '%phase2c%'
ORDER BY executed_at DESC;
