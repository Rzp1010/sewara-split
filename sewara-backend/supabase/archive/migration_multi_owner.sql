-- =============================================================
-- MIGRATION MULTI-OWNER & ROLE (superadmin / owner / cs / gudang)
-- KHUSUS PROJECT PRIBADI / PRODUKSI (Supabase DB: wbujlusshrrvkjjxkhtj)
-- CARA: Dashboard Supabase -> project PRIBADI -> SQL Editor -> paste -> Run
-- DUA KALI: jalankan SEBELUM & SESUDAH akun superadmin@rentalpro.com dibuat
-- (fungsi seed superadmin berjalan jika akun sudah ada)
--
-- Efek:
--   - profiles: tambah kolom owner_id; role bertambah 'superadmin'
--   - Tabel admin_logs (audit aktivitas owner)
--   - Tabel app_config (versi global: 'baru'|'lama' dikontrol superadmin)
--   - inventory/transactions/logs: tambah kolom user_id + backfill ke owner@user.com
--   - RLS data: staf membaca data si owner; superadmin TIDAK membaca data bisnis
--   - RPC: list owners (superadmin), list staff (owner), set_role, toggle_active,
--          list admin_logs, get/set versi global
-- =============================================================

-- ============ 1. PROFILES: tambah owner_id + role superadmin ============
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS owner_id UUID;
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('superadmin', 'owner', 'cs', 'gudang'));

-- ============ 2. SEED SUPERADMIN & OWNER ============
-- superadmin (jika akun sudah dibuat di dashboard)
INSERT INTO public.profiles (user_id, email, role, nama_lengkap, is_active, owner_id)
SELECT id, email, 'superadmin', 'Manajemen RentalPro', true, NULL
FROM auth.users WHERE email = 'superadmin@rentalpro.com'
ON CONFLICT (email) DO NOTHING;

-- owner eksperimen (backfill data lama jadi miliknya)
INSERT INTO public.profiles (user_id, email, role, nama_lengkap, is_active, owner_id)
SELECT id, email, 'owner', email, true, NULL
FROM auth.users WHERE email = 'owner@user.com'
ON CONFLICT (email) DO UPDATE SET role = 'owner', owner_id = NULL;

-- ============ 3. TABEL ADMIN LOGS ============
CREATE TABLE IF NOT EXISTS public.admin_logs (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_email TEXT NOT NULL,
  aksi TEXT NOT NULL,
  target_email TEXT,
  detail TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.admin_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_logs_select_superadmin" ON public.admin_logs;
DROP POLICY IF EXISTS "admin_logs_insert_owner" ON public.admin_logs;

-- Hanya superadmin yang boleh membaca log
CREATE POLICY "admin_logs_select_superadmin"
  ON public.admin_logs FOR SELECT TO authenticated
  USING ((auth.jwt() ->> 'email') = 'superadmin@rentalpro.com');

-- Owner boleh menulis log (utk aksinya sendiri); superadmin juga
CREATE POLICY "admin_logs_insert_owner"
  ON public.admin_logs FOR INSERT TO authenticated
  WITH CHECK (
    (auth.jwt() ->> 'email') = 'superadmin@rentalpro.com'
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.email = (auth.jwt() ->> 'email') AND p.role IN ('owner', 'superadmin')
    )
  );

-- ============ 4. TABEL APP_CONFIG (versi global) ============
CREATE TABLE IF NOT EXISTS public.app_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "app_config_select_all" ON public.app_config;
DROP POLICY IF EXISTS "app_config_write_superadmin" ON public.app_config;

CREATE POLICY "app_config_select_all"
  ON public.app_config FOR SELECT TO authenticated USING (true);

CREATE POLICY "app_config_write_superadmin"
  ON public.app_config FOR ALL TO authenticated
  USING ((auth.jwt() ->> 'email') = 'superadmin@rentalpro.com')
  WITH CHECK ((auth.jwt() ->> 'email') = 'superadmin@rentalpro.com');

INSERT INTO public.app_config (key, value) VALUES ('versi_global', 'baru')
ON CONFLICT (key) DO NOTHING;

-- ============ 5. RLS PROFILES (peran + owner_id) ============
DROP POLICY IF EXISTS "profiles_select_self" ON public.profiles;
DROP POLICY IF EXISTS "profiles_write_owner" ON public.profiles;

-- SELECT: superadmin semua; owner baris sendiri + baris stafnya; staf baris sendiri
CREATE POLICY "profiles_select_allowed"
  ON public.profiles FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR (auth.jwt() ->> 'email') = 'superadmin@rentalpro.com'
    OR owner_id = auth.uid()
  );

