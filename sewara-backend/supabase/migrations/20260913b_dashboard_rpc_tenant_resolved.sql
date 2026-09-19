-- Migration 2026-09-13b: dashboard RPC menerima tenant caller (staf lihat data tenant).
-- MASALAH: guard lama `p_user_id != auth.uid() → EXCEPTION` — staf wajib kirim uid sendiri,
--   padahal transaksi tenant disimpan di bawah uid owner → widget rekap/pembayaran staf selalu NOL.
-- FIX: guard resolve tenant caller (COALESCE(owner_id, user_id) profil aktif) — staf boleh
--   kirim p_user_id = uid owner; owner tetap kirim uid sendiri (owner_id NULL → COALESCE menutup).
-- Body TIDAK diubah — semua WHERE user_id = p_user_id otomatis benar setelah guard resolve tenant.
-- rekap_status baca settings.notif_jam per p_user_id → setelah fix = settings owner (benar untuk tenant).
-- ROLLBACK: jalankan ulang supabase/migration_dashboard_rpc_security_fix.sql.
-- Jalankan manual di SQL Editor DB sewara (obhvrzholszhjnpvmnna).
BEGIN;

-- ============================================================
-- RPC 1: Rekap Status Sewa — tenant-resolved
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
  v_tenant uuid;
BEGIN
  -- SECURITY CHECK: p_user_id harus = tenant caller (owner: dirinya; staf: owner-nya).
  SELECT COALESCE(p.owner_id, p.user_id) INTO v_tenant
  FROM public.profiles p WHERE p.user_id = auth.uid() AND p.is_active;

  IF v_tenant IS NULL OR p_user_id != v_tenant THEN
    RAISE EXCEPTION 'Unauthorized: tenant mismatch. Attempted access to user % by user %',
                    p_user_id, auth.uid();
  END IF;

  -- Ambil notif_jam dari settings (tenant = owner)
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
-- RPC 2: Ringkasan Pembayaran — tenant-resolved
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
  v_tenant uuid;
BEGIN
  -- SECURITY CHECK: p_user_id harus = tenant caller (owner: dirinya; staf: owner-nya).
  SELECT COALESCE(p.owner_id, p.user_id) INTO v_tenant
  FROM public.profiles p WHERE p.user_id = auth.uid() AND p.is_active;

  IF v_tenant IS NULL OR p_user_id != v_tenant THEN
    RAISE EXCEPTION 'Unauthorized: tenant mismatch. Attempted access to user % by user %',
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

COMMENT ON FUNCTION public.rpc_dashboard_rekap_status IS
  'Dashboard RPC - tenant-resolved (staff lihat data owner-nya) 2026-09-13';
COMMENT ON FUNCTION public.rpc_dashboard_pembayaran IS
  'Dashboard RPC - tenant-resolved (staff lihat data owner-nya) 2026-09-13';

COMMIT;
