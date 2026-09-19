ALTER TABLE transactions ALTER COLUMN id_transaksi DROP NOT NULL;
ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_id_transaksi_key;
