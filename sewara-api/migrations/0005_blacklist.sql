-- 0005_blacklist.sql — tabel penyewa_blacklist untuk staging Go
--
-- Diambil dari sewara-backend/supabase/migrations/20261002_penyewa_blacklist.sql.
-- Di sewara-api, ledger dicatat oleh runner (scripts/docker-staging.ps1), bukan
-- oleh INSERT di dalam file. Lihat AGENTS.md §aturan DB pengecualian 2026-10-27.

BEGIN;

CREATE TABLE IF NOT EXISTS public.penyewa_blacklist (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL,
  nama          text NOT NULL,
  hp            text,
  alamat        text,
  alasan        text NOT NULL,
  transaksi_id  uuid,
  member_id     uuid,
  foto_jaminan  jsonb DEFAULT '[]'::jsonb,
  added_by      uuid,
  created_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.penyewa_blacklist ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "penyewa_blacklist_access_own_or_owner" ON public.penyewa_blacklist;
CREATE POLICY "penyewa_blacklist_access_own_or_owner"
  ON public.penyewa_blacklist FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.user_id = auth.uid() AND profiles.is_active)
    AND (user_id = auth.uid() OR user_id = (SELECT profiles.owner_id FROM profiles WHERE profiles.user_id = auth.uid()))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.user_id = auth.uid() AND profiles.is_active)
    AND (user_id = auth.uid() OR user_id = (SELECT profiles.owner_id FROM profiles WHERE profiles.user_id = auth.uid()))
  );

ALTER TABLE public.penyewa_blacklist
  DROP CONSTRAINT IF EXISTS penyewa_blacklist_foto_array_check;
ALTER TABLE public.penyewa_blacklist
  ADD CONSTRAINT penyewa_blacklist_foto_array_check
  CHECK (
    foto_jaminan IS NULL OR (
      jsonb_typeof(foto_jaminan) = 'array'
      AND jsonb_array_length(foto_jaminan) <= 5
    )
  );

CREATE INDEX IF NOT EXISTS penyewa_blacklist_user_idx
  ON public.penyewa_blacklist (user_id);
CREATE INDEX IF NOT EXISTS penyewa_blacklist_nama_lower_idx
  ON public.penyewa_blacklist (user_id, lower(nama));
CREATE INDEX IF NOT EXISTS penyewa_blacklist_hp_idx
  ON public.penyewa_blacklist (user_id, hp);

COMMIT;
