// @ts-nocheck
/**
 * Blacklist Penyewa — helper bersama.
 *
 * Tabel public.penyewa_blacklist per tenant. cariBlacklist dipakai endpoint
 * /api/blacklist/check untuk memberi TAUAN ke frontend.
 * Kebijakan 2026-10-02: blacklist = PASANGAN (nama + HP). Hit HANYA bila kedua
 * nilai terisi dan keduanya sama: nama lower(trim) identik DAN normalisasiHp
 * identik. Tidak ada fallback nama-saja / HP-saja. Penyewa ter-blacklist tetap
 * bisa booking, hanya notif.
 */

/**
 * Normalisasi HP untuk perbandingan: buang semua non-digit, lalu bila diawali
 * '0' ganti satu kali dengan '6' di depan. Hasil hanya dipakai untuk compare,
 * bukan disimpan.
 */
export function normalisasiHp(hp) {
  const digit = String(hp ?? '').replace(/\D/g, '');
  if (!digit) return '';
  return digit.startsWith('0') ? '6' + digit.slice(1) : digit;
}

/** Baris DB -> bentuk json camelCase untuk frontend. */
export function rowToCamel(row) {
  return {
    id: row.id,
    nama: row.nama,
    hp: row.hp,
    alamat: row.alamat,
    alasan: row.alasan,
    transaksiId: row.transaksi_id,
    memberId: row.member_id,
    fotoJaminan: Array.isArray(row.foto_jaminan) ? row.foto_jaminan : [],
    addedBy: row.added_by,
    createdAt: row.created_at,
  };
}

/** Role caller dari profiles (null bila tidak ada). */
export async function getCallerRole(supabase, userId) {
  const { data } = await supabase
    .from('profiles')
    .select('role')
    .eq('user_id', userId)
    .maybeSingle();
  return data?.role || null;
}

/** true bila role owner atau superadmin. */
export async function isOwnerRole(supabase, userId) {
  const role = await getCallerRole(supabase, userId);
  return role === 'owner' || role === 'superadmin';
}

/**
 * Cari entri blacklist yang match untuk tenant.
 *
 * Kebijakan pair: hit hanya bila nama DAN hp sama-sama terisi lalu keduanya
 * identik (nama lower(trim) + normalisasiHp). Salah satu kosong -> null.
 * @returns {Promise<{hit:boolean,nama:string,alasan:string}|null>}
 */
export async function cariBlacklist(supabase, tenantId, { nama, hp } = {}) {
  const targetHp = normalisasiHp(hp);
  const targetNama = String(nama ?? '').trim().toLowerCase();
  if (!tenantId || !targetNama || !targetHp) return null;

  const { data, error } = await supabase
    .from('penyewa_blacklist')
    .select('nama, hp, alasan')
    .eq('user_id', tenantId);
  if (error) throw error;

  const rows = data || [];
  const hit = rows.find(
    (r) =>
      r.hp &&
      normalisasiHp(r.hp) === targetHp &&
      String(r.nama ?? '').trim().toLowerCase() === targetNama,
  );
  if (hit) return { hit: true, nama: hit.nama, alasan: hit.alasan };
  return null;
}
