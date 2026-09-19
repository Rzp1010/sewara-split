-- ============================================================
-- FITUR 5: Pendaftaran Publik + Persetujuan Superadmin + Langganan
-- (bagian A - SQL untuk sesi DATA, dari KOORDINASI.md L212-231)
-- DB redesign: uniscegyqyqnvmuxnfsr (+ SEWARA saat migrasi)
-- Idempotent (aman dijalankan ulang)
-- ============================================================

-- ---------- 1. PROFILES: kolom status + subscribed_until ----------
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'aktif';
-- Perbaiki constraint kalau sudah ada versi lama (drop dulu biar bersih)
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_status_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_status_check
  CHECK (status IN ('menunggu', 'aktif', 'diblokir'));

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS subscribed_until TIMESTAMPTZ NULL;

-- ---------- 2. TRIGGER: blokir self-change status + subscribed_until ----------
CREATE OR REPLACE FUNCTION public.protect_profile_self_escalation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() = OLD.user_id THEN
    IF OLD.role IS DISTINCT FROM NEW.role
       OR OLD.owner_id IS DISTINCT FROM NEW.owner_id
       OR OLD.is_active IS DISTINCT FROM NEW.is_active
       OR OLD.failed_login IS DISTINCT FROM NEW.failed_login
       OR OLD.last_failed_at IS DISTINCT FROM NEW.last_failed_at
       OR OLD.cooldown_until IS DISTINCT FROM NEW.cooldown_until
       OR OLD.locked_until IS DISTINCT FROM NEW.locked_until
       OR OLD.status IS DISTINCT FROM NEW.status
       OR OLD.subscribed_until IS DISTINCT FROM NEW.subscribed_until THEN
      RAISE EXCEPTION 'Tidak boleh mengubah role, owner, status aktif, lockout, atau langganan pada akun sendiri';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_profile_self ON public.profiles;
CREATE TRIGGER trg_protect_profile_self
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_profile_self_escalation();

-- ---------- 3. RPC list_staff: return + status, subscribed_until ----------
DROP FUNCTION IF EXISTS public.rpc_list_staff();
CREATE OR REPLACE FUNCTION public.rpc_list_staff()
RETURNS TABLE (email TEXT, created_at TIMESTAMPTZ, role TEXT, nama_lengkap TEXT, is_active BOOLEAN, locked_until TIMESTAMPTZ, failed_login INTEGER, status TEXT, subscribed_until TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN QUERY
    SELECT p.email::text, p.created_at, p.role, p.nama_lengkap, p.is_active, p.locked_until, p.failed_login, p.status, p.subscribed_until
    FROM profiles p
    WHERE p.owner_id = auth.uid()
    ORDER BY p.created_at ASC;
END;
$$;

-- ---------- 4. RPC list_owners: return + status, subscribed_until ----------
DROP FUNCTION IF EXISTS public.rpc_list_owners();
CREATE OR REPLACE FUNCTION public.rpc_list_owners()
RETURNS TABLE (email TEXT, created_at TIMESTAMPTZ, nama_lengkap TEXT, is_active BOOLEAN, jumlah_staff BIGINT, locked_until TIMESTAMPTZ, failed_login INTEGER, status TEXT, subscribed_until TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE user_id = auth.uid() AND role = 'superadmin') THEN
    RAISE EXCEPTION 'not allowed';
  END IF;
  RETURN QUERY
    SELECT p.email::text, p.created_at, p.nama_lengkap, p.is_active,
           (SELECT count(*)::BIGINT FROM profiles s WHERE s.owner_id = p.user_id),
           p.locked_until, p.failed_login, p.status, p.subscribed_until
    FROM profiles p
    WHERE p.role = 'owner'
    ORDER BY p.created_at ASC;
END;
$$;

-- GRANT tetap (revoke anon + grant authenticated)
REVOKE ALL ON FUNCTION public.rpc_list_staff() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_list_owners() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_list_staff() TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_list_owners() TO authenticated;

NOTIFY pgrst, 'reload schema';