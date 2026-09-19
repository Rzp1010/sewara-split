-- =============================================================
-- ROLLBACK: Batalkan migration_fitur_per_user.sql
-- KHUSUS PROJECT PRIBADI / PRODUKSI (Supabase DB: wbujlusshrrvkjjxkhtj)
-- CARA: Dashboard Supabase -> project PRIBADI -> SQL Editor -> paste -> Run
--
-- Menghapus seluruh artefak fitur versi per akun. Tabel/data lain TIDAK tersentuh.
-- =============================================================

DROP POLICY IF EXISTS "versi_akun_write_owner" ON public.versi_akun;
DROP POLICY IF EXISTS "versi_akun_select_all" ON public.versi_akun;

ALTER TABLE public.versi_akun DISABLE ROW LEVEL SECURITY;

DROP TABLE IF EXISTS public.versi_akun;

DROP FUNCTION IF EXISTS public.rpc_list_akun();
