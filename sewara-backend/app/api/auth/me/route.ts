// @ts-nocheck
import { getServerClient } from '@/lib/api/supabase';
import { successResponse, unauthorizedResponse } from '@/lib/api/response';
import { withErrorHandler } from '@/lib/api/errors';

export const runtime = 'nodejs';

/**
 * GET /api/auth/me
 *
 * Cek session user + ambil profile-nya.
 */
export const GET = withErrorHandler(async () => {
  const supabase = await getServerClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    throw unauthorizedResponse();
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('email, nama_lengkap, username, nama_invoice, role, owner_id, is_active, status, subscribed_until')
    .eq('user_id', user.id)
    .maybeSingle();

  return successResponse({
    user: {
      id: user.id,
      email: user.email,
      ...profile,
    },
  });
});