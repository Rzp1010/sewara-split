// @ts-nocheck
/**
 * /api/blacklist
 *
 * GET  — daftar entri blacklist tenant caller (semua role boleh baca).
 * POST — tambah entri; owner/superadmin saja.
 *        Body: {nama, hp?, alamat?, alasan, transaksiId?, memberId?, fotoJaminan?}
 *        409 bila sudah ada entri sama (HP ternormalisasi ATAU lower(trim(nama))).
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
import { withErrorHandler } from '@/lib/api/errors';
import {
  rowToCamel,
  isOwnerRole,
  cariBlacklist,
} from '@/lib/api/blacklist';

export const runtime = 'nodejs';

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

  const hp = body?.hp != null ? String(body.hp).trim() : null;
  const alamat = body?.alamat != null ? String(body.alamat) : null;
  const fotoJaminan = Array.isArray(body?.fotoJaminan) ? body.fotoJaminan : [];

  if (fotoJaminan.length > 5) {
    return validationErrorResponse('Maksimal 5 foto jaminan.');
  }

  const tenantId = await getTenantId(supabase, user.id);

  // 409 bila sudah ada entri sama (HP ternormalisasi atau nama lower/trim persis).
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
      transaksi_id: body?.transaksiId ?? null,
      member_id: body?.memberId ?? null,
      foto_jaminan: fotoJaminan,
      added_by: user.id,
    })
    .select()
    .single();
  if (error) throw error;

  return successResponse({ entry: rowToCamel(data) }, 201);
});