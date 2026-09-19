// @ts-nocheck
/**
 * Tenant Resolution
 *
 * Multi-tenant Sewara: baris data milik OWNER (owner_id), staf ikut tenant owner-nya.
 * Frontend dulu memakai getOwnerIdAktif(); sekarang resolusi ini di backend
 * supaya user_id pada penulisan selalu benar dan tidak bisa dipalsukan client.
 */

/**
 * Tenant ID aktif: owner_id kalau ada, kalau tidak user_id sendiri.
 *
 * @param {SupabaseClient} supabase - client dengan sesi user
 * @param {string} userId - id user yang login
 * @returns {Promise<string>} owner/tenant id
 */
export async function getTenantId(supabase, userId) {
  if (!userId) return null;

  const { data } = await supabase
    .from('profiles')
    .select('owner_id')
    .eq('user_id', userId)
    .maybeSingle();

  return data?.owner_id || userId;
}

/**
 * Tempel user_id tenant ke satu/beberapa baris sebelum insert.
 */
export async function withTenant(supabase, userId, rows) {
  const tenantId = await getTenantId(supabase, userId);
  const list = Array.isArray(rows) ? rows : [rows];
  return list.map((row) => ({ ...row, user_id: row.user_id || tenantId }));
}