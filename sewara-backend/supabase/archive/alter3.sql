-- Drop lowercase columns from previous wrong alter
ALTER TABLE inventory DROP COLUMN IF EXISTS tipesewa;
ALTER TABLE inventory DROP COLUMN IF EXISTS kondisi;
ALTER TABLE inventory DROP COLUMN IF EXISTS keterangan;
ALTER TABLE inventory DROP COLUMN IF EXISTS tarif;
ALTER TABLE transactions DROP COLUMN IF EXISTS noinvoice;
ALTER TABLE transactions DROP COLUMN IF EXISTS hppenyewa;
ALTER TABLE transactions DROP COLUMN IF EXISTS alamatpenyewa;
ALTER TABLE transactions DROP COLUMN IF EXISTS jaminansewa;
ALTER TABLE transactions DROP COLUMN IF EXISTS waktuambilrencana;
ALTER TABLE transactions DROP COLUMN IF EXISTS waktukembalirencana;
ALTER TABLE transactions DROP COLUMN IF EXISTS waktuambilaktual;
ALTER TABLE transactions DROP COLUMN IF EXISTS waktukembaliaktual;
ALTER TABLE transactions DROP COLUMN IF EXISTS durasiteks;
ALTER TABLE transactions DROP COLUMN IF EXISTS biayadasar;
ALTER TABLE transactions DROP COLUMN IF EXISTS dendatambahan;
ALTER TABLE transactions DROP COLUMN IF EXISTS totalakhir;
ALTER TABLE logs DROP COLUMN IF EXISTS waktu;
ALTER TABLE logs DROP COLUMN IF EXISTS aktivitas;
ALTER TABLE logs DROP COLUMN IF EXISTS detail;
ALTER TABLE logs DROP COLUMN IF EXISTS catatan;

-- Re-create with proper quoted camelCase
ALTER TABLE inventory ADD COLUMN "tipeSewa" TEXT DEFAULT 'fleksibel';
ALTER TABLE inventory ADD COLUMN "kondisi" TEXT DEFAULT 'Baik';
ALTER TABLE inventory ADD COLUMN "keterangan" TEXT DEFAULT '-';
ALTER TABLE inventory ADD COLUMN "tarif" TEXT;

ALTER TABLE transactions ADD COLUMN "noInvoice" TEXT;
ALTER TABLE transactions ADD COLUMN "hpPenyewa" TEXT;
ALTER TABLE transactions ADD COLUMN "alamatPenyewa" TEXT;
ALTER TABLE transactions ADD COLUMN "jaminanSewa" TEXT;
ALTER TABLE transactions ADD COLUMN "waktuAmbilRencana" TEXT;
ALTER TABLE transactions ADD COLUMN "waktuKembaliRencana" TEXT;
ALTER TABLE transactions ADD COLUMN "waktuAmbilAktual" TEXT;
ALTER TABLE transactions ADD COLUMN "waktuKembaliAktual" TEXT;
ALTER TABLE transactions ADD COLUMN "durasiTeks" TEXT;
ALTER TABLE transactions ADD COLUMN "biayaDasar" NUMERIC DEFAULT 0;
ALTER TABLE transactions ADD COLUMN "dendaTambahan" NUMERIC DEFAULT 0;
ALTER TABLE transactions ADD COLUMN "totalAkhir" NUMERIC DEFAULT 0;

ALTER TABLE logs ADD COLUMN "waktu" TEXT;
ALTER TABLE logs ADD COLUMN "aktivitas" TEXT;
ALTER TABLE logs ADD COLUMN "detail" TEXT;
ALTER TABLE logs ADD COLUMN "catatan" TEXT;

NOTIFY pgrst, 'reload schema';
