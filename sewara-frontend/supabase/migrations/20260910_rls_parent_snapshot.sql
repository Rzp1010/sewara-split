-- =====================================================================
-- SNAPSHOT: RLS policies tabel parent DB sewara (obhvrzholszhjnpvmnna)
-- Tanggal snapshot: 2026-09-10, sumber: pg_policies live (verified manual)
-- Tujuan: reproducibility — definisi policy live yang sebelumnya tidak
-- ter-commit di repo. File INI TIDAK PERLU dijalankan di DB live
-- (policy sudah aktif). Gunakan untuk setup DB sewara baru.
--
-- CATATAN GAP REPO vs LIVE (dari audit):
-- 1. Repo lama (migration_multi_owner.sql) pakai nama policy
--    "access_own_or_owner" tanpa cek is_active; live pakai nama
--    per-tabel + cek EXISTS profiles.is_active — versi LIVE lebih
--    ketat dan adalah source of truth file ini.
-- 2. Repo lama profiles pakai hardcoded email superadmin; live pakai
--    rpc_auth_punya_role('superadmin').
-- 3. Definisi function rpc_auth_punya_role BELUM ada di repo —
--    verifikasi dengan: SELECT prosrc FROM pg_proc WHERE proname='rpc_auth_punya_role';
--    lalu tambahkan di file ini.
-- =====================================================================

-- ============ INVENTORY ============
DROP POLICY IF EXISTS "access_own_or_owner_inventory" ON public.inventory;
CREATE POLICY "access_own_or_owner_inventory"
  ON public.inventory FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.user_id = auth.uid() AND profiles.is_active)
    AND (user_id = auth.uid() OR user_id = (SELECT profiles.owner_id FROM profiles WHERE profiles.user_id = auth.uid()))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.user_id = auth.uid() AND profiles.is_active)
    AND (user_id = auth.uid() OR user_id = (SELECT profiles.owner_id FROM profiles WHERE profiles.user_id = auth.uid()))
  );

-- ============ TRANSACTIONS ============
DROP POLICY IF EXISTS "access_own_or_owner_transactions" ON public.transactions;
CREATE POLICY "access_own_or_owner_transactions"
  ON public.transactions FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.user_id = auth.uid() AND profiles.is_active)
    AND (user_id = auth.uid() OR user_id = (SELECT profiles.owner_id FROM profiles WHERE profiles.user_id = auth.uid()))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.user_id = auth.uid() AND profiles.is_active)
    AND (user_id = auth.uid() OR user_id = (SELECT profiles.owner_id FROM profiles WHERE profiles.user_id = auth.uid()))
  );

-- ============ MEMBERS ============
DROP POLICY IF EXISTS "members_access_own_or_owner" ON public.members;
CREATE POLICY "members_access_own_or_owner"
  ON public.members FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.user_id = auth.uid() AND profiles.is_active)
    AND (user_id = auth.uid() OR user_id = (SELECT profiles.owner_id FROM profiles WHERE profiles.user_id = auth.uid()))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.user_id = auth.uid() AND profiles.is_active)
    AND (user_id = auth.uid() OR user_id = (SELECT profiles.owner_id FROM profiles WHERE profiles.user_id = auth.uid()))
  );

-- ============ MEMBER_TYPES ============
-- Nama policy live: "member_templates_access_own_or_owner" (legacy naming,
-- table sekarang member_types). Dipertahankan sesuai live.
DROP POLICY IF EXISTS "member_templates_access_own_or_owner" ON public.member_types;
CREATE POLICY "member_templates_access_own_or_owner"
  ON public.member_types FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.user_id = auth.uid() AND profiles.is_active)
    AND (user_id = auth.uid() OR user_id = (SELECT profiles.owner_id FROM profiles WHERE profiles.user_id = auth.uid()))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.user_id = auth.uid() AND profiles.is_active)
    AND (user_id = auth.uid() OR user_id = (SELECT profiles.owner_id FROM profiles WHERE profiles.user_id = auth.uid()))
  );

-- ============ PROFILES ============
DROP POLICY IF EXISTS "profiles_select_allowed" ON public.profiles;
CREATE POLICY "profiles_select_allowed"
  ON public.profiles FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR rpc_auth_punya_role('superadmin')
    OR owner_id = auth.uid()
  );

DROP POLICY IF EXISTS "profiles_write_allowed" ON public.profiles;
CREATE POLICY "profiles_write_allowed"
  ON public.profiles FOR ALL TO authenticated
  USING (
    rpc_auth_punya_role('superadmin')
    OR user_id = auth.uid()
    OR owner_id = auth.uid()
  )
  WITH CHECK (
    rpc_auth_punya_role('superadmin')
    OR user_id = auth.uid()
    OR owner_id = auth.uid()
  );

-- ============ FUNCTION: rpc_auth_punya_role ============
-- Snapshot dari live DB (verified 2026-09-10): SQL function sederhana,
-- cek role + is_active dari profiles.
CREATE OR REPLACE FUNCTION public.rpc_auth_punya_role(p_role TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE user_id = auth.uid() AND role = p_role AND is_active
  );
$$;
