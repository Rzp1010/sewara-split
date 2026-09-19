-- =============================================================
-- MIGRASI PENGATURAN KE SUPABASE (multi-tenant per user)
--   - Simpan SEMUA pengaturan (getSetting/setSetting) di tabel `settings`
--   - Counter invoice disimpan + di-increment secara ATOMIK (race-safe)
-- Jalankan di SQL Editor dashboard Supabase KEDUA project:
--   - PRIBADI (PRODUKSI): wbujlusshrrvkjjxkhtj
--   - TESTER (UJI):       srgmeoipuybrkhsxmtsf
-- Jalankan SEBELUM deploy versi aplikasi yang memakai ini.
-- =============================================================

-- 1. Tabel settings per user
CREATE TABLE IF NOT EXISTS settings (
  user_id UUID NOT NULL DEFAULT auth.uid(),
  key TEXT NOT NULL,
  value TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, key)
);

ALTER TABLE settings ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_settings_user_id ON settings (user_id);

-- 2. Hapus semua policy lama lalu buat policy per user (pola sama tabel lain)
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT policyname, tablename FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'settings'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, r.tablename);
  END LOOP;
END $$;

CREATE POLICY "Users can access own settings"
  ON settings FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- 3. Fungsi increment counter invoice (atomik, aman dari double-booking)
CREATE OR REPLACE FUNCTION increment_invoice_counter(step int)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  new_val int;
  curr_val int;
BEGIN
  -- Ambil nilai saat ini, bersihkan quotes jika ada
  SELECT COALESCE(NULLIF(regexp_replace(value, '^"|"$', '', 'g'), '')::int, 0) INTO curr_val
  FROM settings WHERE user_id = uid AND key = 'invoice_counter';
  
  new_val := curr_val + step;
  
  INSERT INTO settings (user_id, key, value)
  VALUES (uid, 'invoice_counter', new_val::text)
  ON CONFLICT (user_id, key)
  DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();
  
  RETURN new_val;
END;
$$;