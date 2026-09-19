-- Fitur Tag Kategori di Inventaris
-- Jalankan di SQL Editor dashboard Supabase pribadi (wbujlusshrrvkjjxkhtj) SEBELUM deploy.
ALTER TABLE inventory ADD COLUMN IF NOT EXISTS tag TEXT;
