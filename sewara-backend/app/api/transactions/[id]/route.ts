// @ts-nocheck
import { getServerClient } from '@/lib/api/supabase';
import { requireAuth } from '@/lib/api/auth';
import { successResponse, errorResponse } from '@/lib/api/response';
import { withErrorHandler } from '@/lib/api/errors';
import { guardMaintenance } from '@/lib/api/kondisi-sn';

export const runtime = 'nodejs';

export const GET = withErrorHandler(async (request, { params }) => {
  const supabase = await getServerClient();
  await requireAuth(supabase);
  
  const { id } = await params;
  
  const { data: transaction, error } = await supabase
    .from('transactions')
    .select(`
      *,
      transaction_items!transaction_id(*),
      transaction_payments!transaction_id(*)
    `)
    .eq('id', id)
    .single();
  
  if (error) {
    if (error.code === 'PGRST116') {
      return errorResponse('Transaction not found', 'NOT_FOUND', 404);
    }
    throw error;
  }
  
  return successResponse({ transaction });
});

export const PATCH = withErrorHandler(async (request, { params }) => {
  const supabase = await getServerClient();
  await requireAuth(supabase);
  
  const { id } = await params;
  const body = await request.json();

  // Guard: saat status diubah jadi "Disewa", pastikan SN unit tidak maintenance.
  // Menutup jalur serah-terima walau booking dibuat sebelum SN ditag maintenance.
  if (body?.status === 'Disewa') {
    const { data: items, error: itemError } = await supabase
      .from('transaction_items')
      .select('serial_number, inventory_id, assigned_components')
      .eq('transaction_id', id);
    if (itemError) throw itemError;

    const guardError = await guardMaintenance(
      supabase,
      (items || []).map((it) => ({
        serial_number: it.serial_number,
        inventory_id: it.inventory_id,
        assigned_components: it.assigned_components,
      })),
    );
    if (guardError) return guardError;
  }

  // Filter: buang child tables & metadata sebelum update
  const { transaction_items, transaction_payments, created_at, updated_at, konfirmasi_perubahan_total, ...updateData } = body;

  if (('biaya' in updateData || 'total_akhir' in updateData || 'diskon' in updateData) && !konfirmasi_perubahan_total) {
    const [{ data: payments, error: paymentError }, { data: stored, error: transactionError }] = await Promise.all([
      supabase
        .from('transaction_payments')
        .select('amount')
        .eq('transaction_id', id),
      supabase
        .from('transactions')
        .select('total_akhir, diskon')
        .eq('id', id)
        .single(),
    ]);
    if (paymentError) throw paymentError;
    if (transactionError) throw transactionError;
    const transaksiGratisTersimpan = Number(stored.total_akhir) <= 0 && Number(stored.diskon?.totalDiskon) > 0;
    if (transaksiGratisTersimpan || (payments || []).some((payment) => Number(payment.amount) > 0)) {
      return errorResponse('Transaksi sudah memiliki pembayaran. Konfirmasi perubahan total diperlukan.', 'KONFIRMASI_PERUBAHAN_TOTAL', 409);
    }
  }
  
  const { data: transaction, error } = await supabase
    .from('transactions')
    .update(updateData)
    .eq('id', id)
    .select()
    .single();
  
  if (error) throw error;
  
  return successResponse({ transaction });
});
