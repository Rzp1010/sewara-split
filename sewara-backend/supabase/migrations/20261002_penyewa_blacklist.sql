-- Migration 2026-10-02: Blacklist Penyewa
--
-- TUJUAN:
--   Tabel public.penyewa_blacklist untuk menandai penyewa bermasalah per tenant.
--   Dipakai guard transaksi (POST /api/transactions, PATCH /api/transactions/[id]):
--   penyewa yang match nama/HP diblokir saat membuat/mengubah booking.
--   Foto jaminan mengikuti pola members.foto_jaminan (array [{label,path}], max 5).
--
-- CATATAN KONTRAK: transaksi_id & member_id bertipe uuid TANPA FK (snapshot asal,
--   bukan relasi). frontend mengirim nilai ini apa adanya.
--
-- RLS mengikuti pola members_access_own_or_owner (tenant: user_id = auth.uid()
--   ATAU owner_id tenant yang sama, profil aktif).
--
-- ATURAN LEDGER (AGENTS.md "Aturan DB"): file ini menutup dirinya dengan
--   INSERT INTO schema_migrations (filename) VALUES ('20261002_penyewa_blacklist.sql');
-- Jalankan UTUH di SQL Editor dev (produksi saat rilis).

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Tabel
-- ---------------------------------------------------------------------------
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

-- 2) RLS
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

-- 3) Constraint foto_jaminan: array, maks 5 (tiru foto_jaminan_array_check members).
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

-- 4) Index
CREATE INDEX IF NOT EXISTS penyewa_blacklist_user_idx
  ON public.penyewa_blacklist (user_id);
CREATE INDEX IF NOT EXISTS penyewa_blacklist_nama_lower_idx
  ON public.penyewa_blacklist (user_id, lower(nama));
CREATE INDEX IF NOT EXISTS penyewa_blacklist_hp_idx
  ON public.penyewa_blacklist (user_id, hp);

COMMIT;

-- ---------------------------------------------------------------------------
-- Ledger: catat migration ini (WAJIB, di luar transaksi).
-- ---------------------------------------------------------------------------
INSERT INTO schema_migrations (filename) VALUES ('20261002_penyewa_blacklist.sql');

-- ---------------------------------------------------------------------------
-- VERIFIKASI MANUAL (read-only, setelah COMMIT):
--   SELECT column_name, data_type FROM information_schema.columns
--   WHERE table_schema='public' AND table_name='penyewa_blacklist' ORDER BY ordinal_position;
--   SELECT indexname FROM pg_indexes WHERE tablename='penyewa_blacklist';
--   SELECT policyname FROM pg_policies WHERE tablename='penyewa_blacklist';
-- ---------------------------------------------------------------------------