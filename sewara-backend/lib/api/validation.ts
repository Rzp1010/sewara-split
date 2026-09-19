// @ts-nocheck
/**
 * Validation Schemas (Zod)
 * 
 * Centralized validation schemas untuk API request validation
 */

import { z } from 'zod';
import { VALIDATION } from './constants';

// ============================================================================
// COMMON SCHEMAS
// ============================================================================

/**
 * Email schema
 */
export const emailSchema = z
  .string({ required_error: 'Email wajib diisi.' })
  .email('Format email tidak valid.')
  .trim()
  .toLowerCase();

/**
 * Password schema
 */
export const passwordSchema = z
  .string({ required_error: 'Password wajib diisi.' })
  .min(VALIDATION.PASSWORD_MIN_LENGTH, `Password minimal ${VALIDATION.PASSWORD_MIN_LENGTH} karakter.`);

/**
 * Full name schema
 */
export const fullNameSchema = z
  .string({ required_error: 'Nama lengkap wajib diisi.' })
  .min(1, 'Nama lengkap wajib diisi.')
  .trim();

/**
 * Role schema
 */
export const roleSchema = z.enum(['owner', 'cs', 'gudang'], {
  errorMap: () => ({ message: 'Role tidak valid.' }),
});

/**
 * UUID schema
 */
export const uuidSchema = z.string().uuid('ID tidak valid.');

// ============================================================================
// AUTH SCHEMAS
// ============================================================================

/**
 * Login request schema
 */
export const loginSchema = z.object({
  email: emailSchema,
  password: z.string({ required_error: 'Password wajib diisi.' }),
});

/**
 * Register request schema
 */
export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  full_name: fullNameSchema,
});

/**
 * Resend verification email schema
 */
export const resendVerificationSchema = z.object({
  email: emailSchema,
});

// ============================================================================
// ADMIN USER SCHEMAS
// ============================================================================

/**
 * Create user schema (admin)
 */
export const createUserSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  nama_lengkap: z.string().min(1, 'Nama lengkap wajib diisi.').max(100, 'Nama lengkap maksimal 100 karakter.').trim(),
  username: z.string().max(50, 'Username maksimal 50 karakter.').trim().optional(),
  nama_invoice: z.string().max(100, 'Nama invoice maksimal 100 karakter.').trim().optional(),
  role: roleSchema,
}).strict();

/**
 * Delete user schema (admin)
 */
export const deleteUserByEmailSchema = z.object({
  email: emailSchema,
}).strict();

/**
 * Admin PATCH action schema
 */
export const adminPatchSchema = z.object({
  email: emailSchema,
  action: z.enum([
    'setujui_registrasi', 'tolak_registrasi', 'perpanjang_langganan',
    'unlock_akun', 'ubah_password', 'edit_profil',
    'set_role', 'toggle_active'
  ], { errorMap: () => ({ message: 'Action tidak valid.' }) }),
  durasi: z.number().int().positive('Durasi harus positif.').optional(),
  new_password: passwordSchema.optional(),
  nama_lengkap: z.string().max(100).trim().optional(),
  username: z.string().max(50).trim().optional(),
  nama_invoice: z.string().max(100).trim().optional(),
  role: roleSchema.optional(),
}).strict();

export const deleteUserSchema = z.object({
  user_id: uuidSchema,
});

/**
 * Update user schema (admin)
 */
export const updateUserSchema = z.object({
  user_id: uuidSchema,
  action: z.enum(['extend', 'activate', 'deactivate', 'change_role'], {
    errorMap: () => ({ message: 'Action tidak valid.' }),
  }),
  // Optional fields depending on action
  subscription_duration: z.number().int().positive().optional(),
  role: roleSchema.optional(),
});

// ============================================================================
// MEMBER UPLOAD SCHEMAS
// ============================================================================

/**
 * Member document upload schema
 */
export const memberUploadSchema = z.object({
  member_id: z.string().min(1, 'Member ID wajib diisi.'),
  label: z.enum(VALIDATION.DOCUMENT_LABELS, {
    errorMap: () => ({ message: 'Label dokumen tidak valid.' }),
  }),
  index: z
    .number({ required_error: 'Index dokumen wajib diisi.' })
    .int('Index harus bilangan bulat.')
    .min(0, 'Index minimal 0.')
    .max(VALIDATION.UPLOAD_MAX_DOCUMENTS - 1, `Index maksimal ${VALIDATION.UPLOAD_MAX_DOCUMENTS - 1}.`),
});

// ============================================================================
// TELEGRAM SCHEMAS
// ============================================================================

/**
 * Telegram webhook schema
 */
export const telegramWebhookSchema = z.object({
  table: z.string().min(1, 'Table wajib diisi.'),
  type: z.enum(['INSERT', 'UPDATE', 'DELETE'], {
    errorMap: () => ({ message: 'Type tidak valid.' }),
  }),
  record: z.record(z.any()).optional(),
  old_record: z.record(z.any()).optional(),
});

// ============================================================================
// VALIDATION HELPERS
// ============================================================================

/**
 * Parse dan validate request body
 * 
 * @param {z.ZodSchema} schema - Zod schema
 * @param {any} data - Data yang akan divalidate
 * @returns {{ success: true, data: any } | { success: false, errors: any }}
 * 
 * @example
 * const result = validateRequest(loginSchema, await request.json());
 * if (!result.success) {
 *   return validationErrorResponse('Input tidak valid.', result.errors);
 * }
 * const { email, password } = result.data;
 */
export function validateRequest(schema, data) {
  const result = schema.safeParse(data);
  
  if (!result.success) {
    return {
      success: false,
      errors: result.error.format(),
    };
  }
  
  return {
    success: true,
    data: result.data,
  };
}

/**
 * Parse request body as JSON dan validate
 * 
 * @param {Request} request - Next.js request
 * @param {z.ZodSchema} schema - Zod schema
 * @returns {Promise<{ success: true, data: any } | { success: false, errors: any }>}
 * 
 * @example
 * const result = await parseAndValidate(request, loginSchema);
 * if (!result.success) {
 *   return validationErrorResponse('Input tidak valid.', result.errors);
 * }
 */
export async function parseAndValidate(request, schema) {
  try {
    const body = await request.json();
    return validateRequest(schema, body);
  } catch (error) {
    return {
      success: false,
      errors: { _errors: ['Request body harus JSON yang valid.'] },
    };
  }
}
