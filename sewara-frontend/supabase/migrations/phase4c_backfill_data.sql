-- Phase 4C: Backfill Normalized Tables from JSONB
-- Date: 2026-08-28 11:16 UTC
-- Project: Sewara (obhvrzholszhjnpvmnna)
--
-- Backfills:
-- 1. transaction_items (expect 81 rows from 59 transactions)
-- 2. transaction_payments (expect 63 rows from 45 transactions)
-- 3. inventory_units (expect 59 rows from 46 inventory)
--
-- Total: 203 rows

BEGIN;

-- =====================================================
-- 1. Backfill transaction_items
-- =====================================================

INSERT INTO transaction_items (
  transaction_id,
  inventory_id,
  item_name,
  item_type,
  qty,
  unit_price,
  subtotal,
  rate_type,
  serial_number,
  assigned_components,
  user_id,
  created_at,
  updated_at
)
SELECT 
  t.id as transaction_id,
  
  -- Handle missing inventory_id (use ref.inventory_id or NULL)
  CASE 
    WHEN item->>'inventory_id' IS NOT NULL THEN (item->>'inventory_id')::BIGINT
    WHEN item->'ref'->>'inventory_id' IS NOT NULL THEN (item->'ref'->>'inventory_id')::BIGINT
    ELSE NULL
  END as inventory_id,
  
  -- Item name (try multiple paths)
  COALESCE(
    item->>'nama',
    item->'ref'->>'nama',
    'Unknown Item'
  ) as item_name,
  
  -- Item type
  COALESCE(
    item->>'jenis',
    item->'ref'->>'jenis',
    'satuan'
  ) as item_type,
  
  -- Quantity
  COALESCE((item->>'qty')::INTEGER, 1) as qty,
  
  -- Pricing
  COALESCE((item->>'harga')::NUMERIC, 0) as unit_price,
  COALESCE((item->>'subtotal')::NUMERIC, 0) as subtotal,
  
  -- Rate type
  item->>'tarif' as rate_type,
  
  -- Serial number (for satuan)
  item->>'sn' as serial_number,
  
  -- Components (for bundling)
  COALESCE(item->'assignedSNs', '[]'::jsonb) as assigned_components,
  
  -- Metadata
  t.user_id,
  t.created_at,
  t.updated_at
FROM transactions t,
LATERAL jsonb_array_elements(t.items) AS item
WHERE t.items IS NOT NULL 
  AND jsonb_array_length(t.items) > 0;

-- =====================================================
-- 2. Backfill transaction_payments
-- =====================================================

INSERT INTO transaction_payments (
  transaction_id,
  amount,
  payment_method,
  payment_date,
  notes,
  user_id,
  created_at
)
SELECT 
  t.id as transaction_id,
  
  -- Amount
  COALESCE((payment->>'jumlah')::NUMERIC, 0) as amount,
  
  -- Payment method
  COALESCE(payment->>'metode', 'Tunai') as payment_method,
  
  -- Payment date (parse from tanggal or use transaction created_at)
  CASE 
    WHEN payment->>'tanggal' IS NOT NULL 
      AND payment->>'tanggal' != '' 
    THEN (payment->>'tanggal')::TIMESTAMPTZ
    ELSE t.created_at
  END as payment_date,
  
  -- Notes
  payment->>'catatan' as notes,
  
  -- Metadata
  t.user_id,
  t.created_at
FROM transactions t,
LATERAL jsonb_array_elements(t.pembayaran->'riwayatBayar') AS payment
WHERE t.pembayaran IS NOT NULL
  AND t.pembayaran->'riwayatBayar' IS NOT NULL
  AND jsonb_array_length(t.pembayaran->'riwayatBayar') > 0;

-- =====================================================
-- 3. Backfill inventory_units
-- =====================================================

INSERT INTO inventory_units (
  inventory_id,
  serial_number,
  status,
  notes,
  user_id,
  created_at,
  updated_at
)
SELECT 
  i.id as inventory_id,
  
  -- Serial number (extract from array)
  sn_element::text as serial_number,
  
  -- Status (default to available)
  'available' as status,
  
  -- Notes (empty for now)
  NULL as notes,
  
  -- Metadata
  i.user_id,
  i.created_at,
  i.updated_at
