// @ts-nocheck
/**
 * Guard kondisi S/N unit.
 *
 * Kondisi disimpan sebagai JSONB map di inventory.kondisi_sn:
 *   { "CAM-001": { "kondisi": "bermasalah", "catatan": "lensa macet" } }
 *   kondisi: "baik" | "bermasalah" | "maintenance"
 * SN tidak ada di map = dianggap "baik".
 *
 * Aturan: "maintenance" TIDAK boleh disewa. "bermasalah" boleh (warning di frontend).
 */

import { validationErrorResponse } from './response';

// Pecah string SN. Frontend pakai pemisah ", "; array & objek {sn} ikut didukung.
export function pecahSN(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.flatMap(pecahSN);
  if (typeof value === 'object') return pecahSN(value.sn ?? value.serial_number);
  return String(value)
    .split(', ')
    .map((s) => s.trim())
    .filter(Boolean);
}

// Ambil semua SN dari satu item (tunggal + bundling).
function snDariItem(item) {
  return [
    ...pecahSN(item?.sn ?? item?.serial_number),
    ...pecahSN(item?.assignedSNs ?? item?.assigned_components),
  ];
}

// Ambil inventory_id dari item (mapping sama dengan transaction-items/route.ts:94).
function inventoryIdDariItem(item) {
  return item?.inventory_id ?? item?.idBarang ?? item?.ref?.id ?? null;
}

/**
 * Cek daftar item transaksi terhadap kondisi_sn tiap inventory.
 *
 * @returns {Response|null} Response 400 bila ada SN maintenance, null bila lolos.
 */
export async function guardMaintenance(supabase, items) {
  const daftar = Array.isArray(items) ? items : [];

  // Kelompokkan SN per inventory_id
  const perInventory = new Map();
  for (const item of daftar) {
    const invId = inventoryIdDariItem(item);
    const sns = snDariItem(item);
    if (invId == null || sns.length === 0) continue;
    const key = String(invId);
    const arr = perInventory.get(key) || [];
    arr.push(...sns);
    perInventory.set(key, arr);
  }
  if (perInventory.size === 0) return null;

  const { data, error } = await supabase
    .from('inventory')
    .select('id, kondisi_sn')
    .in('id', [...perInventory.keys()]); // RLS auto-filter tenant
  if (error) throw error;

  const mapById = new Map((data || []).map((r) => [String(r.id), r.kondisi_sn || {}]));

  for (const [invId, sns] of perInventory) {
    // Fail-open: inventory tanpa kondisi_sn (map kosong) = semua baik.
    const kondisiMap = mapById.get(invId) || {};
    for (const sn of sns) {
      if (kondisiMap[sn]?.kondisi === 'maintenance') {
        return validationErrorResponse(
          `Unit S/N "${sn}" sedang maintenance dan tidak bisa disewa.`,
        );
      }
    }
  }

  return null;
}