"use client";

import { useState } from "react";
import { Button, Modal } from "@/components/ui";
import { useNotify } from "@/components/NotificationProvider";
import DokumenJaminan from "@/components/DokumenJaminan";
import {
  patchPelanggan,
  ubahBlacklist,
  uploadDokumenMember,
  uploadDokumenPelanggan,
  urlDokumenMember,
  urlDokumenPelanggan,
  upsertPelanggan,
} from "@/lib/db";
import { api } from "@/lib/api-client";

const FIELDS = [
  { key: "nama", label: "Nama" },
  { key: "hp", label: "No. HP" },
  { key: "email", label: "Email" },
  { key: "alamat", label: "Alamat" },
  { key: "catatan", label: "Catatan" },
];

/**
 * Detail orang: baca-saja, pensil per field, dan dokumen jaminan
 * (unggah/hapus). Dokumen mengikuti pasangan member bila ada (menulis ke
 * members.foto_jaminan), selain itu ke pelanggan.foto.
 */
export default function DetailOrang({ orang, onClose, onTersimpan }) {
  const { notify } = useNotify();
  const [edit, setEdit] = useState(null);
  const [saving, setSaving] = useState(false);
  const [foto, setFoto] = useState(() => orang?.foto || []);

  if (!orang) return null;
  const idMember = Number(orang.member_id) > 0 ? Number(orang.member_id) : 0;

  async function simpanField() {
    setSaving(true);
    try {
      if (idMember) await api.members.update(idMember, { [edit.key]: edit.nilai });
      else if (orang.id) await patchPelanggan(orang.id, { [edit.key]: edit.nilai });
      else if (orang.black?.id)
        await ubahBlacklist(orang.black.id, { [edit.key]: edit.nilai });
      else {
        const baru = await upsertPelanggan({ nama: orang.nama, hp: orang.hp, alamat: orang.alamat });
        if (!baru?.id) throw new Error("Data pelanggan tidak memiliki ID.");
        await patchPelanggan(baru.id, { [edit.key]: edit.nilai });
      }
      notify("Tersimpan.");
      setEdit(null);
      onTersimpan?.();
    } catch (e) {
      notify(e?.message || "Gagal menyimpan.", "error");
    } finally {
      setSaving(false);
    }
  }

  async function targetDokumen() {
    if (idMember) return { jenis: "member", id: idMember };
    if (orang.sumber === "riwayat" || !orang.id) {
      const baris = await upsertPelanggan({ nama: orang.nama, hp: orang.hp, alamat: orang.alamat });
      return { jenis: "pelanggan", id: baris?.id };
    }
    return { jenis: "pelanggan", id: orang.id };
  }

  async function unggahJaminan(file, slotKey, label) {
    try {
      const target = await targetDokumen();
      if (!target?.id) throw new Error("Data pelanggan tidak memiliki ID.");
      const index = foto.findIndex((d) => d.label === label);
      const hasil = target.jenis === "member"
        ? await uploadDokumenMember({ memberId: target.id, file, label, index: index >= 0 ? index : foto.length })
        : await uploadDokumenPelanggan({ pelangganId: target.id, file, label, index: index >= 0 ? index : foto.length });
      setFoto([...foto.filter((d) => d.label !== label), { label: hasil.label || label, path: hasil.path }]);
      notify("Dokumen jaminan diunggah.");
      onTersimpan?.();
    } catch (e) {
      notify(e?.message || "Gagal mengunggah dokumen.", "error");
    }
  }

  async function hapusJaminan(label) {
    try {
      const target = await targetDokumen();
      const sisa = foto.filter((d) => d.label !== label).map(({ label: itemLabel, path }) => ({ label: itemLabel, path }));
      if (target.jenis === "member") await api.members.update(target.id, { foto_jaminan: sisa });
      else await patchPelanggan(target.id, { foto: sisa });
      setFoto(sisa);
      notify("Dokumen jaminan dihapus.");
      onTersimpan?.();
    } catch (e) {
      notify(e?.message || "Gagal menghapus dokumen.", "error");
    }
  }

  const inputClass = "w-full h-10 rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)] px-3 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--color-primary)]";
  return (
    <Modal isOpen onClose={onClose} title="Data pelanggan" description={orang.nama || undefined} size="lg" footer={<Button variant="dark" onClick={onClose}>Tutup</Button>}>
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-x-3.5 gap-y-3 sm:grid-cols-2">
          {FIELDS.map((f) => {
            const nilai = orang[f.key] || "";
            const aktif = edit?.key === f.key;
            return <div key={f.key} className={f.key === "catatan" ? "sm:col-span-2" : ""}>
              <div className="mb-1 block text-[13px] font-medium text-[var(--text-secondary)]">{f.label}</div>
              {aktif ? <div className="flex flex-wrap items-center gap-2"><input autoFocus value={edit.nilai} onChange={(e) => setEdit({ ...edit, nilai: e.target.value })} className={inputClass} /><Button size="sm" loading={saving} onClick={simpanField}>Simpan</Button><Button size="sm" variant="ghost" onClick={() => setEdit(null)}>Batal</Button></div> : <div className={`flex items-center justify-between gap-2 rounded-lg border border-solid border-[var(--border-color)] bg-[var(--bg-surface)] px-3 ${f.key === "catatan" ? "min-h-16 py-2.5" : "h-10"}`}>
                <div className={`min-w-0 break-words text-sm font-medium ${nilai ? "text-[var(--text-primary)]" : "text-[var(--text-muted)]"}`}>{nilai || "Belum diisi"}</div>
                <button type="button" aria-label={`Ubah ${f.label}`} className="shrink-0 rounded-md p-1 text-[var(--text-muted)] hover:bg-[var(--bg-subtle)] hover:text-[var(--text-primary)]" onClick={() => setEdit({ key: f.key, nilai })}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
                </button>
              </div>}
            </div>;
          })}
          {orang.member ? (
            <div className="sm:col-span-2">
              <div className="mb-1 block text-xs font-medium text-[var(--text-secondary)]">Tipe member</div>
              <div className="flex flex-wrap gap-2">
                {/* tipeNama berupa string (bukan array) dari lib/db. */}
                {[].concat(orang.member.tipeNama || []).filter(Boolean).length ? (
                  [].concat(orang.member.tipeNama || []).filter(Boolean).map((tipe) => (
                    <span key={tipe} className="h-9 rounded-lg border border-solid border-[var(--border-color)] bg-[var(--bg-surface)] px-3.5 text-[13px] leading-9 text-[var(--text-secondary)]">{tipe}</span>
                  ))
                ) : (
                  <span className="h-9 rounded-lg border border-solid border-[var(--border-color)] bg-[var(--bg-surface)] px-3.5 text-[13px] leading-9 text-[var(--text-secondary)]">Tanpa tipe</span>
                )}
              </div>
            </div>
          ) : null}
          {orang.black ? <div className="sm:col-span-2 rounded-lg border border-[var(--color-danger)] bg-[var(--bg-subtle)] p-3"><div className="block text-xs font-medium text-[var(--text-secondary)]">Alasan blacklist</div><p className="text-sm">{orang.black.alasan}</p>{orang.black.createdAt ? <p className="mt-1 text-sm">Tanggal masuk: {String(orang.black.createdAt).slice(0, 10)}</p> : null}<p className="mt-1 text-xs text-[var(--text-muted)]">Tanggal masuk bersifat read-only.</p></div> : null}
          <div className="sm:col-span-2"><DokumenJaminan judul="Dokumen jaminan" dokumen={foto} onUpload={unggahJaminan} onHapus={hapusJaminan} urlDokumen={idMember ? urlDokumenMember : urlDokumenPelanggan} /><p className="mt-1 text-xs text-[var(--text-muted)]">JPG/PNG/PDF maks 5MB per file.</p></div>
        </div>
      </div>
    </Modal>
  );
}