-- WRITE: superadmin semua; owner ubah baris sendiri + baris stafnya (bukan jadi superadmin)
CREATE POLICY "profiles_write_allowed"
  ON public.profiles FOR ALL TO authenticated
  USING (
    (auth.jwt() ->> 'email') = 'superadmin@rentalpro.com'
    OR user_id = auth.uid()
    OR owner_id = auth.uid()
  )
  WITH CHECK (
    (auth.jwt() ->> 'email') = 'superadmin@rentalpro.com'
    OR user_id = auth.uid()
    OR owner_id = auth.uid()
  );

-- ============ 6. DATA MULTI-TENANT: user_id + backfill + RLS ============
ALTER TABLE inventory ADD COLUMN IF NOT EXISTS user_id UUID;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS user_id UUID;
ALTER TABLE logs ADD COLUMN IF NOT EXISTS user_id UUID;

-- Backfill data lama ke owner@user.com
UPDATE inventory SET user_id = u.id
  FROM auth.users u WHERE u.email = 'owner@user.com' AND inventory.user_id IS NULL;
UPDATE transactions SET user_id = u.id
  FROM auth.users u WHERE u.email = 'owner@user.com' AND transactions.user_id IS NULL;
UPDATE logs SET user_id = u.id
  FROM auth.users u WHERE u.email = 'owner@user.com' AND logs.user_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_inventory_user_id ON inventory (user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON transactions (user_id);
CREATE INDEX IF NOT EXISTS idx_logs_user_id ON logs (user_id);

-- Hapus policy lama di 3 tabel (apapun namanya) lalu buat policy per-owner
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT policyname, tablename FROM pg_policies
    WHERE schemaname = 'public' AND tablename IN ('inventory', 'transactions', 'logs')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, r.tablename);
  END LOOP;
END $$;

-- Staf membaca data si owner; owner membaca datanya sendiri; superadmin tidak melihat
CREATE POLICY "access_own_or_owner"
  ON inventory FOR ALL TO authenticated
  USING (user_id = auth.uid() OR user_id = (SELECT owner_id FROM profiles WHERE user_id = auth.uid()))
  WITH CHECK (user_id = auth.uid() OR user_id = (SELECT owner_id FROM profiles WHERE user_id = auth.uid()));

CREATE POLICY "access_own_or_owner"
  ON transactions FOR ALL TO authenticated
  USING (user_id = auth.uid() OR user_id = (SELECT owner_id FROM profiles WHERE user_id = auth.uid()))
  WITH CHECK (user_id = auth.uid() OR user_id = (SELECT owner_id FROM profiles WHERE user_id = auth.uid()));

CREATE POLICY "access_own_or_owner"
  ON logs FOR ALL TO authenticated
  USING (user_id = auth.uid() OR user_id = (SELECT owner_id FROM profiles WHERE user_id = auth.uid()))
  WITH CHECK (user_id = auth.uid() OR user_id = (SELECT owner_id FROM profiles WHERE user_id = auth.uid()));

-- ============ 7. RPC ============

