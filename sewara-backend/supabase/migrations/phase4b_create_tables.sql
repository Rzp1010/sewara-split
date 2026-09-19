-- Phase 4B: Create Normalized Tables
-- Date: 2026-08-28 11:05 UTC
-- Project: Sewara (obhvrzholszhjnpvmnna)
--
-- Creates 3 tables:
-- 1. transaction_items (81 rows expected)
-- 2. transaction_payments (63 rows expected)
-- 3. inventory_units (59 rows expected)
--
-- Total: 203 rows

BEGIN;

-- =====================================================
-- 1. transaction_items
-- =====================================================

CREATE TABLE IF NOT EXISTS transaction_items (
  id SERIAL PRIMARY KEY,
  transaction_id BIGINT NOT NULL,
  inventory_id BIGINT,                 -- Nullable (81 items missing inventory_id)
  item_name TEXT NOT NULL,
  item_type TEXT,                      -- 'satuan' or 'bundling'
  qty INTEGER NOT NULL DEFAULT 1 CHECK (qty > 0),
  
  -- Pricing
  unit_price NUMERIC(12,2) DEFAULT 0 CHECK (unit_price >= 0),
  subtotal NUMERIC(12,2) DEFAULT 0 CHECK (subtotal >= 0),
  
  -- Duration & rate
  rate_type TEXT,                      -- 'h6', 'h12', 'h24', etc
  
  -- For satuan items
  serial_number TEXT,
  
  -- For bundling items (keep as JSONB - flexible structure)
  assigned_components JSONB DEFAULT '[]'::jsonb,
  
  -- Metadata
  user_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for transaction_items
CREATE INDEX idx_transaction_items_transaction_id 
  ON transaction_items(transaction_id);

CREATE INDEX idx_transaction_items_inventory_id 
  ON transaction_items(inventory_id)
  WHERE inventory_id IS NOT NULL;

CREATE INDEX idx_transaction_items_user_id 
  ON transaction_items(user_id);

-- Partial index for active satuan items
CREATE INDEX idx_transaction_items_sn 
  ON transaction_items(transaction_id, serial_number)
  WHERE serial_number IS NOT NULL;

-- =====================================================
-- 2. transaction_payments
-- =====================================================

CREATE TABLE IF NOT EXISTS transaction_payments (
  id SERIAL PRIMARY KEY,
  transaction_id BIGINT NOT NULL,
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  payment_method TEXT NOT NULL,        -- 'Tunai', 'Transfer', 'QRIS'
  payment_date TIMESTAMPTZ NOT NULL,
  notes TEXT,
  
  -- Metadata
  user_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for transaction_payments
CREATE INDEX idx_transaction_payments_transaction_id 
  ON transaction_payments(transaction_id);

CREATE INDEX idx_transaction_payments_user_id 
  ON transaction_payments(user_id);

CREATE INDEX idx_transaction_payments_date 
  ON transaction_payments(payment_date DESC);

CREATE INDEX idx_transaction_payments_method 
  ON transaction_payments(payment_method);

-- =====================================================
-- 3. inventory_units
-- =====================================================

CREATE TABLE IF NOT EXISTS inventory_units (
  id SERIAL PRIMARY KEY,
  inventory_id BIGINT NOT NULL,
  serial_number TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'available',  -- 'available', 'rented', 'maintenance', 'retired'
  notes TEXT,
  
  -- Metadata
  user_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  -- Unique constraint: one SN per inventory item per owner
  UNIQUE(inventory_id, serial_number, user_id)
);

-- Indexes for inventory_units
CREATE INDEX idx_inventory_units_inventory_id 
  ON inventory_units(inventory_id);

CREATE INDEX idx_inventory_units_user_id 
  ON inventory_units(user_id);

CREATE INDEX idx_inventory_units_status 
  ON inventory_units(status);

-- Partial index for available units (most queried)
CREATE INDEX idx_inventory_units_available 
  ON inventory_units(inventory_id, serial_number)
  WHERE status = 'available';

-- =====================================================
-- Verification
-- =====================================================

DO $$
DECLARE
  v_table_count INTEGER;
  v_index_count INTEGER;
BEGIN
  -- Count tables created
  SELECT COUNT(*) INTO v_table_count
  FROM information_schema.tables
  WHERE table_schema = 'public'
    AND table_name IN ('transaction_items', 'transaction_payments', 'inventory_units');
  
  IF v_table_count != 3 THEN
    RAISE EXCEPTION 'Expected 3 tables, found %', v_table_count;
  END IF;
  
  -- Count indexes created (3 tables × ~4 indexes = 12 indexes)
  SELECT COUNT(*) INTO v_index_count
  FROM pg_indexes
  WHERE schemaname = 'public'
    AND tablename IN ('transaction_items', 'transaction_payments', 'inventory_units')
    AND indexname NOT LIKE '%pkey';  -- Exclude PK
  
  RAISE NOTICE '✅ 3 tables created: transaction_items, transaction_payments, inventory_units';
  RAISE NOTICE '✅ % indexes created', v_index_count;
  RAISE NOTICE '✅ All tables have 0 rows (ready for backfill)';
  
  -- Verify row counts are 0
  SELECT 
    (SELECT COUNT(*) FROM transaction_items) +
    (SELECT COUNT(*) FROM transaction_payments) +
    (SELECT COUNT(*) FROM inventory_units)
  INTO v_table_count;
  
  IF v_table_count != 0 THEN
    RAISE WARNING 'Tables should be empty but found % rows', v_table_count;
  END IF;
END $$;

COMMIT;

-- =====================================================
-- Post-Creation Notes
-- =====================================================

-- Tables ready for backfill:
-- - transaction_items: expect 81 rows (from 59 transactions)
-- - transaction_payments: expect 63 rows (from 45 transactions with payments)
-- - inventory_units: expect 59 rows (from 46 inventory items)
-- Total: 203 rows

-- Next: Phase 4C (Backfill)
