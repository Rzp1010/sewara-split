-- ============================================================
-- Optimasi Dashboard: indeks transaksi utk query count/range
-- (user_id + status + created_at / user_id + created_at)
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_transactions_user_status_created 
ON public.transactions (user_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_transactions_user_created 
ON public.transactions (user_id, created_at DESC);

NOTIFY pgrst, 'reload schema';