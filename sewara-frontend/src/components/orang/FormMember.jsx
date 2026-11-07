"use client";

import { useEffect, useState } from "react";
import { Button, Modal } from "@/components/ui";
import { useNotify } from "@/components/NotificationProvider";
import DokumenJaminan from "@/components/DokumenJaminan";
import { getMemberTemplates, simpanMember, uploadDokumenMember, urlDokumenMember } from "@/lib/db";

const EMPTY = { nama: "", hp: "", email: "", alamat: "", catatan: "", tipe_id: "", foto_jaminan: [] };

export default function FormMember({ member, prefill, onClose, onDone }) {
  const { notify, confirm: konfirm } = useNotify();
  const [form, setForm] = useState(() => ({ ...EMPTY, ...(prefill || {}), ...(member || {}), tipe_id: member?.tipe_id ?? "", foto_jaminan: Array.isArray(member?.foto_jaminan) ? member.foto_jaminan : [] }));
  const [templates, setTemplates] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let batal = false;
    getMemberTemplates().then((rows) => { if (!batal) setTemplates(Array.isArray(rows) ? rows : []); }).catch(() => {});
    return () => { batal = true; };
  }, []);

  async function unggah(file, slotKey, label) {
    if (!member?.id) return notify("Simpan member dulu sebelum unggah dokumen.", "error");
    const hasil = await uploadDokumenMember({ memberId: member.id, file, label, index: form.foto_jaminan.length });
    setForm((f) => ({ ...f, foto_jaminan: [...f.foto_jaminan.filter((d) => d.label !== label), { label: hasil.label || label, path: hasil.path }] }));
    notify("Dokumen diunggah.");
  }

  async function hapusDokumen(slotKey, label) {
    if (!(await konfirm(`Hapus dokumen ${label}?`))) return;
    setForm((f) => ({ ...f, foto_jaminan: f.foto_jaminan.filter((d) => d.label !== label) }));
  }

  async function simpan() {
    if (!form.nama.trim()) return notify("Nama wajib diisi.", "error");
    if (form.hp && !/^(08|\+62)/.test(form.hp)) return notify("HP harus diawali 08 atau +62.", "error");
    setSaving(true);
    const data = { nama: form.nama.trim(), hp: form.hp, email: form.email, alamat: form.alamat, catatan: form.catatan, foto_jaminan: form.foto_jaminan, tipe_id: form.tipe_id ? Number(form.tipe_id) : null };
    if (member?.id) data.id = member.id;
    const r = await simpanMember(data);
    setSaving(false);
    if (!r.ok) return notify(r.error || "Gagal menyimpan member.", "error");
    notify("Member disimpan.");
    onDone?.();
    onClose?.();
  }

  const inputClass = "w-full h-10 rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)] px-3 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--color-primary)]";
  const chipClass = (active) => `h-9 rounded-lg border border-solid px-3.5 text-[13px] ${active ? "border-[var(--color-primary)] bg-[var(--color-primary-soft)] font-semibold text-[var(--color-primary)]" : "border-[var(--border-color)] bg-[var(--bg-surface)] text-[var(--text-secondary)]"}`;
  return <Modal isOpen onClose={onClose} title={member?.id ? "Edit member" : (prefill?.nama ? "Jadikan member" : "Tambah member")} description="Lengkapi data kontak, tipe, dan dokumen jaminan." size="lg" footer={<><Button variant="ghost" onClick={onClose}>Batal</Button><Button loading={saving} variant="dark" onClick={simpan}>Simpan</Button></>}>
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
        {[{ key: "nama", label: "Nama", wajib: true }, { key: "hp", label: "No. HP" }, { key: "email", label: "Email" }, { key: "alamat", label: "Alamat" }].map((f) => <label key={f.key} className="block text-[13px] font-medium text-[var(--text-secondary)]">{f.label}{f.wajib ? " *" : ""}<input value={form[f.key] || ""} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} className={inputClass} /></label>)}
        <label className="block text-[13px] font-medium text-[var(--text-secondary)] sm:col-span-2">Catatan<textarea placeholder="Catatan tambahan (opsional)" value={form.catatan || ""} onChange={(e) => setForm({ ...form, catatan: e.target.value })} className="w-full h-auto min-h-16 rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)] px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--color-primary)]" /></label>
        <div className="sm:col-span-2"><div className="mb-1 block text-xs font-medium text-[var(--text-secondary)]">Tipe member</div>{templates.length === 0 ? <p className="mb-2 text-xs text-[var(--text-muted)]">Belum ada tipe member.</p> : null}<div className="flex flex-wrap gap-2">{templates.map((t) => <button key={t.id} type="button" onClick={() => setForm({ ...form, tipe_id: t.id })} className={chipClass(String(form.tipe_id) === String(t.id))}>{t.nama}</button>)}<button type="button" onClick={() => setForm({ ...form, tipe_id: "" })} className={chipClass(!form.tipe_id)}>Tanpa tipe</button></div></div>
        <div className="sm:col-span-2">{member?.id ? null : <p className="mb-2 text-xs text-[var(--text-muted)]">Simpan member dulu untuk mengunggah dokumen.</p>}<DokumenJaminan judul="Dokumen jaminan" dokumen={form.foto_jaminan} onUpload={unggah} onHapus={hapusDokumen} urlDokumen={urlDokumenMember} /></div>
      </div>
    </div>
  </Modal>;
}
