// @ts-nocheck
/**
 * Blacklist Penyewa — helper bersama.
 *
 * Tabel public.penyewa_blacklist per tenant. Guard transaksi memakai
 * cariBlacklist untuk menolak penyewa yang match HP (ternormalisasi) atau
 * nama (lower/trim persis).
 */

import { errorResponse } from './response';

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
 * Urutan: HP ternormalisasi dulu, fallback nama lower/trim persis.
 * @returns {Promise<{hit:boolean,nama:string,alasan:string}|null>}
 */
export async function cariBlacklist(supabase, tenantId, { nama, hp } = {}) {
  if (!tenantId || (!nama && !hp)) return null;

  const { data, error } = await supabase
    .from('penyewa_blacklist')
    .select('nama, hp, alasan')
    .eq('user_id', tenantId);
  if (error) throw error;

  const rows = data || [];
  const targetHp = normalisasiHp(hp);
  const targetNama = String(nama ?? '').trim().toLowerCase();

  if (targetHp) {
    const byHp = rows.find((r) => r.hp && normalisasiHp(r.hp) === targetHp);
    if (byHp) return { hit: true, nama: byHp.nama, alasan: byHp.alasan };
  }
  if (targetNama) {
    const byNama = rows.find(
      (r) => String(r.nama ?? '').trim().toLowerCase() === targetNama,
    );
    if (byNama) return { hit: true, nama: byNama.nama, alasan: byNama.alasan };
  }
  return null;
}

/**
 * Guard transaksi: kembalikan Response 403 bila penyewa ter-blacklist, else null.
 */
export async function guardBlacklist(supabase, tenantId, { penyewa, hp } = {}) {
  const found = await cariBlacklist(supabase, tenantId, { nama: penyewa, hp });
  if (!found) return null;
  return errorResponse(
    `Penyewa terdaftar blacklist: ${found.nama} — ${found.alasan}`,
    'PENYEWA_BLACKLIST',
    403,
  );
}