-- LANGKAH 1: Buat tabel + RLS. Jalankan di project UJI, lalu lanjut ke langkah 2.
-- PENTING: kolom camelCase HARUS dikutip ("..."), tanpa kutip PostgreSQL men-lowercase-nya.

DROP TABLE IF EXISTS inventory CASCADE;
DROP TABLE IF EXISTS transactions CASCADE;
DROP TABLE IF EXISTS logs CASCADE;

CREATE TABLE inventory (
  id BIGINT PRIMARY KEY,
  nama TEXT,
  jenis TEXT,
  h24 NUMERIC DEFAULT 0,
  h12 NUMERIC DEFAULT 0,
  h6 NUMERIC DEFAULT 0,
  denda TEXT,
  tarif TEXT,
  sns JSONB DEFAULT '[]',
  komponen JSONB DEFAULT '[]',
  "tipeSewa" TEXT,
  kondisi TEXT,
  keterangan TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE transactions (
  id BIGINT PRIMARY KEY,
  "noInvoice" TEXT,
  penyewa TEXT,
  "hpPenyewa" TEXT,
  "alamatPenyewa" TEXT,
  "jaminanSewa" TEXT,
  "waktuAmbilRencana" TEXT,
  "waktuKembaliRencana" TEXT,
  "waktuAmbilAktual" TEXT,
  "waktuKembaliAktual" TEXT,
  "durasiTeks" TEXT,
  items JSONB DEFAULT '[]',
  "biayaDasar" NUMERIC DEFAULT 0,
  "dendaTambahan" NUMERIC DEFAULT 0,
  "totalAkhir" NUMERIC DEFAULT 0,
  status TEXT DEFAULT 'Booking',
  pembayaran JSONB
);

CREATE TABLE logs (
  id BIGINT PRIMARY KEY,
  waktu TEXT,
  aktivitas TEXT,
  detail TEXT,
  catatan TEXT
);

ALTER TABLE inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can do everything on inventory" ON inventory;
CREATE POLICY "Authenticated users can do everything on inventory"
  ON inventory FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated users can do everything on transactions" ON transactions;
CREATE POLICY "Authenticated users can do everything on transactions"
  ON transactions FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated users can do everything on logs" ON logs;
CREATE POLICY "Authenticated users can do everything on logs"
  ON logs FOR ALL TO authenticated USING (true) WITH CHECK (true);
