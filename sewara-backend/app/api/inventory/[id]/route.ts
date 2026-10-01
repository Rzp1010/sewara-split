// @ts-nocheck
import { getServerClient } from '@/lib/api/supabase';
import { requireAuth } from '@/lib/api/auth';
import { getTenantId } from '@/lib/api/tenant';
import { successResponse, errorResponse, notFoundResponse, validationErrorResponse } from '@/lib/api/response';
import { withErrorHandler } from '@/lib/api/errors';

export const runtime = 'nodejs';

// Serialisasi ringan daftar komponen [{idBarang, qty}] -> string kanonik untuk
// banding "sama persis". Nama sengaja tidak ikut (bukan bagian definisi paket).
function kanonikKomponen(arr) {
  return JSON.stringify(
    (Array.isArray(arr) ? arr : [])
      .map((c) => ({ idBarang: String(c?.idBarang ?? ''), qty: Number(c?.qty) || 0 }))
      .sort((a, b) => a.idBarang.localeCompare(b.idBarang) || a.qty - b.qty),
  );
}

/**
 * PATCH /api/inventory/[id] — update inventory milik tenant sendiri
 */
export const PATCH = withErrorHandler(async (request, { params }) => {
  const { id } = await params;
  const supabase = await getServerClient();
  const user = await requireAuth(supabase);
  const tenantId = await getTenantId(supabase, user.id);

  const body = await request.json();
  delete body.user_id;

  // Guard definisi paket: hanya jalan kalau body mengubah `komponen`.
  // Edit biasa (tanpa key komponen) tidak menambah query apa pun.
  if (Object.prototype.hasOwnProperty.call(body, 'komponen')) {
    if (!Array.isArray(body.komponen)) {
      return validationErrorResponse('Komponen harus berupa array.');
    }
    for (const entry of body.komponen) {
      if (
        !entry ||
        typeof entry !== 'object' ||
        entry.idBarang === undefined ||
        entry.idBarang === null ||
        !(Number(entry.qty) > 0)
      ) {
        return validationErrorResponse('Setiap komponen wajib punya idBarang dan qty > 0.');
      }
      if (entry.nama !== undefined && typeof entry.nama !== 'string') {
        return validationErrorResponse('Nama komponen harus berupa teks.');
      }
    }

    const { data: current, error: currentError } = await supabase
      .from('inventory')
      .select('jenis, komponen')
      .eq('id', id)
      .eq('user_id', tenantId)
      .maybeSingle();
    if (currentError) throw currentError;
    if (!current) return notFoundResponse('Inventaris tidak ditemukan.');

    // Isi sama persis -> lanjut update normal (simpan ulang tanpa ubah = boleh).
    if (kanonikKomponen(current.komponen) !== kanonikKomponen(body.komponen)) {
      // Cek pemakaian aktif. Pola bulk-delete: select transaction_items dulu,
      // lalu query transactions terpisah (join `.in` pada relasi tidak dipakai di repo).
      const { data: refs, error: refError } = await supabase
        .from('transaction_items')
        .select('transaction_id')
        .eq('inventory_id', id);
      if (refError) throw refError;

      const txIds = [...new Set((refs || []).map((r) => r.transaction_id).filter(Boolean))];
      if (txIds.length) {
        const { data: aktif, error: aktifError } = await supabase
          .from('transactions')
          .select('id')
          .in('id', txIds)
          .in('status', ['Booking', 'Disewa']);
        if (aktifError) throw aktifError;
        if (aktif?.length) {
          return errorResponse(
            'Isi paket tidak bisa diubah selama dipakai booking aktif (Booking/Disewa).',
            'PAKET_IN_USE',
            409,
          );
        }
      }
    }
  }

  const { data, error } = await supabase
    .from('inventory')
    .update(body)
    .eq('id', id)
    .eq('user_id', tenantId)
    .select()
    .single();

  if (error) throw error;
  return successResponse({ inventory: data });
});

/**
 * DELETE /api/inventory/[id] — hapus inventory milik tenant sendiri
 */
export const DELETE = withErrorHandler(async (request, { params }) => {
  const { id } = await params;
  const supabase = await getServerClient();
  const user = await requireAuth(supabase);
  const tenantId = await getTenantId(supabase, user.id);

  const { error } = await supabase
    .from('inventory')
    .delete()
    .eq('id', id)
    .eq('user_id', tenantId);

  if (error) throw error;
  return successResponse({ ok: true });
});