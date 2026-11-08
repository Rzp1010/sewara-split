-- 0012_pelanggan_hp_kanonik.sql — backfill hp_normal ke bentuk kanonik.
--
-- Aturan kanonik (HARUS sama dengan NormalisasiHP di internal/db/blacklist.go dan
-- hpNormal di sewara-frontend/src/lib/utils.js): buang non-digit; kalau panjang
-- >= 11 dan berawalan 62 buang "62"; kalau masih berawalan 0 buang satu "0".
-- Contoh: 0812-3456-789 -> 8123456789 ; +62 812 3456 789 -> 8123456789 ;
--          628123456789 -> 8123456789 ; 021-5551234 -> 215551234.
--
-- AMAN (disetujui user 2026-11-08): TIDAK ada baris yang dihapus atau digabung.
-- Baris yang berpotensi bertabrakan dengan baris lain (user + nama sama) tidak
-- disentuh sama sekali, jadi index unik `pelanggan_nama_hp_uniq` tidak mungkin
-- dilanggar. Baris kembar tetap ada; direktori pelanggan sudah menampilkannya
-- sebagai satu orang karena penggabungannya terjadi saat data dibaca.
--
-- Ledger TIDAK ditulis di sini (pengecualian §7 AGENTS.md); runner
-- (scripts/docker-staging.ps1 / staging-db.ps1) yang mencatatnya.

WITH kandidat AS (
    SELECT p.id,
           p.user_id,
           lower(btrim(p.nama)) AS nama_key,
           p.hp_normal,
           CASE
               WHEN left(d.digit, 2) = '62' AND length(d.digit) >= 11
                   THEN CASE WHEN left(substr(d.digit, 3), 1) = '0' THEN substr(d.digit, 4) ELSE substr(d.digit, 3) END
               WHEN left(d.digit, 1) = '0' THEN substr(d.digit, 2)
               ELSE d.digit
           END AS kanonik
    FROM public.pelanggan p
    CROSS JOIN LATERAL (
        SELECT regexp_replace(COALESCE(p.hp, ''), '[^0-9]', '', 'g') AS digit
    ) d
),
aman AS (
    SELECT k.id, k.kanonik
    FROM kandidat k
    WHERE k.kanonik <> ''
      AND k.kanonik IS DISTINCT FROM k.hp_normal
      AND NOT EXISTS (
          SELECT 1
          FROM kandidat o
          WHERE o.id <> k.id
            AND o.user_id = k.user_id
            AND o.nama_key = k.nama_key
            AND (
                o.kanonik = k.kanonik                              -- dua kandidat sama
                OR (o.hp_normal <> '' AND o.hp_normal = k.kanonik)  -- bentrok dengan nilai tersimpan tetangga
                OR o.kanonik = k.hp_normal                          -- tetangga akan menulis nilai yang sama
            )
      )
)
UPDATE public.pelanggan p
SET hp_normal = a.kanonik
FROM aman a
WHERE p.id = a.id;

-- Laporan bentrokan yang MASIH ada (jalankan manual di SQL Editor; migration
-- tidak menjalankannya). Kelompokkan per pasangan nama+nomor kanonik; baris
-- seperti ini sengaja dibiarkan utuh supaya bisa digabung manual kalau perlu.
--
-- WITH kandidat AS (
--   SELECT p.id, p.user_id, lower(btrim(p.nama)) AS nama_key, p.nama, p.hp, p.hp_normal,
--          regexp_replace(COALESCE(p.hp, ''), '[^0-9]', '', 'g') AS digit
--   FROM public.pelanggan p
-- ), kanonik AS (
--   SELECT *, CASE WHEN length(digit) >= 11 AND left(digit, 2) = '62'
--                   THEN CASE WHEN left(substr(digit, 3), 1) = '0' THEN substr(digit, 4) ELSE substr(digit, 3) END
--                  WHEN left(digit, 1) = '0' THEN substr(digit, 2)
--                  ELSE digit END AS hp_baru
--   FROM kandidat
-- )
-- SELECT user_id, nama_key, hp_baru, array_agg(id ORDER BY id) AS pelanggan_ids,
--        array_agg(hp_normal ORDER BY id) AS hp_normal_lama
-- FROM kanonik WHERE hp_baru <> ''
-- GROUP BY user_id, nama_key, hp_baru HAVING count(*) > 1;
