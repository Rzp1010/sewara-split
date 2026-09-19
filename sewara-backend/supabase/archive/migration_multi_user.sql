-- =============================================================
-- MIGRATION MULTI-USER & ROLE (owner / cs / gudang)
-- KHUSUS PROJECT PRIBADI / PRODUKSI (Supabase DB: wbujlusshrrvkjjxkhtj)
-- CARA: Dashboard Supabase -> project PRIBADI -> SQL Editor -> paste -> Run
--
-- Efek:
--   - Membuat tabel baru `profiles` (user_id, email, role, nama_lengkap, is_active)
--   - RLS: setiap user bisa baca barisnya sendiri; owner bisa baca semua
--   - INSERT/UPDATE/DELETE HANYA owner
--   - Fungsi rpc_list_users() utk owner membaca email + role semua akun
--   - Fungsi rpc_set_role() / rpc_toggle_active() utk owner mengubah role / nonaktifkan
-- TIDAK mengubah tabel/data existing sama sekali (murni aditif).
-- =============================================================

-- 1. Tabel profiles
CREATE TABLE IF NOT EXISTS public.profiles (
  user_id UUID PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'cs' CHECK (role IN ('owner', 'cs', 'gudang')),
  nama_lengkap TEXT NOT NULL DEFAULT '',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. RLS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- 3. Hapus policy lama (idempoten) lalu buat baru
DROP POLICY IF EXISTS "profiles_select_self" ON public.profiles;
DROP POLICY IF EXISTS "profiles_write_owner" ON public.profiles;

-- 4. Siapa pun yang login boleh membaca baris miliknya; owner boleh baca semua
CREATE POLICY "profiles_select_self"
  ON public.profiles FOR SELECT TO authenticated
  USING (
    user_id = (auth.uid()) OR
    (auth.jwt() ->> 'email') = 'owner@user.com'
  );

-- 5. Hanya owner yang boleh menambah / mengubah / menghapus baris
CREATE POLICY "profiles_write_owner"
  ON public.profiles FOR ALL TO authenticated
  USING (auth.jwt() ->> 'email' = 'owner@user.com')
  WITH CHECK (auth.jwt() ->> 'email' = 'owner@user.com');

-- 6. RPC: daftar semua akun + role (khusus owner)
--    SECURITY DEFINER agar bisa membaca auth.users; body WAJIB cek email owner.
CREATE OR REPLACE FUNCTION public.rpc_list_users()
RETURNS TABLE (
  email TEXT,
  created_at TIMESTAMPTZ,
  role TEXT,
  nama_lengkap TEXT,
  is_active BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (auth.jwt() ->> 'email') <> 'owner@user.com' THEN
    RAISE EXCEPTION 'not allowed';
  END IF;

  RETURN QUERY
    SELECT u.email::text, u.created_at, p.role, p.nama_lengkap, p.is_active
    FROM auth.users u
    LEFT JOIN public.profiles p ON p.user_id = u.id
    WHERE u.email IS NOT NULL
    ORDER BY u.created_at ASC;
END;
$$;

-- 7. RPC: ubah role (khusus owner)
CREATE OR REPLACE FUNCTION public.rpc_set_role(
  p_email TEXT,
  p_role TEXT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (auth.jwt() ->> 'email') <> 'owner@user.com' THEN
    RAISE EXCEPTION 'not allowed';
  END IF;
  IF p_role NOT IN ('owner', 'cs', 'gudang') THEN
    RAISE EXCEPTION 'role tidak valid';
  END IF;

  UPDATE public.profiles
  SET role = p_role, updated_at = now()
  WHERE email = p_email;
END;
$$;

-- 8. RPC: aktif / nonaktifkan user (khusus owner)
CREATE OR REPLACE FUNCTION public.rpc_toggle_active(
  p_email TEXT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (auth.jwt() ->> 'email') <> 'owner@user.com' THEN
    RAISE EXCEPTION 'not allowed';
  END IF;

  UPDATE public.profiles
  SET is_active = NOT is_active, updated_at = now()
  WHERE email = p_email;
END;
$$;

-- 9. Akses fungsi: hanya authenticated (body tetap memastikan owner)
REVOKE ALL ON FUNCTION public.rpc_list_users() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_set_role(TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_toggle_active(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_list_users() TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_set_role(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_toggle_active(TEXT) TO authenticated;

-- 10. Seed: pastikan owner punya baris profil (role 'owner') di project ini
INSERT INTO public.profiles (user_id, email, role, nama_lengkap, is_active)
SELECT id, email, 'owner', email, true
FROM auth.users
WHERE email = 'owner@user.com'
ON CONFLICT (email) DO NOTHING;

