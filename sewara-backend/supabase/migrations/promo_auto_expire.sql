-- Promo auto-expiry status. Safe additive migration; preserves existing RLS policies.
ALTER TABLE public.promo_codes
  DROP CONSTRAINT IF EXISTS promo_codes_status_check;

ALTER TABLE public.promo_codes
  ADD CONSTRAINT promo_codes_status_check
  CHECK (status IN ('aktif', 'nonaktif', 'expired'));

UPDATE public.promo_codes
SET status = 'expired'
WHERE status = 'aktif'
  AND ((berlaku_sampai IS NOT NULL AND now() >= berlaku_sampai)
    OR (kuota IS NOT NULL AND terpakai >= kuota));
