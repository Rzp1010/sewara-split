-- Fix public.rpc_hapus_data_user after logs -> activity_logs rename.
-- Source: Old-project/auto-backup/schema/fix-hapus-data-user.sql
-- Project: Sewara (obhvrzholszhjnpvmnna)

BEGIN;

CREATE OR REPLACE FUNCTION public.rpc_hapus_data_user(p_email TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target profiles%ROWTYPE;
  uid UUID;
  v_ids UUID[];
BEGIN
  SELECT * INTO target FROM profiles WHERE email = p_email;
  IF NOT FOUND THEN RAISE EXCEPTION 'profil tidak ditemukan'; END IF;

  -- GUARD: service_role (route server) ATAU superadmin ATAU owner utk stafnya
  -- (owner tidak bisa hapus diri sendiri / owner lain)
  IF NOT (
    (auth.jwt() ->> 'role') = 'service_role'
    OR EXISTS (SELECT 1 FROM profiles WHERE user_id = auth.uid() AND role = 'superadmin')
    OR (target.owner_id = auth.uid() AND target.user_id <> auth.uid() AND EXISTS (SELECT 1 FROM profiles WHERE user_id = auth.uid() AND role = 'owner'))
  ) THEN
    RAISE EXCEPTION 'not allowed';
  END IF;

  uid := target.user_id;

  -- kumpulkan id user + stafnya
  v_ids := ARRAY[uid];
  SELECT array_agg(s.user_id) INTO v_ids
    FROM (SELECT user_id FROM profiles WHERE owner_id = uid
          UNION SELECT uid) s;

  -- hapus data bisnis
  DELETE FROM inventory    WHERE user_id = ANY(v_ids);
  DELETE FROM transactions WHERE user_id = ANY(v_ids);
  DELETE FROM activity_logs WHERE user_id = ANY(v_ids);

  -- hapus data per-akun
  DELETE FROM settings    WHERE user_id = ANY(v_ids);
  DELETE FROM versi_akun  WHERE email = p_email OR email IN (SELECT email FROM profiles WHERE user_id = ANY(v_ids));
  DELETE FROM admin_logs  WHERE actor_email = p_email OR target_email = p_email;
  DELETE FROM login_logs  WHERE email = p_email OR email IN (SELECT email FROM profiles WHERE user_id = ANY(v_ids));

  -- hapus profil
  DELETE FROM profiles    WHERE user_id = ANY(v_ids);
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_hapus_data_user(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_hapus_data_user(TEXT) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
