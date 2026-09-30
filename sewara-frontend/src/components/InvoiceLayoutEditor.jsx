"use client";

import { useState, useEffect } from "react";
import InvoiceBody from "@/components/InvoiceBody";
import {
  FIELD_DEFS,
  FIELD_LABELS,
  DEFAULT_LAYOUT,
} from "@/components/invoiceFields";
import { hitungPembayaran } from "@/lib/utils";

const ZONA = [
  { key: "atas", label: "Atas" },
  { key: "kiri", label: "Kiri" },
  { key: "kanan", label: "Kanan" },
  { key: "bawah", label: "Bawah" },
];

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
  jaminan_sewa: "E-KTP 1234",
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
    bawah: [...(l?.bawah || [])],
  };
}

export default function InvoiceLayoutEditor({ open, onClose, value, onApply }) {
  const [draft, setDraft] = useState(() => klonLayout(value) );

  useEffect(() => {
    if (open) setDraft(klonLayout(value));
  }, [open]);

  if (!open) return null;

  const terpakai = new Set([
    ...draft.atas,
    ...draft.kiri,
    ...draft.kanan,
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

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl bg-white shadow-xl"
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
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            {/* Editor */}
            <div className="space-y-4">
              {ZONA.map((z) => (
                <div
                  key={z.key}
                  className="rounded-lg border border-gray-200 bg-gray-50 p-3"
                >
                  <p className="m-0 mb-2 text-sm font-semibold text-gray-800">
                    Zona {z.label}
                  </p>
                  {draft[z.key].length === 0 ? (
                    <p className="m-0 mb-2 text-xs text-gray-400">
                      Belum ada field.
                    </p>
                  ) : (
                    <ul className="m-0 mb-2 list-none space-y-1.5 p-0">
                      {draft[z.key].map((fkey, idx) => (
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
                              onClick={() => geser(z.key, idx, -1)}
                              className="rounded border-0 bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600 hover:bg-gray-200"
                            >
                              ↑
                            </button>
                            <button
                              type="button"
                              aria-label="Turun"
                              onClick={() => geser(z.key, idx, 1)}
                              className="rounded border-0 bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600 hover:bg-gray-200"
                            >
                              ↓
                            </button>
                            <button
                              type="button"
                              aria-label="Hapus"
                              onClick={() => hapus(z.key, idx)}
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
                    onChange={(e) => tambah(z.key, e.target.value)}
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
              ))}

              <button
                type="button"
                onClick={() => setDraft(klonLayout(DEFAULT_LAYOUT))}
                className="rounded-lg border-0 bg-gray-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-gray-300"
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
                <div className="origin-top scale-[0.8] rounded-lg bg-white p-6 shadow-sm">
                  <InvoiceBody
                    data={CONTOH_STATIS}
                    layout={draft}
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
              onApply(draft);
              onClose();
            }}
            className="rounded-lg border-0 bg-[#7181E0] px-4 py-2 text-sm font-semibold text-white hover:bg-[#5d6fcc]"
          >
            Simpan Layout
          </button>
        </div>
      </div>
    </div>
  );
}