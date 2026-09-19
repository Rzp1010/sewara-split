-- Atomic verification resend limiter: max 3 per normalized email per rolling hour,
-- 60-second cooldown, plus per-IP hourly protection.
CREATE TABLE IF NOT EXISTS public.auth_verification_resends (
  email TEXT PRIMARY KEY,
  ip TEXT,
  sent_at TIMESTAMPTZ[] NOT NULL DEFAULT '{}',
  last_sent_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_auth_verification_resends_ip ON public.auth_verification_resends (ip);
ALTER TABLE public.auth_verification_resends ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.rpc_reserve_verification_resend(p_email TEXT, p_ip TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  now_ts TIMESTAMPTZ := now();
  recent TIMESTAMPTZ[];
  ip_count INTEGER;
BEGIN
  IF p_email IS NULL OR p_email = '' THEN RETURN FALSE; END IF;
  SELECT COALESCE(array_agg(x ORDER BY x), '{}') INTO recent
  FROM unnest(COALESCE((SELECT sent_at FROM auth_verification_resends WHERE email = lower(trim(p_email))), '{}')) x
  WHERE x > now_ts - interval '1 hour';

  IF EXISTS (SELECT 1 FROM auth_verification_resends WHERE email = lower(trim(p_email)) AND last_sent_at > now_ts - interval '60 seconds') THEN RETURN FALSE; END IF;
  IF COALESCE(array_length(recent, 1), 0) >= 3 THEN RETURN FALSE; END IF;
  SELECT count(*) INTO ip_count FROM auth_verification_resends WHERE ip = p_ip AND updated_at > now_ts - interval '1 hour';
  IF p_ip IS NOT NULL AND ip_count >= 20 THEN RETURN FALSE; END IF;

  INSERT INTO auth_verification_resends(email, ip, sent_at, last_sent_at)
  VALUES (lower(trim(p_email)), p_ip, recent || now_ts, now_ts)
  ON CONFLICT (email) DO UPDATE SET ip = EXCLUDED.ip, sent_at = EXCLUDED.sent_at, last_sent_at = EXCLUDED.last_sent_at, updated_at = now_ts;
  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_reserve_verification_resend(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_reserve_verification_resend(TEXT, TEXT) TO service_role;
