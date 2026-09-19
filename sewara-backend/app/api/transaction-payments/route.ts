// @ts-nocheck
import { getServerClient } from '@/lib/api/supabase';
import { requireAuth } from '@/lib/api/auth';
import { successResponse } from '@/lib/api/response';
import { withErrorHandler } from '@/lib/api/errors';

export const runtime = 'nodejs';

/**
 * GET /api/transaction-payments?transaction_id=x
 */
export const GET = withErrorHandler(async (request) => {
  const supabase = await getServerClient();
  await requireAuth(supabase);

  const { searchParams } = new URL(request.url);
  const transactionId = searchParams.get('transaction_id');
  if (!transactionId) throw new Error('transaction_id wajib diisi.');

  const { data, error } = await supabase
    .from('transaction_payments')
    .select('*')
    .eq('transaction_id', transactionId)
    .order('payment_date');
  if (error) throw error;
  return successResponse({ payments: data || [] });
});

/**
 * POST /api/transaction-payments — replace pembayaran satu transaksi
 * Body: { transaction_id, payments, user_id? }
 */
export const POST = withErrorHandler(async (request) => {
  const supabase = await getServerClient();
  const user = await requireAuth(supabase);

  const { transaction_id, payments, user_id } = await request.json();
  if (!transaction_id) throw new Error('transaction_id wajib diisi.');

  const { error: deleteError } = await supabase
    .from('transaction_payments')
    .delete()
    .eq('transaction_id', transaction_id);
  if (deleteError) throw deleteError;

  if (!payments || payments.length === 0) return successResponse({ ok: true });

  const normalized = payments.map((p) => ({
    transaction_id,
    amount: p.jumlah || 0,
    payment_method: p.metode || 'Tunai',
    payment_date: p.tanggal || new Date().toISOString(),
    notes: p.catatan || null,
    user_id: user_id || user.id,
  }));

  const { error } = await supabase.from('transaction_payments').insert(normalized);
  if (error) throw error;
  return successResponse({ ok: true });
});