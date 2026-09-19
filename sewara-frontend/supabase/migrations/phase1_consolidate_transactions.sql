-- ================================================================
-- PHASE 1: Konsolidasi Kolom Transactions (snake_case canonical)
-- Date: 27 Agustus 2026
-- Project: Sewara (obhvrzholszhjnpvmnna)
-- 
-- STRATEGI: Copy data dari camelCase → snake_case, lalu drop camelCase
-- BACKUP: preflight row count = 53 transactions
-- ================================================================

BEGIN;

-- ================================================================
-- STEP 1: Konsolidasi data camelCase → snake_case
-- ================================================================

-- 1. noInvoice → id_transaksi (keduanya text, aman)
UPDATE transactions
SET id_transaksi = COALESCE("noInvoice", id_transaksi)
WHERE "noInvoice" IS NOT NULL;

-- 2. hpPenyewa → hp_penyewa
UPDATE transactions
SET hp_penyewa = COALESCE("hpPenyewa", hp_penyewa)
WHERE "hpPenyewa" IS NOT NULL;

-- 3. alamatPenyewa → alamat_penyewa
UPDATE transactions
SET alamat_penyewa = COALESCE("alamatPenyewa", alamat_penyewa)
WHERE "alamatPenyewa" IS NOT NULL;

-- 4. jaminanSewa → jaminan_sewa
UPDATE transactions
SET jaminan_sewa = COALESCE("jaminanSewa", jaminan_sewa)
WHERE "jaminanSewa" IS NOT NULL;

-- 5. waktuAmbilRencana (text) → waktu_ambil_rencana (timestamptz)
-- HATI-HATI: konversi text ke timestamptz
UPDATE transactions
SET waktu_ambil_rencana = COALESCE(
  waktu_ambil_rencana,
  CASE 
    WHEN "waktuAmbilRencana" IS NOT NULL AND "waktuAmbilRencana" != '' 
    THEN "waktuAmbilRencana"::timestamptz 
    ELSE NULL 
  END
)
WHERE "waktuAmbilRencana" IS NOT NULL 
  AND "waktuAmbilRencana" != '';

-- 6. waktuKembaliRencana (text) → waktu_kembali_rencana (timestamptz)
UPDATE transactions
SET waktu_kembali_rencana = COALESCE(
  waktu_kembali_rencana,
  CASE 
    WHEN "waktuKembaliRencana" IS NOT NULL AND "waktuKembaliRencana" != '' 
    THEN "waktuKembaliRencana"::timestamptz 
    ELSE NULL 
  END
)
WHERE "waktuKembaliRencana" IS NOT NULL 
  AND "waktuKembaliRencana" != '';

-- 7. waktuAmbilAktual (text) → waktu_ambil_aktual (timestamptz)
UPDATE transactions
SET waktu_ambil_aktual = COALESCE(
  waktu_ambil_aktual,
  CASE 
    WHEN "waktuAmbilAktual" IS NOT NULL AND "waktuAmbilAktual" != '' 
    THEN "waktuAmbilAktual"::timestamptz 
    ELSE NULL 
  END
)
WHERE "waktuAmbilAktual" IS NOT NULL 
  AND "waktuAmbilAktual" != '';

-- 8. waktuKembaliAktual (text) → waktu_kembali_aktual (timestamptz)
UPDATE transactions
SET waktu_kembali_aktual = COALESCE(
  waktu_kembali_aktual,
  CASE 
    WHEN "waktuKembaliAktual" IS NOT NULL AND "waktuKembaliAktual" != '' 
    THEN "waktuKembaliAktual"::timestamptz 
    ELSE NULL 
  END
)
WHERE "waktuKembaliAktual" IS NOT NULL 
  AND "waktuKembaliAktual" != '';

-- 9. durasiTeks → durasi_teks
UPDATE transactions
SET durasi_teks = COALESCE("durasiTeks", durasi_teks)
WHERE "durasiTeks" IS NOT NULL;

-- 10. biayaDasar → biaya (atau buat kolom baru biaya_dasar?)
-- Cek: biaya sudah ada, biayaDasar juga ada
-- Strategi: biayaDasar lebih spesifik → copy ke biaya
UPDATE transactions
SET biaya = COALESCE("biayaDasar", biaya)
WHERE "biayaDasar" IS NOT NULL;

-- 11. dendaTambahan → denda
UPDATE transactions
SET denda = COALESCE("dendaTambahan", denda)
WHERE "dendaTambahan" IS NOT NULL;

-- 12. totalAkhir → buat kolom baru total_akhir (belum ada di snake_case)
ALTER TABLE transactions 
ADD COLUMN IF NOT EXISTS total_akhir numeric DEFAULT 0;

UPDATE transactions
SET total_akhir = COALESCE("totalAkhir", 0)
WHERE "totalAkhir" IS NOT NULL;

-- 13. noInvoice canonical → tambah kolom no_invoice
ALTER TABLE transactions 
ADD COLUMN IF NOT EXISTS no_invoice text;

UPDATE transactions
SET no_invoice = COALESCE("noInvoice", id_transaksi);

