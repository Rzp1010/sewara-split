-- Tambahkan kolom pembayaran (DP/Lunas) ke transactions
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS "pembayaran" JSONB DEFAULT '{"dp":0,"metodeDp":"","tglDp":"","riwayatBayar":[]}'::jsonb;

NOTIFY pgrst, 'reload schema';
