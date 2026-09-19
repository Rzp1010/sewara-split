// @ts-nocheck
/**
 * Rate Limiting Utilities
 * 
 * Unified rate limiting dengan support untuk Upstash Redis atau fallback ke in-memory
 * 
 * ⚠️ WARNING: In-memory fallback tidak persistent dan reset saat deployment.
 * Untuk production, gunakan Upstash Redis atau Vercel KV.
 */

import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { RATE_LIMITS } from './constants';
import { rateLimitResponse } from './response';
import { logWarning } from './errors';

// ============================================================================
// UPSTASH REDIS SETUP
// ============================================================================

let redis = null;
let isUpstashAvailable = false;

// Check if Upstash credentials are available
if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
  try {
    redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });
    isUpstashAvailable = true;
  } catch (error) {
    logWarning('Failed to initialize Upstash Redis', { error: error.message });
  }
} else {
  logWarning('Upstash Redis credentials not found. Using in-memory fallback.');
}

// ============================================================================
// IN-MEMORY FALLBACK
// ============================================================================

/**
 * In-memory rate limiter (fallback)
 * 
 * ⚠️ Tidak persistent, reset saat deployment
 */
class InMemoryRateLimiter {
  constructor() {
    this.store = new Map();
  }

  /**
   * Clean expired entries
   */
  cleanup() {
    const now = Date.now();
    for (const [key, data] of this.store.entries()) {
      const validAttempts = data.attempts.filter(timestamp => now - timestamp < data.window);
      if (validAttempts.length === 0) {
        this.store.delete(key);
      } else {
        this.store.set(key, { ...data, attempts: validAttempts });
      }
    }
  }

  /**
   * Check rate limit
   */
  async limit(identifier, maxRequests, windowMs) {
    this.cleanup();
    
    const now = Date.now();
    const data = this.store.get(identifier) || { attempts: [], window: windowMs };
    
    // Filter attempts dalam window
    const validAttempts = data.attempts.filter(timestamp => now - timestamp < windowMs);
    
    // Check limit
    if (validAttempts.length >= maxRequests) {
      return {
        success: false,
        remaining: 0,
        reset: new Date(validAttempts[0] + windowMs),
      };
    }
    
    // Record attempt
    validAttempts.push(now);
    this.store.set(identifier, { attempts: validAttempts, window: windowMs });
    
    return {
      success: true,
      remaining: maxRequests - validAttempts.length,
      reset: new Date(now + windowMs),
    };
  }
}

const memoryLimiter = new InMemoryRateLimiter();

// ============================================================================
// RATE LIMITER INSTANCES
// ============================================================================

/**
 * Parse window string ke milliseconds
 * 
 * @param {string|number} window - Window string (e.g., '10m', '1h', '60s') or milliseconds
 * @returns {number} Milliseconds
 */
function parseWindow(window) {
  // If already a number, return as-is
  if (typeof window === 'number') return window;
  
  const match = window.match(/^(\d+)([smh])$/);
  if (!match) return 60000; // default 1 minute
  
  const value = parseInt(match[1]);
  const unit = match[2];
  
  switch (unit) {
    case 's': return value * 1000;
    case 'm': return value * 60 * 1000;
    case 'h': return value * 60 * 60 * 1000;
    default: return 60000;
  }
}

/**
 * Create rate limiter instance
 * 
 * @param {number} requests - Max requests
 * @param {string} window - Time window (e.g., '10m', '1h')
 * @returns {Object} Rate limiter
 */
function createRateLimiter(requests, window) {
  if (isUpstashAvailable && redis) {
    // Use Upstash Redis
    return new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(requests, window),
      analytics: false, // Disable analytics untuk free tier
    });
  }
  
  // Fallback to in-memory
  const windowMs = parseWindow(window);
  return {
    limit: async (identifier) => {
      return await memoryLimiter.limit(identifier, requests, windowMs);
    },
  };
}

// Pre-create limiters untuk common use cases
export const registerLimiter = createRateLimiter(
  RATE_LIMITS.REGISTER_PER_IP.requests,
  RATE_LIMITS.REGISTER_PER_IP.window
);

export const loginIpLimiter = createRateLimiter(
  RATE_LIMITS.LOGIN_IP_FAILURES.requests,
  RATE_LIMITS.LOGIN_IP_FAILURES.window
);

export const loginEmailLimiter = createRateLimiter(
  RATE_LIMITS.LOGIN_EMAIL_FAILURES.requests,
  RATE_LIMITS.LOGIN_EMAIL_FAILURES.window
);

export const memberUploadLimiter = createRateLimiter(
  RATE_LIMITS.MEMBER_UPLOAD.requests,
  RATE_LIMITS.MEMBER_UPLOAD.window
);

export const emailResendPerEmailLimiter = createRateLimiter(
  RATE_LIMITS.EMAIL_RESEND_PER_EMAIL.requests,
  RATE_LIMITS.EMAIL_RESEND_PER_EMAIL.window
);

export const emailResendPerIpLimiter = createRateLimiter(
  RATE_LIMITS.EMAIL_RESEND_PER_IP.requests,
  RATE_LIMITS.EMAIL_RESEND_PER_IP.window
);

/**
 * Admin user management rate limiters
 */
export const adminCreateUserLimiter = createCustomRateLimiter(10, 60 * 1000);
export const adminDeleteUserLimiter = createCustomRateLimiter(5, 60 * 1000);
export const adminPatchUserLimiter = createCustomRateLimiter(20, 60 * 1000);

// ============================================================================
// RATE LIMIT HELPERS
// ============================================================================

/**
 * Check rate limit dan return response jika exceeded
 * 
 * @param {Object} limiter - Rate limiter instance
 * @param {string} identifier - Identifier (IP, email, user ID, etc)
 * @param {string} message - Custom error message (optional)
 * @returns {Promise<Response|null>} Response jika rate limit exceeded, null jika OK
 * 
 * @example
 * const limitResponse = await checkRateLimit(registerLimiter, ip);
 * if (limitResponse) return limitResponse;
 */
export async function checkRateLimit(limiter, identifier, message = null) {
  try {
    const result = await limiter.limit(identifier);
    
    if (!result.success) {
      const defaultMessage = 'Terlalu banyak percobaan. Coba lagi nanti.';
      return rateLimitResponse(message || defaultMessage);
    }
    
    return null; // OK
  } catch (error) {
    // Jika rate limiter error, allow request (fail open)
    logWarning('Rate limiter error', { error: error.message, identifier });
    return null;
  }
}

/**
 * Create custom rate limiter
 * 
 * @param {number} requests - Max requests
 * @param {string} window - Time window
 * @returns {Object} Rate limiter instance
 * 
 * @example
 * const customLimiter = createCustomRateLimiter(100, '1h');
 * const limitResponse = await checkRateLimit(customLimiter, userId);
 */
export function createCustomRateLimiter(requests, window) {
  return createRateLimiter(requests, window);
}

// ============================================================================
// EXPORTS
// ============================================================================

export { isUpstashAvailable };

/**
 * Check if using Upstash Redis atau in-memory fallback
 */
export function getRateLimiterInfo() {
  return {
    provider: isUpstashAvailable ? 'upstash' : 'in-memory',
    persistent: isUpstashAvailable,
    warning: !isUpstashAvailable ? 'In-memory limiter will reset on deployment' : null,
  };
}
