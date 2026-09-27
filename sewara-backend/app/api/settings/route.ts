// @ts-nocheck
import { getServerClient } from '@/lib/api/supabase';
import { requireAuth } from '@/lib/api/auth';
import { getTenantId } from '@/lib/api/tenant';
import { successResponse, forbiddenResponse } from '@/lib/api/response';
import { withErrorHandler } from '@/lib/api/errors';

export const runtime = 'nodejs';

// Pertahanan lapis-2 di route (RLS settings_own_or_owner sudah menolak di DB, tapi
// tanpa ini staf dapat 500 samar; dengan ini -> 403 jelas + tidak bergantung policy).
const KEY_SENSITIF = ['telegram_login_notif', 'webhook_sheets'];

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

  // staf (tenantId = owner) dilarang tulis key sensitif -> 403 eksplisit, bukan 500 RLS
  if (rows.some((r) => KEY_SENSITIF.includes(r?.key)) && tenantId !== user.id) {
    throw forbiddenResponse('Hanya owner yang boleh mengubah pengaturan sensitif ini.');
  }

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