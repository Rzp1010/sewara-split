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
    .select('*, transaction_items(*), transaction_payments(*)')
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
  
  const { data: transaction, error } = await supabase
    .from('transactions')
    .update(body)
    .eq('id', id)
    .select()
    .single();
  
  if (error) throw error;
  
  return successResponse({ transaction });
});
