"use client";

import { useState } from "react";
import { Button, FormField, Modal } from "@/components/ui";
import { useNotify } from "@/components/NotificationProvider";
import { upsertPelanggan } from "@/lib/db";

const KOSONG = { nama: "", hp: "", email: "", alamat: "" };

export default function FormPelanggan({ onClose, onDone }) {
  const { notify } = useNotify();
  const [form, setForm] = useState(KOSONG);
  const [saving, setSaving] = useState(false);

  async function simpan() {
    const nama = form.nama.trim();
    const email = form.email.trim();
    if (!nama) return notify("Nama wajib diisi.", "error");
    if (email && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254))
      return notify("Email tidak valid atau melebihi 254 karakter.", "error");
    setSaving(true);
    try {
      await upsertPelanggan({ nama, hp: form.hp.trim(), email, alamat: form.alamat.trim() });
      notify("Pelanggan disimpan.");
      onDone?.();
      onClose?.();
    } catch (error) {
      notify(error.message || "Gagal menyimpan pelanggan.", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal isOpen onClose={onClose} title="Pelanggan baru" description="Lengkapi data pelanggan." size="lg" footer={<><Button variant="ghost" onClick={onClose}>Batal</Button><Button loading={saving} variant="dark" onClick={simpan}>Simpan</Button></>}>
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
        <FormField name="nama" label="Nama" required value={form.nama} onChange={(event) => setForm({ ...form, nama: event.target.value })} />
        <FormField name="hp" label="No. HP" value={form.hp} onChange={(event) => setForm({ ...form, hp: event.target.value })} />
        <FormField name="email" label="Email" type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} />
        <FormField name="alamat" label="Alamat" value={form.alamat} onChange={(event) => setForm({ ...form, alamat: event.target.value })} />
      </div>
    </Modal>
  );
}
