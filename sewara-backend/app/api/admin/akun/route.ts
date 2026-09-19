// @ts-nocheck
import { getServerClient } from '@/lib/api/supabase';
import { requireAuth, requireRole } from '@/lib/api/auth';
import { successResponse } from '@/lib/api/response';
import { withErrorHandler } from '@/lib/api/errors';

export const runtime = 'nodejs';

/**
 * GET /api/admin/akun — daftar semua akun (superadmin).
 */
export const GET = withErrorHandler(async () => {
  const supabase = await getServerClient();
  const user = await requireAuth(supabase);

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle();

  await requireRole(profile, ['superadmin']);

  const { data, error } = await supabase.rpc('rpc_list_akun');
  if (error) throw error;
  return successResponse({ akun: data || [] });
});