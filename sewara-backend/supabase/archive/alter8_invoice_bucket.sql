-- =============================================================
-- MIGRASI BUCKET STORAGE UNTUK LOGO INVOICE
--   - Buat bucket `invoice-logo` (public read) untuk menyimpan logo invoice
--   - Policy: baca oleh semua authenticated, tulis/update oleh sesama user
-- Jalankan di SQL Editor dashboard Supabase KEDUA project:
--   - PRIBADI: wbujlusshrrvkjjxkhtj
--   - TESTER:  srgmeoipuybrkhsxmtsf
-- =============================================================

-- 1. Buat bucket (jika belum ada) + beri public read
INSERT INTO storage.buckets (id, name, public)
VALUES ('invoice-logo', 'invoice-logo', true)
ON CONFLICT (id) DO NOTHING;

-- 2. Policy READ: siapa pun authenticated boleh melihat logo
DROP POLICY IF EXISTS "Invoice logo public read" ON storage.objects;
CREATE POLICY "Invoice logo public read"
  ON storage.objects FOR SELECT TO authenticated, anon
  USING (bucket_id = 'invoice-logo');

-- 3. Policy INSERT/UPDATE/DELETE: user boleh kelola file di folder-nya sendiri
DROP POLICY IF EXISTS "Invoice logo owner manage" ON storage.objects;
CREATE POLICY "Invoice logo owner manage"
  ON storage.objects FOR ALL TO authenticated
  USING (bucket_id = 'invoice-logo' AND (storage.foldername(name))[1] = auth.uid()::text)
  WITH CHECK (bucket_id = 'invoice-logo' AND (storage.foldername(name))[1] = auth.uid()::text);