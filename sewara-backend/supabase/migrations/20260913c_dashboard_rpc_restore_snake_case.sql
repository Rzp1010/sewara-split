-- Migration 2026-09-13c: PERBAIKAN regression 20260913b.
-- 20260913b salah menimpa RPC live dengan body camelCase dari file repo stale
--   ("waktuKembaliRencana"/"totalAkhir" — kolom itu sudah tidak ada; skema = snake_case).
-- VERSI BENAR yang tertimpa (rekap): supabase/migrations/20260903_fix_dashboard_rpc_notif_jam_cast.sql
--   — snake_case + parsing notif_jam tahan JSON-quotes.
-- Pembayaran: body identik versi live, kolom total_akhir (snake_case); JSON key
--   "riwayatBayar" tetap camelCase (JSON content, bukan kolom).
-- GUARD tenant-resolved (staf boleh kirim p_user_id = uid owner) tetap dipertahankan
--   — itu fitur 20260913b yang benar; yang salah hanya kolom.
-- ROLLBACK: jalankan ulang file ini tidak diperlukan; untuk kembali ke guard lama,
--   jalankan 20260903 lalu ganti guard secara manual (atau minta orchestrator).
-- Jalankan manual di SQL Editor DB sewara (obhvrzholszhjnpvmnna).
BEGIN;

-- ============================================================
-- RPC 1: Rekap Status — base 20260903 (snake_case + notif_jam robust) + guard tenant
-- ============================================================
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
  v_tenant uuid;
BEGIN
  -- SECURITY CHECK: p_user_id harus = tenant caller (owner: dirinya; staf: owner-nya).
  SELECT COALESCE(p.owner_id, p.user_id) INTO v_tenant
  FROM public.profiles p WHERE p.user_id = auth.uid() AND p.is_active;

  IF v_tenant IS NULL OR p_user_id != v_tenant THEN
    RAISE EXCEPTION 'Unauthorized: tenant mismatch. Attempted access to user % by user %',
                    p_user_id, auth.uid();
  END IF;

  -- Extract JSON scalar text, remove JSON quotes, default invalid ke 2 (identik 20260903).
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

-- ============================================================
-- RPC 2: Pembayaran — kolom total_akhir (snake_case) + guard tenant
-- ============================================================
CREATE OR REPLACE FUNCTION public.rpc_dashboard_pembayaran(
  p_user_id uuid,
  p_mulai timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_akhir timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_basis text DEFAULT 'selesai'
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_total_akhir numeric := 0;
  v_diterima numeric := 0;
  v_tunai numeric := 0;
  v_transfer numeric := 0;
  v_qris numeric := 0;
  v_tenant uuid;
BEGIN
  -- SECURITY CHECK: p_user_id harus = tenant caller (owner: dirinya; staf: owner-nya).
  SELECT COALESCE(p.owner_id, p.user_id) INTO v_tenant
  FROM public.profiles p WHERE p.user_id = auth.uid() AND p.is_active;

  IF v_tenant IS NULL OR p_user_id != v_tenant THEN
    RAISE EXCEPTION 'Unauthorized: tenant mismatch. Attempted access to user % by user %',
                    p_user_id, auth.uid();
  END IF;

  -- Total Akhir (kolom snake_case)
  SELECT COALESCE(SUM(total_akhir), 0) INTO v_total_akhir
  FROM transactions
  WHERE user_id = p_user_id
    AND status != 'Dibatalkan'
    AND (
      (p_basis = 'selesai' AND status = 'Selesai')
      OR (p_basis = 'aktif' AND status IN ('Selesai', 'Disewa'))
      OR (p_basis = 'semua')
    )
    AND (p_mulai IS NULL OR created_at >= p_mulai)
    AND (p_akhir IS NULL OR created_at <= p_akhir);

  -- Total Diterima (JSON key riwayatBayar — bukan kolom, tetap camelCase)
  SELECT COALESCE(SUM((bayar->>'jumlah')::numeric), 0) INTO v_diterima
  FROM transactions t,
  LATERAL jsonb_array_elements(
    COALESCE((t.pembayaran->>'riwayatBayar')::jsonb, '[]'::jsonb)
  ) AS bayar
  WHERE t.user_id = p_user_id
    AND t.status != 'Dibatalkan'
    AND (
      (p_basis = 'selesai' AND t.status = 'Selesai')
      OR (p_basis = 'aktif' AND t.status IN ('Selesai', 'Disewa'))
      OR (p_basis = 'semua')
    )
    AND (p_mulai IS NULL OR t.created_at >= p_mulai)
    AND (p_akhir IS NULL OR t.created_at <= p_akhir);

  -- Tunai
  SELECT COALESCE(SUM((bayar->>'jumlah')::numeric), 0) INTO v_tunai
  FROM transactions t,
  LATERAL jsonb_array_elements(
    COALESCE((t.pembayaran->>'riwayatBayar')::jsonb, '[]'::jsonb)
  ) AS bayar
  WHERE t.user_id = p_user_id
    AND t.status != 'Dibatalkan'
    AND (
      (p_basis = 'selesai' AND t.status = 'Selesai')
      OR (p_basis = 'aktif' AND t.status IN ('Selesai', 'Disewa'))
      OR (p_basis = 'semua')
    )
    AND (p_mulai IS NULL OR t.created_at >= p_mulai)
    AND (p_akhir IS NULL OR t.created_at <= p_akhir)
    AND bayar->>'metode' = 'Tunai';

  -- Transfer
  SELECT COALESCE(SUM((bayar->>'jumlah')::numeric), 0) INTO v_transfer
  FROM transactions t,
  LATERAL jsonb_array_elements(
    COALESCE((t.pembayaran->>'riwayatBayar')::jsonb, '[]'::jsonb)
  ) AS bayar
  WHERE t.user_id = p_user_id
    AND t.status != 'Dibatalkan'
    AND (
      (p_basis = 'selesai' AND t.status = 'Selesai')
      OR (p_basis = 'aktif' AND t.status IN ('Selesai', 'Disewa'))
      OR (p_basis = 'semua')
    )
    AND (p_mulai IS NULL OR t.created_at >= p_mulai)
    AND (p_akhir IS NULL OR t.created_at <= p_akhir)
    AND bayar->>'metode' = 'Transfer';

  -- QRIS
  SELECT COALESCE(SUM((bayar->>'jumlah')::numeric), 0) INTO v_qris
  FROM transactions t,
  LATERAL jsonb_array_elements(
    COALESCE((t.pembayaran->>'riwayatBayar')::jsonb, '[]'::jsonb)
  ) AS bayar
  WHERE t.user_id = p_user_id
    AND t.status != 'Dibatalkan'
    AND (
      (p_basis = 'selesai' AND t.status = 'Selesai')
      OR (p_basis = 'aktif' AND t.status IN ('Selesai', 'Disewa'))
      OR (p_basis = 'semua')
    )
    AND (p_mulai IS NULL OR t.created_at >= p_mulai)
    AND (p_akhir IS NULL OR t.created_at <= p_akhir)
    AND bayar->>'metode' = 'QRIS';

  RETURN jsonb_build_object(
    'totalAkhir', v_total_akhir,
    'diterima', v_diterima,
    'tunai', v_tunai,
    'transfer', v_transfer,
    'qris', v_qris
  );
END;
$$;

NOTIFY pgrst, 'reload schema';

COMMIT;
