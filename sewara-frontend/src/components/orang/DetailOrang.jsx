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
        // Baris riwayat belum punya baris pelanggan: materialkan dulu (upsert
        // pasangan nama+HP), baru tulis field-nya. Id-nya 0 bukan berarti
        // "tak bisa disimpan".
        const baru = await upsertPelanggan({
          nama: orang.nama,
          hp: orang.hp,
          alamat: orang.alamat,
        });
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

  // Baris riwayat belum punya baris pelanggan: materialkan dulu supaya
  // dokumen jaminan punya tempat simpan (perilaku sama seperti tab lama).
  async function targetDokumen() {
    if (idMember) return { jenis: "member", id: idMember };
    if (orang.sumber === "riwayat" || !orang.id) {
      const baris = await upsertPelanggan({
        nama: orang.nama,
        hp: orang.hp,
        alamat: orang.alamat,
      });
      return { jenis: "pelanggan", id: baris?.id };
    }
    return { jenis: "pelanggan", id: orang.id };
  }

  async function unggahJaminan(file, slotKey, label) {
    try {
      const target = await targetDokumen();
      if (!target?.id) throw new Error("Data pelanggan tidak memiliki ID.");
      const index = foto.findIndex((d) => d.label === label);
      const hasil =
        target.jenis === "member"
          ? await uploadDokumenMember({
              memberId: target.id,
              file,
              label,
              index: index >= 0 ? index : foto.length,
            })
          : await uploadDokumenPelanggan({
              pelangganId: target.id,
              file,
              label,
              index: index >= 0 ? index : foto.length,
            });
      setFoto([
        ...foto.filter((d) => d.label !== label),
        { label: hasil.label || label, path: hasil.path },
      ]);
      notify("Dokumen jaminan diunggah.");
      onTersimpan?.();
    } catch (e) {
      notify(e?.message || "Gagal mengunggah dokumen.", "error");
    }
  }

  async function hapusJaminan(label) {
    try {
      const target = await targetDokumen();
      const sisa = foto
        .filter((d) => d.label !== label)
        .map(({ label: itemLabel, path }) => ({ label: itemLabel, path }));
      if (target.jenis === "member")
        await api.members.update(target.id, { foto_jaminan: sisa });
      else await patchPelanggan(target.id, { foto: sisa });
      setFoto(sisa);
      notify("Dokumen jaminan dihapus.");
      onTersimpan?.();
    } catch (e) {
      notify(e?.message || "Gagal menghapus dokumen.", "error");
    }
  }

  return (
    <Modal isOpen onClose={onClose} title={`Detail ${orang.nama}`} size="lg">
      <div className="flex flex-col gap-3">
        {FIELDS.map((f) => {
          const nilai = orang[f.key] || "";
          const aktif = edit?.key === f.key;
          return (
            <div
              key={f.key}
              className="flex items-start gap-3 rounded-lg border border-[var(--border-color)] px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <div className="text-[11px] font-bold uppercase tracking-wide text-[var(--text-muted)]">
                  {f.label}
                </div>
                {aktif ? (
                  <input
                    autoFocus
                    value={edit.nilai}
                    onChange={(e) => setEdit({ ...edit, nilai: e.target.value })}
                    className="mt-1 w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-surface)] px-2 py-1.5 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--color-primary)]"
                  />
                ) : (
                  <div className="truncate text-sm text-[var(--text-primary)]">
                    {nilai || "—"}
                  </div>
                )}
              </div>
              {aktif ? (
                <div className="flex shrink-0 gap-2">
                  <Button size="sm" loading={saving} onClick={simpanField}>
                    Simpan
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEdit(null)}>
                    Batal
                  </Button>
                </div>
              ) : (
                <button
                  type="button"
                  aria-label={`Ubah ${f.label}`}
                  className="shrink-0 rounded-md px-2 py-1 text-[var(--text-secondary)] hover:bg-[var(--bg-subtle)]"
                  onClick={() => setEdit({ key: f.key, nilai })}
                >
                  ✎
                </button>
              )}
            </div>
          );
        })}

        {orang.black ? (
          <div className="rounded-lg border border-[var(--color-danger)] bg-[var(--bg-subtle)] px-3 py-2 text-xs text-[var(--text-primary)]">
            <strong>Blacklist</strong> · alasan: {orang.black.alasan}
            {orang.black.createdAt
              ? ` · sejak ${String(orang.black.createdAt).slice(0, 10)}`
              : ""}
            <div className="mt-1 text-[var(--text-muted)]">
              Tanggal masuk bersifat read-only.
            </div>
          </div>
        ) : null}

        <div className="rounded-lg border border-[var(--border-color)] px-3 py-2">
          <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-[var(--text-muted)]">
            Dokumen jaminan · {foto.filter((d) => d?.path).length}/5
            {idMember ? " (tersimpan di data member)" : ""}
          </div>
          <DokumenJaminan
            judul=""
            dokumen={foto}
            onUpload={unggahJaminan}
            onHapus={hapusJaminan}
            urlDokumen={idMember ? urlDokumenMember : urlDokumenPelanggan}
          />
          <p className="mt-1 text-[11px] text-[var(--text-muted)]">
            JPG/PNG/PDF maks 5MB per file.
          </p>
        </div>
      </div>
    </Modal>
  );
}