-- Phase 8 Step 3: Add NOT NULL + Defaults
-- Run after Step 2 succeeds

BEGIN;

-- NOT NULL constraints
ALTER TABLE transactions ALTER COLUMN penyewa SET NOT NULL;
ALTER TABLE transactions ALTER COLUMN status SET NOT NULL;
ALTER TABLE inventory ALTER COLUMN nama SET NOT NULL;
ALTER TABLE inventory ALTER COLUMN jenis SET NOT NULL;
ALTER TABLE members ALTER COLUMN nama SET NOT NULL;
ALTER TABLE member_types ALTER COLUMN nama SET NOT NULL;

-- Set enum defaults
ALTER TABLE transactions 
ALTER COLUMN status SET DEFAULT 'Booking'::enum_status_transaksi;

ALTER TABLE inventory 
ALTER COLUMN kondisi SET DEFAULT 'Baik'::enum_kondisi_inventory;

ALTER TABLE members 
ALTER COLUMN status SET DEFAULT 'aktif'::enum_status_aktif;

ALTER TABLE member_types 
ALTER COLUMN status SET DEFAULT 'aktif'::enum_status_aktif;

ALTER TABLE inventory_units 
ALTER COLUMN status SET DEFAULT 'available'::enum_status_unit;

ALTER TABLE transaction_payments 
ALTER COLUMN payment_method SET DEFAULT 'Tunai'::enum_metode_bayar;

COMMIT;
