// @ts-nocheck
import { getServerClient } from '@/lib/api/supabase';
import { requireAuth } from '@/lib/api/auth';
import { getTenantId } from '@/lib/api/tenant';
import { successResponse } from '@/lib/api/response';
import { withErrorHandler } from '@/lib/api/errors';

export const runtime = 'nodejs';

/**
 * PATCH /api/members/[id] — update member (hanya milik tenant sendiri)
 */
export const PATCH = withErrorHandler(async (request, { params }) => {
  const { id } = await params;
  const supabase = await getServerClient();
  const user = await requireAuth(supabase);
  const tenantId = await getTenantId(supabase, user.id);

  const body = await request.json();
  delete body.user_id;

  const { data, error } = await supabase
    .from('members')
    .update(body)
    .eq('id', id)
    .eq('user_id', tenantId)
    .select()
    .single();

  if (error) throw error;
  return successResponse({ member: data });
});

/**
 * DELETE /api/members/[id] — hapus member (hanya milik tenant sendiri)
 */
export const DELETE = withErrorHandler(async (request, { params }) => {
  const { id } = await params;
  const supabase = await getServerClient();
  const user = await requireAuth(supabase);
  const tenantId = await getTenantId(supabase, user.id);

  const { error } = await supabase
    .from('members')
    .delete()
    .eq('id', id)
    .eq('user_id', tenantId);

  if (error) throw error;
  return successResponse({ ok: true });
});