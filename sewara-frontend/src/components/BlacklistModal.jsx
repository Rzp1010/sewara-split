"use client";

import { useState } from "react";
import {
  tambahBlacklist,
  ubahBlacklist,
  uploadBlacklistFoto,
} from "@/lib/db";
import { useNotify } from "@/components/NotificationProvider";
import { FOTO_SLOTS, SlotJaminan } from "@/components/DokumenJaminan";
import { Button, Modal } from "@/components/ui";

const EMPTY = { nama: "", hp: "", alamat: "", alasan: "" };
const SLOT_KOSONG = Array(5).fill(null);

// Nilai awal dihitung saat mount: host selalu me-mount ulang modal ini per entri
// (`{blackEdit ? <BlacklistModal entry=... /> : null}`), jadi tidak perlu efek
// penyelarasan state.
function formAwal(prefill, entry) {
  return {
    ...EMPTY,
    nama: entry?.nama || prefill?.nama || "",
    hp: entry?.hp || prefill?.hp || "",
    alamat: entry?.alamat || prefill?.alamat || "",
    alasan: entry?.alasan || "",
  };
}

function slotsAwal(prefill, entry) {
  // Snapshot foto member -> readonly, ikut terkirim saat POST create.
  const awal = Array(5).fill(null);
  const sumber = entry
    ? Array.isArray(entry.fotoJaminan)
      ? entry.fotoJaminan
      : []
    : Array.isArray(prefill?.fotoJaminan)
      ? prefill.fotoJaminan
      : [];
  sumber
    .filter((f) => f?.path)
    .slice(0, 5)
    .forEach((f, i) => {
      awal[i] = {
        label: f.label || FOTO_SLOTS[i],
        path: f.path,
        ...(entry ? {} : { snapshot: true }),
      };
    });
  return awal;
}

/**
 * Modal Blacklist penyewa (dibuat dari riwayat / pelanggan / detail member).
 * prefill: {nama, hp, alamat, transaksiId?, memberId?, fotoJaminan?}
 * entry:   entri blacklist yang diedit (mode ubah data + tambah foto).
 * onDone(): dipanggil setelah sukses (caller refresh).
 */
export default function BlacklistModal({ open, onClose, prefill, entry, onDone }) {
  const { notify } = useNotify();
  const [form, setForm] = useState(() => formAwal(prefill, entry));
  const [slots, setSlots] = useState(() => slotsAwal(prefill, entry));
  const [saving, setSaving] = useState(false);

  async function simpan() {
    if (!form.nama.trim()) return notify("Nama wajib diisi.", "error");
    if (!form.hp.trim()) return notify("HP wajib diisi.", "error");
    if (!form.alasan.trim()) return notify("Alasan wajib diisi.", "error");
    setSaving(true);
    try {
      const snapshot = slots
        .filter((s) => s?.path)
        .map((s) => ({ label: s.label, path: s.path }));
      if (entry?.id) {
        const r = await ubahBlacklist(entry.id, {
          nama: form.nama.trim(),
          hp: form.hp.trim(),
          alamat: form.alamat || "",
          alasan: form.alasan.trim(),
        });
        if (!r.ok) return notify(r.error || "Gagal menyimpan blacklist.", "error");
        for (const s of slots.filter((x) => x?.file)) {
          const up = await uploadBlacklistFoto(entry.id, s.file, s.label);
          if (!up.ok)
            notify(`Gagal upload ${s.label}: ${up.error || "coba lagi"}.`, "warning");
        }
        notify("Entri blacklist diperbarui.");
        onDone?.();
        onClose?.();
        return;
      }
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

  const snapshotAda = slots.some((slot) => slot?.snapshot);
  return (
    <Modal
      isOpen={open}
      onClose={onClose}
      title={entry ? "Ubah entri blacklist" : "Tambah ke blacklist"}
      description="Data ini dipakai untuk memberi peringatan saat penyewa dikenali."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Batal</Button>
          <Button
            variant="danger"
            loading={saving}
            disabled={!form.nama.trim() || !form.hp.trim() || !form.alasan.trim()}
            onClick={simpan}
          >
            {entry ? "Simpan perubahan" : "Tambahkan ke blacklist"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <section className="rounded-lg border border-[var(--border-color)] p-4">
          <h4 className="mb-3 text-xs font-bold uppercase tracking-wide text-[var(--text-muted)]">Data penyewa</h4>
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-[var(--text-secondary)]">Nama <span className="text-[var(--color-danger)]">*</span></label>
              <input
                value={form.nama}
                onChange={(e) => setForm({ ...form, nama: e.target.value })}
                placeholder="Nama penyewa"
                className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)] px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-[var(--text-secondary)]">No. HP <span className="text-[var(--color-danger)]">*</span></label>
              <input
                value={form.hp}
                onChange={(e) => setForm({ ...form, hp: e.target.value })}
                placeholder="08xxxxxxxxxx"
                className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)] px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
              />
              <p className="mt-1 text-xs text-[var(--text-muted)]">Pencocokan memakai pasangan nama dan nomor HP.</p>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-[var(--text-secondary)]">Alamat</label>
              <input
                value={form.alamat}
                onChange={(e) => setForm({ ...form, alamat: e.target.value })}
                placeholder="Alamat penyewa (opsional)"
                className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)] px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-[var(--text-secondary)]">Alasan <span className="text-[var(--color-danger)]">*</span></label>
              <textarea
                rows={3}
                value={form.alasan}
                onChange={(e) => setForm({ ...form, alasan: e.target.value })}
                placeholder="Jelaskan alasan penyewa masuk blacklist."
                className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)] px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
              />
            </div>
          </div>
        </section>

        <section className="rounded-lg border border-[var(--border-color)] p-4">
          <h4 className="mb-3 text-xs font-bold uppercase tracking-wide text-[var(--text-muted)]">Dokumen jaminan</h4>
          <SlotJaminan items={slots} onChange={setSlots} />
          <p className="mt-2 text-xs leading-relaxed text-[var(--text-muted)]">JPG/PNG/PDF maks 5MB per file.</p>
          {snapshotAda ? <p className="mt-2 text-xs text-[var(--text-muted)]">Dokumen tersalin dari data member; tidak dapat diubah di sini.</p> : null}
        </section>
      </div>
    </Modal>
  );
}
