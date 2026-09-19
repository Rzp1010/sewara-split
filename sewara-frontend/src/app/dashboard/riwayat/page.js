"use client";

import { useState, useEffect } from "react";
import { getTransactionsRingkas, getTransactionById } from "@/lib/db";
import dynamic from "next/dynamic";
import { formatRupiah } from "@/lib/utils";
import { Button, EmptyState } from "@/components/ui";

const InvoiceView = dynamic(() => import("@/components/InvoiceView"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center gap-2 p-8">
      <div className="h-5 w-5 animate-spin rounded-full border-4 border-surface-card border-t-brand"></div>
      <span className="text-text-muted">Memuat invoice...</span>
    </div>
  ),
});

export default function RiwayatPage() {
  const [trx, setTrx] = useState([]);
  const [halaman, setHalaman] = useState(1);
  const perHalaman = 50;

  useEffect(() => {
    (async () => {
      const t = await getTransactionsRingkas();
      setTrx([...t].reverse());
      setHalaman(1);
    })();
  }, []);

  useEffect(() => {
    const handler = () => {
      (async () => {
        const t = await getTransactionsRingkas();
        setTrx([...t].reverse());
        setHalaman(1);
      })();
    };
    window.addEventListener("dataChanged", handler);
    return () => window.removeEventListener("dataChanged", handler);
  }, []);

  const [cetakId, setCetakId] = useState(null);

  const jmlHalaman = Math.max(1, Math.ceil(trx.length / perHalaman));
  const halamanAman = Math.min(halaman, jmlHalaman);
  const trxHal = trx.slice(
    (halamanAman - 1) * perHalaman,
    halamanAman * perHalaman,
  );

  function bukaCetak(id) {
    setCetakId(id);
    (async () => {
      const penuh = await getTransactionById(id);
      if (penuh) setDataCetak(penuh);
    })();
  }

  const [dataCetak, setDataCetak] = useState(null);

  return (
    <div className="min-h-full bg-gray-50 px-4 py-6 text-slate-900 sm:px-6 lg:px-8">
      <div className="mb-6">
        <h2 className="text-2xl font-bold tracking-tight text-[#0f172a]">
          Riwayat Invoice
        </h2>
        <p className="mt-1 text-sm text-gray-500">
          Daftar transaksi yang sudah selesai.
        </p>
      </div>
      <div className="overflow-x-auto rounded-xl border-2 border-solid border-slate-200 bg-white shadow-lg">
        <table className="w-full table-fixed border-collapse whitespace-nowrap text-sm">
          <thead className="bg-slate-100 text-xs font-bold uppercase tracking-wide text-slate-600">
            <tr>
              <th className="px-4 py-3 text-left">Invoice / Penyewa</th>
              <th className="px-4 py-3 text-left">Status Akhir</th>
              <th className="px-4 py-3 text-left">Total Biaya</th>
              <th className="px-4 py-3 text-left">Aksi</th>
            </tr>
          </thead>
          <tbody>
            {trx.length === 0 && (
              <tr>
                <td colSpan={4}>
                  <EmptyState message="Belum ada transaksi." />
                </td>
              </tr>
            )}
            {trxHal.map((t) => (
              <tr key={t.id} className="hover:bg-slate-50">
                <td className="px-4 py-3">
                  <span className="text-xs text-text-muted">
                    {t.no_invoice}
                  </span>
                  <br />
                  <span className="font-bold">{t.penyewa}</span>
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${t.status === "Selesai" ? "bg-green-100 text-green-700" : t.status === "Belum Selesai" ? "bg-indigo-100 text-indigo-700" : t.status === "Dibatalkan" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}`}
                  >
                    {t.status || "Booking"}
                  </span>
                </td>
                <td className="px-4 py-3 font-bold">
                  {formatRupiah(t.total_akhir || 0)}
                </td>
                <td className="px-4 py-3">
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => bukaCetak(t.id)}
                  >
                    Struk
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {jmlHalaman > 1 && (
        <div className="flex items-center justify-center gap-3 mt-4">
          <button
            type="button"
            onClick={() => setHalaman((h) => Math.max(1, h - 1))}
            disabled={halamanAman <= 1}
            className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            ‹ Sebelumnya
          </button>
          <span className="text-[13px] font-semibold">
            Halaman {halamanAman} / {jmlHalaman}
          </span>
          <button
            type="button"
            onClick={() => setHalaman((h) => Math.min(jmlHalaman, h + 1))}
            disabled={halamanAman >= jmlHalaman}
            className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Berikutnya ›
          </button>
        </div>
      )}

      {/* Invoice Print */}
      {dataCetak && (
        <InvoiceView
          data={dataCetak}
          onClose={() => {
            setCetakId(null);
            setDataCetak(null);
          }}
        />
      )}
    </div>
  );
}
