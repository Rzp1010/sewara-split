-- Phase 8 Step 2: Apply Enums to Tables
-- Run after Step 1 succeeds

BEGIN;

-- transactions.status
ALTER TABLE transactions ALTER COLUMN status DROP DEFAULT;
ALTER TABLE transactions 
ALTER COLUMN status TYPE enum_status_transaksi 
USING status::enum_status_transaksi;

-- inventory.jenis
ALTER TABLE inventory DROP CONSTRAINT IF EXISTS inventory_jenis_check;
ALTER TABLE inventory ALTER COLUMN jenis DROP DEFAULT;
ALTER TABLE inventory 
ALTER COLUMN jenis TYPE enum_jenis_inventory 
USING jenis::enum_jenis_inventory;

-- inventory.kondisi
ALTER TABLE inventory ALTER COLUMN kondisi DROP DEFAULT;
ALTER TABLE inventory 
ALTER COLUMN kondisi TYPE enum_kondisi_inventory 
USING COALESCE(kondisi::enum_kondisi_inventory, 'Baik'::enum_kondisi_inventory);

-- transaction_payments.payment_method
ALTER TABLE transaction_payments ALTER COLUMN payment_method DROP DEFAULT;
ALTER TABLE transaction_payments 
ALTER COLUMN payment_method TYPE enum_metode_bayar 
USING payment_method::enum_metode_bayar;

-- members.status
ALTER TABLE members DROP CONSTRAINT IF EXISTS members_status_check;
ALTER TABLE members ALTER COLUMN status DROP DEFAULT;
ALTER TABLE members 
ALTER COLUMN status TYPE enum_status_aktif 
USING status::enum_status_aktif;

-- member_types.status
ALTER TABLE member_types DROP CONSTRAINT IF EXISTS member_templates_status_check;
ALTER TABLE member_types DROP CONSTRAINT IF EXISTS member_types_status_check;
ALTER TABLE member_types ALTER COLUMN status DROP DEFAULT;
ALTER TABLE member_types 
ALTER COLUMN status TYPE enum_status_aktif 
USING status::enum_status_aktif;

-- inventory_units.status
ALTER TABLE inventory_units ALTER COLUMN status DROP DEFAULT;
ALTER TABLE inventory_units 
ALTER COLUMN status TYPE enum_status_unit 
USING status::enum_status_unit;

COMMIT;
