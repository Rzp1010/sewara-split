"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { formatRupiah, formatTanggal } from "@/lib/utils";

export default function ModalPerpanjang({ data, onClose, onConfirm }) {
  const [langkah, setLangkah] = useState(1);
  const [pilihan, setPilihan] = useState(0);
  if (!data) return null;
  const opsi = data.opsi[pilihan];
  const beda = opsi.biaya - data.biayaLama;
  const menitTelat = data.menitTelat;
  const durasiTelat = menitTelat >= 1440
    ? `Telat ${Math.floor(menitTelat / 1440)} hari${Math.floor((menitTelat % 1440) / 60) ? ` ${Math.floor((menitTelat % 1440) / 60)} jam` : ""}`
    : menitTelat >= 60
      ? `Telat ${Math.floor(menitTelat / 60)} jam${menitTelat % 60 ? ` ${menitTelat % 60} menit` : ""}`
      : menitTelat > 0 ? `Telat ${menitTelat} menit` : "";
  const footer = langkah === 1
    ? <><Button variant="outline" className="min-h-11" onClick={onClose}>Batal</Button><Button className="min-h-11" onClick={() => setLangkah(2)}>Lanjut</Button></>
    : <><Button variant="outline" className="min-h-11" onClick={() => setLangkah(1)}>Kembali</Button><Button className="min-h-11" onClick={() => onConfirm(opsi)}>Konfirmasi perpanjangan</Button></>;
  return <Modal isOpen onClose={onClose} size="lg" title="Perpanjang sewa" description={`${data.penyewa} · ${data.invoice}`} footer={footer}>
    <div className="mb-4 rounded-lg border border-solid border-[var(--border-color)] bg-[var(--bg-subtle)] p-3 text-sm">
      <strong>Rencana kembali {formatTanggal(data.kembaliLama)}</strong>{durasiTelat && <div className="mt-1 text-[var(--text-secondary)]">{durasiTelat}</div>}
    </div>
    {langkah === 1 ? <section>
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">Langkah 1 · Pilih durasi</div>
      <div className="space-y-2">{data.opsi.map((o, i) => <button key={o.kembali} type="button" onClick={() => setPilihan(i)} className={`w-full rounded-xl border border-solid p-3 text-left transition-colors ${i === pilihan ? "border-[var(--color-primary-soft-text)] bg-[var(--color-primary-soft)] ring-1 ring-[var(--color-primary-soft-text)]" : "border-[var(--border-color)] bg-[var(--bg-surface)] hover:bg-[var(--bg-subtle)]"}`}>
        <span className="block font-semibold">{data.durasiLama} → {o.dur.durasi_teks}</span><span className="mt-1 block text-sm text-[var(--text-secondary)]">+{o.dur.totalJam - data.jamLama} jam · Kembali {formatTanggal(o.kembali)}</span><span className="mt-2 block text-base font-bold">{formatRupiah(o.biaya)}</span>{o.bentrok && <span className="mt-2 block rounded-md bg-[var(--color-warning-soft)] p-2 text-sm font-medium text-[var(--color-warning-text)]">Bentrok {o.bentrok}</span>}
      </button>)}</div>
    </section> : <section>
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">Langkah 2 · Konfirmasi</div>
      <div className="rounded-xl border border-solid border-[var(--border-color)] p-4"><div className="font-semibold">{formatTanggal(data.kembaliLama)} → {formatTanggal(opsi.kembali)}</div><div className="mt-3 border-t border-solid border-[var(--border-color)] pt-3 text-sm">{beda > 0 ? `Naik ${formatRupiah(beda)} dari ${formatRupiah(data.biayaLama)}` : "Harga tetap"}</div><p className="mb-0 mt-3 text-sm text-[var(--text-secondary)]">Waktu kembali diperbarui setelah konfirmasi.</p>{opsi.bentrok && <p className="mb-0 mt-3 rounded-md bg-[var(--color-warning-soft)] p-2 text-sm font-medium text-[var(--color-warning-text)]">Peringatan jadwal bentrok: {opsi.bentrok}</p>}</div>
    </section>}
  </Modal>;
}