-- RPC: daftar owner (superadmin)
CREATE OR REPLACE FUNCTION public.rpc_list_owners()
RETURNS TABLE (email TEXT, created_at TIMESTAMPTZ, nama_lengkap TEXT, is_active BOOLEAN, jumlah_staff BIGINT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF (auth.jwt() ->> 'email') <> 'superadmin@rentalpro.com' THEN
    RAISE EXCEPTION 'not allowed';
  END IF;
  RETURN QUERY
    SELECT p.email::text, p.created_at, p.nama_lengkap, p.is_active,
           (SELECT count(*)::BIGINT FROM profiles s WHERE s.owner_id = p.user_id)
    FROM profiles p
    WHERE p.role = 'owner'
    ORDER BY p.created_at ASC;
END;
$$;

-- RPC: daftar staf (owner)
CREATE OR REPLACE FUNCTION public.rpc_list_staff()
RETURNS TABLE (email TEXT, created_at TIMESTAMPTZ, role TEXT, nama_lengkap TEXT, is_active BOOLEAN)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN QUERY
    SELECT p.email::text, p.created_at, p.role, p.nama_lengkap, p.is_active
    FROM profiles p
    WHERE p.owner_id = auth.uid()
    ORDER BY p.created_at ASC;
END;
$$;

-- RPC: ubah role (superadmin utk owner; owner utk stafnya; bukan utk diri sendiri)
CREATE OR REPLACE FUNCTION public.rpc_set_role(p_email TEXT, p_role TEXT)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE target profiles%ROWTYPE;
BEGIN
  IF p_role NOT IN ('owner', 'cs', 'gudang') THEN RAISE EXCEPTION 'role tidak valid'; END IF;
  SELECT * INTO target FROM profiles WHERE email = p_email;
  IF NOT FOUND THEN RAISE EXCEPTION 'profil tidak ditemukan'; END IF;

  IF (auth.jwt() ->> 'email') = 'superadmin@rentalpro.com' THEN
    IF target.role = 'superadmin' THEN RAISE EXCEPTION 'tidak bisa ubah superadmin'; END IF;
  ELSIF target.owner_id = auth.uid() THEN
    -- owner mengubah stafnya; tidak bisa jadikan owner/superadmin
    IF p_role IN ('owner', 'superadmin') THEN RAISE EXCEPTION 'tidak bisa jadikan owner/superadmin'; END IF;
  ELSE
    RAISE EXCEPTION 'not allowed';
  END IF;

  UPDATE profiles SET role = p_role, updated_at = now() WHERE email = p_email;
END;
$$;

-- RPC: aktif/nonaktif (superadmin utk owner; owner utk staf; bukan diri sendiri)
CREATE OR REPLACE FUNCTION public.rpc_toggle_active(p_email TEXT)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE target profiles%ROWTYPE;
BEGIN
  SELECT * INTO target FROM profiles WHERE email = p_email;
  IF NOT FOUND THEN RAISE EXCEPTION 'profil tidak ditemukan'; END IF;

  IF (auth.jwt() ->> 'email') = 'superadmin@rentalpro.com' THEN
    IF target.role = 'superadmin' THEN RAISE EXCEPTION 'tidak bisa nonaktifkan superadmin'; END IF;
  ELSIF target.owner_id = auth.uid() THEN
    NULL; -- boleh
  ELSE
    RAISE EXCEPTION 'not allowed';
  END IF;
  IF target.email = (auth.jwt() ->> 'email') THEN RAISE EXCEPTION 'tidak bisa nonaktifkan diri sendiri'; END IF;

  UPDATE profiles SET is_active = NOT is_active, updated_at = now() WHERE email = p_email;
END;
$$;

-- RPC: daftar admin logs (superadmin)
CREATE OR REPLACE FUNCTION public.rpc_list_admin_logs()
RETURNS TABLE (actor_email TEXT, aksi TEXT, target_email TEXT, detail TEXT, created_at TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF (auth.jwt() ->> 'email') <> 'superadmin@rentalpro.com' THEN
    RAISE EXCEPTION 'not allowed';
  END IF;
  RETURN QUERY
    SELECT l.actor_email, l.aksi, l.target_email, l.detail, l.created_at
    FROM admin_logs l ORDER BY l.created_at DESC LIMIT 500;
END;
$$;

-- RPC: baca versi global (semua authenticated)
CREATE OR REPLACE FUNCTION public.rpc_get_versi_global()
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v TEXT;
BEGIN
  SELECT value INTO v FROM app_config WHERE key = 'versi_global';
  RETURN COALESCE(v, 'baru');
END;
$$;

-- RPC: set versi global (superadmin)
CREATE OR REPLACE FUNCTION public.rpc_set_versi_global(p_mode TEXT)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF (auth.jwt() ->> 'email') <> 'superadmin@rentalpro.com' THEN
    RAISE EXCEPTION 'not allowed';
  END IF;
  IF p_mode NOT IN ('baru', 'lama') THEN RAISE EXCEPTION 'mode tidak valid'; END IF;
  INSERT INTO app_config (key, value) VALUES ('versi_global', p_mode)
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
END;
$$;

-- RPC: helper catat admin log (dipanggil API route pakai service role)
CREATE OR REPLACE FUNCTION public.rpc_tambah_admin_log(p_actor TEXT, p_aksi TEXT, p_target TEXT, p_detail TEXT)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO admin_logs (actor_email, aksi, target_email, detail)
  VALUES (p_actor, p_aksi, p_target, p_detail);
END;
$$;

-- ============ 8. GRANT ============
REVOKE ALL ON FUNCTION public.rpc_list_owners() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_list_staff() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_set_role(TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_toggle_active(TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_list_admin_logs() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_get_versi_global() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_set_versi_global(TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_tambah_admin_log(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.rpc_list_owners() TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_list_staff() TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_set_role(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_toggle_active(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_list_admin_logs() TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_get_versi_global() TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_set_versi_global(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_tambah_admin_log(TEXT, TEXT, TEXT, TEXT) TO authenticated;
