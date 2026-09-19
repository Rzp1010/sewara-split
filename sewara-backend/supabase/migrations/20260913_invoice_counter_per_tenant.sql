-- Migration 2026-09-13: invoice counter per-TENANT (owner + staf satu counter).
-- MASALAH: increment_invoice_counter pakai auth.uid() — owner dan staf masing-masing
-- punya counter sendiri → dua-duanya bisa mengeluarkan INV-000001 di tenant yang sama.
-- FIX: resolve owner aktif via COALESCE(owner_id, user_id) dari profiles.
-- AMAN: owner owner_id NULL → fallback user_id = perilaku lama persis.
--       Counter lama milik staf jadi baris mati (tidak dibaca lagi), tidak diganggu.
-- Signature SAMA seperti asli (alter7_settings.sql): increment_invoice_counter(step int) RETURNS int.
-- ROLLBACK: jalankan ulang blok "3. Fungsi increment counter" dari supabase/alter7_settings.sql.
-- Jalankan manual di SQL Editor DB sewara (obhvrzholszhjnpvmnna).
BEGIN;

CREATE OR REPLACE FUNCTION public.increment_invoice_counter(step int)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  v_owner uuid;
  new_val int;
  curr_val int;
BEGIN
  -- Tenant aktif pemanggil: staf -> owner_id; owner -> dirinya (COALESCE menutup owner_id NULL).
  SELECT COALESCE(p.owner_id, p.user_id) INTO v_owner
  FROM public.profiles p
  WHERE p.user_id = uid AND p.is_active;

  IF v_owner IS NULL THEN RAISE EXCEPTION 'active profile required'; END IF;

  -- Ambil nilai saat ini, bersihkan quotes jika ada (identik alter7).
  SELECT COALESCE(NULLIF(regexp_replace(value, '^"|"$', '', 'g'), '')::int, 0) INTO curr_val
  FROM settings WHERE user_id = v_owner AND key = 'invoice_counter';

  new_val := curr_val + step;

  INSERT INTO settings (user_id, key, value)
  VALUES (v_owner, 'invoice_counter', new_val::text)
  ON CONFLICT (user_id, key)
  DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();

  RETURN new_val;
END;
$$;

COMMIT;
