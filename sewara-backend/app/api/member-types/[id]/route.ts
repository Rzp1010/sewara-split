// @ts-nocheck
import { getServerClient } from '@/lib/api/supabase';
import { requireAuth } from '@/lib/api/auth';
import { getTenantId } from '@/lib/api/tenant';
import { successResponse } from '@/lib/api/response';
import { withErrorHandler } from '@/lib/api/errors';

export const runtime = 'nodejs';

/**
 * DELETE /api/member-types/[id] — hapus template member milik tenant sendiri
 */
export const DELETE = withErrorHandler(async (request, { params }) => {
  const supabase = await getServerClient();
  const user = await requireAuth(supabase);
  const tenantId = await getTenantId(supabase, user.id);

  const { id } = await params;

  const { error } = await supabase
    .from('member_types')
    .delete()
    .eq('id', id)
    .eq('user_id', tenantId);

  if (error) throw error;
  return successResponse({ ok: true });
});

/**
 * PATCH /api/member-types/[id] — update template member milik tenant sendiri
 */
export const PATCH = withErrorHandler(async (request, { params }) => {
  const supabase = await getServerClient();
  const user = await requireAuth(supabase);
  const tenantId = await getTenantId(supabase, user.id);

  const { id } = await params;
  const body = await request.json();
  delete body.user_id;

  const { data, error } = await supabase
    .from('member_types')
    .update(body)
    .eq('id', id)
    .eq('user_id', tenantId)
    .select()
    .single();

  if (error) throw error;
  return successResponse({ memberType: data });
});