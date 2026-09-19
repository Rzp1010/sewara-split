// @ts-nocheck
import { getServerClient } from '@/lib/api/supabase';
import { requireAuth } from '@/lib/api/auth';
import { successResponse, errorResponse } from '@/lib/api/response';
import { withErrorHandler } from '@/lib/api/errors';

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
