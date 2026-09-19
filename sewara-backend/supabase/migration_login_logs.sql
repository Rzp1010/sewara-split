-- ============================================================
-- FITUR 2: Halaman Log Login/Logout/Salah Password
-- DB redesign: uniscegyqyqnvmuxnfsr
-- Tanggal: 2026-08-10
-- Idempotent (aman dijalankan ulang)
-- Catatan: login_logs BUKAN data bisnis -> tidak ikut "Kosongkan Semua Data"
-- ============================================================

CREATE TABLE IF NOT EXISTS public.login_logs (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email TEXT NOT NULL,
  owner_id UUID,
  event TEXT NOT NULL CHECK (event IN ('login_sukses','login_gagal','logout')),
  detail TEXT,
  ip TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.login_logs ENABLE ROW LEVEL SECURITY;

-- Akses: superadmin -> semua; owner -> tenant-nya (owner_id = dirinya)
CREATE OR REPLACE FUNCTION public.rpc_list_login_logs()
RETURNS TABLE (id BIGINT, email TEXT, event TEXT, detail TEXT, ip TEXT, user_agent TEXT, created_at TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM profiles WHERE user_id = auth.uid() AND role = 'superadmin') THEN
    RETURN QUERY
      SELECT l.id, l.email, l.event, l.detail, l.ip, l.user_agent, l.created_at
      FROM public.login_logs l
      ORDER BY l.created_at DESC, l.id DESC
      LIMIT 500;
  ELSIF EXISTS (SELECT 1 FROM profiles WHERE user_id = auth.uid() AND role = 'owner') THEN
    RETURN QUERY
      SELECT l.id, l.email, l.event, l.detail, l.ip, l.user_agent, l.created_at
      FROM public.login_logs l
      WHERE l.owner_id = auth.uid()
      ORDER BY l.created_at DESC, l.id DESC
      LIMIT 500;
  ELSE
    RAISE EXCEPTION 'not allowed';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_list_login_logs() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_list_login_logs() TO authenticated;

CREATE INDEX IF NOT EXISTS idx_login_logs_owner_created ON public.login_logs (owner_id, created_at DESC);

-- Retensi 30 hari: tiap insert baru, hapus otomatis baris lebih tua dari 30 hari
-- (usulan sesi Data; login_logs berisi email/IP -> tidak disimpan selamanya)
CREATE OR REPLACE FUNCTION public.purge_login_logs_retensi()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  DELETE FROM public.login_logs WHERE created_at < now() - interval '30 days';
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_login_logs_retensi ON public.login_logs;
CREATE TRIGGER trg_login_logs_retensi
  BEFORE INSERT ON public.login_logs
  FOR EACH ROW EXECUTE FUNCTION public.purge_login_logs_retensi();

NOTIFY pgrst, 'reload schema';
