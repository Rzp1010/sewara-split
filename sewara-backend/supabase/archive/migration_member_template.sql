-- =============================================================
-- MIGRATION MEMBER TEMPLATE (SEWARA)
-- Project: SEWARA (Supabase DB: obhvrzholszhjnpvmnna)
-- CARA: Dashboard Supabase -> project SEWARA -> SQL Editor -> paste -> Run
--
-- Efek:
--   - Tabel member_templates (tipe member: nama + diskon_persen, per-tenant)
--   - members + kolom tipe_id (referensi template; diskon dibaca LIVE dari template)
--   - RLS: pola access_own_or_owner + guard is_active (sama seperti members/promo_codes)
-- =============================================================

-- ============ 1. TABEL MEMBER TEMPLATES ============
CREATE TABLE IF NOT EXISTS public.member_templates (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id UUID NOT NULL,
  nama TEXT NOT NULL,
  diskon_persen NUMERIC NOT NULL DEFAULT 0 CHECK (diskon_persen >= 0 AND diskon_persen <= 100),
  status TEXT NOT NULL DEFAULT 'aktif' CHECK (status IN ('aktif', 'nonaktif')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.member_templates ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_member_templates_user_id ON public.member_templates (user_id);

DROP POLICY IF EXISTS "member_templates_access_own_or_owner" ON public.member_templates;
CREATE POLICY "member_templates_access_own_or_owner"
  ON public.member_templates FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE user_id = auth.uid() AND is_active)
    AND (user_id = auth.uid() OR user_id = (SELECT owner_id FROM profiles WHERE user_id = auth.uid()))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE user_id = auth.uid() AND is_active)
    AND (user_id = auth.uid() OR user_id = (SELECT owner_id FROM profiles WHERE user_id = auth.uid()))
  );

-- ============ 2. MEMBERS + KOLOM TIPE_ID ============
ALTER TABLE public.members ADD COLUMN IF NOT EXISTS tipe_id BIGINT;

-- ============ 3. GRANT ============
GRANT SELECT, INSERT, UPDATE, DELETE ON public.member_templates TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.member_templates_id_seq TO authenticated;