// @ts-nocheck
import { triggerDataChangedEvent } from "../helpers/eventHelper";

/**
 * Shared Transaction Field Mappers and Utilities
 *
 * Used by transactionService and transactionServiceAtomic
 * for consistent data transformation
 */

// ============================================================================
// FIELD MAPPERS - TRANSACTION DATA
// ============================================================================

export function mapTransactionToRPC(transactionData) {
  return {
    id: transactionData.id ?? null,
    id_transaksi:
      transactionData.id_transaksi ?? transactionData.no_invoice ?? null,
    penyewa: transactionData.penyewa ?? null,
    hp_penyewa: transactionData.hp_penyewa ?? null,
    alamat_penyewa: transactionData.alamat_penyewa ?? null,
    jaminan_sewa: transactionData.jaminan_sewa ?? null,
    waktu_ambil_rencana: transactionData.waktu_ambil_rencana ?? null,
    waktu_kembali_rencana: transactionData.waktu_kembali_rencana ?? null,
    waktu_ambil_aktual: transactionData.waktu_ambil_aktual ?? null,
    waktu_kembali_aktual: transactionData.waktu_kembali_aktual ?? null,
    status: transactionData.status ?? null,
    riwayatDilayani: transactionData.riwayatDilayani ?? null,
    dilayani_oleh: transactionData.dilayani_oleh ?? null,
    items: transactionData.items ?? [],
    denda: transactionData.denda ?? 0,
    biaya: transactionData.biaya ?? 0,
    durasi_teks: transactionData.durasi_teks ?? null,
    total_akhir: transactionData.total_akhir ?? 0,
    pembayaran: transactionData.pembayaran ?? {},
    diskon: transactionData.diskon ?? {},
    member_id: transactionData.member_id ?? null,
    dp_hangus: transactionData.dp_hangus ?? 0,
    dp_hangus_aturan: transactionData.dp_hangus_aturan ?? null,
    printilan: transactionData.printilan ?? null,
  };
}

// ============================================================================
// FIELD MAPPERS - ITEMS & PAYMENTS
// ============================================================================

export function mapItemsToRPC(items = []) {
  return items.map((item) => ({
    inventory_id: item.inventory_id ?? item.ref?.id ?? null,
    nama: item.nama ?? item.ref?.nama ?? "Unknown",
    jenis: item.jenis ?? item.ref?.jenis ?? "satuan",
    qty: item.qty ?? 1,
    harga: item.harga ?? item.ref?.harga ?? 0,
    subtotal:
      item.subtotal ?? (item.qty ?? 1) * (item.harga ?? item.ref?.harga ?? 0),
    tarif: item.tarif ?? null,
    sn: item.sn ?? null,
    assignedSNs: item.assignedSNs ?? [],
  }));
}
export function mapPaymentsToRPC(payments = []) {
  return payments.map((payment) => ({
    jumlah: payment.jumlah ?? 0,
    metode: payment.metode ?? "Tunai",
    tanggal: payment.tanggal ?? payment.tgl ?? new Date().toISOString(),
    catatan: payment.catatan ?? null,
  }));
}

// ============================================================================
// ERROR HANDLING
// ============================================================================

export function handleRPCError(error) {
  const messages = {
    28000: "Authentication required",
    42501: "Tidak memiliki akses / data tidak ditemukan",
    23503: "Data terkait tidak valid (FK violation)",
    23514: "Data melanggar constraint",
    22023: "Format data tidak valid",
  };
  throw new Error(messages[error.code] || error.message);
}

// ============================================================================
// SHARED EVENT HELPERS
// ============================================================================

export { triggerDataChangedEvent };
