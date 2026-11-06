"use client";

import { useState } from "react";
import { Button, Modal } from "@/components/ui";
import { useNotify } from "@/components/NotificationProvider";
import { patchPelanggan, ubahBlacklist } from "@/lib/db";
import { api } from "@/lib/api-client";

const FIELDS = [
  { key: "nama", label: "Nama" },
  { key: "hp", label: "No. HP" },
  { key: "email", label: "Email" },
  { key: "alamat", label: "Alamat" },
];

/**
 * Detail orang read-only dengan pensil per field. Tujuan simpan ditentukan
 * oleh sumber baris: baris pelanggan → PATCH /api/pelanggan/{id}; baris murni
 * member → PATCH /api/members/{id}; baris murni blacklist → PATCH blacklist.
 */
export default function DetailOrang({ orang, onClose, onTersimpan }) {
  const { notify } = useNotify();
  const [edit, setEdit] = useState(null);
  const [saving, setSaving] = useState(false);
  if (!orang) return null;
  const jmlFoto = Array.isArray(orang.foto) ? orang.foto.length : 0;

  async function simpan() {
    setSaving(true);
    try {
      if (orang.id) await patchPelanggan(orang.id, { [edit.key]: edit.nilai });
      else if (orang.member_id)
        await api.members.update(orang.member_id, { [edit.key]: edit.nilai });
      else if (orang.black?.id)
        await ubahBlacklist(orang.black.id, { [edit.key]: edit.nilai });
      else throw new Error("Baris ini tidak punya tujuan simpan.");
      notify("Tersimpan.");
      setEdit(null);
      onTersimpan?.();
    } catch (e) {
      notify(e?.message || "Gagal menyimpan.", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={`Detail ${orang.nama}`}
      size="lg"
    >
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
                  <Button size="sm" loading={saving} onClick={simpan}>
                    Simpan
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setEdit(null)}
                  >
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

        {orang.member ? (
          <div className="text-xs text-[var(--text-muted)]">
            Tipe member: {orang.member.tipeNama || "tanpa tipe"} · diskon{" "}
            {orang.member.diskon_persen ?? 0}%
          </div>
        ) : null}

        {orang.black ? (
          <div className="rounded-lg border border-[var(--color-danger)] bg-[var(--color-danger-soft)] px-3 py-2 text-xs text-[var(--color-danger-text)]">
            Blacklist · alasan: {orang.black.alasan}
            {orang.black.createdAt
              ? ` · sejak ${String(orang.black.createdAt).slice(0, 10)}`
              : ""}
            <div className="mt-1">Tanggal masuk bersifat read-only.</div>
          </div>
        ) : null}

        <div className="text-xs text-[var(--text-muted)]">
          {jmlFoto} dokumen jaminan · unggah/hapus di tab Pelanggan.
        </div>
      </div>
    </Modal>
  );
}
