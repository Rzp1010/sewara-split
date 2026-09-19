-- LANGKAH 2: Tambahkan index. Jalankan SETELAH langkah 1 sukses.

CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions (status);
CREATE INDEX IF NOT EXISTS idx_transactions_waktu_ambil_rencana ON transactions ("waktuAmbilRencana");
CREATE INDEX IF NOT EXISTS idx_transactions_waktu_kembali_rencana ON transactions ("waktuKembaliRencana");
CREATE INDEX IF NOT EXISTS idx_transactions_waktu_kembali_aktual ON transactions ("waktuKembaliAktual");
CREATE INDEX IF NOT EXISTS idx_logs_waktu ON logs (waktu);
CREATE INDEX IF NOT EXISTS idx_inventory_nama ON inventory (nama);
