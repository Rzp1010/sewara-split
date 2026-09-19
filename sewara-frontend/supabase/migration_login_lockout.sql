-- ============================================================
-- FITUR PROTEKSI LOGIN (lockout semua role) + status Terkunci
-- DB redesign: uniscegyqyqnvmuxnfsr
-- Tanggal: 2026-08-10
-- Referensi: PLAN_KEAMANAN_LOGIN.md Fitur A
-- Idempotent (aman dijalankan ulang)
-- ============================================================

-- 1) Kolom lockout di profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS failed_login    INTEGER     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_failed_at  TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS cooldown_until  TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS locked_until    TIMESTAMPTZ NULL;

-- 2) rpc_list_staff: + locked_until, failed_login (status Terkunci di SDM)
CREATE OR REPLACE FUNCTION public.rpc_list_staff()
RETURNS TABLE (email TEXT, created_at TIMESTAMPTZ, role TEXT, nama_lengkap TEXT, is_active BOOLEAN, locked_until TIMESTAMPTZ, failed_login INTEGER)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN QUERY
    SELECT p.email::text, p.created_at, p.role, p.nama_lengkap, p.is_active, p.locked_until, p.failed_login
    FROM profiles p
    WHERE p.owner_id = auth.uid()
    ORDER BY p.created_at ASC;
END;
$$;

-- 3) rpc_list_owners: + locked_until, failed_login (status Terkunci di Manajemen)
CREATE OR REPLACE FUNCTION public.rpc_list_owners()
RETURNS TABLE (email TEXT, created_at TIMESTAMPTZ, nama_lengkap TEXT, is_active BOOLEAN, jumlah_staff BIGINT, locked_until TIMESTAMPTZ, failed_login INTEGER)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE user_id = auth.uid() AND role = 'superadmin') THEN
    RAISE EXCEPTION 'not allowed';
  END IF;
  RETURN QUERY
    SELECT p.email::text, p.created_at, p.nama_lengkap, p.is_active,
           (SELECT count(*)::BIGINT FROM profiles s WHERE s.owner_id = p.user_id),
           p.locked_until, p.failed_login
    FROM profiles p
    WHERE p.role = 'owner'
    ORDER BY p.created_at ASC;
END;
$$;

NOTIFY pgrst, 'reload schema';
