// @ts-nocheck
/**
 * Member Photo/Document URL API Route
 * 
 * Generate signed URL untuk akses member documents dari R2 storage
 */

import { NextResponse } from 'next/server';
import { getServerClient } from '@/lib/api/supabase';
import { requireAuth } from '@/lib/api/auth';
import { forbiddenResponse, validationErrorResponse } from '@/lib/api/response';
import { withErrorHandler } from '@/lib/api/errors';
import { checkRateLimit, memberUploadLimiter } from '@/lib/api/rate-limit';
import { storage } from '@/lib/storage';
import { STORAGE } from '@/lib/api/constants';

export const runtime = 'nodejs';

/**
 * GET /api/member/photo
 * 
 * Generate signed URL untuk member document
 * 
 * Query params:
 * - key: Storage key (format: {user_id}/member-documents/{member_id}/{label}/{index}.{ext})
 */
async function getMemberPhotoHandler(request) {
  const supabase = await getServerClient();
  
  // Require authentication
  const user = await requireAuth(supabase);
  
  // Rate limiting
  const rateLimitResponse = await checkRateLimit(memberUploadLimiter, user.id);
  if (rateLimitResponse) return rateLimitResponse;
  
  // Get key dari query params
  const url = new URL(request.url);
  const key = url.searchParams.get('key');
  
  if (!key) {
    return validationErrorResponse('Parameter key wajib diisi.');
  }
  
  // Security check: key harus dimulai dengan ownerId tenant (staf: owner-nya; owner: dirinya)
  const { data: prof } = await supabase
    .from('profiles')
    .select('owner_id')
    .eq('user_id', user.id)
    .maybeSingle();
  const ownerId = prof?.owner_id || user.id;
  if (!key.startsWith(`${ownerId}/`)) {
    return forbiddenResponse('Anda tidak memiliki akses ke file ini.');
  }
  
  // Generate signed URL (valid untuk 1 jam)
  const signedUrl = await storage.getSignedURL(key, STORAGE.SIGNED_URL_EXPIRES);
  
  // Return flat structure for backward compatibility with frontend
  // Frontend expects: { ok: true, url: "..." }
  return NextResponse.json({ ok: true, url: signedUrl });
}

// Export dengan error handler
export const GET = withErrorHandler(getMemberPhotoHandler);
