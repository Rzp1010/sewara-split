-- 0010_pelanggan_email.sql — email pelanggan.
-- Ledger dicatat runner staging-db.ps1, bukan di migration (pengecualian §7).
BEGIN;
ALTER TABLE public.pelanggan ADD COLUMN IF NOT EXISTS email text NOT NULL DEFAULT '';
COMMIT;
