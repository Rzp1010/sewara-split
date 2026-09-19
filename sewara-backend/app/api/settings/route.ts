// @ts-nocheck
import { getServerClient } from '@/lib/api/supabase';
import { requireAuth } from '@/lib/api/auth';
import { getTenantId } from '@/lib/api/tenant';
import { successResponse } from '@/lib/api/response';
import { withErrorHandler } from '@/lib/api/errors';

export const runtime = 'nodejs';

/**
 * GET /api/settings
 * GET /api/settings?key=xxx
 */
export const GET = withErrorHandler(async (request) => {
  const supabase = await getServerClient();
  await requireAuth(supabase);

  const { searchParams } = new URL(request.url);
  const key = searchParams.get('key');

  const query = supabase.from('settings').select('*');

  if (key) {
    const { data, error } = await query.eq('key', key).maybeSingle();
    if (error) throw error;
    return successResponse({ setting: data });
  }

  const { data, error } = await query;
  if (error) throw error;
  return successResponse({ settings: data });
});

/**
 * POST /api/settings — upsert setting tenant
 *
 * `value` dikirim sudah dalam bentuk string JSON (pola lama: JSON.stringify).
 */
export const POST = withErrorHandler(async (request) => {
  const supabase = await getServerClient();
  const user = await requireAuth(supabase);
  const tenantId = await getTenantId(supabase, user.id);

  const body = await request.json();
  const rows = Array.isArray(body) ? body : [body];

  const stamped = rows.map((row) => ({
    ...row,
    user_id: tenantId,
    value:
      typeof row.value === 'string' ? row.value : JSON.stringify(row.value),
    updated_at: row.updated_at || new Date().toISOString(),
  }));

  const { data, error } = await supabase
    .from('settings')
    .upsert(stamped, { onConflict: 'user_id,key' })
    .select();

  if (error) throw error;
  return successResponse({ settings: data });
});