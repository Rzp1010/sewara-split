-- Phase 3 Hotfix: Update RPC Functions to Use Snake_case Columns
-- Date: 2026-08-28
-- Project: Sewara (obhvrzholszhjnpvmnna)
--
-- Issue: RPC functions still reference dropped camelCase columns
-- Fix: Replace "waktuKembaliRencana" → waktu_kembali_rencana

-- =====================================================
-- Fix rpc_dashboard_rekap_status
-- =====================================================

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
  -- 🔒 SECURITY CHECK: Validasi p_user_id = authenticated user
  IF p_user_id != auth.uid() THEN
    RAISE EXCEPTION 'Unauthorized: user_id mismatch. Attempted access to user % by user %', 
                    p_user_id, auth.uid();
  END IF;

  -- Ambil notif_jam dari settings
  v_batas_jam := COALESCE((
    SELECT value::int FROM settings WHERE user_id = p_user_id AND key = 'notif_jam'
  ), 2);

  -- Hitung booking, disewa, mendekati, telat dalam 1 query
  -- ✅ FIXED: waktuKembaliRencana → waktu_kembali_rencana
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

  -- Belum Selesai
  SELECT COUNT(*) INTO v_belum
  FROM transactions
  WHERE user_id = p_user_id
    AND status = 'Belum Selesai'
    AND (p_mulai IS NULL OR created_at >= p_mulai)
    AND (p_akhir IS NULL OR created_at <= p_akhir);

  -- Selesai
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

-- =====================================================
-- Verification
-- =====================================================

DO $$
BEGIN
  RAISE NOTICE '✅ rpc_dashboard_rekap_status updated to use snake_case columns';
END $$;

-- =====================================================
-- Check if other RPC functions need fixing
-- =====================================================

-- Search for other functions with camelCase references
SELECT 
  p.proname as function_name
FROM pg_proc p
WHERE p.pronamespace = 'public'::regnamespace
  AND (
    pg_get_functiondef(p.oid) LIKE '%waktuKembaliRencana%'
    OR pg_get_functiondef(p.oid) LIKE '%waktuAmbilRencana%'
    OR pg_get_functiondef(p.oid) LIKE '%noInvoice%'
    OR pg_get_functiondef(p.oid) LIKE '%hpPenyewa%'
    OR pg_get_functiondef(p.oid) LIKE '%alamatPenyewa%'
    OR pg_get_functiondef(p.oid) LIKE '%jaminanSewa%'
    OR pg_get_functiondef(p.oid) LIKE '%totalAkhir%'
  )
ORDER BY p.proname;

-- If this returns any rows, those functions also need fixing
