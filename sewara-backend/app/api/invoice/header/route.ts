// @ts-nocheck
/**
 * Invoice Header API Route
 *
 * Header invoice kustom per-tenant (foto menggantikan tulisan "INVOICE").
 * Byte foto di-stream langsung dari R2 (browser tidak pernah menerima URL R2).
 *
 * Storage key: headers/<tenantId>.<ext>
 * Path disimpan frontend di settings key `invoice_header` via /api/settings.
 */

import { NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { getServerClient } from '@/lib/api/supabase';
import { requireAuth } from '@/lib/api/auth';
import { getTenantId } from '@/lib/api/tenant';
import {
  successResponse,
  notFoundResponse,
  forbiddenResponse,
  validationErrorResponse,
} from '@/lib/api/response';
import { withErrorHandler } from '@/lib/api/errors';
import {
  checkRateLimit,
  createCustomRateLimiter,
} from '@/lib/api/rate-limit';
import { storage } from '@/lib/storage';

export const runtime = 'nodejs';

// Limiter khusus header invoice (bucket sendiri).
const invoiceHeaderLimiter = createCustomRateLimiter(20, '1m');

const ALLOWED_MIME = ['image/png', 'image/jpeg', 'image/webp'];
const MAX_SIZE = 5 * 1024 * 1024;

function extFromMime(mime) {
  if (mime === 'image/png') return 'png';
  if (mime === 'image/webp') return 'webp';
  return 'jpg'; // image/jpeg
}

function mimeFromExt(ext) {
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  return 'application/octet-stream';
}

function prefixFor(tenantId) {
  return `headers/${tenantId}.`;
}

/**
 * GET /api/invoice/header
 * Stream byte header invoice milik tenant caller.
 */
async function getInvoiceHeaderHandler() {
  const supabase = await getServerClient();
  const user = await requireAuth(supabase);
  const tenantId = await getTenantId(supabase, user.id);

  const { data, error } = await supabase
    .from('settings')
    .select('value')
    .eq('user_id', tenantId)
    .eq('key', 'invoice_header')
    .maybeSingle();

  if (error) throw error;

  let path = data?.value;
  // value bisa tersimpan sebagai string JSON ("headers/x.png") mengikuti pola settings lama.
  if (typeof path === 'string') {
    try {
      const parsed = JSON.parse(path);
      if (typeof parsed === 'string') path = parsed;
    } catch {
      // bukan JSON, pakai apa adanya
    }
  }

  if (!path || typeof path !== 'string') {
    return notFoundResponse('Header invoice belum diatur.');
  }

  if (!path.startsWith(prefixFor(tenantId))) {
    return forbiddenResponse('Anda tidak memiliki akses ke file ini.');
  }

  let bytes;
  try {
    bytes = await storage.get(path);
  } catch (e) {
    return notFoundResponse('Header invoice tidak ditemukan (mungkin sudah terhapus).');
  }

  const ext = path.split('.').pop()?.toLowerCase();
  const etag = `"${createHash('sha256').update(bytes).digest('hex').slice(0, 32)}"`;

  return new NextResponse(bytes, {
    headers: {
      'Content-Type': mimeFromExt(ext),
      // Key per-tenant stabil: ganti foto harus langsung terlihat.
      'Cache-Control': 'private, max-age=0, must-revalidate',
      'ETag': etag,
      'Content-Disposition': 'inline',
    },
  });
}

/**
 * POST /api/invoice/header
 * Upload header invoice. Tidak menulis settings (frontend simpan path).
 */
async function postInvoiceHeaderHandler(request) {
  const supabase = await getServerClient();
  const user = await requireAuth(supabase);
  const tenantId = await getTenantId(supabase, user.id);

  const rateLimitResponse = await checkRateLimit(
    invoiceHeaderLimiter,
    user.id,
    'Terlalu banyak upload. Coba lagi dalam beberapa saat.'
  );
  if (rateLimitResponse) return rateLimitResponse;

  const formData = await request.formData();
  const file = formData.get('file');

  const isBlob = file && typeof file.arrayBuffer === 'function' && typeof file.size === 'number';
  if (!isBlob) {
    return validationErrorResponse('File tidak valid.');
  }

  if (!ALLOWED_MIME.includes(file.type)) {
    return validationErrorResponse('Jenis file tidak didukung. Gunakan PNG, JPG, atau WEBP.');
  }

  if (file.size > MAX_SIZE) {
    return validationErrorResponse('Ukuran file maksimal 5 MB.');
  }

  const ext = extFromMime(file.type);
  const path = `${prefixFor(tenantId)}${ext}`;

  await storage.upload(path, Buffer.from(await file.arrayBuffer()), file.type);

  return successResponse({ path });
}

/**
 * DELETE /api/invoice/header?path=headers/<tenantId>.<ext>
 */
async function deleteInvoiceHeaderHandler(request) {
  const supabase = await getServerClient();
  const user = await requireAuth(supabase);
  const tenantId = await getTenantId(supabase, user.id);

  const { searchParams } = new URL(request.url);
  const path = searchParams.get('path');

  if (!path) {
    return validationErrorResponse('Parameter path wajib diisi.');
  }

  if (!path.startsWith(prefixFor(tenantId))) {
    return forbiddenResponse('Anda tidak memiliki akses ke file ini.');
  }

  try {
    await storage.delete(path);
  } catch (e) {
    // Hapus foto yang sudah hilang bukan error.
    if (e?.name === 'NoSuchKey' || e?.name === 'NotFound') {
      // swallow
    } else {
      throw e;
    }
  }

  return successResponse({ ok: true });
}

export const GET = withErrorHandler(getInvoiceHeaderHandler);
export const POST = withErrorHandler(postInvoiceHeaderHandler);
export const DELETE = withErrorHandler(deleteInvoiceHeaderHandler);