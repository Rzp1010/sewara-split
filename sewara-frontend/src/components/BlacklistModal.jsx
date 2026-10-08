"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { tambahBlacklist, uploadBlacklistFoto } from "@/lib/db";
import { useNotify } from "@/components/NotificationProvider";
import BlacklistFotoSlot, { FOTO_SLOTS } from "@/components/BlacklistFotoSlot";

const EMPTY = { nama: "", hp: "", alamat: "", alasan: "" };
const SLOT_KOSONG = Array(5).fill(null);

/**
 * Modal Blacklist penyewa (dibuat dari riwayat / pelanggan / detail member).
 * prefill: {nama, hp, alamat, transaksiId?, memberId?, fotoJaminan?}
 * onDone(): dipanggil setelah sukses (caller refresh).
 */
export default function BlacklistModal({ open, onClose, prefill, onDone }) {
  const { notify } = useNotify();
  const [form, setForm] = useState(EMPTY);
  const [slots, setSlots] = useState(SLOT_KOSONG);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm({
      ...EMPTY,
      nama: prefill?.nama || "",
      hp: prefill?.hp || "",
      alamat: prefill?.alamat || "",
    });
    // Snapshot foto member -> readonly, ikut terkirim saat POST create.
    const awal = Array(5).fill(null);
    (Array.isArray(prefill?.fotoJaminan) ? prefill.fotoJaminan : [])
      .filter((f) => f?.path)
      .slice(0, 5)
      .forEach((f, i) => {
        awal[i] = { label: f.label || FOTO_SLOTS[i], path: f.path, snapshot: true };
      });
    setSlots(awal);
  }, [open]);

  async function simpan() {
    if (!form.nama.trim()) return notify("Nama wajib diisi.", "error");
    if (!form.hp.trim()) return notify("HP wajib diisi.", "error");
    if (!form.alasan.trim()) return notify("Alasan wajib diisi.", "error");
    setSaving(true);
    try {
      const snapshot = slots
        .filter((s) => s?.path)
        .map((s) => ({ label: s.label, path: s.path }));
      const r = await tambahBlacklist({
        nama: form.nama.trim(),
        hp: form.hp.trim(),
        alamat: form.alamat || "",
        alasan: form.alasan.trim(),
        transaksiId: prefill?.transaksiId,
        memberId: prefill?.memberId,
        fotoJaminan: snapshot,
      });
      if (!r.ok) {
        return notify(
          r.code === "BLACKLIST_DUPLIKAT" || /duplikat/i.test(r.error || "")
            ? "Penyewa ini sudah ada di blacklist."
            : r.error || "Gagal menyimpan blacklist.",
          "error",
        );
      }
      const entryId = r.data?.id || r.data?.entry?.id;
      // Upload file baru setelah entri punya id; gagal per file jangan batalkan.
      const baru = slots.filter((s) => s?.file);
      if (entryId && baru.length) {
        for (const s of baru) {
          const up = await uploadBlacklistFoto(entryId, s.file, s.label);
          if (!up.ok)
            notify(`Gagal upload ${s.label}: ${up.error || "coba lagi"}.`, "warning");
        }
      }
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
        className="relative flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-xl bg-[var(--bg-surface)] shadow-2xl"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--border-color)] px-6 py-4">
          <h3 className="m-0 text-lg font-bold">Blacklist Penyewa</h3>
          <button
            type="button"
            aria-label="Tutup"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg border-0 bg-[var(--bg-subtle)] text-xl text-[var(--text-secondary)] hover:bg-[var(--bg-surface)]"
          >
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-sm font-semibold text-[var(--text-primary)]">
                Nama
              </label>
              <input
                value={form.nama}
                onChange={(e) => setForm({ ...form, nama: e.target.value })}
                className="w-full rounded-md border border-solid border-[var(--border-color)] bg-[var(--bg-surface)] px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none focus:border-[#7181E0] focus:ring-2 focus:ring-[#7181E0]/20"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-semibold text-[var(--text-primary)]">
                No. HP <span className="text-red-500">*</span>
              </label>
              <input
                value={form.hp}
                onChange={(e) => setForm({ ...form, hp: e.target.value })}
                placeholder="08xxxxxxxxxx"
                className="w-full rounded-md border border-solid border-[var(--border-color)] bg-[var(--bg-surface)] px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none focus:border-[#7181E0] focus:ring-2 focus:ring-[#7181E0]/20"
              />
              <p className="mt-1 text-[11px] text-[var(--text-muted)]">
                Blacklist memakai pasangan nama + nomor HP.
              </p>
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1.5 block text-sm font-semibold text-[var(--text-primary)]">
                Alamat
              </label>
              <input
                value={form.alamat}
                onChange={(e) => setForm({ ...form, alamat: e.target.value })}
                className="w-full rounded-md border border-solid border-[var(--border-color)] bg-[var(--bg-surface)] px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none focus:border-[#7181E0] focus:ring-2 focus:ring-[#7181E0]/20"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1.5 block text-sm font-semibold text-[var(--text-primary)]">
                Alasan <span className="text-red-500">*</span>
              </label>
              <textarea
                rows={3}
                value={form.alasan}
                onChange={(e) => setForm({ ...form, alasan: e.target.value })}
                placeholder="Cth: barang tidak dikembalikan, telat berulang, dll."
                className="w-full rounded-md border border-solid border-[var(--border-color)] bg-[var(--bg-surface)] px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none focus:border-[#7181E0] focus:ring-2 focus:ring-[#7181E0]/20"
              />
            </div>
          </div>

          <div className="mt-5">
            <BlacklistFotoSlot items={slots} onChange={setSlots} />
            <p className="mt-2 text-[11px] leading-relaxed text-[var(--text-muted)]">
              JPG/PNG/PDF maks 5MB per file.
            </p>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-[var(--border-color)] px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border-0 bg-[var(--bg-subtle)] px-4 py-2 text-sm font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-surface)]"
          >
            Batal
          </button>
          <button
            type="button"
            onClick={simpan}
            disabled={
              saving ||
              !form.nama.trim() ||
              !form.hp.trim() ||
              !form.alasan.trim()
            }
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