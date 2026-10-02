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
  const { transaction_items, transaction_payments, created_at, updated_at, ...updateData } = body;
  
  const { data: transaction, error } = await supabase
    .from('transactions')
    .update(updateData)
    .eq('id', id)
    .select()
    .single();
  
  if (error) throw error;
  
  return successResponse({ transaction });
});
