// @ts-nocheck
/**
 * Standard Response Utilities
 * 
 * Menyediakan format response yang konsisten untuk semua API routes
 */

import { NextResponse } from 'next/server';
import { ERROR_CODES } from './constants';

// ============================================================================
// SUCCESS RESPONSES
// ============================================================================

/**
 * Return standard success response
 * 
 * @param {*} data - Data yang akan dikembalikan (optional)
 * @param {number} status - HTTP status code (default: 200)
 * @returns {NextResponse}
 */
export function successResponse(data = null, status = 200) {
  const payload = { ok: true };
  
  if (data !== null && data !== undefined) {
    payload.data = data;
  }
  
  return NextResponse.json(payload, { status });
}

// ============================================================================
// ERROR RESPONSES
// ============================================================================

/**
 * Return standard error response
 * 
 * @param {string} message - Error message (Indonesian)
 * @param {string} code - Error code dari ERROR_CODES
 * @param {number} status - HTTP status code
 * @returns {NextResponse}
 */
export function errorResponse(message, code = ERROR_CODES.INTERNAL_ERROR, status = 500) {
  return NextResponse.json(
    {
      ok: false,
      error: {
        code,
        message,
      },
    },
    { status }
  );
}

// ============================================================================
// COMMON ERROR RESPONSES
// ============================================================================

/**
 * 401 Unauthorized - Tidak terautentikasi
 */
export function unauthorizedResponse(message = 'Tidak terautentikasi. Silakan login.') {
  return errorResponse(message, ERROR_CODES.UNAUTHORIZED, 401);
}

/**
 * 403 Forbidden - Tidak memiliki akses
 */
export function forbiddenResponse(message = 'Anda tidak memiliki akses untuk operasi ini.') {
  return errorResponse(message, ERROR_CODES.FORBIDDEN, 403);
}

/**
 * 404 Not Found - Resource tidak ditemukan
 */
export function notFoundResponse(message = 'Data tidak ditemukan.') {
  return errorResponse(message, ERROR_CODES.NOT_FOUND, 404);
}

/**
 * 400 Validation Error - Input tidak valid
 */
export function validationErrorResponse(message, errors = null) {
  const payload = {
    ok: false,
    error: {
      code: ERROR_CODES.VALIDATION_ERROR,
      message,
    },
  };
  
  if (errors) {
    payload.error.details = errors;
  }
  
  return NextResponse.json(payload, { status: 400 });
}

/**
 * 429 Rate Limit Exceeded
 */
export function rateLimitResponse(message = 'Terlalu banyak percobaan. Coba lagi nanti.') {
  return errorResponse(message, ERROR_CODES.RATE_LIMIT_EXCEEDED, 429);
}

/**
 * 423 Account Locked
 */
export function accountLockedResponse(message = 'Akun terkunci. Coba lagi nanti.') {
  return errorResponse(message, ERROR_CODES.ACCOUNT_LOCKED, 423);
}

/**
 * 500 Internal Server Error
 */
export function internalErrorResponse(message = 'Terjadi kesalahan server. Coba lagi.') {
  return errorResponse(message, ERROR_CODES.INTERNAL_ERROR, 500);
}

/**
 * 502 External Service Error (Telegram, Email provider, etc)
 */
export function externalServiceErrorResponse(message = 'Layanan eksternal tidak tersedia.') {
  return errorResponse(message, ERROR_CODES.EXTERNAL_SERVICE_ERROR, 502);
}
