-- =============================================================
-- MIGRATION FITUR PER USER (versi 'baru' / 'lama' per akun)
-- KHUSUS PROJECT PRIBADI / PRODUKSI (Supabase DB: wbujlusshrrvkjjxkhtj)
-- CARA: Dashboard Supabase -> project PRIBADI -> SQL Editor -> paste -> Run
--
-- Efek:
--   - Membuat tabel baru `versi_akun` (email -> mode 'baru'|'lama')
--   - RLS: semua authenticated boleh SELECT (baca barisnya sendiri / semua utk owner)
--   - INSERT/UPDATE/DELETE HANYA pemilik (owner@user.com)
--   - Fungsi rpc_list_akun() utk owner membaca semua email dari auth.users
-- TIDAK mengubah tabel/data existing sama sekali (murni aditif).
-- =============================================================

-- 1. Tabel versi_akun
CREATE TABLE IF NOT EXISTS public.versi_akun (
  email TEXT PRIMARY KEY,
  mode TEXT NOT NULL DEFAULT 'lama' CHECK (mode IN ('baru', 'lama')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Index (opsional, email sudah PK)
CREATE INDEX IF NOT EXISTS idx_versi_akun_mode ON public.versi_akun (mode);

-- 3. RLS
ALTER TABLE public.versi_akun ENABLE ROW LEVEL SECURITY;

-- 4. Hapus policy lama (idempoten) lalu buat policy baru
DROP POLICY IF EXISTS "versi_akun_select_all" ON public.versi_akun;
DROP POLICY IF EXISTS "versi_akun_write_owner" ON public.versi_akun;

-- 5. Siapa saja yang login boleh membaca: baris milik dirinya sendiri,
--    kecuali owner yang boleh membaca semua (utk halaman admin)
CREATE POLICY "versi_akun_select_all"
  ON public.versi_akun FOR SELECT TO authenticated
  USING (
    email = (auth.jwt() ->> 'email') OR
    (auth.jwt() ->> 'email') = 'owner@user.com'
  );

-- 6. Hanya owner yang boleh menambah / mengubah / menghapus baris
CREATE POLICY "versi_akun_write_owner"
  ON public.versi_akun FOR ALL TO authenticated
  USING (auth.jwt() ->> 'email' = 'owner@user.com')
  WITH CHECK (auth.jwt() ->> 'email' = 'owner@user.com');

-- 7. RPC: daftar semua akun dari auth.users (khusus owner)
--    SECURITY DEFINER: dijalankan sebagai pemilik fungsi (postgres) agar bisa
--    membaca auth.users. Body fungsi WAJIB memastikan pemanggil adalah owner,
--    karena SECURITY DEFINER mengabaikan RLS tapi auth.jwt() tetap tersedia.
CREATE OR REPLACE FUNCTION public.rpc_list_akun()
RETURNS TABLE (email TEXT, created_at TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (auth.jwt() ->> 'email') <> 'owner@user.com' THEN
    RAISE EXCEPTION 'not allowed';
  END IF;

  RETURN QUERY
    SELECT u.email::text, u.created_at
    FROM auth.users u
    WHERE u.email IS NOT NULL
    ORDER BY u.created_at ASC;
END;
$$;

-- 8. Akses fungsi: semua authenticated BOLEH memanggil, namun body-nya menolak
--    pemanggil selain owner. (REVOKE dari anon; grant hanya authenticated.)
REVOKE ALL ON FUNCTION public.rpc_list_akun() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_list_akun() TO authenticated;
