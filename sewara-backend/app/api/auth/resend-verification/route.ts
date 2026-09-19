// @ts-nocheck
/**
 * Resend Verification Email API Route
 * 
 * Endpoint untuk mengirim ulang email verifikasi dengan rate limiting
 */

import { getServiceRoleClient } from '@/lib/api/supabase';
import { getClientIp } from '@/lib/api/auth';
import { successResponse, rateLimitResponse, externalServiceErrorResponse, internalErrorResponse } from '@/lib/api/response';
import { parseAndValidate, resendVerificationSchema } from '@/lib/api/validation';
import { withErrorHandler, logError } from '@/lib/api/errors';

export const runtime = 'nodejs';

// Generic responses untuk anti-enumeration
const GENERIC_SUCCESS = { ok: true, message: 'Jika email terdaftar, email verifikasi akan dikirim.' };
const GENERIC_FAILURE = { ok: false, message: 'Email belum dapat dikirim ulang. Coba lagi nanti.' };

/**
 * POST /api/auth/resend-verification
 * 
 * Resend email verifikasi dengan rate limiting
 */
async function resendVerificationHandler(request) {
  // Validate input
  const validation = await parseAndValidate(request, resendVerificationSchema);
  if (!validation.success) {
    // Return generic response untuk anti-enumeration
    return successResponse(GENERIC_SUCCESS);
  }
  
  const { email } = validation.data;
  const ip = getClientIp(request);
  const admin = getServiceRoleClient();
  
  // Check rate limit via RPC
  const { data: allowed, error: limitError } = await admin.rpc('rpc_reserve_verification_resend', {
    p_email: email,
    p_ip: ip,
  });
  
  if (limitError) {
    logError(new Error('Rate limiter RPC failed'), {
      route: '/api/auth/resend-verification',
      email,
      ip,
      error: limitError,
    });
    return internalErrorResponse('Email belum dapat dikirim ulang. Coba lagi nanti.');
  }
  
  if (allowed !== true) {
    return rateLimitResponse('Terlalu banyak permintaan. Coba lagi nanti.');
  }
  
  // Build redirect URL from parsed body
  const redirectTo = buildRedirectUrl(validation.data, request);
  
  // Resend verification email
  // Note: Supabase tidak expose apakah email exist (anti-enumeration)
  const { error: resendError } = await admin.auth.resend({
    type: 'signup',
    email,
    options: { emailRedirectTo: redirectTo },
  });
  
  if (resendError) {
    logError(new Error('Resend verification failed'), {
      route: '/api/auth/resend-verification',
      email,
      error: {
        code: resendError.code,
        message: sanitizeErrorMessage(resendError.message),
      },
    });
    
    // Return generic failure untuk anti-enumeration
    return externalServiceErrorResponse('Email belum dapat dikirim ulang. Coba lagi nanti.');
  }
  
  // Return generic success
  return successResponse(GENERIC_SUCCESS);
}

/**
 * Build safe redirect URL
 * 
 * @param {Object} body - Parsed request body
 * @param {Request} request - Request object
 * @returns {string} Safe redirect URL
 */
function buildRedirectUrl(body, request) {
  const requestOrigin = new URL(request.url).origin;
  const defaultRedirect = `${requestOrigin}/auth/callback`;
  
  // Allowed origins
  const allowedOrigins = [
    process.env.NEXT_PUBLIC_SITE_URL,
    process.env.APP_URL,
    requestOrigin,
  ]
    .filter(Boolean)
    .map((url) => url.replace(/\/$/, ''));
  
  // Validate custom redirect
  if (body.redirectTo) {
    try {
      const candidate = new URL(body.redirectTo, requestOrigin);
      if (allowedOrigins.includes(candidate.origin)) {
        return candidate.toString();
      }
    } catch {
      // Invalid URL, use default
    }
  }
  
  return defaultRedirect;
}

/**
 * Sanitize error message (remove tokens/sensitive info)
 * 
 * @param {string} message - Error message
 * @returns {string} Sanitized message
 */
function sanitizeErrorMessage(message) {
  if (typeof message !== 'string') return 'unknown error';
  
  return message
    .replace(/[\r\n\t]/g, ' ')
    .replace(/Bearer\s+\S+|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[redacted]')
    .slice(0, 300);
}

// Export dengan error handler
export const POST = withErrorHandler(resendVerificationHandler);
