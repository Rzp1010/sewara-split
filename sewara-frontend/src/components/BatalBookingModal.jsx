"use client";

import { useState, useEffect } from "react";
import { getAturanDpHangus, hitungDpHangus } from "@/lib/db";
import { formatRupiah } from "@/lib/utils";

/**
 * Modal konfirmasi pembatalan booking + DP Hangus.
 *
 * Props:
 *   transaction – objek transaksi yang akan dibatalkan
 *   onConfirm   – ({ dp_hangus: number, dp_hangus_aturan: string }) => void
 *   onClose     – () => void
 */
export default function BatalBookingModal({ transaction, onConfirm, onClose }) {
  const [aturanLabel, setAturanLabel] = useState("");
  const [dpBayar, setDpBayar] = useState(0);
  const [dpHangusOtomatis, setDpHangusOtomatis] = useState(0);
  const [manualInput, setManualInput] = useState("");
  const [manualMode, setManualMode] = useState(false);

  useEffect(() => {
    if (!transaction) return;

    const bayar = (transaction.pembayaran?.riwayatBayar || []).reduce(
      (s, b) => s + (b.jumlah || 0),
      0,
    );
    setDpBayar(bayar);

    const config = getAturanDpHangus();
    if (config.aktif) {
      const hasil = hitungDpHangus(bayar, transaction.waktu_ambil_rencana, config);
      setDpHangusOtomatis(hasil.jumlah);
      setAturanLabel(hasil.label);
      setManualMode(false);
    } else {
      setDpHangusOtomatis(bayar);
      setManualInput(String(bayar));
      setManualMode(true);
    }
  }, [transaction]);

  if (!transaction) return null;

  const dpHangusFinal = manualMode
    ? Math.max(0, Number(manualInput) || 0)
    : dpHangusOtomatis;

  function handleConfirm() {
    onConfirm({
      dp_hangus: dpHangusFinal,
      dp_hangus_aturan: manualMode
        ? `Manual: ${formatRupiah(dpHangusFinal)}`
        : aturanLabel,
    });
  }

  return (
    <div className="fixed inset-0 z-[10001] flex items-center justify-center overflow-y-auto bg-black/55 p-4 backdrop-blur-sm">
      <div className="relative flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-lg border border-slate-200 bg-white p-6 shadow-xl">
        {/* Header */}
        <div className="mb-4 flex items-center justify-between border-b border-slate-200 pb-4">
          <h3 className="text-lg font-bold text-gray-900">Batalkan Booking</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup"
            className="rounded p-2 text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-900"
          >
            &times;
          </button>
        </div>

        {/* Info transaksi */}
        <div className="mb-4 space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-500">Invoice</span>
            <span className="font-mono font-semibold">{transaction.no_invoice}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Penyewa</span>
            <span className="font-semibold">{transaction.penyewa}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Total Akhir</span>
            <span className="font-semibold">{formatRupiah(transaction.total_akhir || 0)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Sudah Dibayar</span>
            <span className="font-semibold">{formatRupiah(dpBayar)}</span>
          </div>
        </div>

        {/* Divider */}
        <div className="mb-4 border-t border-dashed border-gray-300" />

        {/* DP Hangus */}
        <div className="mb-4 rounded-lg bg-red-50 p-4">
          <div className="flex justify-between text-sm">
            <span className="font-medium text-red-700">DP Hangus</span>
            <span className="text-lg font-bold text-red-700">
              {formatRupiah(dpHangusFinal)}
            </span>
          </div>

          {manualMode ? (
            <div className="mt-3">
              <label className="mb-1 block text-xs text-gray-500">
                Masukkan jumlah DP hangus:
              </label>
              <input
                type="number"
                min="0"
                value={manualInput}
                onChange={(e) => setManualInput(e.target.value)}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-red-500 focus:ring-2 focus:ring-red-500/20"
              />
            </div>
          ) : (
            <p className="mt-1 text-xs text-red-500">{aturanLabel}</p>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50"
          >
            Batal
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            className="rounded-lg border-0 bg-red-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-600"
          >
            Ya, Batalkan
          </button>
        </div>
      </div>
    </div>
  );
}