FROM inventory i,
LATERAL jsonb_array_elements_text(i.sns) AS sn_element
WHERE i.sns IS NOT NULL 
  AND jsonb_array_length(i.sns) > 0
ON CONFLICT (inventory_id, serial_number, user_id) DO NOTHING;

-- =====================================================
-- Verification
-- =====================================================

DO $$
DECLARE
  v_items_source INTEGER;
  v_items_target INTEGER;
  v_payments_source INTEGER;
  v_payments_target INTEGER;
  v_units_source INTEGER;
  v_units_target INTEGER;
BEGIN
  -- Verify transaction_items
  SELECT SUM(jsonb_array_length(items)) INTO v_items_source
  FROM transactions
  WHERE items IS NOT NULL AND jsonb_array_length(items) > 0;
  
  SELECT COUNT(*) INTO v_items_target FROM transaction_items;
  
  IF v_items_source != v_items_target THEN
    RAISE WARNING 'transaction_items mismatch! Source: %, Target: %', v_items_source, v_items_target;
  ELSE
    RAISE NOTICE '✅ transaction_items: % rows', v_items_target;
  END IF;
  
  -- Verify transaction_payments
  SELECT SUM(jsonb_array_length(pembayaran->'riwayatBayar')) INTO v_payments_source
  FROM transactions
  WHERE pembayaran->'riwayatBayar' IS NOT NULL 
    AND jsonb_array_length(pembayaran->'riwayatBayar') > 0;
  
  SELECT COUNT(*) INTO v_payments_target FROM transaction_payments;
  
  IF v_payments_source != v_payments_target THEN
    RAISE WARNING 'transaction_payments mismatch! Source: %, Target: %', v_payments_source, v_payments_target;
  ELSE
    RAISE NOTICE '✅ transaction_payments: % rows', v_payments_target;
  END IF;
  
  -- Verify inventory_units
  SELECT SUM(jsonb_array_length(sns)) INTO v_units_source
  FROM inventory
  WHERE sns IS NOT NULL AND jsonb_array_length(sns) > 0;
  
  SELECT COUNT(*) INTO v_units_target FROM inventory_units;
  
  IF v_units_source != v_units_target THEN
    RAISE WARNING 'inventory_units mismatch! Source: %, Target: %', v_units_source, v_units_target;
  ELSE
    RAISE NOTICE '✅ inventory_units: % rows', v_units_target;
  END IF;
  
  -- Check for NULL inventory_id in transaction_items (expected based on inspection)
  SELECT COUNT(*) INTO v_items_source
  FROM transaction_items
  WHERE inventory_id IS NULL;
  
  IF v_items_source > 0 THEN
    RAISE NOTICE '⚠️  % items have NULL inventory_id (expected from inspection)', v_items_source;
  END IF;
  
  -- Summary
  RAISE NOTICE '===================================';
  RAISE NOTICE 'Backfill Summary:';
  RAISE NOTICE '  transaction_items: % rows', v_items_target;
  RAISE NOTICE '  transaction_payments: % rows', v_payments_target;
  RAISE NOTICE '  inventory_units: % rows', v_units_target;
  RAISE NOTICE '  TOTAL: % rows', v_items_target + v_payments_target + v_units_target;
  RAISE NOTICE '===================================';
END $$;

COMMIT;

-- =====================================================
-- Post-Backfill Verification Queries
-- =====================================================

-- Run these after COMMIT to verify data:

-- 1. Check sample transaction_items
-- SELECT * FROM transaction_items ORDER BY created_at DESC LIMIT 5;

-- 2. Check sample transaction_payments
-- SELECT * FROM transaction_payments ORDER BY payment_date DESC LIMIT 5;

-- 3. Check sample inventory_units
-- SELECT * FROM inventory_units ORDER BY created_at DESC LIMIT 10;

-- 4. Check NULL inventory_id count
-- SELECT COUNT(*) FROM transaction_items WHERE inventory_id IS NULL;

-- 5. Verify row counts match
-- SELECT 
--   (SELECT COUNT(*) FROM transaction_items) as items,
--   (SELECT COUNT(*) FROM transaction_payments) as payments,
--   (SELECT COUNT(*) FROM inventory_units) as units,
--   (SELECT COUNT(*) FROM transaction_items) + 
--   (SELECT COUNT(*) FROM transaction_payments) + 
--   (SELECT COUNT(*) FROM inventory_units) as total;
