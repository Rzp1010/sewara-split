"use client";

import { useEffect, useState } from "react";
import { Button, Modal } from "@/components/ui";
import { useNotify } from "@/components/NotificationProvider";
import DokumenJaminan from "@/components/DokumenJaminan";
import {
  getMemberTemplates,
  simpanMember,
  uploadDokumenMember,
  urlDokumenMember,
} from "@/lib/db";

const EMPTY = {
  nama: "",
  hp: "",
  email: "",
  alamat: "",
  catatan: "",
  tipe_id: "",
  foto_jaminan: [],
};

/**
 * Form tambah/edit member. Dipasang hanya saat terbuka (host memberi `key`),
 * jadi state awal cukup diambil dari props — tanpa setState di dalam effect.
 */
export default function FormMember({ member, onClose, onDone }) {
  const { notify, confirm: konfirm } = useNotify();
  const [form, setForm] = useState(() => ({
    ...EMPTY,
    ...(member || {}),
    tipe_id: member?.tipe_id ?? "",
    foto_jaminan: Array.isArray(member?.foto_jaminan) ? member.foto_jaminan : [],
  }));
  const [templates, setTemplates] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let batal = false;
    getMemberTemplates()
      .then((rows) => {
        if (!batal) setTemplates(Array.isArray(rows) ? rows : []);
      })
      .catch(() => {});
    return () => {
      batal = true;
    };
  }, []);

  const input =
    "w-full rounded-md border border-solid border-[var(--border-color)] bg-[var(--bg-surface)] px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--color-primary)]";

  async function unggah(file, slotKey, label) {
    if (!member?.id) return notify("Simpan member dulu sebelum unggah dokumen.", "error");
    const hasil = await uploadDokumenMember({
      memberId: member.id,
      file,
      label,
      index: form.foto_jaminan.length,
    });
    setForm((f) => ({
      ...f,
      foto_jaminan: [
        ...f.foto_jaminan.filter((d) => d.label !== label),
        { label: hasil.label || label, path: hasil.path },
      ],
    }));
    notify("Dokumen diunggah.");
  }

  async function hapusDokumen(slotKey, label) {
    if (!(await konfirm(`Hapus dokumen ${label}?`))) return;
    setForm((f) => ({
      ...f,
      foto_jaminan: f.foto_jaminan.filter((d) => d.label !== label),
    }));
  }

  async function simpan() {
    if (!form.nama.trim()) return notify("Nama wajib diisi.", "error");
    if (form.hp && !/^(08|\+62)/.test(form.hp))
      return notify("HP harus diawali 08 atau +62.", "error");
    setSaving(true);
    const data = {
      nama: form.nama.trim(),
      hp: form.hp,
      email: form.email,
      alamat: form.alamat,
      catatan: form.catatan,
      foto_jaminan: form.foto_jaminan,
      tipe_id: form.tipe_id ? Number(form.tipe_id) : null,
    };
    if (member?.id) data.id = member.id;
    const r = await simpanMember(data);
    setSaving(false);
    if (!r.ok) return notify(r.error || "Gagal menyimpan member.", "error");
    notify("Member disimpan.");
    onDone?.();
    onClose?.();
  }

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={`${member?.id ? "Edit" : "Tambah"} member`}
      size="lg"
    >
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {[
            { key: "nama", label: "Nama", wajib: true },
            { key: "hp", label: "No HP" },
            { key: "email", label: "Email" },
            { key: "alamat", label: "Alamat" },
          ].map((f) => (
            <label
              key={f.key}
              className="text-xs font-semibold text-[var(--text-secondary)]"
            >
              {f.label}
              {f.wajib ? " *" : ""}
              <input
                value={form[f.key] || ""}
                onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                className={`mt-1 ${input}`}
              />
            </label>
          ))}
          <label className="text-xs font-semibold text-[var(--text-secondary)] sm:col-span-2">
            Catatan
            <input
              value={form.catatan || ""}
              onChange={(e) => setForm({ ...form, catatan: e.target.value })}
              className={`mt-1 ${input}`}
            />
          </label>
        </div>

        <div>
          <div className="mb-1 text-xs font-semibold text-[var(--text-secondary)]">
            Tipe member
          </div>
          <div className="flex flex-wrap gap-2">
            {templates.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setForm({ ...form, tipe_id: t.id })}
                className={`rounded-full px-3 py-1.5 text-sm font-semibold ${
                  String(form.tipe_id) === String(t.id)
                    ? "bg-[var(--color-primary)] text-white"
                    : "border border-[var(--border-color)] bg-[var(--bg-surface)] text-[var(--text-primary)] hover:bg-[var(--bg-subtle)]"
                }`}
              >
                {t.nama}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setForm({ ...form, tipe_id: "" })}
              className={`rounded-full px-3 py-1.5 text-sm font-semibold ${
                !form.tipe_id
                  ? "bg-[var(--color-primary)] text-white"
                  : "border border-[var(--border-color)] bg-[var(--bg-surface)] text-[var(--text-primary)] hover:bg-[var(--bg-subtle)]"
              }`}
            >
              Tanpa tipe
            </button>
          </div>
        </div>

        <div>
          <div className="mb-1 text-xs font-semibold text-[var(--text-secondary)]">
            Dokumen jaminan
          </div>
          <DokumenJaminan
            judul=""
            dokumen={form.foto_jaminan}
            onUpload={unggah}
            onHapus={hapusDokumen}
            urlDokumen={urlDokumenMember}
          />
          {member?.id ? null : (
            <p className="mt-1 text-[11px] text-[var(--text-muted)]">
              Simpan member dulu untuk mengunggah dokumen.
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-[var(--border-color)] pt-3">
          <Button variant="ghost" onClick={onClose}>
            Batal
          </Button>
          <Button loading={saving} onClick={simpan}>
            Simpan
          </Button>
        </div>
      </div>
    </Modal>
  );
}