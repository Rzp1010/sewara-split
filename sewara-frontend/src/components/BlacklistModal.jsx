"use client";

import { useState } from "react";
import { tambahBlacklist, ubahBlacklist, uploadBlacklistFoto } from "@/lib/db";
import { useNotify } from "@/components/NotificationProvider";
import { FOTO_SLOTS, SlotJaminan } from "@/components/DokumenJaminan";
import { Button, Modal } from "@/components/ui";
import { hpNormal } from "@/lib/utils";
import InputHP from "@/components/ui/InputHP";

const EMPTY = { nama: "", hp: "", alamat: "", alasan: "" };
const SLOT_KOSONG = Array(5).fill(null);

function formAwal(prefill, entry) {
  return { ...EMPTY, nama: entry?.nama || prefill?.nama || "", hp: entry?.hp || prefill?.hp || "", alamat: entry?.alamat || prefill?.alamat || "", alasan: entry?.alasan || "" };
}

function slotsAwal(prefill, entry) {
  const awal = Array(5).fill(null);
  const sumber = entry ? (Array.isArray(entry.fotoJaminan) ? entry.fotoJaminan : []) : (Array.isArray(prefill?.fotoJaminan) ? prefill.fotoJaminan : []);
  sumber.filter((f) => f?.path).slice(0, 5).forEach((f, i) => { awal[i] = { label: f.label || FOTO_SLOTS[i], path: f.path, ...(entry ? {} : { snapshot: true }) }; });
  return awal;
}

export default function BlacklistModal({ open, onClose, prefill, entry, onDone, daftarPembanding = [] }) {
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
      const snapshot = slots.filter((s) => s?.path).map((s) => ({ label: s.label, path: s.path }));
      if (entry?.id) {
        const r = await ubahBlacklist(entry.id, { nama: form.nama.trim(), hp: hpNormal(form.hp), alamat: form.alamat || "", alasan: form.alasan.trim() });
        if (!r.ok) return notify(r.error || "Gagal menyimpan blacklist.", "error");
        for (const s of slots.filter((x) => x?.file)) {
          const up = await uploadBlacklistFoto(entry.id, s.file, s.label);
          if (!up.ok) notify(`Gagal upload ${s.label}: ${up.error || "coba lagi"}.`, "warning");
        }
        notify("Entri blacklist diperbarui."); onDone?.(); onClose?.(); return;
      }
      const r = await tambahBlacklist({ nama: form.nama.trim(), hp: hpNormal(form.hp), alamat: form.alamat || "", alasan: form.alasan.trim(), transaksiId: prefill?.transaksiId, memberId: prefill?.memberId, fotoJaminan: snapshot });
      if (!r.ok) return notify(r.code === "BLACKLIST_DUPLIKAT" || /duplikat/i.test(r.error || "") ? "Penyewa ini sudah ada di blacklist." : r.error || "Gagal menyimpan blacklist.", "error");
      const entryId = r.data?.id || r.data?.entry?.id;
      const baru = slots.filter((s) => s?.file);
      if (entryId && baru.length) for (const s of baru) {
        const up = await uploadBlacklistFoto(entryId, s.file, s.label);
        if (!up.ok) notify(`Gagal upload ${s.label}: ${up.error || "coba lagi"}.`, "warning");
      }
      notify("Penyewa ditambahkan ke blacklist."); onDone?.(); onClose?.();
    } finally { setSaving(false); }
  }

  if (typeof document === "undefined" || !open) return null;
  const snapshotAda = slots.some((slot) => slot?.snapshot);
  const orangSudahAda = Boolean(prefill?.nama?.trim());
  const tampilkanKontak = Boolean(entry) || !orangSudahAda;
  const tampilkanDokumen = Boolean(entry) || !orangSudahAda;
  const inputClass = "w-full h-10 rounded-lg border border-solid border-[var(--border-color)] bg-[var(--bg-surface)] px-3 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--color-primary)]";
  const judul = entry ? "Ubah entri blacklist" : "Tambah ke blacklist";
  return <Modal isOpen={open} onClose={onClose} title={judul} description={form.nama || undefined} size={orangSudahAda && !entry ? "action" : "lg"} footer={<><Button variant="ghost" onClick={onClose}>Batal</Button><Button variant="danger" loading={saving} disabled={!form.nama.trim() || !form.hp.trim() || !form.alasan.trim()} onClick={simpan}>{entry ? "Simpan perubahan" : "Tambahkan"}</Button></>}>
    <div className="flex flex-col gap-3.5">
      {tampilkanKontak ? <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
        <label className="block text-[13px] font-medium text-[var(--text-secondary)]">Nama <span className="text-[var(--color-danger)]">*</span><input value={form.nama} onChange={(e) => setForm({ ...form, nama: e.target.value })} placeholder="Nama penyewa" className={inputClass} /></label>
        <label className="block text-[13px] font-medium text-[var(--text-secondary)]">No. HP <span className="text-[var(--color-danger)]">*</span><InputHP name="hp" value={form.hp} onChange={(hp) => setForm({ ...form, hp })} placeholder="8123456789" daftarPembanding={daftarPembanding.filter((orang) => orang.hp !== form.hp)} /><span className="mt-1 block text-xs text-[var(--text-muted)]">Pencocokan memakai pasangan nama dan nomor HP.</span></label>
        <label className="block text-[13px] font-medium text-[var(--text-secondary)] sm:col-span-2">Alamat<input value={form.alamat} onChange={(e) => setForm({ ...form, alamat: e.target.value })} placeholder="Alamat penyewa (opsional)" className={inputClass} /></label>
      </div> : null}
      <label className="block text-[13px] font-medium text-[var(--text-secondary)]">Alasan <span className="text-[var(--color-danger)]">*</span><textarea value={form.alasan} onChange={(e) => setForm({ ...form, alasan: e.target.value })} placeholder="Jelaskan alasan penyewa masuk blacklist." className="w-full h-auto min-h-16 rounded-lg border border-solid border-[var(--border-color)] bg-[var(--bg-surface)] px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--color-primary)]" /></label>
      <div className="rounded-lg border border-solid border-[var(--color-danger)] bg-[var(--color-danger-soft)] p-2.5 text-[12px] text-[var(--color-danger-text)]">Penyewa ini tidak bisa melakukan booking selama masuk blacklist.</div>
      {tampilkanDokumen ? <div><SlotJaminan items={slots} onChange={setSlots} /><p className="mt-1 text-xs text-[var(--text-muted)]">JPG/PNG/PDF maks 5MB per file.</p>{snapshotAda ? <p className="mt-1 text-xs text-[var(--text-muted)]">Dokumen tersalin dari data member; tidak dapat diubah di sini.</p> : null}</div> : null}
    </div>
  </Modal>;
}
