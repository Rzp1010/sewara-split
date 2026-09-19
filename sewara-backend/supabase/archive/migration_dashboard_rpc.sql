-- ============================================================
-- Optimasi Dashboard: 2 RPC untuk replace getRekapStatus & getPembayaranRentang
-- Aggregate di DB, return JSON siap pakai — O(1) relatif ukuran data
-- ============================================================

-- ============================================================
-- RPC 1: Rekap Status Sewa (replace getRekapStatus)
-- ============================================================
CREATE OR REPLACE FUNCTION public.rpc_dashboard_rekap_status(
  p_user_id uuid,
  p_mulai text DEFAULT NULL,
  p_akhir text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_booking int := 0; v_disewa int := 0; v_mendekati int := 0; v_telat int := 0;
  v_belum int := 0; v_selesai int := 0;
  v_batas_jam int := COALESCE((
    SELECT value::int FROM settings WHERE user_id = p_user_id AND key = 'notif_jam'
  ), 2);
BEGIN
  -- Hitung booking, disewa, mendekati, telat dalam 1 query pakai index (user_id, status, created_at)
  SELECT
    COUNT(*) FILTER (WHERE status = 'Booking'),
    COUNT(*) FILTER (WHERE status = 'Disewa' AND ("waktuKembaliRencana" IS NULL OR "waktuKembaliRencana" >= now())),
    COUNT(*) FILTER (WHERE status = 'Disewa' AND "waktuKembaliRencana" IS NOT NULL 
      AND "waktuKembaliRencana" < now() 
      AND "waktuKembaliRencana" - now() <= v_batas_jam * interval '1 hour'),
    COUNT(*) FILTER (WHERE status = 'Disewa' AND "waktuKembaliRencana" IS NOT NULL 
      AND "waktuKembaliRencana" < now() 
      AND "waktuKembaliRencana" - now() > v_batas_jam * interval '1 hour')
  INTO v_booking, v_disewa, v_mendekati, v_telat
  FROM transactions
  WHERE user_id = p_user_id
    AND status IN ('Booking', 'Disewa')
    AND (p_mulai IS NULL OR created_at >= p_mulai::timestamptz)
    AND (p_akhir IS NULL OR created_at <= p_akhir::timestamptz);

  -- Belum Selesai & Selesai
  SELECT COUNT(*) INTO v_belum
  FROM transactions
  WHERE user_id = p_user_id
    AND status = 'Belum Selesai'
    AND (p_mulai IS NULL OR created_at >= p_mulai::timestamptz)
    AND (p_akhir IS NULL OR created_at <= p_akhir::timestamptz);

  SELECT COUNT(*) INTO v_selesai
  FROM transactions
  WHERE user_id = p_user_id
    AND status = 'Selesai'
    AND (p_mulai IS NULL OR created_at >= p_mulai::timestamptz)
    AND (p_akhir IS NULL OR created_at <= p_akhir::timestamptz);

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
-- RPC 2: Ringkasan Pembayaran (replace getPembayaranRentang)
-- ============================================================
CREATE OR REPLACE FUNCTION public.rpc_dashboard_pembayaran(
  p_user_id uuid,
  p_mulai text DEFAULT NULL,
  p_akhir text DEFAULT NULL,
  p_basis text DEFAULT 'selesai'  -- 'selesai' | 'aktif'
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_total_akhir numeric := 0;
  v_diterima numeric := 0;
  v_tunai numeric := 0;
  v_transfer numeric := 0;
  v_qris numeric := 0;
BEGIN
  -- Base query: transaksi dalam rentang, filter status
  WITH trx AS (
    SELECT t."totalAkhir", t.pembayaran
    FROM transactions t
    WHERE t.user_id = p_user_id
      AND t.status != 'Dibatalkan'
      AND (
        (p_basis = 'selesai' AND t.status = 'Selesai')
        OR (p_basis = 'aktif' AND t.status IN ('Selesai', 'Disewa'))
      )
      AND (p_mulai IS NULL OR t.created_at >= p_mulai::timestamptz)
      AND (p_akhir IS NULL OR t.created_at <= p_akhir::timestamptz)
  )
  -- Total akhir & diterima
  SELECT
    COALESCE(SUM("totalAkhir"), 0),
    COALESCE(SUM(
      COALESCE(
        (SELECT SUM((bayar->>'jumlah')::numeric)
         FROM jsonb_array_elements(COALESCE((pembayaran->>'riwayatBayar')::jsonb, '[]'::jsonb)) bayar),
        0
      )
    ), 0)
  INTO v_total_akhir, v_diterima
  FROM trx;

  -- Per metode
  SELECT COALESCE(SUM((bayar->>'jumlah')::numeric), 0) INTO v_tunai
  FROM trx,
  LATERAL jsonb_array_elements(COALESCE((pembayaran->>'riwayatBayar')::jsonb, '[]'::jsonb)) bayar
  WHERE bayar->>'metode' = 'Tunai';

  SELECT COALESCE(SUM((bayar->>'jumlah')::numeric), 0) INTO v_transfer
  FROM trx,
  LATERAL jsonb_array_elements(COALESCE((pembayaran->>'riwayatBayar')::jsonb, '[]'::jsonb)) bayar
  WHERE bayar->>'metode' = 'Transfer';

  SELECT COALESCE(SUM((bayar->>'jumlah')::numeric), 0) INTO v_qris
  FROM trx,
  LATERAL jsonb_array_elements(COALESCE((pembayaran->>'riwayatBayar')::jsonb, '[]'::jsonb)) bayar
  WHERE bayar->>'metode' = 'QRIS';

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
-- Index Wajib (sudah ada di Phase 1, tapi pastikan jalan)
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_transactions_user_status_created 
ON public.transactions (user_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_transactions_user_created 
ON public.transactions (user_id, created_at DESC);

NOTIFY pgrst, 'reload schema';