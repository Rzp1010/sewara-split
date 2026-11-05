-- 0008_chat_trx_bigint.sql — trx_id chat harus bigint, mengikuti transactions.id
--
-- 0007 membuat trx_id uuid; id transaksi aplikasi bigint (mis. 1793799472301),
-- jadi semua permintaan /api/chat?trxId=<angka> ditolak 400. Baris lama
-- (uuid) tidak bisa dikonversi -> dibuang, staging memang data uji.
-- Ledger dicatat runner; JANGAN tulis INSERT INTO schema_migrations.

BEGIN;

DELETE FROM public.chat_messages WHERE trx_id IS NOT NULL;
DELETE FROM public.chat_reads WHERE scope LIKE 'trx:%';

ALTER TABLE public.chat_messages ALTER COLUMN trx_id TYPE bigint USING NULL;

COMMIT;