-- ================================================================
-- STEP 2: Verifikasi row count tidak berubah
-- ================================================================

DO $$
DECLARE
  expected_count INTEGER := 53;
  actual_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO actual_count FROM transactions;
  
  IF actual_count != expected_count THEN
    RAISE EXCEPTION 'Row count mismatch! Expected %, got %', expected_count, actual_count;
  END IF;
  
  RAISE NOTICE '✅ Row count verified: %', actual_count;
END $$;

-- ================================================================
-- STEP 3: Verifikasi data tidak NULL di kolom penting
-- ================================================================

DO $$
DECLARE
  null_no_invoice INTEGER;
  null_penyewa INTEGER;
  null_status INTEGER;
BEGIN
  SELECT COUNT(*) INTO null_no_invoice FROM transactions WHERE no_invoice IS NULL;
  SELECT COUNT(*) INTO null_penyewa FROM transactions WHERE penyewa IS NULL;
  SELECT COUNT(*) INTO null_status FROM transactions WHERE status IS NULL;
  
  IF null_no_invoice > 0 THEN
    RAISE WARNING '⚠️  % transactions dengan no_invoice NULL', null_no_invoice;
  END IF;
  
  IF null_penyewa > 0 THEN
    RAISE WARNING '⚠️  % transactions dengan penyewa NULL', null_penyewa;
  END IF;
  
  IF null_status > 0 THEN
    RAISE WARNING '⚠️  % transactions dengan status NULL', null_status;
  END IF;
  
  RAISE NOTICE '✅ Validation complete';
END $$;

-- ================================================================
-- STEP 4: Drop kolom camelCase (HATI-HATI!)
-- ================================================================

-- UNCOMMENT setelah verifikasi data aman di aplikasi
-- ALTER TABLE transactions DROP COLUMN IF EXISTS "noInvoice";
-- ALTER TABLE transactions DROP COLUMN IF EXISTS "hpPenyewa";
-- ALTER TABLE transactions DROP COLUMN IF EXISTS "alamatPenyewa";
-- ALTER TABLE transactions DROP COLUMN IF EXISTS "jaminanSewa";
-- ALTER TABLE transactions DROP COLUMN IF EXISTS "waktuAmbilRencana";
-- ALTER TABLE transactions DROP COLUMN IF EXISTS "waktuKembaliRencana";
-- ALTER TABLE transactions DROP COLUMN IF EXISTS "waktuAmbilAktual";
-- ALTER TABLE transactions DROP COLUMN IF EXISTS "waktuKembaliAktual";
-- ALTER TABLE transactions DROP COLUMN IF EXISTS "durasiTeks";
-- ALTER TABLE transactions DROP COLUMN IF EXISTS "biayaDasar";
-- ALTER TABLE transactions DROP COLUMN IF EXISTS "dendaTambahan";
-- ALTER TABLE transactions DROP COLUMN IF EXISTS "totalAkhir";
-- ALTER TABLE transactions DROP COLUMN IF EXISTS "riwayatDilayani";

-- ================================================================
-- STEP 5: Tambah kolom baru yang dibutuhkan
-- ================================================================

-- member_id untuk relasi ke members
ALTER TABLE transactions 
ADD COLUMN IF NOT EXISTS member_id bigint REFERENCES members(id) ON DELETE SET NULL;

-- created_by dan updated_by untuk audit
ALTER TABLE transactions 
ADD COLUMN IF NOT EXISTS created_by uuid;

ALTER TABLE transactions 
ADD COLUMN IF NOT EXISTS updated_by uuid;

-- ================================================================
-- STEP 6: Index untuk performa
-- ================================================================

CREATE INDEX IF NOT EXISTS idx_transactions_no_invoice 
ON transactions (no_invoice) 
WHERE no_invoice IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_transactions_member_id 
ON transactions (member_id) 
WHERE member_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_transactions_user_status 
ON transactions (user_id, status);

-- ================================================================
-- COMMIT
-- ================================================================

COMMIT;

-- ================================================================
-- POST-EXECUTION CHECKS
-- ================================================================

-- Jalankan manual setelah COMMIT untuk verifikasi:

-- 1. Cek row count
-- SELECT COUNT(*) FROM transactions;
-- Expected: 53

-- 2. Cek sample data
-- SELECT id, no_invoice, penyewa, status, waktu_ambil_rencana, total_akhir
-- FROM transactions 
-- ORDER BY created_at DESC 
-- LIMIT 5;

-- 3. Cek kolom camelCase masih ada (sebelum di-drop)
-- SELECT column_name 
-- FROM information_schema.columns 
-- WHERE table_name = 'transactions' 
--   AND column_name LIKE '%[A-Z]%'
-- ORDER BY column_name;

-- 4. Cek NULL values
-- SELECT 
--   COUNT(*) FILTER (WHERE no_invoice IS NULL) AS null_no_invoice,
--   COUNT(*) FILTER (WHERE penyewa IS NULL) AS null_penyewa,
--   COUNT(*) FILTER (WHERE total_akhir IS NULL) AS null_total
-- FROM transactions;
