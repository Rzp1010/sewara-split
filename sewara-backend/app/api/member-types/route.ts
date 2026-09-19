// @ts-nocheck
import { getServerClient } from '@/lib/api/supabase';
import { requireAuth } from '@/lib/api/auth';
import { getTenantId, withTenant } from '@/lib/api/tenant';
import { successResponse } from '@/lib/api/response';
import { withErrorHandler } from '@/lib/api/errors';

export const runtime = 'nodejs';

export const GET = withErrorHandler(async () => {
  const supabase = await getServerClient();
  const user = await requireAuth(supabase);
  const tenantId = await getTenantId(supabase, user.id);

  const { data: memberTypes, error } = await supabase
    .from('member_types')
    .select('*')
    .eq('user_id', tenantId)
    .order('nama');

  if (error) throw error;
  return successResponse({ memberTypes: memberTypes || [] });
});

export const POST = withErrorHandler(async (request) => {
  const supabase = await getServerClient();
  const user = await requireAuth(supabase);

  const body = await request.json();
  const [row] = await withTenant(supabase, user.id, [body]);

  const { data: memberType, error } = await supabase
    .from('member_types')
    .insert(row)
    .select()
    .single();

  if (error) throw error;
  return successResponse({ memberType });
});