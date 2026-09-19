// @ts-nocheck
import { getServerClient, getServiceRoleClient } from '@/lib/api/supabase';
import { requireAuth, requireRole } from '@/lib/api/auth';
import { successResponse } from '@/lib/api/response';
import { withErrorHandler } from '@/lib/api/errors';

export const runtime = 'nodejs';

export const GET = withErrorHandler(async (request) => {
  const supabase = await getServerClient();
  const user = await requireAuth(supabase);
  
  // Get profile untuk cek role
  const { data: profile } = await supabase
    .from('profiles')
    .select('role, user_id')
    .eq('user_id', user.id)
    .single();
  
  await requireRole(profile, ['owner', 'superadmin']);
  
  const { searchParams } = new URL(request.url);
  const offset = parseInt(searchParams.get('offset') || '0');
  const limit = parseInt(searchParams.get('limit') || '50');
  
  const serviceSupabase = getServiceRoleClient();
  
  // Query login_logs table
  let query = serviceSupabase
    .from('login_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);
  
  // Superadmin: semua logs. Owner: logs owner_id sendiri
  if (profile.role === 'owner') {
    query = query.eq('owner_id', profile.user_id);
  }
  
  const { data: logs, error } = await query;
  if (error) throw error;
  
  return successResponse({ logs: logs || [] });
});
