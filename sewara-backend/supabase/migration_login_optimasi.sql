-- ============================================================
-- Optimasi login: indeks utk rate-limit count query
-- (ip/email + event + created_at — dipakai login route tiap request)
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_login_logs_ip_event_created ON public.login_logs (ip, event, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_login_logs_email_event_created ON public.login_logs (email, event, created_at DESC);

NOTIFY pgrst, 'reload schema';