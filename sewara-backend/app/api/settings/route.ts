// @ts-nocheck
import { getServerClient } from '@/lib/api/supabase';
import { requireAuth } from '@/lib/api/auth';
import { getTenantId } from '@/lib/api/tenant';
import { successResponse, forbiddenResponse } from '@/lib/api/response';
import { withErrorHandler } from '@/lib/api/errors';

export const runtime = 'nodejs';

// Pertahanan lapis-2 di route (RLS settings_own_or_owner sudah menolak di DB, tapi
// tanpa ini staf dapat 500 samar; dengan ini -> 403 jelas + tidak bergantung policy).

// Allowlist key yang boleh ditulis staf (non-owner). Key lain -> 403.
const KEY_STAF = ['kalender_selesai', 'bukti_backup_ack'];

// Key privat yang disembunyikan dari staf pada GET (owner/superadmin bebas).
const KEY_PRIVAT = ['telegram_login_notif', 'webhook_sheets', 'invoice_prefix', 'invoice_digit', 'invoice_mulai', 'invoice_counter', 'cari_sembunyikan_riwayat'];

async function getCallerRole(supabase, userId) {
  const { data } = await supabase
    .from('profiles')
    .select('role')
    .eq('user_id', userId)
    .maybeSingle();
  return data?.role || null;
}

function isOwnerRole(role) {
  return role === 'owner' || role === 'superadmin';
}

/**
 * GET /api/settings
 * GET /api/settings?key=xxx
 */
export const GET = withErrorHandler(async (request) => {
  const supabase = await getServerClient();
  const user = await requireAuth(supabase);
  const owner = isOwnerRole(await getCallerRole(supabase, user.id));

  const { searchParams } = new URL(request.url);
  const key = searchParams.get('key');

  if (key) {
    if (!owner && KEY_PRIVAT.includes(key)) return successResponse({ setting: null });
    const { data, error } = await supabase.from('settings').select('*').eq('key', key).maybeSingle();
    if (error) throw error;
    return successResponse({ setting: data });
  }

  const { data, error } = await supabase.from('settings').select('*');
  if (error) throw error;
  const settings = owner ? data : data.filter((r) => !KEY_PRIVAT.includes(r.key));
  return successResponse({ settings });
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
  const owner = isOwnerRole(await getCallerRole(supabase, user.id));

  const body = await request.json();
  const rows = Array.isArray(body) ? body : [body];

  // staf (non-owner) hanya boleh tulis key di KEY_STAF; sisanya dibuang.
  // kalau request minta key terlarang -> 403 eksplisit, bukan 500 RLS.
  let izin = rows;
  if (!owner) {
    izin = rows.filter((r) => KEY_STAF.includes(r?.key));
    if (izin.length === 0 && rows.some((r) => r?.key && !KEY_STAF.includes(r.key))) {
      throw forbiddenResponse('Hanya owner yang boleh mengubah pengaturan ini.');
    }
  }

  const stamped = izin.map((row) => ({
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