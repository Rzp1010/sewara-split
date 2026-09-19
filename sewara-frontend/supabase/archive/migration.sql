CREATE TABLE IF NOT EXISTS inventory (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nama TEXT NOT NULL,
  jenis TEXT NOT NULL CHECK (jenis IN ('satuan', 'bundling')),
  h24 NUMERIC DEFAULT 0,
  h12 NUMERIC DEFAULT 0,
  h6 NUMERIC DEFAULT 0,
  tarif TEXT,
  denda TEXT,
  sns JSONB DEFAULT '[]',
  komponen JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS transactions (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  id_transaksi TEXT NOT NULL UNIQUE,
  penyewa TEXT,
  hp_penyewa TEXT,
  alamat_penyewa TEXT,
  jaminan_sewa TEXT,
  waktu_ambil_rencana TIMESTAMPTZ,
  waktu_kembali_rencana TIMESTAMPTZ,
  waktu_ambil_aktual TIMESTAMPTZ,
  waktu_kembali_aktual TIMESTAMPTZ,
  status TEXT DEFAULT 'Booking',
  items JSONB DEFAULT '[]',
  denda NUMERIC DEFAULT 0,
  biaya NUMERIC DEFAULT 0,
  durasi_teks TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS logs (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  time TEXT,
  aksi TEXT,
  sn TEXT,
  nama_barang TEXT,
  id_barang TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
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

CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions (status);
CREATE INDEX IF NOT EXISTS idx_transactions_waktu_ambil_rencana ON transactions ("waktuAmbilRencana");
CREATE INDEX IF NOT EXISTS idx_transactions_waktu_kembali_rencana ON transactions ("waktuKembaliRencana");
CREATE INDEX IF NOT EXISTS idx_transactions_waktu_kembali_aktual ON transactions ("waktuKembaliAktual");
CREATE INDEX IF NOT EXISTS idx_logs_waktu ON logs (waktu);
CREATE INDEX IF NOT EXISTS idx_inventory_nama ON inventory (nama);
