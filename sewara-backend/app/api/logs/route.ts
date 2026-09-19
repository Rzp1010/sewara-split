// @ts-nocheck
import { getServerClient } from '@/lib/api/supabase';
import { requireAuth } from '@/lib/api/auth';
import { getTenantId, withTenant } from '@/lib/api/tenant';
import { successResponse } from '@/lib/api/response';
import { withErrorHandler } from '@/lib/api/errors';

export const runtime = 'nodejs';

/**
 * GET /api/logs — list activity logs
 *
 * Query params: startDate, endDate (created_at range), offset, limit (default 200)
 */
export const GET = withErrorHandler(async (request) => {
  const supabase = await getServerClient();
  await requireAuth(supabase);

  const { searchParams } = new URL(request.url);
  const startDate = searchParams.get('startDate');
  const endDate = searchParams.get('endDate');
  const offset = Number(searchParams.get('offset') || 0);
  const limit = Number(searchParams.get('limit') || 200);

  let query = supabase
    .from('activity_logs')
    .select('*')
    .order('id', { ascending: false })
    .range(offset, offset + limit - 1);

  if (startDate) query = query.gte('created_at', startDate);
  if (endDate) query = query.lte('created_at', endDate);

  const { data, error } = await query;
  if (error) throw error;
  return successResponse({ logs: data });
});

/**
 * POST /api/logs — insert activity log(s)
 */
export const POST = withErrorHandler(async (request) => {
  const supabase = await getServerClient();
  const user = await requireAuth(supabase);

  const body = await request.json();
  const rows = Array.isArray(body) ? body : [body];
  
  // Stamp user_id untuk RLS
  const stamped = await withTenant(supabase, user.id, rows);

  const { data, error } = await supabase
    .from('activity_logs')
    .insert(stamped)
    .select();

  if (error) throw error;
  return successResponse({ logs: data });
});

/**
 * DELETE /api/logs
 * Body: { ids: [...] }            → hapus log tertentu
 * Body: { olderThanDays: n }      → hapus log lebih lama dari n hari
 * Body: {}                        → hapus semua log tenant
 */
export const DELETE = withErrorHandler(async (request) => {
  const supabase = await getServerClient();
  await requireAuth(supabase);

  const body = await request.json().catch(() => ({}));
  const { ids, olderThanDays } = body || {};

  let query = supabase.from('activity_logs').delete();

  if (ids?.length) {
    query = query.in('id', ids);
  } else if (olderThanDays) {
    const batas = new Date(
      Date.now() - Number(olderThanDays) * 24 * 60 * 60 * 1000,
    ).toISOString();
    query = query.lt('created_at', batas);
  } else {
    query = query.neq('id', '00000000-0000-0000-0000-000000000000');
  }

  const { data, error } = await query.select('id');
  if (error) throw error;
  return successResponse({ ok: true, deleted: (data || []).length });
});