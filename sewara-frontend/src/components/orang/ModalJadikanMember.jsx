"use client";

import { useEffect, useState } from "react";
import { Button, Modal } from "@/components/ui";
import { useNotify } from "@/components/NotificationProvider";
import { getMemberTemplates, simpanMember } from "@/lib/db";

export default function ModalJadikanMember({ orang, onClose, onDone }) {
  const { notify } = useNotify();
  const [tipe, setTipe] = useState("");
  const [templates, setTemplates] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let batal = false;
    getMemberTemplates()
      .then((daftar) => {
        if (batal) return;
        const aktif = Array.isArray(daftar) ? daftar.filter((item) => item.status !== "nonaktif") : [];
        setTemplates(aktif);
        if (aktif.length) setTipe(String(aktif[0].id));
      })
      .catch((error) => {
        if (!batal) notify(error?.message || "Gagal memuat tipe member.", "error");
      });
    return () => { batal = true; };
  }, [notify]);

  async function konfirmasi() {
    if (!tipe) return;
    setSaving(true);
    const hasil = await simpanMember({
      nama: orang.nama,
      hp: orang.hp,
      email: orang.email,
      alamat: orang.alamat,
      tipe_id: Number(tipe),
    });
    setSaving(false);
    if (!hasil.ok) return notify(hasil.error || "Gagal menambahkan member.", "error");
    notify("Member ditambahkan.");
    onDone?.();
    onClose?.();
  }

  const chip = (aktif) => `h-[34px] rounded-lg border border-solid px-3.5 text-[13px] ${aktif ? "border-[var(--color-primary)] bg-[var(--color-primary-soft)] font-semibold text-[var(--color-primary-soft-text)]" : "border-[var(--border-color)] bg-[var(--bg-surface)] text-[var(--text-secondary)]"}`;

  return (
    <Modal isOpen onClose={onClose} title="Jadikan member" description={orang.nama} size="action" footer={<><Button variant="ghost" onClick={onClose}>Batal</Button><Button variant="primary" loading={saving} disabled={!tipe} onClick={konfirmasi}>Konfirmasi</Button></>}>
      <div className="flex flex-col gap-4">
        <div>
          <div className="mb-2 text-[12px] font-semibold text-[var(--text-secondary)]">Pilih tipe member</div>
          <div className="flex flex-wrap gap-2">
            {templates.map((item) => <button key={item.id} type="button" aria-pressed={tipe === String(item.id)} onClick={() => setTipe(String(item.id))} className={chip(tipe === String(item.id))}>{item.nama}</button>)}
            {!templates.length ? <span className="text-sm text-[var(--text-muted)]">Belum ada tipe member aktif.</span> : null}
          </div>
        </div>
        <div className="rounded-lg bg-[var(--bg-body)] p-2.5 text-[12px] text-[var(--text-secondary)]">Data pelanggan tetap sama. Dokumen jaminan bisa diubah nanti di Detail.</div>
      </div>
    </Modal>
  );
}
