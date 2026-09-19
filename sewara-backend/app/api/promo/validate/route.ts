// @ts-nocheck
import { getServerClient } from '@/lib/api/supabase';
import { requireAuth } from '@/lib/api/auth';
import { successResponse } from '@/lib/api/response';
import { withErrorHandler } from '@/lib/api/errors';

export const runtime = 'nodejs';

/**
 * Promo dianggap kedaluwarsa kalau lewat tanggal berlaku_sampai,
 * atau pemakaian sudah mencapai kuota.
 */
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
 * POST /api/promo/validate
 * Body: { id }
 *
 * Return { valid, promo?, error? } — bukan HTTP error, ini hasil bisnis.
 */
export const POST = withErrorHandler(async (request) => {
  const supabase = await getServerClient();
  await requireAuth(supabase);

  const { id } = await request.json();

  const { data, error } = await supabase
    .from('promo_codes')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) throw error;
  if (!data) {
    return successResponse({ valid: false, error: 'Kode promo tidak ditemukan' });
  }

  if (sudahKadaluarsa(data)) {
    if (data.status === 'aktif') {
      await supabase
        .from('promo_codes')
        .update({ status: 'expired' })
        .eq('id', id)
        .eq('status', 'aktif');
    }
    return successResponse({
      valid: false,
      error: 'Kode promo sudah kedaluwarsa',
      promo: { ...data, status: 'expired' },
    });
  }

  if (data.status !== 'aktif') {
    return successResponse({
      valid: false,
      error: 'Kode promo nonaktif',
      promo: data,
    });
  }

  return successResponse({ valid: true, promo: data });
});