// @ts-nocheck
/**
 * /api/blacklist/check
 *
 * GET ?nama=&hp= — cek penyewa terhadap blacklist tenant caller (semua role).
 * Balas entri pertama yang match: {hit, nama, alasan}.
 */

import { getServerClient } from '@/lib/api/supabase';
import { requireAuth } from '@/lib/api/auth';
import { getTenantId } from '@/lib/api/tenant';
import { successResponse } from '@/lib/api/response';
import { withErrorHandler } from '@/lib/api/errors';
import { cariBlacklist } from '@/lib/api/blacklist';

export const runtime = 'nodejs';

export const GET = withErrorHandler(async (request) => {
  const supabase = await getServerClient();
  const user = await requireAuth(supabase);
  const tenantId = await getTenantId(supabase, user.id);

  const { searchParams } = new URL(request.url);
  const nama = searchParams.get('nama') || '';
  const hp = searchParams.get('hp') || '';

  const found = await cariBlacklist(supabase, tenantId, { nama, hp });
  if (!found) return successResponse({ hit: false, nama: null, alasan: null });

  return successResponse({ hit: true, nama: found.nama, alasan: found.alasan });
});