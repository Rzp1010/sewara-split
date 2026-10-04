// @ts-nocheck
/**
 * /api/blacklist/upload
 *
 * POST multipart: entryId, file, label? (index ignored for compatibility).
 * Label slot is one of FOTO_SLOTS; R2 key uses slug(label).
 */

import { getServerClient } from '@/lib/api/supabase';
import { requireAuth } from '@/lib/api/auth';
import { getTenantId } from '@/lib/api/tenant';
import {
  successResponse,
  notFoundResponse,
  validationErrorResponse,
} from '@/lib/api/response';
import { withErrorHandler, logError } from '@/lib/api/errors';
import { memberUploadLimiter, checkRateLimit } from '@/lib/api/rate-limit';
import { storage } from '@/lib/storage';

export const runtime = 'nodejs';

const ALLOWED_MIME = ['image/jpeg', 'image/png', 'application/pdf'];
const MAX_SIZE = 5 * 1024 * 1024;
const FOTO_SLOTS = ['KTP', 'Kartu Keluarga', 'SIM', 'NPWP', 'Lainnya'];

function slugLabel(label) {
  return label.toLowerCase().replace(/\s+/g, '-');
}

async function deleteBlacklistFile(path, tenantId) {
  if (!path.startsWith(`blacklist/${tenantId}/`)) {
    logError(new Error('Skip deletion of non-blacklist tenant path.'), {
      route: '/api/blacklist/upload', operation: 'delete_old_file_skip_unsafe_path', path,
    });
    return;
  }
  try {
    await storage.delete(path);
  } catch (e) {
    logError(e, { route: '/api/blacklist/upload', operation: 'delete_old_file', path });
  }
}

export const POST = withErrorHandler(async (request) => {
  const supabase = await getServerClient();
  const user = await requireAuth(supabase);

  const rateLimitResponse = await checkRateLimit(
    memberUploadLimiter,
    user.id,
    'Terlalu banyak upload. Coba lagi dalam beberapa saat.',
  );
  if (rateLimitResponse) return rateLimitResponse;

  const formData = await request.formData();
  const file = formData.get('file');
  const entryId = formData.get('entryId');
  // Multipart index sengaja tidak dipakai lagi; slot ditentukan label.
  const labelRaw = formData.get('label') || 'Lainnya';
  const label = String(labelRaw);

  if (!file || typeof file.arrayBuffer !== 'function' || !entryId) {
    return validationErrorResponse('File atau entry ID tidak valid.');
  }
  if (!FOTO_SLOTS.includes(label)) {
    return validationErrorResponse('Label dokumen tidak valid.');
  }
  if (!ALLOWED_MIME.includes(file.type)) {
    return validationErrorResponse('Jenis file tidak didukung. Gunakan JPG, PNG, atau PDF.');
  }
  if (file.size > MAX_SIZE) {
    return validationErrorResponse('Ukuran file maksimal 5 MB.');
  }

  const tenantId = await getTenantId(supabase, user.id);

  const { data: entry, error: entryError } = await supabase
    .from('penyewa_blacklist')
    .select('foto_jaminan')
    .eq('id', entryId)
    .eq('user_id', tenantId)
    .maybeSingle();
  if (entryError) throw entryError;
  if (!entry) return notFoundResponse('Entri blacklist tidak ditemukan.');

  const documents = Array.isArray(entry.foto_jaminan) ? entry.foto_jaminan : [];
  const existingIndex = documents.findIndex((doc) => doc?.label === label);
  if (existingIndex < 0 && documents.length >= 5) {
    return validationErrorResponse('Maksimal 5 dokumen diizinkan.');
  }

  const ext = file.type === 'application/pdf' ? 'pdf' : file.type === 'image/png' ? 'png' : 'jpg';
  const key = `blacklist/${tenantId}/${entryId}/${slugLabel(label)}.${ext}`;
  const oldPath = existingIndex >= 0 ? documents[existingIndex]?.path : null;

  await storage.upload(key, Buffer.from(await file.arrayBuffer()), file.type);

  const newDoc = { label, path: key };
  if (existingIndex >= 0) {
    if (oldPath && oldPath !== key) await deleteBlacklistFile(oldPath, tenantId);
    documents[existingIndex] = newDoc;
  } else {
    documents.push(newDoc);
  }

  const { error: updateError } = await supabase
    .from('penyewa_blacklist')
    .update({ foto_jaminan: documents })
    .eq('id', entryId)
    .eq('user_id', tenantId);
  if (updateError) throw updateError;

  return successResponse({ path: key, label });
});