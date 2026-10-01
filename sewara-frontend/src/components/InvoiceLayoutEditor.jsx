"use client";

import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import InvoiceBody from "@/components/InvoiceBody";
import { API_BASE } from "@/lib/api-client";
import { uploadInvoiceHeader } from "@/lib/db";
import {
  FIELD_DEFS,
  FIELD_LABELS,
  DEFAULT_LAYOUT,
} from "@/components/invoiceFields";
import { hitungPembayaran } from "@/lib/utils";

/* Contoh statis untuk live preview. */
const CONTOH_STATIS = {
  no_invoice: "INV-0001",
  created_at: "2026-09-30T09:00:00",
  status: "Disewa",
  waktu_ambil_rencana: "2026-09-30T10:00:00",
  waktu_kembali_rencana: "2026-10-02T10:00:00",
  durasi_teks: "2 Hari",
  penyewa: "Budi Santoso",
  hp_penyewa: "081234567890",
  alamat_penyewa: "Jl. Merdeka No. 12, Bandung",
  jaminan_sewa: ["E-KTP", "SIM"],
  dilayani_oleh: "Rizki",
  total_akhir: 150000,
  diskon: { biayaAsli: 150000 },
  pembayaran: { riwayatBayar: [{ jumlah: 100000 }] },
  riwayatDilayani: [
    { aksi: "booking", nama: "Rizki" },
    { aksi: "serahkan", nama: "Rizki" },
  ],
  items: [
    {
      ref: { nama: "Tenda Camp", jenis: "satuan" },
      sn: "SN-001",
      qty: 1,
      subtotal: 100000,
    },
    {
      ref: { nama: "Paket BBQ", jenis: "bundling" },
      qty: 1,
      subtotal: 50000,
      assignedSNs: [{ nama: "Kompor", sns: ["K-01"] }],
    },
  ],
  printilan: { mode: "dicentang", terpilih: ["Tri pod"], custom: "" },
};

function klonLayout(l) {
  return {
    mode: l?.mode || "custom",
    atas: [...(l?.atas || [])],
    kiri: [...(l?.kiri || [])],
    kanan: [...(l?.kanan || [])],
    tengah: [...(l?.tengah || [])],
    bawah: [...(l?.bawah || [])],
  };
}

