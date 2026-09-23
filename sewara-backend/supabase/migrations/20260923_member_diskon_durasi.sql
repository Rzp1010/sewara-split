-- Fitur: diskon durasi sewa per tipe member
-- member_types.diskon_durasi_aturan: JSONB array [{min_hari, persentase}]
-- Contoh: [{"min_hari":1,"persentase":10},{"min_hari":2,"persentase":15},{"min_hari":7,"persentase":20}]
-- Array kosong [] = tipe tidak pakai aturan durasi (fallback ke diskon_persen fixed lama)
ALTER TABLE public.member_types
  ADD COLUMN IF NOT EXISTS diskon_durasi_aturan JSONB NOT NULL DEFAULT '[]'::jsonb;
