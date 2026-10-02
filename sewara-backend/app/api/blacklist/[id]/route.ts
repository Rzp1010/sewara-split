// @ts-nocheck
/**
 * /api/blacklist/[id]
 *
 * PATCH  — update nama/hp/alamat/alasan/fotoJaminan; owner/superadmin saja.
 * DELETE — hapus entri; owner/superadmin saja. Foto R2 dihapus dulu (best-effort).
 */

import { getServerClient } from '@/lib/api/supabase';
import { requireAuth } from '@/lib/api/auth';
import { getTenantId } from '@/lib/api/tenant';
import {
  successResponse,
  notFoundResponse,
  forbiddenResponse,
  validationErrorResponse,
} from '@/lib/api/response';
import { withErrorHandler, logError } from '@/lib/api/errors';
import { storage } from '@/lib/storage';
import { rowToCamel, isOwnerRole } from '@/lib/api/blacklist';

export const runtime = 'nodejs';

async function requireOwner(supabase, user) {
  if (!(await isOwnerRole(supabase, user.id))) {
    return forbiddenResponse('Hanya owner yang boleh mengelola blacklist.');
  }
  return null;
}

export const PATCH = withErrorHandler(async (request, { params }) => {
  const { id } = await params;
  const supabase = await getServerClient();
  const user = await requireAuth(supabase);

  const ownerError = await requireOwner(supabase, user);
  if (ownerError) return ownerError;

  const body = await request.json().catch(() => ({}));
  const update = {};

  if (body?.nama !== undefined) {
    const nama = String(body.nama).trim();
    if (!nama) return validationErrorResponse('Nama tidak boleh kosong.');
    update.nama = nama;
  }
  if (body?.alasan !== undefined) {
    const alasan = String(body.alasan).trim();
    if (!alasan) return validationErrorResponse('Alasan tidak boleh kosong.');
    update.alasan = alasan;
  }
  if (body?.hp !== undefined) update.hp = body.hp == null ? null : String(body.hp).trim();
  if (body?.alamat !== undefined) update.alamat = body.alamat == null ? null : String(body.alamat);
  if (body?.fotoJaminan !== undefined) {
    if (!Array.isArray(body.fotoJaminan)) {
      return validationErrorResponse('Foto jaminan harus berupa array.');
    }
    if (body.fotoJaminan.length > 5) {
      return validationErrorResponse('Maksimal 5 foto jaminan.');
    }
    update.foto_jaminan = body.fotoJaminan;
  }

  if (Object.keys(update).length === 0) {
    return validationErrorResponse('Tidak ada perubahan.');
  }

  const tenantId = await getTenantId(supabase, user.id);
  const { data, error } = await supabase
    .from('penyewa_blacklist')
    .update(update)
    .eq('id', id)
    .eq('user_id', tenantId)
    .select()
    .maybeSingle();
  if (error) throw error;
  if (!data) return notFoundResponse('Entri blacklist tidak ditemukan.');

  return successResponse({ entry: rowToCamel(data) });
});

export const DELETE = withErrorHandler(async (request, { params }) => {
  const { id } = await params;
  const supabase = await getServerClient();
  const user = await requireAuth(supabase);

  const ownerError = await requireOwner(supabase, user);
  if (ownerError) return ownerError;

  const tenantId = await getTenantId(supabase, user.id);
  const { data: row, error: rowError } = await supabase
    .from('penyewa_blacklist')
    .select('foto_jaminan')
    .eq('id', id)
    .eq('user_id', tenantId)
    .maybeSingle();
  if (rowError) throw rowError;
  if (!row) return notFoundResponse('Entri blacklist tidak ditemukan.');

  // Hapus file R2 dulu (best-effort) — jangan gagalkan delete row.
  const paths = (Array.isArray(row.foto_jaminan) ? row.foto_jaminan : [])
    .map((d) => d?.path)
    .filter(Boolean);
  for (const path of paths) {
    try {
      await storage.delete(path);
    } catch (e) {
      if (e?.name !== 'NoSuchKey' && e?.name !== 'NotFound') {
        logError(e, { route: '/api/blacklist/[id]', operation: 'delete_r2', path });
      }
    }
  }

  const { error } = await supabase
    .from('penyewa_blacklist')
    .delete()
    .eq('id', id)
    .eq('user_id', tenantId);
  if (error) throw error;

  return successResponse({ ok: true });
});