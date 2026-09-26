// @ts-nocheck
/**
 * Member Photo/Document API Route
 *
 * Streaming langsung byte member document dari R2 (browser tidak pernah menerima URL R2).
 */

import { NextResponse } from 'next/server';
import { getServerClient } from '@/lib/api/supabase';
import { requireAuth } from '@/lib/api/auth';
import { forbiddenResponse, validationErrorResponse, notFoundResponse } from '@/lib/api/response';
import { withErrorHandler } from '@/lib/api/errors';
import { checkRateLimit, memberUploadLimiter } from '@/lib/api/rate-limit';
import { storage } from '@/lib/storage';

export const runtime = 'nodejs';

/**
 * GET /api/member/photo
 * 
 * Stream member document
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
  
  // Stream the object bytes (no R2 URL exposed to browser)
  let bytes;
  try {
    bytes = await storage.get(key);
  } catch (e) {
    return notFoundResponse('Dokumen tidak ditemukan (mungkin sudah terhapus).');
  }
  const ext = key.split('.').pop()?.toLowerCase();
  const mime = ext === 'png' ? 'image/png'
    : ext === 'webp' ? 'image/webp'
    : ext === 'pdf' ? 'application/pdf'
    : (ext === 'jpg' || ext === 'jpeg') ? 'image/jpeg'
    : 'application/octet-stream';
  return new NextResponse(bytes, { headers: { 'Content-Type': mime, 'Cache-Control': 'private, max-age=3600', 'Content-Disposition': 'inline' } });
}

// Export dengan error handler
export const GET = withErrorHandler(getMemberPhotoHandler);
