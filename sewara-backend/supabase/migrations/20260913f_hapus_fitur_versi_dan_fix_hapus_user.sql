-- Migration 2026-09-13f: Gabungan (REPLACE 20260913e — JANGAN jalankan 20260913e lagi).
--
-- (1) rpc_hapus_data_user: URUTAN hapus salah → inventory sebelum transactions.
--     FK fk_transaction_items_inventory ON DELETE RESTRICT menolak → hapus akun owner
--     yang punya transaksi SELALU GAGAL. Fix: transactions dulu (CASCADE items), baru inventory.
--     Sekaligus bersihkan members/member_types/promo_codes (PII tenant) yang sebelumnya tertinggal.
--     VERSI INI FINAL: tanpa DELETE FROM versi_akun (tabel di-drop di bagian 3).
--
-- (2) Guard eskalasi role lintas-baris: owner bisa UPDATE baris staf (policy
--     profiles_write_allowed: owner_id = auth.uid()) dan set role='superadmin' →
--     lolos trigger lama (hanya blok baris sendiri) & CHECK (superadmin legal) →
--     akses SEMUA tenant. Fix: trigger blok kenaikan role/owner_id pada baris
--     yang BUKAN milik sendiri, kecuali pemanggil superadmin/service_role.
--
-- (3) Hapus fitur selector versi global (BARU/LAMA) — jarang dipakai, kurang efektif:
--     - drop tabel versi_akun (mekanisme lama per-email, sudah tidak dirujuk kode).
--     - drop rpc_get_versi_global / rpc_set_versi_global (satu-satunya pemakai app_config).
--     - drop tabel app_config (hanya menampung key 'versi_global'; 1 baris).
--     - hapus baris settings key 'fitur_mode' (sisa sinkronisasi client lama).
--     Semua fitur (invoiceCustom, dendaFleksibel, boardBelumSelesai, memberPromo)
--     jadi permanen ON di src/lib/features.js.
--
-- Jalankan manual di SQL Editor DB sewara (obhvrzholszhjnpvmnna).
BEGIN;

-- ============ (1) FIX rpc_hapus_data_user ============
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
  IF NOT (
    (auth.jwt() ->> 'role') = 'service_role'
    OR EXISTS (SELECT 1 FROM profiles WHERE user_id = auth.uid() AND role = 'superadmin')
    OR (target.owner_id = auth.uid() AND target.user_id <> auth.uid() AND EXISTS (SELECT 1 FROM profiles WHERE user_id = auth.uid() AND role = 'owner'))
  ) THEN
    RAISE EXCEPTION 'not allowed';
  END IF;

  uid := target.user_id;

  v_ids := ARRAY[uid];
  SELECT array_agg(s.user_id) INTO v_ids
    FROM (SELECT user_id FROM profiles WHERE owner_id = uid
          UNION SELECT uid) s;

  -- URUTAN WAJIB: transactions DULU (CASCADE transaction_items/payments),
  -- baru inventory (FK RESTRICT dari transaction_items).
  DELETE FROM transactions  WHERE user_id = ANY(v_ids);
  DELETE FROM inventory     WHERE user_id = ANY(v_ids);
  DELETE FROM activity_logs WHERE user_id = ANY(v_ids);

  -- data pelanggan tenant (sebelumnya tertinggal)
  DELETE FROM members      WHERE user_id = ANY(v_ids);
  DELETE FROM member_types WHERE user_id = ANY(v_ids);
  DELETE FROM promo_codes  WHERE user_id = ANY(v_ids);

  -- hapus data per-akun
  DELETE FROM settings    WHERE user_id = ANY(v_ids);
  DELETE FROM admin_logs  WHERE actor_email = p_email OR target_email = p_email;
  DELETE FROM login_logs  WHERE email = p_email OR email IN (SELECT email FROM profiles WHERE user_id = ANY(v_ids));

  -- hapus profil
  DELETE FROM profiles    WHERE user_id = ANY(v_ids);
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_hapus_data_user(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_hapus_data_user(TEXT) TO service_role;

-- ============ (2) GUARD eskalasi role lintas-baris ============
-- Trigger protect_profile_self_escalation LAMA hanya melindungi baris sendiri.
-- Versi baru: siapa pun yang mengubah baris BUKAN miliknya tidak boleh mengubah
-- role ke owner/superadmin atau memindahkan owner_id (kecuali superadmin/service_role).
-- Owner tetap boleh ubah kolom lain (nama_lengkap, username, nama_invoice) dan
-- cs <-> gudang via rpc_set_role (punya validasi sendiri).
CREATE OR REPLACE FUNCTION public.protect_profile_self_escalation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Baris sendiri: tak boleh ubah role/owner/status/lockout/langganan.
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
    RETURN NEW;
  END IF;

  -- Baris pihak lain: non-superadmin / non-service-role tidak boleh eskalasi.
  IF auth.uid() IS NOT NULL
     AND (auth.jwt() ->> 'role') IS DISTINCT FROM 'service_role'
     AND NOT EXISTS (
       SELECT 1 FROM profiles WHERE user_id = auth.uid() AND role = 'superadmin'
     ) THEN
    IF NEW.role IN ('owner', 'superadmin') AND NEW.role IS DISTINCT FROM OLD.role THEN
      RAISE EXCEPTION 'Tidak boleh menaikkan role ke owner/superadmin';
    END IF;
    IF OLD.owner_id IS DISTINCT FROM NEW.owner_id THEN
      RAISE EXCEPTION 'Tidak boleh memindahkan kepemilikan (owner_id) akun';
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

-- ============ (3) HAPUS FITUR SELECTOR VERSI ============
DROP TABLE IF EXISTS public.versi_akun;
DROP FUNCTION IF EXISTS public.rpc_get_versi_global();
DROP FUNCTION IF EXISTS public.rpc_set_versi_global(TEXT);
DROP TABLE IF EXISTS public.app_config;

-- sisa baris settings per-tenant dari sinkronisasi client lama
DELETE FROM settings WHERE key = 'fitur_mode';

-- refresh cache schema PostgREST (drop tabel/RPC + replace function)
NOTIFY pgrst, 'reload schema';

COMMIT;
