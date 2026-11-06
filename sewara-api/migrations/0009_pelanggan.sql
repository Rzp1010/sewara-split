-- 0009_pelanggan.sql — tabel pelanggan (pool penyewa) untuk staging Go
--
-- Diambil dari sewara-backend/supabase/migrations/20261106_pelanggan.sql
-- (DDL identik). Di sewara-api, ledger dicatat oleh runner
-- (scripts/docker-staging.ps1), bukan oleh INSERT di dalam file.
-- Lihat AGENTS.md §aturan DB pengecualian 2026-10-27.

BEGIN;

CREATE TABLE IF NOT EXISTS public.pelanggan (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     uuid NOT NULL,
  nama        text NOT NULL,
  hp          text NOT NULL DEFAULT '',
  hp_normal   text NOT NULL DEFAULT '',
  alamat      text NOT NULL DEFAULT '',
  catatan     text NOT NULL DEFAULT '',
  foto        jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.pelanggan ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pelanggan_access_own_or_owner" ON public.pelanggan;
CREATE POLICY "pelanggan_access_own_or_owner"
  ON public.pelanggan FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.user_id = auth.uid() AND profiles.is_active)
    AND (user_id = auth.uid() OR user_id = (SELECT profiles.owner_id FROM profiles WHERE profiles.user_id = auth.uid()))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.user_id = auth.uid() AND profiles.is_active)
    AND (user_id = auth.uid() OR user_id = (SELECT profiles.owner_id FROM profiles WHERE profiles.user_id = auth.uid()))
  );

ALTER TABLE public.pelanggan
  DROP CONSTRAINT IF EXISTS pelanggan_foto_array_check;
ALTER TABLE public.pelanggan
  ADD CONSTRAINT pelanggan_foto_array_check
  CHECK (
    foto IS NULL OR (
      jsonb_typeof(foto) = 'array'
      AND jsonb_array_length(foto) <= 5
    )
  );

CREATE UNIQUE INDEX IF NOT EXISTS pelanggan_hp_uniq
  ON public.pelanggan (user_id, hp_normal)
  WHERE hp_normal <> '';

CREATE UNIQUE INDEX IF NOT EXISTS pelanggan_nama_uniq
  ON public.pelanggan (user_id, lower(btrim(nama)))
  WHERE hp_normal = '';

CREATE INDEX IF NOT EXISTS pelanggan_user_idx
  ON public.pelanggan (user_id);

CREATE INDEX IF NOT EXISTS pelanggan_nama_lower_idx
  ON public.pelanggan (user_id, lower(nama));

COMMIT;

-- Ledger TIDAK ditulis di sini (pengecualian §7); runner staging-db.ps1 mencatatnya.
