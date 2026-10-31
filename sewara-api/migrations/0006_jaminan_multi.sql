-- 0006_jaminan_multi.sql — jaminan sewa multi-select
-- cermin dari sewara-backend/supabase/migrations/20260930_jaminan_multi.sql
-- Di sewara-api, ledger dicatat oleh runner, bukan oleh INSERT di dalam file.

BEGIN;

ALTER TABLE public.transactions ALTER COLUMN jaminan_sewa TYPE jsonb USING (
  CASE
    WHEN jaminan_sewa IS NULL THEN NULL
    WHEN trim(jaminan_sewa) = '' THEN '[]'::jsonb
    WHEN jaminan_sewa ~ '^\s*\[' THEN jaminan_sewa::jsonb
    ELSE jsonb_build_array(jaminan_sewa)
  END
);

ALTER TABLE public.transactions ALTER COLUMN jaminan_sewa SET DEFAULT '[]'::jsonb;

ALTER TABLE public.transactions
  DROP CONSTRAINT IF EXISTS jaminan_sewa_is_array;
ALTER TABLE public.transactions
  ADD CONSTRAINT jaminan_sewa_is_array
  CHECK (jaminan_sewa IS NULL OR jsonb_typeof(jaminan_sewa) = 'array');

COMMENT ON COLUMN public.transactions.jaminan_sewa IS
  'Jenis jaminan sewa untuk transaksi, disimpan sebagai array JSON string. NULL berarti belum diisi; array kosong berarti tanpa jaminan.';

COMMIT;
