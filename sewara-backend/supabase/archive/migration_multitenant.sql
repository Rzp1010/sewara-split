-- =============================================================
-- MIGRATION MULTI-TENANT (user_id + RLS per user)
-- KHUSUS PROJECT UJI / TESTER (Supabase DB: srgmeoipuybrkhsxmtsf)
-- JANGAN dijalankan di project PRODUKSI (wbujlusshrrvkjjxkhtj).
--
-- Cara: Dashboard Supabase -> project UJI -> SQL Editor -> paste -> Run
--
-- Efek:
--   - Semua tabel mendapat kolom user_id (default = uid user yang login)
--   - Data existing di-backfill ke pemilik lama (test@owner.com)
--   - RLS berubah dari "semua authenticated lihat semua" -> "per user"
-- =============================================================

-- 1. Tambah kolom user_id (uuid, default = id user yang login)
ALTER TABLE inventory ADD COLUMN IF NOT EXISTS user_id UUID DEFAULT auth.uid();
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS user_id UUID DEFAULT auth.uid();
ALTER TABLE logs ADD COLUMN IF NOT EXISTS user_id UUID DEFAULT auth.uid();

-- 2. Backfill: data existing jadi milik test@owner.com
--    (agar data high-load 2200/11007/55003 tetap terlihat oleh akun tersebut)
UPDATE inventory SET user_id = u.id
  FROM auth.users u WHERE u.email = 'test@owner.com' AND inventory.user_id IS NULL;
UPDATE transactions SET user_id = u.id
  FROM auth.users u WHERE u.email = 'test@owner.com' AND transactions.user_id IS NULL;
UPDATE logs SET user_id = u.id
  FROM auth.users u WHERE u.email = 'test@owner.com' AND logs.user_id IS NULL;

-- 3. Index untuk performa query per user
CREATE INDEX IF NOT EXISTS idx_inventory_user_id ON inventory (user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON transactions (user_id);
CREATE INDEX IF NOT EXISTS idx_logs_user_id ON logs (user_id);

-- 4. Hapus SEMUA policy lama di 3 tabel, lalu buat policy per user.
--    (pakai dynamic SQL supaya nama policy lama yang berbeda pun ikut terhapus)
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT policyname, tablename FROM pg_policies
    WHERE schemaname = 'public' AND tablename IN ('inventory', 'transactions', 'logs')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, r.tablename);
  END LOOP;
END $$;

CREATE POLICY "Users can access own inventory"
  ON inventory FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can access own transactions"
  ON transactions FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can access own logs"
  ON logs FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
