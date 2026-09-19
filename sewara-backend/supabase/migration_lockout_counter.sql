-- ============================================================
-- LOCKOUT LOGIN: RPC atomik untuk counter failed_login
-- DB redesign: uniscegyqyqnvmuxnfsr
-- Tanggal: 2026-08-10
-- Idempotent (aman dijalankan ulang)
-- Rujukan: PLAN_KEAMANAN_LOGIN.md (Fitur A) + audit item #8 (race condition)
-- ============================================================

-- Naikkan failed_login secara ATOMIK + decay 24 jam.
-- Hanya dipanggil server-side (route login via service role).
CREATE OR REPLACE FUNCTION public.rpc_register_login_failure(p_user_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_fl INTEGER;
BEGIN
  UPDATE public.profiles
  SET failed_login = CASE
        WHEN last_failed_at IS NULL OR last_failed_at < now() - interval '24 hours'
        THEN 1
        ELSE failed_login + 1
      END,
      last_failed_at = now()
  WHERE user_id = p_user_id
  RETURNING failed_login INTO v_fl;

  RETURN COALESCE(v_fl, 0);
END;
$$;

-- Hanya service_role (server route) yang boleh memanggil — bukan authenticated
REVOKE ALL ON FUNCTION public.rpc_register_login_failure(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_register_login_failure(UUID) TO service_role;

NOTIFY pgrst, 'reload schema';
