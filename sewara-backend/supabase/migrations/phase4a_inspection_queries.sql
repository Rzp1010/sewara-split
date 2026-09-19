-- Phase 4A: JSONB Inspection Queries
-- Date: 2026-08-28 10:54 UTC
-- Project: Sewara (obhvrzholszhjnpvmnna)
--
-- Goal: Understand current JSONB structure before normalization
-- Duration: 30 minutes
-- Run all queries in Supabase SQL Editor and paste results

-- =====================================================
-- 1. TRANSACTIONS.ITEMS Inspection
-- =====================================================

-- 1.1 Sample items JSONB (5 transactions)
SELECT 
  id,
  no_invoice,
  status,
  jsonb_pretty(items) as items_structure,
  jsonb_array_length(items) as item_count,
  created_at
FROM transactions
WHERE jsonb_array_length(items) > 0
ORDER BY created_at DESC
LIMIT 5;

-- 1.2 Total items count
SELECT 
  COUNT(*) as total_transactions,
  COUNT(*) FILTER (WHERE items IS NOT NULL AND jsonb_array_length(items) > 0) as transactions_with_items,
  SUM(jsonb_array_length(items)) as total_items,
  AVG(jsonb_array_length(items))::numeric(10,2) as avg_items_per_transaction,
  MAX(jsonb_array_length(items)) as max_items,
  MIN(jsonb_array_length(items)) as min_items
FROM transactions
WHERE items IS NOT NULL AND jsonb_array_length(items) > 0;

-- 1.3 Discover all keys in items
SELECT DISTINCT jsonb_object_keys(item) as item_keys
FROM transactions,
LATERAL jsonb_array_elements(items) AS item
ORDER BY item_keys;

-- 1.4 Edge cases: empty/NULL items
SELECT 
  'Empty items array' as case_type,
  COUNT(*) as count
FROM transactions 
WHERE items = '[]'::jsonb
UNION ALL
SELECT 
  'NULL items',
  COUNT(*)
FROM transactions 
WHERE items IS NULL;

-- 1.5 Check for missing critical fields
SELECT 
  'Missing inventory_id' as issue,
  COUNT(*) as count
FROM transactions t,
LATERAL jsonb_array_elements(t.items) AS item
WHERE item->>'inventory_id' IS NULL
  OR item->'ref'->>'inventory_id' IS NULL
UNION ALL
SELECT 
  'Missing qty',
  COUNT(*)
FROM transactions t,
LATERAL jsonb_array_elements(t.items) AS item
WHERE item->>'qty' IS NULL;

-- =====================================================
-- 2. TRANSACTIONS.PEMBAYARAN Inspection
-- =====================================================

-- 2.1 Sample pembayaran JSONB (5 transactions)
SELECT 
  id,
  no_invoice,
  jsonb_pretty(pembayaran) as pembayaran_structure,
  jsonb_array_length(pembayaran->'riwayatBayar') as payment_count,
  created_at
FROM transactions
WHERE pembayaran->'riwayatBayar' IS NOT NULL
  AND jsonb_array_length(pembayaran->'riwayatBayar') > 0
ORDER BY created_at DESC
LIMIT 5;

-- 2.2 Total payments count
SELECT 
  COUNT(*) as total_transactions,
  COUNT(*) FILTER (
    WHERE pembayaran->'riwayatBayar' IS NOT NULL 
      AND jsonb_array_length(pembayaran->'riwayatBayar') > 0
  ) as transactions_with_payments,
  SUM(jsonb_array_length(pembayaran->'riwayatBayar')) as total_payments,
  AVG(jsonb_array_length(pembayaran->'riwayatBayar'))::numeric(10,2) as avg_payments_per_transaction,
  MAX(jsonb_array_length(pembayaran->'riwayatBayar')) as max_payments
FROM transactions
WHERE pembayaran->'riwayatBayar' IS NOT NULL
  AND jsonb_array_length(pembayaran->'riwayatBayar') > 0;

-- 2.3 Discover all keys in riwayatBayar
SELECT DISTINCT jsonb_object_keys(payment) as payment_keys
FROM transactions,
LATERAL jsonb_array_elements(pembayaran->'riwayatBayar') AS payment
ORDER BY payment_keys;

-- 2.4 Payment methods distribution
SELECT 
  payment->>'metode' as payment_method,
  COUNT(*) as count,
  SUM((payment->>'jumlah')::numeric) as total_amount
FROM transactions,
LATERAL jsonb_array_elements(pembayaran->'riwayatBayar') AS payment
WHERE payment->>'metode' IS NOT NULL
GROUP BY payment->>'metode'
ORDER BY count DESC;

