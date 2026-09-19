-- =============================================================
-- MIGRATION MEMBER & KODE PROMO (SEWARA)
-- Project: SEWARA (Supabase DB: obhvrzholszhjnpvmnna)
-- CARA: Dashboard Supabase -> project SEWARA -> SQL Editor -> paste -> Run
--
-- Efek:
--   - Tabel members (per-tenant via user_id = owner id)
--   - Tabel promo_codes (per-tenant via user_id = owner id)
--   - transactions + kolom diskon JSONB (rincian potongan utk audit)
--   - RLS: pola access_own_or_owner (staf baca data owner, owner baca sendiri)
-- =============================================================

-- ============ 1. TABEL MEMBERS ============
CREATE TABLE IF NOT EXISTS public.members (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id UUID NOT NULL,
  nama TEXT NOT NULL,
  hp TEXT NOT NULL DEFAULT '',
  alamat TEXT NOT NULL DEFAULT '',
  diskon_persen NUMERIC NOT NULL DEFAULT 0 CHECK (diskon_persen >= 0 AND diskon_persen <= 100),
  status TEXT NOT NULL DEFAULT 'aktif' CHECK (status IN ('aktif', 'nonaktif')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.members ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_members_user_id ON public.members (user_id);

DROP POLICY IF EXISTS "members_access_own_or_owner" ON public.members;
CREATE POLICY "members_access_own_or_owner"
  ON public.members FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE user_id = auth.uid() AND is_active)
    AND (user_id = auth.uid() OR user_id = (SELECT owner_id FROM profiles WHERE user_id = auth.uid()))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE user_id = auth.uid() AND is_active)
    AND (user_id = auth.uid() OR user_id = (SELECT owner_id FROM profiles WHERE user_id = auth.uid()))
  );

-- ============ 2. TABEL PROMO CODES ============
CREATE TABLE IF NOT EXISTS public.promo_codes (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id UUID NOT NULL,
  kode TEXT NOT NULL,
  diskon_persen NUMERIC NOT NULL DEFAULT 0 CHECK (diskon_persen >= 0 AND diskon_persen <= 100),
  berlaku_dari TIMESTAMPTZ,
  berlaku_sampai TIMESTAMPTZ,
  kuota INT,
  terpakai INT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'aktif' CHECK (status IN ('aktif', 'nonaktif')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT promo_codes_user_kode UNIQUE (user_id, kode)
);

ALTER TABLE public.promo_codes ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_promo_codes_user_id ON public.promo_codes (user_id);

DROP POLICY IF EXISTS "promo_codes_access_own_or_owner" ON public.promo_codes;
CREATE POLICY "promo_codes_access_own_or_owner"
  ON public.promo_codes FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE user_id = auth.uid() AND is_active)
    AND (user_id = auth.uid() OR user_id = (SELECT owner_id FROM profiles WHERE user_id = auth.uid()))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE user_id = auth.uid() AND is_active)
    AND (user_id = auth.uid() OR user_id = (SELECT owner_id FROM profiles WHERE user_id = auth.uid()))
  );

-- ============ 3. TRANSACTIONS + KOLOM DISKON ============
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS diskon JSONB;

-- ============ 4. GRANT (default aman: tabel baru hanya authenticated via RLS) ============
GRANT SELECT, INSERT, UPDATE, DELETE ON public.members TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.promo_codes TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.members_id_seq TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.promo_codes_id_seq TO authenticated;