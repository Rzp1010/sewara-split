// @ts-nocheck
import { getServerClient } from '@/lib/api/supabase';
import { requireAuth } from '@/lib/api/auth';
import { successResponse } from '@/lib/api/response';
import { withErrorHandler } from '@/lib/api/errors';

export const runtime = 'nodejs';

async function ambilSemua(supabase, kolom) {
  const pageSize = 1000;
  const hasil = [];
  let offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from('transaction_items')
      .select(kolom)
      .order('id', { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    const batch = data || [];
    hasil.push(...batch);
    if (batch.length < pageSize) break;
    offset += pageSize;
  }
  return hasil;
}

/**
 * GET /api/transaction-items
 *   ?transaction_id=x     item satu transaksi
 *   ?transaction_ids=a,b  grouped per transaksi
 *   ?all=1 | ?stats=1     semua item tenant
 */
export const GET = withErrorHandler(async (request) => {
  const supabase = await getServerClient();
  await requireAuth(supabase);

  const { searchParams } = new URL(request.url);
  const transactionId = searchParams.get('transaction_id');
  const transactionIds = searchParams.get('transaction_ids');

  if (transactionId) {
    const { data, error } = await supabase
      .from('transaction_items')
      .select('*')
      .eq('transaction_id', transactionId)
      .order('id');
    if (error) throw error;
    return successResponse({ items: data || [] });
  }

  if (transactionIds) {
    const ids = transactionIds.split(',').filter(Boolean);
    const { data, error } = await supabase
      .from('transaction_items')
      .select('*')
      .in('transaction_id', ids);
    if (error) throw error;
    const itemsByTransaction = (data || []).reduce((g, item) => {
      (g[item.transaction_id] ||= []).push(item);
      return g;
    }, {});
    return successResponse({ itemsByTransaction });
  }

  const items = await ambilSemua(
    supabase,
    'transaction_id,item_name,qty,item_type',
  );
  return successResponse({ items });
});

/**
 * POST /api/transaction-items — replace item satu transaksi
 * Body: { transaction_id, items, user_id? }
 */
export const POST = withErrorHandler(async (request) => {
  const supabase = await getServerClient();
  const user = await requireAuth(supabase);

  const { transaction_id, items, user_id } = await request.json();
  if (!transaction_id) throw new Error('transaction_id wajib diisi.');

  const { error: deleteError } = await supabase
    .from('transaction_items')
    .delete()
    .eq('transaction_id', transaction_id);
  if (deleteError) throw deleteError;

  if (!items || items.length === 0) return successResponse({ ok: true });

  const normalized = items.map((item) => ({
    transaction_id,
    inventory_id: item.inventory_id || item.ref?.id || null,
    item_name: item.nama || item.ref?.nama || 'Unknown',
    item_type: item.jenis || item.ref?.jenis || 'satuan',
    qty: item.qty || 1,
    unit_price: item.harga || item.ref?.harga || 0,
    subtotal: (item.qty || 1) * (item.harga || item.ref?.harga || 0),
    rate_type: item.tarif || null,
    serial_number: item.sn || null,
    assigned_components: item.assignedSNs || [],
    user_id: user_id || user.id,
  }));

  const { error } = await supabase.from('transaction_items').insert(normalized);
  if (error) throw error;
  return successResponse({ ok: true });
});