-- 2.5 Edge cases: empty/NULL pembayaran
SELECT 
  'NULL pembayaran' as case_type,
  COUNT(*) as count
FROM transactions 
WHERE pembayaran IS NULL
UNION ALL
SELECT 
  'Empty riwayatBayar',
  COUNT(*)
FROM transactions 
WHERE pembayaran->'riwayatBayar' = '[]'::jsonb
  OR jsonb_array_length(pembayaran->'riwayatBayar') = 0;

-- =====================================================
-- 3. INVENTORY.SNS Inspection
-- =====================================================

-- 3.1 Sample sns JSONB (10 items)
SELECT 
  id,
  nama,
  jenis,
  jsonb_pretty(sns) as sns_structure,
  jsonb_array_length(sns) as sn_count,
  created_at
FROM inventory
WHERE sns IS NOT NULL
  AND jsonb_array_length(sns) > 0
ORDER BY created_at DESC
LIMIT 10;

-- 3.2 Total serial numbers count
SELECT 
  COUNT(*) as total_inventory,
  COUNT(*) FILTER (WHERE sns IS NOT NULL AND jsonb_array_length(sns) > 0) as inventory_with_sns,
  SUM(jsonb_array_length(sns)) as total_serial_numbers,
  AVG(jsonb_array_length(sns))::numeric(10,2) as avg_sns_per_item,
  MAX(jsonb_array_length(sns)) as max_sns,
  MIN(jsonb_array_length(sns)) as min_sns
FROM inventory
WHERE sns IS NOT NULL AND jsonb_array_length(sns) > 0;

-- 3.3 SNS by jenis inventory
SELECT 
  jenis,
  COUNT(*) as inventory_count,
  SUM(jsonb_array_length(sns)) as total_sns,
  AVG(jsonb_array_length(sns))::numeric(10,2) as avg_sns
FROM inventory
WHERE sns IS NOT NULL AND jsonb_array_length(sns) > 0
GROUP BY jenis;

-- 3.4 Edge cases: empty/NULL sns
SELECT 
  'Empty sns array' as case_type,
  COUNT(*) as count
FROM inventory 
WHERE sns = '[]'::jsonb
UNION ALL
SELECT 
  'NULL sns',
  COUNT(*)
FROM inventory 
WHERE sns IS NULL;

-- 3.5 Check SNS data type (should be array of strings)
SELECT 
  id,
  nama,
  jsonb_typeof(sns) as sns_type,
  jsonb_typeof(sns->0) as first_element_type,
  sns->0 as first_sn
FROM inventory
WHERE sns IS NOT NULL
  AND jsonb_array_length(sns) > 0
LIMIT 5;

-- =====================================================
-- 4. Summary Statistics
-- =====================================================

SELECT 
  'Transactions with items' as metric,
  COUNT(*) as count
FROM transactions
WHERE items IS NOT NULL AND jsonb_array_length(items) > 0
UNION ALL
SELECT 
  'Transactions with payments',
  COUNT(*)
FROM transactions
WHERE pembayaran->'riwayatBayar' IS NOT NULL 
  AND jsonb_array_length(pembayaran->'riwayatBayar') > 0
UNION ALL
SELECT 
  'Inventory with serial numbers',
  COUNT(*)
FROM inventory
WHERE sns IS NOT NULL AND jsonb_array_length(sns) > 0
UNION ALL
SELECT 
  'Total items to normalize',
  SUM(jsonb_array_length(items))::bigint
FROM transactions
WHERE items IS NOT NULL AND jsonb_array_length(items) > 0
UNION ALL
SELECT 
  'Total payments to normalize',
  SUM(jsonb_array_length(pembayaran->'riwayatBayar'))::bigint
FROM transactions
WHERE pembayaran->'riwayatBayar' IS NOT NULL 
  AND jsonb_array_length(pembayaran->'riwayatBayar') > 0
UNION ALL
SELECT 
  'Total serial numbers to normalize',
  SUM(jsonb_array_length(sns))::bigint
FROM inventory
WHERE sns IS NOT NULL AND jsonb_array_length(sns) > 0;

-- =====================================================
-- Instructions
-- =====================================================

-- Run each query group (1-4) in Supabase SQL Editor
-- Copy results and paste to orchestrator
-- Focus on:
-- - Sample JSONB structures (1.1, 2.1, 3.1)
-- - Total counts (summary section 4)
-- - Edge cases (empty/NULL counts)
-- - Key discovery (item_keys, payment_keys)