/* Satu kartu zona: header + daftar field (naik/turun/hapus) + select tambah. */
function ZonaCard({
  label,
  sub,
  daftar,
  tersedia,
  onTambah,
  onHapus,
  onGeser,
  className = "",
}) {
  return (
    <div className={`rounded-lg border border-gray-200 bg-gray-50 p-3 ${className}`}>
      <div className="mb-2">
        <p className="m-0 text-sm font-semibold text-gray-800">{label}</p>
        {sub && <p className="m-0 mt-0.5 text-[11px] text-gray-400">{sub}</p>}
      </div>
      {daftar.length === 0 ? (
        <p className="m-0 mb-2 text-xs text-gray-400">Belum ada field.</p>
      ) : (
        <ul className="m-0 mb-2 list-none space-y-1.5 p-0">
          {daftar.map((fkey, idx) => (
            <li
              key={`${fkey}-${idx}`}
              className="flex items-center justify-between gap-2 rounded-md border border-gray-200 bg-white px-2.5 py-1.5"
            >
              <span className="truncate text-sm text-gray-700">
                {FIELD_LABELS[fkey] || fkey}
              </span>
              <span className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  aria-label="Naik"
                  onClick={() => onGeser(idx, -1)}
                  className="rounded border-0 bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600 hover:bg-gray-200"
                >
                  ↑
                </button>
                <button
                  type="button"
                  aria-label="Turun"
                  onClick={() => onGeser(idx, 1)}
                  className="rounded border-0 bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600 hover:bg-gray-200"
                >
                  ↓
                </button>
                <button
                  type="button"
                  aria-label="Hapus"
                  onClick={() => onHapus(idx)}
                  className="rounded border-0 bg-gray-100 px-1.5 py-0.5 text-xs text-[#F04438] hover:bg-gray-200"
                >
                  ✕
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <select
        value=""
        onChange={(e) => onTambah(e.target.value)}
        className="w-full rounded-md border border-gray-200 bg-white px-2 py-1.5 text-sm text-gray-700 outline-none focus:border-[#7181E0]"
      >
        <option value="">+ tambah field</option>
        {tersedia.map((f) => (
          <option key={f.key} value={f.key}>
            {f.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export default function InvoiceLayoutEditor({ open, onClose, value, header, onApply }) {
  const [draft, setDraft] = useState(() => klonLayout(value));
  const [draftHeader, setDraftHeader] = useState(header || "");
  const [sedangUpload, setSedangUpload] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => {
    if (open) {
      setDraft(klonLayout(value));
      setDraftHeader(header || "");
    }
  }, [open]);

  if (!open) return null;

  const terpakai = new Set([
    ...draft.atas,
    ...draft.kiri,
    ...draft.kanan,
    ...draft.tengah,
    ...draft.bawah,
  ]);
  const tersedia = FIELD_DEFS.filter((f) => !terpakai.has(f.key));

  const ubahZona = (zona, arr) => setDraft((d) => ({ ...d, [zona]: arr }));

  const tambah = (zona, key) => {
    if (!key) return;
    ubahZona(zona, [...draft[zona], key]);
  };

  const hapus = (zona, idx) =>
    ubahZona(
      zona,
      draft[zona].filter((_, i) => i !== idx),
    );

  const geser = (zona, idx, delta) => {
    const arr = [...draft[zona]];
    const j = idx + delta;
    if (j < 0 || j >= arr.length) return;
    [arr[idx], arr[j]] = [arr[j], arr[idx]];
    ubahZona(zona, arr);
  };

  const pay = hitungPembayaran(CONTOH_STATIS);
  const namaAksi = (aksi) =>
    CONTOH_STATIS.riwayatDilayani?.find((r) => r.aksi === aksi)?.nama || "";

  const pilihGambar = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || sedangUpload) return;
    setSedangUpload(true);
    try {
      const hasil = await uploadInvoiceHeader(file);
      if (hasil.ok) setDraftHeader(hasil.path);
    } finally {
      setSedangUpload(false);
    }
  };

  const hapusGambar = () => setDraftHeader("");

  // Portal ke body: ancestor settings punya transform/animasi yang bikin
  // position:fixed terkunci ke area kartu (modal cuma nutup sebagian halaman).
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[92vh] w-[min(1200px,calc(100vw-1rem))] max-w-none flex-col overflow-hidden rounded-xl bg-white shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
          <h3 className="m-0 text-base font-semibold text-gray-900">
            Atur Tata Letak Invoice
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup"
            className="rounded-md border-0 bg-transparent px-2 py-1 text-lg text-gray-500 hover:bg-gray-100"
          >
            ✕
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-[5fr_6fr]">
            {/* Editor — susunan kartu mencerminkan kertas invoice */}
            <div className="flex flex-col gap-4">
              {/* Header Invoice (hanya berlaku di mode custom) */}
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                <p className="m-0 text-sm font-semibold text-gray-800">
                  A · Header Invoice
                </p>
                <p className="m-0 mt-0.5 text-[11px] text-gray-400">
                  Menggantikan tulisan INVOICE (hanya mode custom).
                </p>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={pilihGambar}
                  className="hidden"
                />
                {draftHeader ? (
                  <div className="mt-2 space-y-2">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`${API_BASE}/api/invoice/header?v=${encodeURIComponent(draftHeader)}`}
                      alt="Header invoice"
                      className="w-full rounded-md border border-gray-200 bg-white object-contain p-1"
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={sedangUpload}
                        onClick={() => fileRef.current?.click()}
                        className="flex-1 rounded-md border-0 bg-gray-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-gray-300 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {sedangUpload ? "Mengunggah..." : "Ganti"}
                      </button>
                      <button
                        type="button"
                        onClick={hapusGambar}
                        className="flex-1 rounded-md border-0 bg-[#F04438] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#d03a2f]"
                      >
                        Hapus
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    disabled={sedangUpload}
                    onClick={() => fileRef.current?.click()}
                    className="mt-2 w-full rounded-md border-0 bg-[#7181E0] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#5d6fcc] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {sedangUpload ? "Mengunggah..." : "Pilih gambar"}
                  </button>
                )}
                <p className="m-0 mt-1.5 text-[11px] leading-relaxed text-gray-400">
                  Gambar melebar (rasio 4:1–8:1), lebar ideal 1600px, maks 5MB.
                  JPG/PNG/WebP.
                </p>
              </div>

              <ZonaCard
                label="B · Atas"
                sub="Full lebar, di atas"
                daftar={draft.atas}
                tersedia={tersedia}
                onTambah={(k) => tambah("atas", k)}
                onHapus={(i) => hapus("atas", i)}
                onGeser={(i, d) => geser("atas", i, d)}
              />

              {/* Kiri & Kanan berdampingan (mencerminkan dua kolom kertas) */}
              <div className="grid grid-cols-2 gap-4">
                <ZonaCard
                  label="C · Kiri"
                  sub="Kolom kiri"
                  daftar={draft.kiri}
                  tersedia={tersedia}
                  onTambah={(k) => tambah("kiri", k)}
                  onHapus={(i) => hapus("kiri", i)}
                  onGeser={(i, d) => geser("kiri", i, d)}
                />
                <ZonaCard
                  label="D · Kanan"
                  sub="Kolom kanan"
                  daftar={draft.kanan}
                  tersedia={tersedia}
                  onTambah={(k) => tambah("kanan", k)}
                  onHapus={(i) => hapus("kanan", i)}
                  onGeser={(i, d) => geser("kanan", i, d)}
                />
              </div>

              {/* Kartu terkunci: Daftar Alat — selalu tampil, tidak bisa diedit */}
              <div className="rounded-lg border border-gray-200 bg-gray-100 p-3">
                <p className="m-0 text-sm font-semibold text-gray-500">
                  E · Daftar Alat
                </p>
                <p className="m-0 mt-0.5 text-[11px] text-gray-400">
                  Bagian ini selalu tampil
                </p>
              </div>

              {/* Zona Tengah (editable, di samping Total) + Total (terkunci) */}
              <div className="grid grid-cols-2 gap-4">
                <ZonaCard
                  label="F · Ringkasan Kiri"
                  sub="catatan/teks di samping total"
                  daftar={draft.tengah}
                  tersedia={tersedia}
                  onTambah={(k) => tambah("tengah", k)}
                  onHapus={(i) => hapus("tengah", i)}
                  onGeser={(i, d) => geser("tengah", i, d)}
                />
                <div className="rounded-lg border border-gray-200 bg-gray-100 p-3">
                  <p className="m-0 text-sm font-semibold text-gray-500">
                    G · Total
                  </p>
                  <p className="m-0 mt-0.5 text-[11px] text-gray-400">
                    Bagian ini selalu tampil
                  </p>
                </div>
              </div>

              <ZonaCard
                label="H · Bawah"
                sub="Full lebar, di bawah"
                daftar={draft.bawah}
                tersedia={tersedia}
                onTambah={(k) => tambah("bawah", k)}
                onHapus={(i) => hapus("bawah", i)}
                onGeser={(i, d) => geser("bawah", i, d)}
              />

              <button
                type="button"
                onClick={() => setDraft(klonLayout(DEFAULT_LAYOUT))}
                className="self-start rounded-lg border-0 bg-gray-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-gray-300"
              >
                Pulihkan default
              </button>
            </div>

            {/* Preview */}
            <div>
              <p className="m-0 mb-2 text-sm font-semibold text-gray-800">
                Pratinjau
              </p>
              <div className="max-h-[60vh] overflow-auto rounded-lg border border-gray-200 bg-gray-100 p-4">
                {/* Lebar = A4 sungguhan (794px @96dpi) lalu zoom seragam,
                    supaya proporsi preview identik dengan hasil cetak/PDF. */}
                <div
                  className="mx-auto rounded-lg bg-white shadow-sm"
                  style={{
                    width: 794,
                    padding: 48,
                    zoom: 0.72,
                  }}
                >
                  <InvoiceBody
                    data={CONTOH_STATIS}
                    layout={draft}
                    header={draftHeader}
                    footer={
                      "Terima kasih. Harap kembalikan barang lengkap sesuai Nomor Seri tertera untuk mengambil jaminan."
                    }
                    namaAksi={namaAksi}
                    pay={pay}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-gray-200 px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border-0 bg-gray-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-gray-300"
          >
            Batal
          </button>
          <button
            type="button"
            onClick={() => {
              onApply(draft, draftHeader);
              onClose();
            }}
            className="rounded-lg border-0 bg-[#7181E0] px-4 py-2 text-sm font-semibold text-white hover:bg-[#5d6fcc]"
          >
            Simpan Layout
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}