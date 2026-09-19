// @ts-nocheck
/**
 * Error Handling & Logging Utilities
 * 
 * Centralized error handling dan structured logging
 */

import { internalErrorResponse } from './response';

// ============================================================================
// ERROR CLASSES
// ============================================================================

/**
 * Base API Error
 */
export class ApiError extends Error {
  constructor(message, code, statusCode = 500) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

/**
 * Validation Error
 */
export class ValidationError extends ApiError {
  constructor(message, details = null) {
    super(message, 'VALIDATION_ERROR', 400);
    this.name = 'ValidationError';
    this.details = details;
  }
}

/**
 * Database Error
 */
export class DatabaseError extends ApiError {
  constructor(message, originalError = null) {
    super(message, 'DATABASE_ERROR', 500);
    this.name = 'DatabaseError';
    this.originalError = originalError;
  }
}

// ============================================================================
// ERROR LOGGING
// ============================================================================

/**
 * Log error dengan context
 * 
 * @param {Error} error - Error object
 * @param {Object} context - Additional context
 * 
 * @example
 * logError(error, {
 *   route: '/api/auth/login',
 *   userId: user.id,
 *   action: 'login_attempt'
 * });
 */
export function logError(error, context = {}) {
  const timestamp = new Date().toISOString();
  
  console.error('[ERROR]', {
    timestamp,
    message: error.message,
    name: error.name,
    code: error.code || 'UNKNOWN',
    stack: error.stack,
    ...context,
  });
}

/**
 * Log warning dengan context
 * 
 * @param {string} message - Warning message
 * @param {Object} context - Additional context
 */
export function logWarning(message, context = {}) {
  const timestamp = new Date().toISOString();
  
  console.warn('[WARNING]', {
    timestamp,
    message,
    ...context,
  });
}

/**
 * Log info dengan context
 * 
 * @param {string} message - Info message
 * @param {Object} context - Additional context
 */
export function logInfo(message, context = {}) {
  const timestamp = new Date().toISOString();
  
  console.log('[INFO]', {
    timestamp,
    message,
    ...context,
  });
}

// ============================================================================
// ERROR HANDLERS
// ============================================================================

/**
 * Handle Supabase errors
 * 
 * @param {Object} error - Supabase error object
 * @param {string} operation - Operation yang sedang dilakukan
 * @returns {Response} Error response
 * 
 * @example
 * const { data, error } = await supabase.from('profiles').select();
 * if (error) {
 *   return handleSupabaseError(error, 'fetch profile');
 * }
 */
export function handleSupabaseError(error, operation = 'database operation') {
  logError(new DatabaseError(`Supabase error during ${operation}`, error), {
    operation,
    supabaseError: {
      message: error.message,
      code: error.code,
      details: error.details,
      hint: error.hint,
    },
  });
  
  return internalErrorResponse('Terjadi kesalahan pada database. Coba lagi.');
}

/**
 * Handle validation errors dari Zod
 * 
 * @param {Object} zodError - Zod error object
 * @returns {Response} Validation error response
 */
export function handleValidationError(zodError) {
  const firstError = Object.values(zodError)[0];
  const message = Array.isArray(firstError?._errors) 
    ? firstError._errors[0] 
    : 'Input tidak valid.';
  
  return validationErrorResponse(message, zodError);
}

/**
 * Catch-all error handler untuk route handlers
 * 
 * Wrap route handler dengan ini untuk automatic error handling
 * 
 * @param {Function} handler - Route handler function
 * @returns {Function} Wrapped handler
 * 
 * @example
 * export const POST = withErrorHandler(async (request) => {
 *   // Your route logic
 *   // Errors akan di-catch dan di-handle otomatis
 * });
 */
export function withErrorHandler(handler) {
  return async (request, context) => {
    try {
      return await handler(request, context);
    } catch (error) {
      // Jika error adalah Response (dari helper functions), return langsung
      if (error instanceof Response) {
        return error;
      }
      
      // Jika ApiError, convert ke response
      if (error instanceof ApiError) {
        logError(error, {
          route: request.url,
          method: request.method,
        });
        
        return errorResponse(error.message, error.code, error.statusCode);
      }
      
      // Unknown error
      logError(error, {
        route: request.url,
        method: request.method,
        type: 'UNHANDLED',
      });
      
      return internalErrorResponse();
    }
  };
}

// ============================================================================
// SAFE ERROR DETAILS (untuk client)
// ============================================================================

/**
 * Get safe error details untuk client
 * 
 * Filter sensitive information dari error sebelum dikirim ke client
 * 
 * @param {Error} error - Error object
 * @returns {string} Safe error message
 */
export function getSafeErrorMessage(error) {
  // Default safe message
  if (!error || !error.message) {
    return 'Terjadi kesalahan. Coba lagi.';
  }
  
  // Jika error dari Supabase auth, return generic message
  if (error.message?.includes('Invalid login credentials')) {
    return 'Email atau password salah.';
  }
  
  if (error.message?.includes('Email not confirmed')) {
    return 'Email belum diverifikasi.';
  }
  
  if (error.message?.includes('User not found')) {
    return 'Pengguna tidak ditemukan.';
  }
  
  // Return original message jika sudah safe (Indonesian)
  if (/^[a-zA-Z\s.,!?]+$/.test(error.message) === false) {
    return error.message;
  }
  
  // Default fallback
  return 'Terjadi kesalahan. Coba lagi.';
}

// Import missing dependency
import { validationErrorResponse, errorResponse } from './response';
