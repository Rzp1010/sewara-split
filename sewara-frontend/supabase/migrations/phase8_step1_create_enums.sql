-- Phase 8 Step 1: Create Enum Types ONLY
-- Run this first, verify success before next step

BEGIN;

CREATE TYPE enum_status_transaksi AS ENUM (
  'Booking', 
  'Disewa', 
  'Selesai', 
  'Belum Selesai', 
  'Dibatalkan'
);

CREATE TYPE enum_jenis_inventory AS ENUM (
  'satuan', 
  'bundling'
);

CREATE TYPE enum_metode_bayar AS ENUM (
  'Tunai', 
  'Transfer', 
  'QRIS'
);

CREATE TYPE enum_status_aktif AS ENUM (
  'aktif', 
  'nonaktif'
);

CREATE TYPE enum_status_unit AS ENUM (
  'available',
  'rented',
  'maintenance',
  'retired'
);

CREATE TYPE enum_kondisi_inventory AS ENUM (
  'Sangat Baik',
  'Baik',
  'Rusak Ringan',
  'Rusak Berat'
);

COMMIT;

-- Verify
SELECT typname FROM pg_type 
WHERE typname LIKE 'enum_%' 
  AND typnamespace = 'public'::regnamespace
ORDER BY typname;
-- Expected: 6 enum types
