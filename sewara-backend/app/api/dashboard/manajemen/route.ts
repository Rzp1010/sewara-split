// @ts-nocheck
import { getServerClient } from '@/lib/api/supabase';
import { requireAuth } from '@/lib/api/auth';
import { successResponse } from '@/lib/api/response';
import { withErrorHandler } from '@/lib/api/errors';

export const runtime = 'nodejs';

/**
 * GET /api/dashboard/manajemen — ringkasan akun (owner/staf aktif-nonaktif).
 */
export const GET = withErrorHandler(async () => {
  const supabase = await getServerClient();
  await requireAuth(supabase);

  const { data, error } = await supabase
    .from('profiles')
    .select('role, is_active');
  if (error) throw error;

  const rows = data || [];
  const owner = rows.filter((r) => r.role === 'owner');
  const staf = rows.filter((r) => r.role === 'cs' || r.role === 'gudang');

  return successResponse({
    manajemen: {
      totalOwner: owner.length,
      ownerAktif: owner.filter((r) => r.is_active).length,
      ownerNonaktif: owner.filter((r) => !r.is_active).length,
      totalStaf: staf.length,
      stafAktif: staf.filter((r) => r.is_active).length,
      stafNonaktif: staf.filter((r) => !r.is_active).length,
      totalAkun: rows.length,
    },
  });
});