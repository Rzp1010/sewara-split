-- =============================================================
-- HARDENING: cegah eskalasi role/tenant lewat profil sendiri
-- Jalankan di SQL Editor dashboard Supabase KEDUA project:
--   - PRIBADI (PRODUKSI): wbujlusshrrvkjjxkhtj
--   - TESTER (UJI):       srgmeoipuybrkhsxmtsf
--
-- Efek: user (staf/owner) TIDAK bisa mengubah role, owner_id, atau
-- is_active pada baris profilnya sendiri. Superadmin & service-role
-- (admin API) tetap bisa mengubah profil orang lain (auth.uid() mereka
-- bukan pemilik baris tersebut).
-- =============================================================

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
       OR OLD.is_active IS DISTINCT FROM NEW.is_active THEN
      RAISE EXCEPTION 'Tidak boleh mengubah role, owner, atau status aktif pada akun sendiri';
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
