"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { getTransactionsRingkas, getTransactionById, eksporBuktiBayar } from "@/lib/db";
import dynamic from "next/dynamic";
import { formatRupiah } from "@/lib/utils";
import { Button, EmptyState } from "@/components/ui";
import { useNotify } from "@/components/NotificationProvider";
import ModalBuktiBayar from "@/components/ModalBuktiBayar";
import BannerBackupBukti from "@/components/BannerBackupBukti";

const BULAN_ID = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];

// YYYY-MM waktu LOKAL — jangan toISOString(): tanggal 1 dini hari WIB
// bergeser ke bulan sebelumnya di UTC.
function bulanLokal(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function labelBulan(value) {
  const [y, m] = String(value || "").split("-");
  const idx = parseInt(m, 10) - 1;
  if (!y || idx < 0 || idx > 11) return value;
  return `${BULAN_ID[idx]} ${y}`;
}

const InvoiceView = dynamic(() => import("@/components/InvoiceView"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center gap-2 p-8">
      <div className="h-5 w-5 animate-spin rounded-full border-4 border-surface-card border-t-brand"></div>
      <span className="text-text-muted">Memuat invoice...</span>
    </div>
  ),
});

function RiwayatPageInner() {
  const { notify } = useNotify();
  const searchParams = useSearchParams();
  const [trx, setTrx] = useState([]);
  const [halaman, setHalaman] = useState(1);
  const perHalaman = 50;
  const [bulanEkspor, setBulanEkspor] = useState(() => bulanLokal(new Date()));
  const [bulanEkstra, setBulanEkstra] = useState(null);

  // Terima ?ekspor=YYYY-MM dari banner pengingat backup.
  useEffect(() => {
    const q = searchParams.get("ekspor");
    if (!q || !/^\d{4}-\d{2}$/.test(q)) return;
    setBulanEkspor(q);
    setBulanEkstra(q);
  }, [searchParams]);

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

  const [buktiTrx, setBuktiTrx] = useState(null);
  const [loadingBuktiId, setLoadingBuktiId] = useState(null);

  async function bukaBukti(id) {
    if (loadingBuktiId) return;
    setLoadingBuktiId(id);
    try {
      const penuh = await getTransactionById(id);
      if (penuh) setBuktiTrx(penuh);
    } finally {
      setLoadingBuktiId(null);
    }
  }

  async function ekspor() {
    const hasil = await eksporBuktiBayar(bulanEkspor);
    if (!hasil.ok) notify(hasil.message, "error");
  }

  const pilihanBulan = (() => {
    const out = [];
    const now = new Date();
    for (let i = 0; i < 12; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      out.push(bulanLokal(d));
    }
    // Bulan dari ?ekspor= bisa di luar 12 bulan terakhir — sisipkan agar
    // dropdown tetap bisa menampilkannya sebagai opsi terpilih.
    if (bulanEkstra && !out.includes(bulanEkstra)) out.unshift(bulanEkstra);
    return out;
  })();

  return (
    <div className="min-h-full bg-gray-50 px-4 py-6 text-slate-900 sm:px-6 lg:px-8">
      <BannerBackupBukti />
      <div className="mt-4 mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-[#0f172a]">
            Riwayat Invoice
          </h2>
          <p className="mt-1 text-sm text-gray-500">
            Daftar transaksi yang sudah selesai.
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-xl border-2 border-solid border-slate-200 bg-white p-3 shadow-lg">
          <span className="text-xs font-bold uppercase tracking-wide text-slate-600">
            Ekspor Bukti Bayar
          </span>
          <select
            value={bulanEkspor}
            onChange={(e) => setBulanEkspor(e.target.value)}
            className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 outline-none focus:border-blue-600"
          >
            {pilihanBulan.map((b) => (
              <option key={b} value={b}>
                {labelBulan(b)}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={ekspor}
            className="rounded-lg bg-[#7181E0] px-4 py-1.5 text-sm font-semibold text-white hover:bg-[#5d6fcc]"
          >
            Ekspor
          </button>
        </div>
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
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => bukaBukti(t.id)}
                      disabled={loadingBuktiId === t.id}
                      className="rounded-lg border-0 bg-gray-200 px-3 py-1.5 text-sm font-semibold text-slate-700 transition-colors hover:bg-gray-300 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {loadingBuktiId === t.id ? "Memuat..." : "Bukti"}
                    </button>
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => bukaCetak(t.id)}
                    >
                      Struk
                    </Button>
                  </div>
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

      {buktiTrx && (
        <ModalBuktiBayar
          transaksi={buktiTrx}
          onClose={() => setBuktiTrx(null)}
        />
      )}
    </div>
  );
}

export default function RiwayatPage() {
  return (
    <Suspense fallback={null}>
      <RiwayatPageInner />
    </Suspense>
  );
}
