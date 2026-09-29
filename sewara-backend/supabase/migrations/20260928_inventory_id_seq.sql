-- Inventory id pakai sequence DB asli (atomik) — hapus kebutuhan generate max+1 di aplikasi.
-- Jalankan SEKALI di project produksi (obhvrzholszhjnpvmnna) via SQL Editor SEBELUM deploy
-- route.ts versi "id dari default". after = urutan deploy benar.
--
-- Catatan: kolom id numeric sudah berisi timestamp-ms (era pre-split). Sequence dimulai
-- dari MAX(id)+1 sehingga id baru tetap unik global dan tidak pernah mundur.
BEGIN;

CREATE SEQUENCE IF NOT EXISTS inventory_id_seq;

SELECT setval(
  'inventory_id_seq',
  COALESCE((SELECT MAX(id) FROM public.inventory), 0),
  true  -- nextval() = MAX(id)+1
);

ALTER TABLE public.inventory
  ALTER COLUMN id SET DEFAULT nextval('inventory_id_seq');

ALTER SEQUENCE public.inventory_id_seq OWNED BY public.inventory.id;

COMMIT;

-- Verifikasi setelah jalan:
-- SELECT last_value, is_called FROM inventory_id_seq;   -- next id = last_value+1
-- INSERT menghasilkan id baru otomatis (tanpa kirim id).
