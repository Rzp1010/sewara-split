// @ts-nocheck
/**
 * /api/blacklist
 *
 * GET  — daftar entri blacklist tenant caller (semua role boleh baca).
 * POST — tambah entri; owner/superadmin saja.
 *        Body: {nama, hp, alamat?, alasan, transaksiId?, memberId?, fotoJaminan?}
 *        nama + hp + alasan wajib. 409 bila pasangan (nama+hp) sudah ada.
 */

import { getServerClient } from '@/lib/api/supabase';
import { requireAuth } from '@/lib/api/auth';
import { getTenantId } from '@/lib/api/tenant';
import {
  successResponse,
  errorResponse,
  forbiddenResponse,
  validationErrorResponse,
} from '@/lib/api/response';
import { withErrorHandler, logError } from '@/lib/api/errors';
import {
  rowToCamel,
  isOwnerRole,
  cariBlacklist,
} from '@/lib/api/blacklist';
import { storage } from '@/lib/storage';

export const runtime = 'nodejs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseOptionalUuid(value, field) {
  if (value == null || value === '' || value === 'null') return null;
  if (typeof value !== 'string' || !UUID_RE.test(value)) {
    return validationErrorResponse(`${field} harus berupa UUID yang valid.`);
  }
  return value;
}

export const GET = withErrorHandler(async () => {
  const supabase = await getServerClient();
  const user = await requireAuth(supabase);
  const tenantId = await getTenantId(supabase, user.id);

  const { data, error } = await supabase
    .from('penyewa_blacklist')
    .select('*')
    .eq('user_id', tenantId)
    .order('created_at', { ascending: false });
  if (error) throw error;

  return successResponse({ blacklist: (data || []).map(rowToCamel) });
});

export const POST = withErrorHandler(async (request) => {
  const supabase = await getServerClient();
  const user = await requireAuth(supabase);

  // Role gate SEBELUM parse body (pola admin/users: 400 tidak bocor ke non-owner).
  if (!(await isOwnerRole(supabase, user.id))) {
    return forbiddenResponse('Hanya owner yang boleh mengelola blacklist.');
  }

  const body = await request.json().catch(() => ({}));
  const nama = typeof body?.nama === 'string' ? body.nama.trim() : '';
  const alasan = typeof body?.alasan === 'string' ? body.alasan.trim() : '';
  if (!nama) return validationErrorResponse('Nama wajib diisi.');
  if (!alasan) return validationErrorResponse('Alasan wajib diisi.');

  const hp = body?.hp != null ? String(body.hp).trim() : '';
  if (!hp) {
    return validationErrorResponse('HP wajib diisi (blacklist memakai pasangan nama + HP).');
  }
  const alamat = body?.alamat != null ? String(body.alamat) : null;
  const fotoInput = Array.isArray(body?.fotoJaminan) ? body.fotoJaminan : [];

  if (fotoInput.length > 5) {
    return validationErrorResponse('Maksimal 5 foto jaminan.');
  }

  const transaksiId = parseOptionalUuid(body?.transaksiId, 'transaksiId');
  if (transaksiId instanceof Response) return transaksiId;
  const memberId = parseOptionalUuid(body?.memberId, 'memberId');
  if (memberId instanceof Response) return memberId;

  const tenantId = await getTenantId(supabase, user.id);

  // 409 bila pasangan (nama + HP) sudah ada.
  const duplikat = await cariBlacklist(supabase, tenantId, { nama, hp });
  if (duplikat) {
    return errorResponse(
      'Penyewa ini sudah ada di blacklist.',
      'BLACKLIST_DUPLIKAT',
      409,
    );
  }

  const { data, error } = await supabase
    .from('penyewa_blacklist')
    .insert({
      user_id: tenantId,
      nama,
      hp,
      alamat,
      alasan,
      transaksi_id: transaksiId,
      member_id: memberId,
      foto_jaminan: [],
      added_by: user.id,
    })
    .select()
    .single();
  if (error) throw error;

  // Snapshot foto jaminan member ke folder blacklist. Path lama member tidak
  // pernah ditempel langsung ke entry; kegagalan satu salinan hanya di-log.
  const fotoJaminan = [];
  for (let i = 0; i < fotoInput.length; i += 1) {
    const item = fotoInput[i];
    const oldPath = typeof item?.path === 'string' ? item.path : '';
    if (oldPath.startsWith(`blacklist/${tenantId}/`)) {
      fotoJaminan.push({ label: item?.label, path: oldPath });
      continue;
    }
    if (!oldPath.startsWith(`${tenantId}/`)) {
      logError(new Error('Foto blacklist path tidak valid untuk tenant.'), {
        route: '/api/blacklist', operation: 'copy_snapshot_invalid_path', path: oldPath,
      });
      continue;
    }

    try {
      const bytes = await storage.get(oldPath);
      const ext = oldPath.split('.').pop()?.toLowerCase() || 'bin';
      const newPath = `blacklist/${tenantId}/${data.id}/doc-${i}.${ext}`;
      const mime = ext === 'png' ? 'image/png'
        : ext === 'webp' ? 'image/webp'
        : ext === 'pdf' ? 'application/pdf'
        : (ext === 'jpg' || ext === 'jpeg') ? 'image/jpeg'
        : 'application/octet-stream';
      await storage.upload(newPath, bytes, mime);
      fotoJaminan.push({ label: item?.label, path: newPath });
    } catch (copyError) {
      logError(copyError, {
        route: '/api/blacklist', operation: 'copy_snapshot', path: oldPath,
      });
    }
  }

  const { data: updated, error: updateError } = await supabase
    .from('penyewa_blacklist')
    .update({ foto_jaminan: fotoJaminan })
    .eq('id', data.id)
    .eq('user_id', tenantId)
    .select()
    .single();
  if (updateError) throw updateError;

  return successResponse({ entry: rowToCamel(updated) }, 201);
});