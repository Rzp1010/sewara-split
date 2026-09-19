// @ts-nocheck
import { getServerClient } from '@/lib/api/supabase';
import { requireAuth } from '@/lib/api/auth';
import { getTenantId, withTenant } from '@/lib/api/tenant';
import { successResponse } from '@/lib/api/response';
import { withErrorHandler } from '@/lib/api/errors';

export const runtime = 'nodejs';

/**
 * GET /api/members — member tenant + info tipe-nya.
 *
 * tipeNama & diskon_persen ikut dihitung di sini supaya frontend tidak
 * perlu join sendiri (dulu: getMembers di membersService.js).
 */
export const GET = withErrorHandler(async () => {
  const supabase = await getServerClient();
  const user = await requireAuth(supabase);
  const tenantId = await getTenantId(supabase, user.id);

  const [membersRes, typesRes] = await Promise.all([
    supabase.from('members').select('*').eq('user_id', tenantId).order('nama'),
    supabase.from('member_types').select('*').eq('user_id', tenantId),
  ]);

  if (membersRes.error) throw membersRes.error;
  if (typesRes.error) throw typesRes.error;

  const types = typesRes.data || [];
  const byId = new Map(types.map((t) => [t.id, t]));

  const members = (membersRes.data || []).map((m) => {
    const tpl = m.tipe_id != null ? byId.get(m.tipe_id) : null;
    return {
      ...m,
      tipeNama: tpl?.nama || null,
      diskon_persen:
        tpl && tpl.status === 'aktif' ? Number(tpl.diskon_persen) || 0 : 0,
    };
  });

  return successResponse({ members });
});

/**
 * POST /api/members — tambah member
 */
export const POST = withErrorHandler(async (request) => {
  const supabase = await getServerClient();
  const user = await requireAuth(supabase);

  const body = await request.json();
  const [row] = await withTenant(supabase, user.id, [body]);

  const { data, error } = await supabase
    .from('members')
    .insert(row)
    .select()
    .single();

  if (error) throw error;
  return successResponse({ member: data });
});