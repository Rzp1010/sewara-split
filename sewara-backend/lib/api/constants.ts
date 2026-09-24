// @ts-nocheck
/**
 * API Configuration Constants
 * 
 * Centralized configuration untuk rate limits, timeouts, dan business rules
 */

// ============================================================================
// RATE LIMITING
// ============================================================================

export const RATE_LIMITS = {
  // Registration
  REGISTER_PER_IP: {
    requests: 5,
    window: '10m', // 10 minutes
  },
  
  // Login
  LOGIN_IP_FAILURES: {
    requests: 10,
    window: '10m',
  },
  LOGIN_EMAIL_FAILURES: {
    requests: 5,
    window: '10m',
  },
  
  // Member upload
  MEMBER_UPLOAD: {
    requests: 50,
    window: '1m', // 60 seconds
  },
  
// Pembayaran (bukti bayar) upload
  PEMBAYARAN_UPLOAD: {
    requests: 50,
    window: '1m',
  },

  // Email resend
  EMAIL_RESEND_PER_EMAIL: {
    requests: 3,
    window: '1h',
  },
  EMAIL_RESEND_PER_IP: {
    requests: 20,
    window: '1h',
  },
};

// ============================================================================
// ACCOUNT LOCKOUT & COOLDOWN
// ============================================================================

export const LOCKOUT = {
  // Login cooldown setelah failed attempts
  COOLDOWN_1MIN: 1 * 60 * 1000, // 1 minute
  COOLDOWN_2MIN: 2 * 60 * 1000, // 2 minutes
  COOLDOWN_30MIN: 30 * 60 * 1000, // 30 minutes
  
  // Thresholds
  THRESHOLD_COOLDOWN_1: 3, // 3 failures → 1 min cooldown
  THRESHOLD_COOLDOWN_2: 5, // 5 failures → 2 min cooldown
  THRESHOLD_LOCKED: 10, // 10 failures → 30 min locked
};

// ============================================================================
// VALIDATION RULES
// ============================================================================

export const VALIDATION = {
  // Password
  PASSWORD_MIN_LENGTH: 8,
  
  // Email regex
  EMAIL_REGEX: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  
  // File upload
  UPLOAD_MAX_SIZE: 10 * 1024 * 1024, // 10 MB
  UPLOAD_MAX_DOCUMENTS: 5,
  UPLOAD_ALLOWED_TYPES: [
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/webp',
    'application/pdf',
  ],
  
  // Member document labels
  DOCUMENT_LABELS: ['KTP', 'KK', 'SIM', 'Lainnya'],
};

// ============================================================================
// SUBSCRIPTION
// ============================================================================

export const SUBSCRIPTION = {
  // Default duration (days)
  DEFAULT_DURATION: 30,
  
  // Grace period setelah expired (belum implemented)
  GRACE_PERIOD_DAYS: 7,
};

// ============================================================================
// TELEGRAM
// ============================================================================

export const TELEGRAM = {
  // Thread IDs
  THREAD_BACKUP: 6,
  THREAD_REGISTRATION: 25,
  THREAD_LOGIN: 4,
  
  // Timeouts
  REQUEST_TIMEOUT: 10000, // 10 seconds
};

// ============================================================================
// STORAGE
// ============================================================================

export const STORAGE = {
  // Signed URL lifetime
  SIGNED_URL_EXPIRES: 3600, // 1 hour
  
  // Bucket paths
  MEMBER_DOCUMENTS_PATH: 'member-documents',
};

// ============================================================================
// ERROR CODES
// ============================================================================

export const ERROR_CODES = {
  // Auth
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  EMAIL_NOT_VERIFIED: 'EMAIL_NOT_VERIFIED',
  ACCOUNT_LOCKED: 'ACCOUNT_LOCKED',
  ACCOUNT_COOLDOWN: 'ACCOUNT_COOLDOWN',
  SUBSCRIPTION_EXPIRED: 'SUBSCRIPTION_EXPIRED',
  
  // Validation
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  INVALID_INPUT: 'INVALID_INPUT',
  
  // Rate limiting
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
  
  // Resources
  NOT_FOUND: 'NOT_FOUND',
  ALREADY_EXISTS: 'ALREADY_EXISTS',
  
  // Server
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  DATABASE_ERROR: 'DATABASE_ERROR',
  EXTERNAL_SERVICE_ERROR: 'EXTERNAL_SERVICE_ERROR',
};
