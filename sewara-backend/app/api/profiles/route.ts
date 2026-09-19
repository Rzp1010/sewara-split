// @ts-nocheck
import { getServerClient } from '@/lib/api/supabase';
import { requireAuth } from '@/lib/api/auth';
import { successResponse } from '@/lib/api/response';
import { withErrorHandler } from '@/lib/api/errors';

export const runtime = 'nodejs';

/**
 * GET /api/profiles
 * GET /api/profiles?email=xxx
 *
 * List profiles (sdm/manajemen). Filter by email kalau ada.
 */
export const GET = withErrorHandler(async (request) => {
  const supabase = await getServerClient();
  await requireAuth(supabase);

  const { searchParams } = new URL(request.url);
  const email = searchParams.get('email');

  const query = supabase
    .from('profiles')
    .select('user_id, email, nama_lengkap, username, role, owner_id, is_active, status');

  if (email) {
    const { data, error } = await query.eq('email', email).maybeSingle();
    if (error) throw error;
    return successResponse({ profile: data });
  }

  const { data, error } = await query;
  if (error) throw error;
  return successResponse({ profiles: data });
});