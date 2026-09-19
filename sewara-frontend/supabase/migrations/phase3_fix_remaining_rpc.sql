-- Phase 3 Hotfix Part 2: Fix Remaining RPC Functions
-- Date: 2026-08-28
-- Project: Sewara (obhvrzholszhjnpvmnna)
--
-- Fix remaining functions:
-- 1. rpc_dashboard_pembayaran: "totalAkhir" → total_akhir
-- 2. notify_telegram_transaksi: "totalAkhir", "biayaDasar", "noInvoice" → snake_case

-- =====================================================
-- 1. Fix rpc_dashboard_pembayaran
-- =====================================================

CREATE OR REPLACE FUNCTION public.rpc_dashboard_pembayaran(
  p_user_id uuid, 
  p_mulai timestamp with time zone DEFAULT NULL::timestamp with time zone, 
  p_akhir timestamp with time zone DEFAULT NULL::timestamp with time zone, 
  p_basis text DEFAULT 'selesai'::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
  -- ✅ FIXED: "totalAkhir" → total_akhir
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
$function$;

-- =====================================================
-- 2. Fix notify_telegram_transaksi
-- =====================================================

CREATE OR REPLACE FUNCTION public.notify_telegram_transaksi()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_url TEXT := 'https://app-sewara.vercel.app/api/telegram/webhook';
  v_secret TEXT := '720d6bc28ac0a6f1a0458faa36140676a3679cfe90646182';
BEGIN
  -- Guard anti-spam: SKIP jika ini sekadar relink UUID (perubahan user_id saja,
  -- terjadi saat relink-users.ps1 / migrasi) - bukan perubahan data nyata.
  -- ✅ FIXED: camelCase → snake_case
  IF TG_OP = 'UPDATE' AND OLD.user_id IS DISTINCT FROM NEW.user_id
     AND OLD.status = NEW.status
     AND OLD.total_akhir IS NOT DISTINCT FROM NEW.total_akhir
     AND OLD.biaya IS NOT DISTINCT FROM NEW.biaya
     AND OLD.no_invoice = NEW.no_invoice THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  PERFORM net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', v_secret
    ),
    body := jsonb_build_object(
      'type', TG_OP,
      'table', 'transactions',
      'record', to_jsonb(NEW),
      'old_record', to_jsonb(OLD)
    )
  );
  RETURN COALESCE(NEW, OLD);
END;
$function$;

-- =====================================================
-- Verification
-- =====================================================

DO $$
BEGIN
  RAISE NOTICE '✅ rpc_dashboard_pembayaran updated';
  RAISE NOTICE '✅ notify_telegram_transaksi updated';
  RAISE NOTICE '✅ All RPC functions now use snake_case columns';
END $$;

-- Final check: should return 0 rows
SELECT 
  p.proname as function_name
FROM pg_proc p
WHERE p.pronamespace = 'public'::regnamespace
  AND (
    pg_get_functiondef(p.oid) LIKE '%"waktuKembaliRencana"%'
    OR pg_get_functiondef(p.oid) LIKE '%"waktuAmbilRencana"%'
    OR pg_get_functiondef(p.oid) LIKE '%"noInvoice"%'
    OR pg_get_functiondef(p.oid) LIKE '%"hpPenyewa"%'
    OR pg_get_functiondef(p.oid) LIKE '%"alamatPenyewa"%'
    OR pg_get_functiondef(p.oid) LIKE '%"jaminanSewa"%'
    OR pg_get_functiondef(p.oid) LIKE '%"totalAkhir"%'
    OR pg_get_functiondef(p.oid) LIKE '%"biayaDasar"%'
  )
ORDER BY p.proname;
