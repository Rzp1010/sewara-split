// @ts-nocheck
import { getServerClient, getServiceRoleClient } from '@/lib/api/supabase';
import { requireAuth } from '@/lib/api/auth';
import { getTenantId, withTenant } from '@/lib/api/tenant';
import { successResponse } from '@/lib/api/response';
import { withErrorHandler } from '@/lib/api/errors';

export const runtime = 'nodejs';

/**
 * GET /api/inventory
 *   ?ids=a,b     .in('id')
 *   ?kolom=id    select kolom tertentu
 *   ?ringkas=1   hanya id
 */
export const GET = withErrorHandler(async (request) => {
  const supabase = await getServerClient();
  await requireAuth(supabase);

  const { searchParams } = new URL(request.url);
  const ids = searchParams.get('ids');
  const ringkas = searchParams.get('ringkas') === '1';
  const kolom = ringkas ? 'id' : searchParams.get('kolom') || '*';

  let query = supabase.from('inventory').select(kolom);

  if (ids) {
    query = query.in('id', ids.split(',').filter(Boolean));
  } else {
    query = query.order('nama');
  }

  const { data, error } = await query;
  if (error) throw error;
  return successResponse({ inventory: data });
});

/**
 * POST /api/inventory — tambah inventory
 */
export const POST = withErrorHandler(async (request) => {
  const supabase = await getServerClient();
  const user = await requireAuth(supabase);

  const body = await request.json();
  const { id, ...cleanBody } = body; // Strip id dari frontend
  
  // Generate id: epoch-ms global (domain id inventory memang timestamp ms dari
  // era pre-split; max+1 numeric kecil nabrak baris tenant lain — lihat riwayat
  // bug duplicate inventory_pkey). Urut DESC = max global, service role = tanpa
  // filter RLS tenant.
  // ponytail: tabrakan dua POST dalam millidetik yang sama masih mungkin;
  // upgrade path = sequence DB asli / generateUuid.
  const admin = getServiceRoleClient();
  const { data: maxRow } = await admin
    .from('inventory')
    .select('id')
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle();
  const nowMs = Date.now();
  const nextId = Math.max(nowMs, (Number(maxRow?.id) || 0) + 1);
  
  const [row] = await withTenant(supabase, user.id, [{ ...cleanBody, id: nextId }]);

  const { data, error } = await supabase
    .from('inventory')
    .insert(row)
    .select()
    .single();

  if (error) throw error;
  return successResponse({ inventory: data });
});