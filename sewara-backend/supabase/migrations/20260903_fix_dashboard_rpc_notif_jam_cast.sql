-- Fix dashboard notif_jam JSON scalar conversion.
-- Preserve deployed rpc_dashboard_rekap_status behavior and signature.

BEGIN;

CREATE OR REPLACE FUNCTION public.rpc_dashboard_rekap_status(
  p_user_id uuid,
  p_mulai timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_akhir timestamp with time zone DEFAULT NULL::timestamp with time zone
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_booking int := 0;
  v_disewa int := 0;
  v_mendekati int := 0;
  v_telat int := 0;
  v_belum int := 0;
  v_selesai int := 0;
  v_batas_jam int;
BEGIN
  -- SECURITY CHECK: Validasi p_user_id = authenticated user
  IF p_user_id != auth.uid() THEN
    RAISE EXCEPTION 'Unauthorized: user_id mismatch. Attempted access to user % by user %',
                    p_user_id, auth.uid();
  END IF;

  -- Extract JSON scalar text, remove JSON quotes, and default invalid values to 2.
  v_batas_jam := COALESCE((
    SELECT CASE
      WHEN NULLIF(btrim(value::text, '"'), '') ~ '^-?[0-9]+$'
        AND btrim(value::text, '"')::numeric BETWEEN -2147483648 AND 2147483647
        THEN btrim(value::text, '"')::int
      ELSE NULL
    END
    FROM settings
    WHERE user_id = p_user_id AND key = 'notif_jam'
  ), 2);

  SELECT
    COUNT(*) FILTER (WHERE status = 'Booking'),
    COUNT(*) FILTER (WHERE status = 'Disewa' AND (waktu_kembali_rencana IS NULL OR waktu_kembali_rencana >= now())),
    COUNT(*) FILTER (WHERE status = 'Disewa' AND waktu_kembali_rencana IS NOT NULL
      AND waktu_kembali_rencana < now()
      AND now() - waktu_kembali_rencana <= v_batas_jam * interval '1 hour'),
    COUNT(*) FILTER (WHERE status = 'Disewa' AND waktu_kembali_rencana IS NOT NULL
      AND waktu_kembali_rencana < now()
      AND now() - waktu_kembali_rencana > v_batas_jam * interval '1 hour')
  INTO v_booking, v_disewa, v_mendekati, v_telat
  FROM transactions
  WHERE user_id = p_user_id
    AND status IN ('Booking', 'Disewa')
    AND (p_mulai IS NULL OR created_at >= p_mulai)
    AND (p_akhir IS NULL OR created_at <= p_akhir);

  SELECT COUNT(*) INTO v_belum
  FROM transactions
  WHERE user_id = p_user_id
    AND status = 'Belum Selesai'
    AND (p_mulai IS NULL OR created_at >= p_mulai)
    AND (p_akhir IS NULL OR created_at <= p_akhir);

  SELECT COUNT(*) INTO v_selesai
  FROM transactions
  WHERE user_id = p_user_id
    AND status = 'Selesai'
    AND (p_mulai IS NULL OR created_at >= p_mulai)
    AND (p_akhir IS NULL OR created_at <= p_akhir);

  RETURN jsonb_build_object(
    'booking', v_booking,
    'disewa', v_disewa,
    'mendekati', v_mendekati,
    'telat', v_telat,
    'belumSelesai', v_belum,
    'selesai', v_selesai
  );
END;
$function$;

-- CREATE OR REPLACE preserves existing function permissions.
NOTIFY pgrst, 'reload schema';

COMMIT;

-- Verification SQL:
-- SELECT pg_get_functiondef('public.rpc_dashboard_rekap_status(uuid,timestamptz,timestamptz)'::regprocedure);
-- SELECT proacl FROM pg_proc WHERE oid = 'public.rpc_dashboard_rekap_status(uuid,timestamptz,timestamptz)'::regprocedure;
-- SELECT public.rpc_dashboard_rekap_status(auth.uid(), NULL, NULL);
