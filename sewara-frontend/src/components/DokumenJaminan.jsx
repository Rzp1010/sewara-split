"use client";
import { useState } from "react";

const SLOTS = [
  { key: "ktp", label: "KTP" },
  { key: "kk", label: "Kartu Keluarga" },
  { key: "sim", label: "SIM" },
  { key: "npwp", label: "NPWP" },
  { key: "lainnya", label: "Lainnya" },
];

export default function DokumenJaminan({ judul = "Dokumen Jaminan", dokumen = [], onUpload, onHapus, urlDokumen, maks = 5, bolehUbah = true }) {
  const [preview, setPreview] = useState(null);
  const [dragging, setDragging] = useState(null);
  const [busy, setBusy] = useState({});
  const valid = Array.isArray(dokumen) ? dokumen : [];
  const pilih = async (file, slot) => {
    if (!file || !bolehUbah || (!valid.some((d) => d.label === slot.label) && valid.filter((d) => d?.path).length >= maks)) return;
    setBusy((x) => ({ ...x, [slot.key]: true }));
    try { await onUpload(file, slot.key, slot.label); } finally { setBusy((x) => ({ ...x, [slot.key]: false })); }
  };
  return <section className="w-full">
    <div className="mb-4 mt-6 flex items-center gap-3"><div className="h-px flex-1 bg-[var(--bg-subtle)]"/><span className="whitespace-nowrap text-xs font-semibold text-[var(--text-secondary)]">{judul} (Opsional · {valid.filter((d) => d?.path).length}/{maks})</span><div className="h-px flex-1 bg-[var(--bg-subtle)]"/></div>
    <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-5">{SLOTS.map((slot) => {
      const item = valid.find((d) => d?.label === slot.label && d.path);
      const url = item ? urlDokumen(item.path) : "";
      const pdf = item?.path && /\.pdf(?:$|[?#])/i.test(item.path);
      return <div key={slot.key} className={`relative flex min-h-20 flex-col items-center justify-center gap-1.5 rounded-[10px] border-[1.5px] px-2 py-3.5 text-center ${item ? "border-solid border-emerald-500 bg-[var(--bg-subtle)]" : "border-dashed border-[var(--border-color)]"}`} onDragOver={(e) => { if (bolehUbah) { e.preventDefault(); setDragging(slot.key); } }} onDragLeave={() => setDragging(null)} onDrop={(e) => { e.preventDefault(); setDragging(null); void pilih(e.dataTransfer.files[0], slot); }}>
        {item ? <button type="button" aria-label={`Pratinjau ${slot.label}`} onClick={() => setPreview({ url, pdf, label: slot.label })} className="w-full text-center text-xs font-semibold text-[var(--text-primary)]">{pdf ? "PDF" : <img src={url} alt={slot.label} className="mx-auto max-h-20 max-w-full object-contain"/>}<span className="block">{slot.label}</span></button> : <label className={`text-[11px] font-semibold text-[var(--text-secondary)] ${bolehUbah ? "cursor-pointer" : ""}`}>{bolehUbah && <span className="block text-xl">{dragging === slot.key ? "↓" : "+"}</span>}{slot.label}<input aria-label={`Unggah ${slot.label}`} type="file" hidden accept="image/jpeg,image/png,application/pdf" disabled={!bolehUbah || valid.filter((d) => d?.path).length >= maks} capture="environment" onChange={(e) => { void pilih(e.target.files?.[0], slot); e.target.value = ""; }}/></label>}
        {busy[slot.key] && <span className="text-xs" aria-live="polite">Mengunggah...</span>}{item && bolehUbah && <button type="button" aria-label={`Hapus ${slot.label}`} className="text-xs text-red-500" onClick={() => onHapus(slot.label)}>Hapus</button>}
      </div>;
    })}</div>
    {preview && <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/80 p-4" onClick={() => setPreview(null)}><div className="max-h-full max-w-full" onClick={(e) => e.stopPropagation()}>{preview.pdf ? <iframe title={`Pratinjau ${preview.label}`} src={preview.url} className="h-[80vh] w-[min(90vw,800px)] bg-white"/> : <img src={preview.url} alt={`Pratinjau ${preview.label}`} className="max-h-[85vh] max-w-[90vw] object-contain"/>}<button type="button" aria-label="Tutup pratinjau" className="mt-2 rounded bg-[var(--bg-surface)] px-4 py-2 text-[var(--text-primary)]" onClick={() => setPreview(null)}>Tutup</button></div></div>}
  </section>;
}
