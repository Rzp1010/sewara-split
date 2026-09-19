// @ts-nocheck
import { getServerClient } from '@/lib/api/supabase';
import { requireAuth } from '@/lib/api/auth';
import { successResponse, errorResponse } from '@/lib/api/response';
import { withErrorHandler } from '@/lib/api/errors';

export const runtime = 'nodejs';

/**
 * POST /api/inventory/bulk-delete
 * Body: { ids: [...] }
 *
 * Preflight FK ke transaction_items sebelum hapus parent — supaya error
 * "dipakai transaksi" muncul sebagai pesan jelas, bukan FK violation mentah.
 */
export const POST = withErrorHandler(async (request) => {
  const supabase = await getServerClient();
  await requireAuth(supabase);

  const { ids } = await request.json();
  if (!ids || ids.length === 0) return successResponse({ ok: true });

  const { data: references, error: referenceError } = await supabase
    .from('transaction_items')
    .select('id, inventory_id, transaction_id')
    .in('inventory_id', ids);

  if (referenceError) throw referenceError;

  if (references?.length) {
    return errorResponse(
      'Inventaris tidak dapat dihapus karena sudah digunakan dalam transaksi.',
      'INVENTORY_IN_USE',
      409,
    );
  }

  const { error } = await supabase.from('inventory').delete().in('id', ids);
  if (error) throw error;
  return successResponse({ ok: true });
});