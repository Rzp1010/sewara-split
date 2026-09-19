-- ============================================================
-- SECURITY FIX: Tambahkan validasi auth.uid() = p_user_id
-- CRITICAL: Prevent privilege escalation vulnerability
-- ============================================================

-- Drop fungsi lama
DROP FUNCTION IF EXISTS public.rpc_dashboard_rekap_status(uuid, timestamptz, timestamptz);
DROP FUNCTION IF EXISTS public.rpc_dashboard_pembayaran(uuid, timestamptz, timestamptz, text);

-- ============================================================
-- RPC 1: Rekap Status Sewa (SECURE VERSION)
-- ============================================================
CREATE OR REPLACE FUNCTION public.rpc_dashboard_rekap_status(
  p_user_id uuid,
  p_mulai timestamptz DEFAULT NULL,
  p_akhir timestamptz DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
  SELECT
    COUNT(*) FILTER (WHERE status = 'Booking'),
    COUNT(*) FILTER (WHERE status = 'Disewa' AND ("waktuKembaliRencana" IS NULL OR "waktuKembaliRencana"::timestamptz >= now())),
    COUNT(*) FILTER (WHERE status = 'Disewa' AND "waktuKembaliRencana" IS NOT NULL 
      AND "waktuKembaliRencana"::timestamptz < now() 
      AND now() - "waktuKembaliRencana"::timestamptz <= v_batas_jam * interval '1 hour'),
    COUNT(*) FILTER (WHERE status = 'Disewa' AND "waktuKembaliRencana" IS NOT NULL 
      AND "waktuKembaliRencana"::timestamptz < now() 
      AND now() - "waktuKembaliRencana"::timestamptz > v_batas_jam * interval '1 hour')
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
$$;

-- ============================================================
-- RPC 2: Ringkasan Pembayaran (SECURE VERSION)
-- ============================================================
CREATE OR REPLACE FUNCTION public.rpc_dashboard_pembayaran(
  p_user_id uuid,
  p_mulai timestamptz DEFAULT NULL,
  p_akhir timestamptz DEFAULT NULL,
  p_basis text DEFAULT 'selesai'
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_total_akhir numeric := 0;
  v_diterima numeric := 0;
  v_tunai numeric := 0;
  v_transfer numeric := 0;
  v_qris numeric := 0;
BEGIN
  -- 🔒 SECURITY CHECK: Validasi p_user_id = authenticated user
  IF p_user_id != auth.uid() THEN
    RAISE EXCEPTION 'Unauthorized: user_id mismatch. Attempted access to user % by user %', 
                    p_user_id, auth.uid();
  END IF;

  -- Total Akhir
  SELECT COALESCE(SUM("totalAkhir"), 0) INTO v_total_akhir
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

  -- Total Diterima (sum semua riwayatBayar.jumlah)
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

  -- Per metode: Tunai
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

-- ============================================================
-- Index sudah ada, pastikan aktif
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_transactions_user_status_created 
ON public.transactions (user_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_transactions_user_created 
ON public.transactions (user_id, created_at DESC);

-- Reload PostgREST schema
NOTIFY pgrst, 'reload schema';

-- ============================================================
-- SECURITY AUDIT LOG
-- ============================================================
COMMENT ON FUNCTION public.rpc_dashboard_rekap_status IS 
'Dashboard RPC - SECURE VERSION with auth.uid() validation (2026-08-21)';

COMMENT ON FUNCTION public.rpc_dashboard_pembayaran IS 
'Dashboard RPC - SECURE VERSION with auth.uid() validation (2026-08-21)';
