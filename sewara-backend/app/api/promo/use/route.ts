// @ts-nocheck
import { getServerClient } from '@/lib/api/supabase';
import { requireAuth } from '@/lib/api/auth';
import { successResponse, errorResponse } from '@/lib/api/response';
import { withErrorHandler } from '@/lib/api/errors';

export const runtime = 'nodejs';

function sudahKadaluarsa(promo, now = Date.now()) {
  const sampai = promo?.berlaku_sampai
    ? new Date(promo.berlaku_sampai).getTime()
    : null;
  return (
    (sampai != null && now >= sampai) ||
    (promo?.kuota != null && Number(promo.terpakai || 0) >= Number(promo.kuota))
  );
}

/**
 * POST /api/promo/use
 * Body: { id }
 *
 * Naikkan counter terpakai dengan guard concurrency
 * (cocokkan nilai terpakai lama supaya dua pemakaian bersamaan tidak saling menimpa).
 */
export const POST = withErrorHandler(async (request) => {
  const supabase = await getServerClient();
  await requireAuth(supabase);

  const { id } = await request.json();

  const { data: promo, error } = await supabase
    .from('promo_codes')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) throw error;
  if (!promo) return errorResponse('Kode promo tidak ditemukan', 'NOT_FOUND', 404);

  if (sudahKadaluarsa(promo)) {
    if (promo.status === 'aktif') {
      await supabase
        .from('promo_codes')
        .update({ status: 'expired' })
        .eq('id', id)
        .eq('status', 'aktif');
    }
    return errorResponse('Kode promo sudah kedaluwarsa', 'PROMO_EXPIRED', 409);
  }

  if (promo.status !== 'aktif') {
    return errorResponse('Kode promo nonaktif', 'PROMO_INACTIVE', 409);
  }

  const current = promo.terpakai || 0;

  let query = supabase
    .from('promo_codes')
    .update({ terpakai: current + 1 })
    .eq('id', id)
    .eq('status', 'aktif')
    .eq('terpakai', current);

  if (promo.kuota != null) query = query.lt('terpakai', promo.kuota);

  const { data, error: updateError } = await query.select('id').maybeSingle();
  if (updateError) throw updateError;

  if (!data) {
    return errorResponse(
      'Kuota kode promo habis atau promo sudah tidak aktif',
      'PROMO_QUOTA_EXCEEDED',
      409,
    );
  }

  if (promo.kuota != null && current + 1 >= promo.kuota) {
    await supabase
      .from('promo_codes')
      .update({ status: 'expired' })
      .eq('id', id)
      .eq('status', 'aktif');
  }

  return successResponse({ ok: true });
});