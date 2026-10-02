"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { tambahBlacklist } from "@/lib/db";
import { useNotify } from "@/components/NotificationProvider";

const EMPTY = { nama: "", hp: "", alamat: "", alasan: "", fotoJaminan: [] };

/**
 * Modal Blacklist penyewa.
 * prefill: {nama, hp, alamat, transaksiId?, memberId?, fotoJaminan?}
 * onDone(): dipanggil setelah sukses (caller refresh).
 */
export default function BlacklistModal({ open, onClose, prefill, onDone }) {
  const { notify } = useNotify();
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm({
      ...EMPTY,
      nama: prefill?.nama || "",
      hp: prefill?.hp || "",
      alamat: prefill?.alamat || "",
      fotoJaminan: Array.isArray(prefill?.fotoJaminan)
        ? prefill.fotoJaminan.filter((f) => f?.path)
        : [],
    });
  }, [open]);

  async function simpan() {
    if (!form.nama.trim()) return notify("Nama wajib diisi.", "error");
    if (!form.alasan.trim()) return notify("Alasan wajib diisi.", "error");
    setSaving(true);
    try {
      const r = await tambahBlacklist({
        nama: form.nama.trim(),
        hp: form.hp || "",
        alamat: form.alamat || "",
        alasan: form.alasan.trim(),
        transaksiId: prefill?.transaksiId,
        memberId: prefill?.memberId,
        fotoJaminan: form.fotoJaminan,
      });
      if (!r.ok)
        return notify(
          r.code === "BLACKLIST_DUPLIKAT" || /duplikat/i.test(r.error || "")
            ? "Penyewa ini sudah ada di blacklist."
            : r.error || "Gagal menyimpan blacklist.",
          "error",
        );
      notify("Penyewa ditambahkan ke blacklist.");
      onDone?.();
      onClose?.();
    } finally {
      setSaving(false);
    }
  }

  if (typeof document === "undefined" || !open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <h3 className="m-0 text-lg font-bold">Blacklist Penyewa</h3>
          <button
            type="button"
            aria-label="Tutup"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg border-0 bg-gray-100 text-xl text-gray-600 hover:bg-gray-200"
          >
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-sm font-semibold text-slate-700">
                Nama
              </label>
              <input
                value={form.nama}
                onChange={(e) => setForm({ ...form, nama: e.target.value })}
                className="w-full rounded-md border border-solid border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none focus:border-[#7181E0] focus:ring-2 focus:ring-[#7181E0]/20"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-semibold text-slate-700">
                No HP
              </label>
              <input
                value={form.hp}
                onChange={(e) => setForm({ ...form, hp: e.target.value })}
                className="w-full rounded-md border border-solid border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none focus:border-[#7181E0] focus:ring-2 focus:ring-[#7181E0]/20"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1.5 block text-sm font-semibold text-slate-700">
                Alamat
              </label>
              <input
                value={form.alamat}
                onChange={(e) => setForm({ ...form, alamat: e.target.value })}
                className="w-full rounded-md border border-solid border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none focus:border-[#7181E0] focus:ring-2 focus:ring-[#7181E0]/20"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1.5 block text-sm font-semibold text-slate-700">
                Alasan <span className="text-red-500">*</span>
              </label>
              <textarea
                rows={3}
                value={form.alasan}
                onChange={(e) => setForm({ ...form, alasan: e.target.value })}
                placeholder="Cth: barang tidak dikembalikan, telat berulang, dll."
                className="w-full rounded-md border border-solid border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none focus:border-[#7181E0] focus:ring-2 focus:ring-[#7181E0]/20"
              />
            </div>
          </div>

          {form.fotoJaminan.length > 0 && (
            <div className="mt-4">
              <p className="mb-2 text-xs font-semibold text-gray-500">
                Snapshot dokumen jaminan ({form.fotoJaminan.length})
              </p>
              <div className="flex flex-wrap gap-2">
                {form.fotoJaminan.map((f, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-600"
                  >
                    {f.label || `Dokumen ${i + 1}`}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-gray-200 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border-0 bg-gray-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-gray-300"
          >
            Batal
          </button>
          <button
            type="button"
            onClick={simpan}
            disabled={saving}
            className="rounded-lg border-0 bg-[#F04438] px-4 py-2 text-sm font-semibold text-white hover:bg-[#d03a2f] disabled:opacity-60"
          >
            {saving ? "Menyimpan..." : "Blacklist"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}