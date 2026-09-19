-- Phase 8: Create Enum Types and Optimize Data Types
-- Date: 2026-08-28 12:25 UTC (19:25 WIB)
-- Project: Sewara (obhvrzholszhjnpvmnna)
--
-- Creates enum types for static values
-- Optimizes data types (BIGINT → INT, etc)
-- Adds NOT NULL constraints where appropriate
-- Duration: 30 minutes

BEGIN;

-- =====================================================
-- 1. Create Enum Types
-- =====================================================

-- Transaction status
CREATE TYPE enum_status_transaksi AS ENUM (
  'Booking', 
  'Disewa', 
  'Selesai', 
  'Belum Selesai', 
  'Dibatalkan'
);

-- Inventory type
CREATE TYPE enum_jenis_inventory AS ENUM (
  'satuan', 
  'bundling'
);

-- Payment method
CREATE TYPE enum_metode_bayar AS ENUM (
  'Tunai', 
  'Transfer', 
  'QRIS'
);

-- Active status (for members, member_types, etc)
CREATE TYPE enum_status_aktif AS ENUM (
  'aktif', 
  'nonaktif'
);

-- Inventory unit status
CREATE TYPE enum_status_unit AS ENUM (
  'available',
  'rented',
  'maintenance',
  'retired'
);

-- Inventory condition
CREATE TYPE enum_kondisi_inventory AS ENUM (
  'Sangat Baik',
  'Baik',
  'Rusak Ringan',
  'Rusak Berat'
);

-- =====================================================
-- 2. Apply Enums to Existing Tables
-- =====================================================

-- transactions.status (drop default first, then change type)
ALTER TABLE transactions 
ALTER COLUMN status DROP DEFAULT;

ALTER TABLE transactions 
ALTER COLUMN status TYPE enum_status_transaksi 
USING status::enum_status_transaksi;

-- inventory.jenis (drop constraint + default first)
ALTER TABLE inventory 
DROP CONSTRAINT IF EXISTS inventory_jenis_check;

ALTER TABLE inventory 
ALTER COLUMN jenis DROP DEFAULT;

ALTER TABLE inventory 
ALTER COLUMN jenis TYPE enum_jenis_inventory 
USING jenis::enum_jenis_inventory;

-- inventory.kondisi (if column exists and has data)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'inventory' AND column_name = 'kondisi'
  ) THEN
    -- Drop default first
    ALTER TABLE inventory 
    ALTER COLUMN kondisi DROP DEFAULT;
    
    -- Then convert to enum
    ALTER TABLE inventory 
    ALTER COLUMN kondisi TYPE enum_kondisi_inventory 
    USING COALESCE(kondisi::enum_kondisi_inventory, 'Baik'::enum_kondisi_inventory);
  END IF;
END $$;

-- transaction_payments.payment_method (drop default first)
ALTER TABLE transaction_payments 
ALTER COLUMN payment_method DROP DEFAULT;

ALTER TABLE transaction_payments 
ALTER COLUMN payment_method TYPE enum_metode_bayar 
USING payment_method::enum_metode_bayar;

-- members.status (drop default + constraints first)
ALTER TABLE members 
DROP CONSTRAINT IF EXISTS members_status_check;

ALTER TABLE members 
ALTER COLUMN status DROP DEFAULT;

ALTER TABLE members 
ALTER COLUMN status TYPE enum_status_aktif 
USING status::enum_status_aktif;

-- member_types.status (drop OLD constraint name from when table was member_templates)
ALTER TABLE member_types 
DROP CONSTRAINT IF EXISTS member_templates_status_check;  -- OLD name

ALTER TABLE member_types 
DROP CONSTRAINT IF EXISTS member_types_status_check;  -- NEW name (just in case)

-- Then handle rest in DO block
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'member_types' AND column_name = 'status'
  ) THEN
    -- Drop default
    ALTER TABLE member_types 
    ALTER COLUMN status DROP DEFAULT;
    
    -- Convert to enum
    ALTER TABLE member_types 
    ALTER COLUMN status TYPE enum_status_aktif 
    USING status::enum_status_aktif;
  END IF;
END $$;

-- inventory_units.status (drop default first)
ALTER TABLE inventory_units 
ALTER COLUMN status DROP DEFAULT;

ALTER TABLE inventory_units 
ALTER COLUMN status TYPE enum_status_unit 
USING status::enum_status_unit;

-- =====================================================
-- 3. Optimize Data Types (BIGINT → INT)
-- =====================================================

-- Note: This is SAFE only if all ID values < 2.1 billion
-- Current max IDs are ~1.7 billion (timestamp-based IDs)
-- Skip for now to avoid risk - can be done later

