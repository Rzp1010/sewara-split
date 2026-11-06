-- 0011_pelanggan_identitas.sql — identitas pelanggan = PASANGAN nama + HP.
--
-- Aturan tenant (dikonfirmasi 2026-11-06): identitas nempel di pasangan
-- nama+no HP. HP sama dengan nama berbeda = orang berbeda; nama sama dengan
-- HP berbeda = orang berbeda juga. Satu-satunya pengecualian: tenant mengubah
-- no HP pelanggan yang sudah terdaftar (itu UPDATE baris yang sama).
--
-- Index lama `pelanggan_hp_uniq (user_id, hp_normal)` melanggar aturan itu:
-- satu HP dipakai beberapa nama (data nyata: hp=123 → Agung | sda | test
-- tabrakan) akan gagal insert / tertukar baris.
--
-- Ledger TIDAK ditulis di sini (pengecualian §7 AGENTS.md); runner
-- (scripts/docker-staging.ps1 / staging-db.ps1) yang mencatatnya.

BEGIN;

DROP INDEX IF EXISTS public.pelanggan_hp_uniq;

-- HP terisi → identitas = pasangan nama (lower/trim) + hp_normal.
CREATE UNIQUE INDEX IF NOT EXISTS pelanggan_nama_hp_uniq
  ON public.pelanggan (user_id, lower(btrim(nama)), hp_normal)
  WHERE hp_normal <> '';

-- HP kosong → identitas = nama saja (index dari 0009, dipertahankan eksplisit).
CREATE UNIQUE INDEX IF NOT EXISTS pelanggan_nama_uniq
  ON public.pelanggan (user_id, lower(btrim(nama)))
  WHERE hp_normal = '';

COMMIT;
