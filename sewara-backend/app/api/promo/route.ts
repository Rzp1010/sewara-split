// @ts-nocheck
import { getServerClient } from '@/lib/api/supabase';
import { requireAuth } from '@/lib/api/auth';
import { getTenantId, withTenant } from '@/lib/api/tenant';
import { successResponse } from '@/lib/api/response';
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
 * GET /api/promo — list promo code tenant.
 *
 * Sekalian tandai yang lewat tanggal/kuota sebagai 'expired'
 * (dulu: tandaiPromoKadaluarsa) supaya daftar selalu konsisten.
 */
export const GET = withErrorHandler(async () => {
  const supabase = await getServerClient();
  const user = await requireAuth(supabase);
  const tenantId = await getTenantId(supabase, user.id);

  const { data, error } = await supabase
    .from('promo_codes')
    .select('*')
    .eq('user_id', tenantId)
    .order('created_at', { ascending: false });
  if (error) throw error;

  const promos = data || [];
  const kedaluwarsa = promos.filter(
    (p) => p.status !== 'expired' && sudahKadaluarsa(p),
  );

  for (const promo of kedaluwarsa) {
    await supabase
      .from('promo_codes')
      .update({ status: 'expired' })
      .eq('id', promo.id)
      .eq('status', 'aktif');
  }

  const ids = new Set(kedaluwarsa.map((p) => p.id));
  return successResponse({
    promos: promos.map((p) => (ids.has(p.id) ? { ...p, status: 'expired' } : p)),
  });
});

/**
 * POST /api/promo — tambah promo code
 */
export const POST = withErrorHandler(async (request) => {
  const supabase = await getServerClient();
  const user = await requireAuth(supabase);

  const body = await request.json();
  const [row] = await withTenant(supabase, user.id, [
    { ...body, kode: String(body.kode || '').trim().toUpperCase() },
  ]);

  const { data, error } = await supabase
    .from('promo_codes')
    .insert(row)
    .select()
    .single();

  if (error) throw error;
  return successResponse({ promo: data });
});