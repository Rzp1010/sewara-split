-- ============================================================
-- FITUR LOG AKTIVITAS: kolom pelayan + trx_info (penyewa & no invoice)
-- DB redesign: uniscegyqyqnvmuxnfsr
-- Tanggal: 2026-08-10
-- Idempotent (aman dijalankan ulang)
-- ============================================================

ALTER TABLE logs ADD COLUMN IF NOT EXISTS pelayan TEXT;
ALTER TABLE logs ADD COLUMN IF NOT EXISTS trx_info TEXT;

NOTIFY pgrst, 'reload schema';