-- Future optimization (not in this phase):
-- ALTER TABLE transactions ALTER COLUMN id TYPE INT4;
-- ALTER TABLE inventory ALTER COLUMN id TYPE INT4;
-- etc...

-- (BIGINT → INT optimization skipped for safety)

-- =====================================================
-- 4. Add NOT NULL Constraints
-- =====================================================

-- Critical fields that should never be NULL

-- transactions
ALTER TABLE transactions 
ALTER COLUMN penyewa SET NOT NULL;

ALTER TABLE transactions 
ALTER COLUMN status SET NOT NULL;

-- inventory
ALTER TABLE inventory 
ALTER COLUMN nama SET NOT NULL;

ALTER TABLE inventory 
ALTER COLUMN jenis SET NOT NULL;

-- members
ALTER TABLE members 
ALTER COLUMN nama SET NOT NULL;

-- member_types
ALTER TABLE member_types 
ALTER COLUMN nama SET NOT NULL;

-- transaction_items (already has NOT NULL from CREATE TABLE)
-- transaction_payments (already has NOT NULL from CREATE TABLE)
-- inventory_units (already has NOT NULL from CREATE TABLE)

-- =====================================================
-- 5. Add Default Values
-- =====================================================

-- transactions.status default
ALTER TABLE transactions 
ALTER COLUMN status SET DEFAULT 'Booking'::enum_status_transaksi;

-- inventory.kondisi default
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'inventory' AND column_name = 'kondisi'
  ) THEN
    ALTER TABLE inventory 
    ALTER COLUMN kondisi SET DEFAULT 'Baik'::enum_kondisi_inventory;
  END IF;
END $$;

-- members.status default
ALTER TABLE members 
ALTER COLUMN status SET DEFAULT 'aktif'::enum_status_aktif;

-- member_types.status default
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'member_types' AND column_name = 'status'
  ) THEN
    ALTER TABLE member_types 
    ALTER COLUMN status SET DEFAULT 'aktif'::enum_status_aktif;
  END IF;
END $$;

-- inventory_units.status default
ALTER TABLE inventory_units 
ALTER COLUMN status SET DEFAULT 'available'::enum_status_unit;

-- transaction_payments.payment_method default
ALTER TABLE transaction_payments 
ALTER COLUMN payment_method SET DEFAULT 'Tunai'::enum_metode_bayar;

-- =====================================================
-- Verification
-- =====================================================

DO $$
DECLARE
  v_enum_count INTEGER;
  v_not_null_count INTEGER;
BEGIN
  -- Count enum types created
  SELECT COUNT(*) INTO v_enum_count
  FROM pg_type
  WHERE typname LIKE 'enum_%'
    AND typnamespace = 'public'::regnamespace;
  
  IF v_enum_count < 6 THEN
    RAISE WARNING 'Expected at least 6 enum types, found %', v_enum_count;
  ELSE
    RAISE NOTICE '✅ % enum types created', v_enum_count;
  END IF;
  
  -- Count NOT NULL constraints on key tables
  SELECT COUNT(*) INTO v_not_null_count
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name IN ('transactions', 'inventory', 'members', 'member_types')
    AND column_name IN ('nama', 'penyewa', 'status', 'jenis')
    AND is_nullable = 'NO';
  
  RAISE NOTICE '✅ % critical columns set to NOT NULL', v_not_null_count;
  
  -- List enum types
  RAISE NOTICE '===================================';
  RAISE NOTICE 'Enum Types:';
  FOR v_enum_count IN 
    SELECT typname 
    FROM pg_type 
    WHERE typname LIKE 'enum_%' 
      AND typnamespace = 'public'::regnamespace
    ORDER BY typname
  LOOP
    -- List iteration
  END LOOP;
  RAISE NOTICE '===================================';
END $$;

COMMIT;

-- =====================================================
-- Post-Phase Notes
-- =====================================================

-- Enum types applied to:
-- - transactions.status → enum_status_transaksi
-- - inventory.jenis → enum_jenis_inventory
-- - inventory.kondisi → enum_kondisi_inventory
-- - transaction_payments.payment_method → enum_metode_bayar
-- - members.status → enum_status_aktif
-- - member_types.status → enum_status_aktif
-- - inventory_units.status → enum_status_unit

-- Benefits:
-- - Type safety (invalid values rejected at DB level)
-- - Better query performance (indexed enums)
-- - Self-documenting schema
-- - Smaller storage (enum = 4 bytes vs TEXT)

-- Next: Phase 8D (Final test + deploy)
