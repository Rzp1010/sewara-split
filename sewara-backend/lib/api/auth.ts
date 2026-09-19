// @ts-nocheck
/**
 * Authentication & Authorization Helpers
 * 
 * Reusable helpers untuk auth checks di API routes
 */

import { unauthorizedResponse, forbiddenResponse } from './response';

// ============================================================================
// AUTHENTICATION
// ============================================================================

/**
 * Require authenticated user
 * 
 * @param {SupabaseClient} supabase - Supabase client instance
 * @returns {Promise<User>} Authenticated user
 * @throws {Response} 401 jika tidak terautentikasi
 * 
 * @example
 * const supabase = getServerClient();
 * const user = await requireAuth(supabase);
 */
export async function requireAuth(supabase, message) {
  const { data: { user }, error } = await supabase.auth.getUser();
  
  if (error || !user) {
    throw unauthorizedResponse(message);
  }
  
  return user;
}

// ============================================================================
// PROFILE CHECKS
// ============================================================================

/**
 * Require active profile
 * 
 * Cek apakah user memiliki profile yang aktif
 * 
 * @param {SupabaseClient} supabase - Supabase client instance
 * @param {string} userId - User ID
 * @returns {Promise<Profile>} User profile
 * @throws {Response} 401 jika profile tidak ditemukan atau tidak aktif
 * 
 * @example
 * const user = await requireAuth(supabase);
 * const profile = await requireActiveProfile(supabase, user.id);
 */
export async function requireActiveProfile(supabase, userId) {
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  
  if (error) {
    console.error('Error fetching profile:', error);
    throw unauthorizedResponse('Gagal mengambil data profil.');
  }
  
  if (!profile) {
    throw unauthorizedResponse('Profil tidak ditemukan.');
  }
  
  if (profile.is_active === false) {
    throw unauthorizedResponse('Akun Anda tidak aktif. Hubungi administrator.');
  }
  
  return profile;
}

// ============================================================================
// ROLE-BASED AUTHORIZATION
// ============================================================================

/**
 * Require specific role(s)
 * 
 * @param {Profile} profile - User profile
 * @param {string|string[]} allowedRoles - Role atau array of roles yang diizinkan
 * @throws {Response} 403 jika role tidak sesuai
 * 
 * @example
 * requireRole(profile, 'superadmin');
 * requireRole(profile, ['owner', 'superadmin']);
 */
export function requireRole(profile, allowedRoles) {
  const roles = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];
  
  if (!roles.includes(profile.role)) {
    throw forbiddenResponse('Anda tidak memiliki akses untuk operasi ini.');
  }
}

/**
 * Check if user has role
 * 
 * @param {Profile} profile - User profile
 * @param {string|string[]} roles - Role atau array of roles
 * @returns {boolean}
 * 
 * @example
 * if (hasRole(profile, 'superadmin')) {
 *   // Do admin stuff
 * }
 */
export function hasRole(profile, roles) {
  const roleList = Array.isArray(roles) ? roles : [roles];
  return roleList.includes(profile.role);
}

// ============================================================================
// SUBSCRIPTION CHECKS
// ============================================================================

/**
 * Require active subscription
 * 
 * Cek apakah user memiliki subscription yang aktif (belum expired)
 * 
 * @param {Profile} profile - User profile
 * @throws {Response} 401 jika subscription expired
 * 
 * @example
 * const profile = await requireActiveProfile(supabase, user.id);
 * requireActiveSubscription(profile);
 */
export function requireActiveSubscription(profile) {
  if (!profile.subscribed_until) {
    throw unauthorizedResponse('Subscription tidak aktif.');
  }

  const subscriptionEnd = new Date(profile.subscribed_until);
  const now = new Date();

  if (subscriptionEnd < now) {
    throw unauthorizedResponse('Subscription Anda telah berakhir. Silakan perpanjang.');
  }
}

// ============================================================================
// EMAIL VERIFICATION CHECKS
// ============================================================================

/**
 * Require verified email
 * 
 * @param {User} user - Supabase auth user
 * @throws {Response} 401 jika email belum terverifikasi
 * 
 * @example
 * const user = await requireAuth(supabase);
 * requireVerifiedEmail(user);
 */
export function requireVerifiedEmail(user) {
  if (!user.email_confirmed_at) {
    throw unauthorizedResponse('Email Anda belum diverifikasi. Cek inbox Anda.');
  }
}

// ============================================================================
// OWNERSHIP CHECKS
// ============================================================================

/**
 * Require resource ownership atau admin role
 * 
 * @param {Profile} profile - User profile
 * @param {string} resourceOwnerId - Owner ID dari resource yang diakses
 * @throws {Response} 403 jika bukan owner dan bukan admin
 * 
 * @example
 * requireOwnership(profile, transaction.user_id);
 */
export function requireOwnership(profile, resourceOwnerId) {
  const isOwner = profile.user_id === resourceOwnerId;
  const isAdmin = hasRole(profile, ['owner', 'superadmin']);
  
  if (!isOwner && !isAdmin) {
    throw forbiddenResponse('Anda tidak memiliki akses ke resource ini.');
  }
}

// ============================================================================
// UTILITY HELPERS
// ============================================================================

/**
 * Extract client IP address dari request headers
 * 
 * @param {Request} request - Next.js request object
 * @returns {string} IP address
 * 
 * @example
 * const ip = getClientIp(request);
 */
export function getClientIp(request) {
  const forwarded = request.headers.get('x-forwarded-for');
  
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  
  return request.headers.get('x-real-ip') || 'unknown';
}
