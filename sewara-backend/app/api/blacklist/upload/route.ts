// @ts-nocheck
/**
 * /api/blacklist/upload
 *
 * POST multipart: entryId, file, index (slot 0-4), label?.
 * Simpan ke R2 `blacklist/<tenantId>/<entryId>/doc-<index>.<ext>` lalu perbarui
 * fotoJaminan entri (array [{label,path}] max 5, ganti slot). Pola member/upload.
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
const MAX_SIZE = 10 * 1024 * 1024;

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
  const indexRaw = formData.get('index');
  const label = formData.get('label') || 'Lainnya';

  if (!file || typeof file.arrayBuffer !== 'function' || !entryId) {
    return validationErrorResponse('File atau entry ID tidak valid.');
  }
  const index = Number(indexRaw);
  if (!Number.isInteger(index) || index < 0 || index > 4) {
    return validationErrorResponse('Index dokumen tidak valid (harus 0-4).');
  }
  if (!ALLOWED_MIME.includes(file.type)) {
    return validationErrorResponse('Jenis file tidak didukung. Gunakan JPG, PNG, atau PDF.');
  }
  if (file.size > MAX_SIZE) {
    return validationErrorResponse('Ukuran file maksimal 10 MB.');
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

  const ext = file.type === 'application/pdf' ? 'pdf' : file.type === 'image/png' ? 'png' : 'jpg';
  const key = `blacklist/${tenantId}/${entryId}/doc-${index}.${ext}`;

  await storage.upload(key, Buffer.from(await file.arrayBuffer()), file.type);

  const documents = Array.isArray(entry.foto_jaminan) ? entry.foto_jaminan : [];
  const newDoc = { label: String(label), path: key };

  if (index < documents.length) {
    const oldPath = documents[index]?.path;
    if (oldPath && oldPath !== key) {
      try {
        await storage.delete(oldPath);
      } catch (e) {
        logError(e, { route: '/api/blacklist/upload', operation: 'delete_old_file', path: oldPath });
      }
    }
    documents[index] = newDoc;
  } else {
    if (documents.length >= 5) {
      return validationErrorResponse('Maksimal 5 dokumen diizinkan.');
    }
    documents.push(newDoc);
  }

  const { error: updateError } = await supabase
    .from('penyewa_blacklist')
    .update({ foto_jaminan: documents })
    .eq('id', entryId)
    .eq('user_id', tenantId);
  if (updateError) throw updateError;

  return successResponse({ path: key, label: String(label) });
});