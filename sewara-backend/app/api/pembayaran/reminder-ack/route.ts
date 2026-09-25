// @ts-nocheck
/**
 * POST /api/pembayaran/reminder-ack
 *
 * Tandai banner reminder bulan tsb sudah di-ack.
 * Body JSON: { bulan: "YYYY-MM" }
 */
import { withErrorHandler } from '@/lib/api/errors';
import { requireAuth } from '@/lib/api/auth';
import { getServerClient } from '@/lib/api/supabase';
import { validationErrorResponse, successResponse } from '@/lib/api/response';

export const runtime = 'nodejs';

async function ackHandler(request) {
  const supabase = await getServerClient();
  const user = await requireAuth(supabase, 'Anda harus login terlebih dahulu.');

  const body = await request.json().catch(() => ({}));
  const bulan = body?.bulan;
  if (typeof bulan !== 'string' || !/^\d{4}-\d{2}$/.test(bulan)) {
    return validationErrorResponse('Parameter bulan tidak valid. Format: YYYY-MM.');
  }

  // Tenant aktif: staf pakai owner_id, owner pakai user_id sendiri.
  const { data: prof } = await supabase
    .from('profiles')
    .select('owner_id')
    .eq('user_id', user.id)
    .maybeSingle();
  const ownerId = prof?.owner_id || user.id;

  const { error } = await supabase
    .from('settings')
    .upsert(
      {
        user_id: ownerId,
        key: 'bukti_backup_ack',
        value: bulan,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,key' }
    );

  if (error) throw error;
  return successResponse({ ok: true });
}

export const POST = withErrorHandler(ackHandler);
