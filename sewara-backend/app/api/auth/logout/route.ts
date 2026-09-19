// @ts-nocheck
/**
 * Logout API Route
 * 
 * Endpoint untuk logout user dan mencatat log logout
 */

import { getServerClient, getServiceRoleClient } from '@/lib/api/supabase';
import { requireAuth, getClientIp } from '@/lib/api/auth';
import { successResponse, internalErrorResponse } from '@/lib/api/response';
import { withErrorHandler, logError } from '@/lib/api/errors';

export const runtime = 'nodejs';

/**
 * POST /api/auth/logout
 * 
 * Logout user dan catat ke login_logs
 */
async function logoutHandler(request) {
  const supabase = await getServerClient();
  
  // Get authenticated user
  const user = await requireAuth(supabase);
  
  // Log logout (fire-and-forget)
  logLogoutEvent(user.email, request).catch((error) => {
    logError(error, { 
      route: '/api/auth/logout',
      email: user.email,
      operation: 'log_logout'
    });
  });
  
  // Sign out
  await supabase.auth.signOut();
  
  return successResponse();
}

/**
 * Log logout event ke login_logs
 * 
 * @param {string} email - User email
 * @param {Request} request - Request object
 */
async function logLogoutEvent(email, request) {
  const admin = getServiceRoleClient();
  
  // Get profile untuk ambil owner_id
  const { data: profile } = await admin
    .from('profiles')
    .select('owner_id, user_id')
    .eq('email', email)
    .maybeSingle();
  
  // Extract request info
  const ip = getClientIp(request);
  const userAgent = request.headers.get('user-agent');
  
  // Insert log
  await admin.from('login_logs').insert({
    email,
    owner_id: profile?.owner_id || profile?.user_id || null,
    event: 'logout',
    detail: null,
    ip,
    user_agent: userAgent,
  });
}

// Export dengan error handler
export const POST = withErrorHandler(logoutHandler);
