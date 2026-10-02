// @ts-nocheck
/**
 * /api/blacklist/header
 *
 * GET ?path=blacklist/<tenantId>/... — stream proxy foto blacklist dari R2.
 * Guard prefix tegas: path wajib mulai `blacklist/<tenantId caller>/`.
 * Route khusus blacklist (bukan generik) supaya prefix guard eksplisit.
 */

import { NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { getServerClient } from '@/lib/api/supabase';
import { requireAuth } from '@/lib/api/auth';
import { getTenantId } from '@/lib/api/tenant';
import {
  forbiddenResponse,
  notFoundResponse,
  validationErrorResponse,
} from '@/lib/api/response';
import { withErrorHandler } from '@/lib/api/errors';
import { storage } from '@/lib/storage';

export const runtime = 'nodejs';

function mimeFromExt(ext) {
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'pdf') return 'application/pdf';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  return 'application/octet-stream';
}

export const GET = withErrorHandler(async (request) => {
  const supabase = await getServerClient();
  const user = await requireAuth(supabase);
  const tenantId = await getTenantId(supabase, user.id);

  const { searchParams } = new URL(request.url);
  const path = searchParams.get('path');
  if (!path) return validationErrorResponse('Parameter path wajib diisi.');

  if (!path.startsWith(`blacklist/${tenantId}/`)) {
    return forbiddenResponse('Anda tidak memiliki akses ke file ini.');
  }

  let bytes;
  try {
    bytes = await storage.get(path);
  } catch (e) {
    return notFoundResponse('Foto tidak ditemukan (mungkin sudah terhapus).');
  }

  const ext = path.split('.').pop()?.toLowerCase();
  const etag = `"${createHash('sha256').update(bytes).digest('hex').slice(0, 32)}"`;

  return new NextResponse(bytes, {
    headers: {
      'Content-Type': mimeFromExt(ext),
      'Cache-Control': 'private, max-age=0, must-revalidate',
      'ETag': etag,
      'Content-Disposition': 'inline',
    },
  });
});