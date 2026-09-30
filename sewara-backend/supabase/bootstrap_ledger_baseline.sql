-- Baseline ledger — jalankan SEKALI per project DB, SETELAH tabel schema_migrations ada.
-- Semua perubahan sebelum 2026-09-30 tidak dicatat per-file (era pre-ledger):
--   * PRODUKSI : kondisi skemanya sudah final per tanggal itu (ground truth = dump pg_catalog).
--   * DEV      : dibuat dari schema_prod_20260930.sql = kondisi produksi tanggal itu.
-- Mulai sekarang, setiap migration baru dicatat individual. Jangan insert baseline ini dua kali (idempotent).

INSERT INTO schema_migrations (filename)
VALUES ('<<baseline: seluruh skema s.d. 2026-09-30, lihat schema_prod_20260930.sql>>')
ON CONFLICT (filename) DO NOTHING;
