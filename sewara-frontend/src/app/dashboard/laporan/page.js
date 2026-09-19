"use client";

import { useState, useEffect } from "react";
import { getSetting, getTransactionsLaporan, getTransactionsLaporanRange, getTransactionItemsSemua } from "@/lib/db";
import { api } from "@/lib/api-client";
import {
  formatRupiah,
  formatTanggal,
  unduhCSV,
  hitungPembayaran,
} from "@/lib/utils";
import { ROLE_OWNER, ROLE_SUPERADMIN } from "@/lib/role";
import { useNotify } from "@/components/NotificationProvider";
import DateTimePicker from "@/components/DateTimePicker";
import { Button } from "@/components/ui";

const fmtYMD = (d) =>
  d
    ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
    : "";

export default function LaporanPage() {
  const { notify } = useNotify();
  const [trx, setTrx] = useState([]);
  const [periode, setPeriode] = useState("semua");
  const [dari, setDari] = useState("");
  const [sampai, setSampai] = useState("");
  const [halaman, setHalaman] = useState(1);
  const perHalaman = 50;
  const [versi, setVersi] = useState(0);
  const [userRole, setUserRole] = useState("");
  const [tab, setTab] = useState("keuangan");
  const [items, setItems] = useState([]);

  useEffect(() => {
    let aktif = true;
    (async () => {
      try {
        const me = await api.auth.me();
        if (aktif) setUserRole(me?.user?.role || "");
      } catch {}
    })();
    return () => {
      aktif = false;
    };
  }, []);

  const bolehExport = userRole === ROLE_OWNER || userRole === ROLE_SUPERADMIN;

  const hitungRange = () => {
    const now = new Date();
    if (periode === "harian")
      return { mulai: new Date(now.getTime() - 1 * 86400000), akhir: now };
    if (periode === "mingguan")
      return { mulai: new Date(now.getTime() - 7 * 86400000), akhir: now };
    if (periode === "bulanan")
      return { mulai: new Date(now.getTime() - 30 * 86400000), akhir: now };
    if (periode === "custom") {
      const s = dari ? new Date(dari + "T00:00:00") : null;
      const e = sampai ? new Date(sampai + "T23:59:59") : null;
      return { mulai: s, akhir: e };
    }
    return null;
  };

  useEffect(() => {
    (async () => {
      const r = hitungRange();
      const data =
        r && r.mulai && r.akhir
          ? await getTransactionsLaporanRange(
              r.mulai.toISOString(),
              r.akhir.toISOString(),
            )
          : await getTransactionsLaporan();
      setTrx(data);
    })();
  }, [periode, dari, sampai, versi]);

  useEffect(() => {
    let aktif = true;
    (async () => {
      const data = await getTransactionItemsSemua();
      if (aktif) setItems(data || []);
    })();
    return () => {
      aktif = false;
    };
  }, [versi]);

  useEffect(() => {
    const handler = () => setVersi((v) => v + 1);
    window.addEventListener("dataChanged", handler);
    window.addEventListener("settingChanged", handler);
    return () => {
      window.removeEventListener("dataChanged", handler);
      window.removeEventListener("settingChanged", handler);
    };
  }, []);

  const dalamPeriode = (t) => {
    if (periode === "semua") return true;
    const tgl = new Date(t.waktu_kembali_rencana);
    if (periode === "custom") {
      if (!dari && !sampai) return true;
      const s = dari ? new Date(dari + "T00:00:00") : null;
      const e = sampai ? new Date(sampai + "T23:59:59") : null;
      if (s && tgl < s) return false;
      if (e && tgl > e) return false;
      return true;
    }
    const now = new Date();
    const start = new Date(now);
    if (periode === "harian") start.setDate(now.getDate() - 1);
    else if (periode === "mingguan") start.setDate(now.getDate() - 7);
    else if (periode === "bulanan") start.setMonth(now.getMonth() - 1);
    return tgl >= start;
  };

  const basis = getSetting("basis_pendapatan", "selesai");
  const dataRekap = trx.filter((t) => {
    if (t.status === "Dibatalkan") return false;
    if (basis === "selesai" && t.status !== "Selesai") return false;
    if (basis === "aktif" && t.status !== "Selesai" && t.status !== "Disewa")
      return false;
    return dalamPeriode(t);
  });

  const dataPeriode = trx.filter(
    (t) => t.status === "Selesai" && dalamPeriode(t),
  );

  // ===== Alat Populer: agregasi client-side (data tenant kecil; upgrade: RPC agregasi bila row items membesar) =====
  const trxEligibel = new Map(
    trx
      .filter((t) => t.status !== "Dibatalkan" && dalamPeriode(t))
      .map((t) => [t.id, t]),
  );
  const dataAlat = Object.values(
    items.reduce((acc, it) => {
      const t = trxEligibel.get(it.transaction_id);
      if (!t) return acc;
      const k = (it.item_name || "(tanpa nama)").trim();
      const e = (acc[k] ||= {
        nama: k,
        totalUnit: 0,
        transaksi: new Set(),
        terakhir: null,
      });
      e.totalUnit += it.qty || 0;
      e.transaksi.add(t.id);
      const tgl = new Date(t.waktu_kembali_aktual || t.waktu_kembali_rencana || 0);
      if (!e.terakhir || tgl > e.terakhir) e.terakhir = tgl;
      return acc;
    }, {}),
  ).sort(
    (a, b) =>
      b.totalUnit - a.totalUnit ||
      b.transaksi.size - a.transaksi.size ||
      a.nama.localeCompare(b.nama),
  );
  const totalUnitAlat = dataAlat.reduce((s, a) => s + a.totalUnit, 0);

  const totalBiaya = dataRekap.reduce((s, t) => s + (t.biaya || 0), 0);
  const total_denda = dataRekap.reduce((s, t) => s + (t.denda || 0), 0);
  const total_akhir = dataRekap.reduce((s, t) => s + (t.total_akhir || 0), 0);
  const totalDiterima = dataRekap.reduce(
    (s, t) => s + hitungPembayaran(t).dibayar,
    0,
  );
  const bayarMetode = (trx, metode) =>
    (trx.pembayaran?.riwayatBayar || []).reduce(
      (s, b) => s + ((b.metode || "") === metode ? b.jumlah || 0 : 0),
      0,
    );
  const diterimaTunai = dataRekap.reduce(
    (s, t) => s + bayarMetode(t, "Tunai"),
    0,
  );
  const diterimaQris = dataRekap.reduce(
    (s, t) => s + bayarMetode(t, "QRIS"),
    0,
  );
  const diterimaTransfer = dataRekap.reduce(
    (s, t) => s + bayarMetode(t, "Transfer"),
    0,
  );

  // DP Hangus — diambil dari field terpisah di transaksi
  const dataDibatalkan = trx.filter(
    (t) => t.status === "Dibatalkan" && dalamPeriode(t),
  );
  const totalDpHangus = dataDibatalkan.reduce(
    (s, t) => s + (t.dp_hangus || 0),
    0,
  );

  const sorted = [...dataPeriode].sort(
    (a, b) =>
      new Date(b.waktu_kembali_aktual || 0) -
      new Date(a.waktu_kembali_aktual || 0),
  );

  const jmlHalaman = Math.max(1, Math.ceil(sorted.length / perHalaman));
  const halamanAman = Math.min(halaman, jmlHalaman);
  const sortedHal = sorted.slice(
    (halamanAman - 1) * perHalaman,
    halamanAman * perHalaman,
  );

  async function exportKeuangan() {
    const selesai = sorted.filter((t) => t.status === "Selesai");
    const dibatalkan = dataDibatalkan.filter((t) => (t.dp_hangus || 0) > 0);
    if (selesai.length === 0 && dibatalkan.length === 0)
      return notify("Tidak ada data transaksi pada periode ini!", "error");
    let csv =
      "No Invoice,Waktu Selesai,Nama Penyewa,No HP,Biaya Dasar,Denda Tambahan,Total Akhir,Bayar Tunai,Bayar QRIS,Bayar Transfer\n";
    selesai.forEach(
      (t) =>
        (csv += `${t.no_invoice},"${formatTanggal(t.waktu_kembali_aktual)}","${t.penyewa}","${t.hp_penyewa || "-"}",${t.biaya || 0},${t.denda || 0},${t.total_akhir || 0},${bayarMetode(t, "Tunai")},${bayarMetode(t, "QRIS")},${bayarMetode(t, "Transfer")}\n`),
    );
    if (dibatalkan.length > 0) {
      csv += "\nDP Hangus (Pembatalan)\n";
      csv += "No Invoice,Waktu Dibatalkan,Nama Penyewa,DP Hangus,Aturan\n";
      dibatalkan.forEach(
        (t) =>
          (csv += `${t.no_invoice},"${formatTanggal(t.waktu_kembali_aktual || t.updated_at)}","${t.penyewa}",${t.dp_hangus || 0},"${(t.dp_hangus_aturan || "-").replace(/"/g, '""')}"\n`),
      );
    }
    unduhCSV(csv, `Laporan_Keuangan_Sewara.csv`);
  }

  return (
    <div className="w-full max-w-7xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-4 mb-6">
        <h2 className="text-2xl font-bold tracking-tight leading-tight">
          {tab === "keuangan" ? "Laporan Keuangan" : "Laporan Alat Populer"}
        </h2>
        <div className="flex items-center flex-wrap gap-2">
          {tab === "keuangan" && bolehExport && (
            <>
              <button
                type="button"
                onClick={exportKeuangan}
                className="rounded-lg border-0 bg-[#7181E0] px-4 py-2 text-sm font-semibold text-white hover:bg-[#5d6fcc]"
              >
                Export Keuangan
              </button>
            </>
          )}
        </div>
      </div>

      <div className="flex items-center flex-wrap gap-2 mb-4">
        {[
          { key: "keuangan", label: "Keuangan" },
          { key: "alat", label: "Alat Populer" },
        ].map((t) => (
          <button
            type="button"
            key={t.key}
            onClick={() => {
              setTab(t.key);
              setHalaman(1);
            }}
            className={`rounded-lg border-0 px-4 py-2 text-sm font-semibold ${tab === t.key ? "bg-[#7181E0] text-white hover:bg-[#5d6fcc]" : "bg-gray-200 text-slate-700 hover:bg-gray-300"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex items-center flex-wrap gap-2 mb-4">
        {[
          { key: "semua", label: "Semua" },
          { key: "harian", label: "24 Jam" },
          { key: "mingguan", label: "7 Hari" },
          { key: "bulanan", label: "30 Hari" },
          { key: "custom", label: "Custom" },
        ].map((p) => (
          <button
            type="button"
            key={p.key}
            onClick={() => {
              setPeriode(p.key);
              setHalaman(1);
            }}
            className={`rounded-lg border-0 px-4 py-2 text-sm font-semibold ${periode === p.key ? "bg-[#7181E0] text-white hover:bg-[#5d6fcc]" : "bg-gray-200 text-slate-700 hover:bg-gray-300"}`}
          >
            {p.label}
          </button>
        ))}
        {periode === "custom" && (
          <div className="flex items-center flex-wrap gap-2">
            <div className="w-[150px] max-w-full">
              <DateTimePicker
                value={dari ? new Date(`${dari}T00:00:00`) : null}
                onChange={(d) => {
                  setDari(fmtYMD(d));
                  setHalaman(1);
                }}
                showTime={false}
                placeholder="dd/mm/yyyy"
              />
            </div>
            <span className="text-13 text-gray-600">s/d</span>
            <div className="w-[150px] max-w-full">
              <DateTimePicker
                value={sampai ? new Date(`${sampai}T00:00:00`) : null}
                onChange={(d) => {
                  setSampai(fmtYMD(d));
                  setHalaman(1);
                }}
                showTime={false}
                placeholder="dd/mm/yyyy"
              />
            </div>
          </div>
        )}
      </div>

      {tab === "keuangan" && (
        <>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 border-l-4 border-[#7181E0] p-4">
          <p className="text-xs font-semibold text-gray-500 mb-0">
            Total Biaya Dasar
          </p>
          <p className="text-[22px] font-bold mb-0">
            {formatRupiah(totalBiaya)}
          </p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 border-l-4 border-red-500 p-4">
          <p className="text-xs font-semibold text-gray-500 mb-0">
            Total Denda
          </p>
          <p className="text-[22px] font-bold text-danger mb-0">
            {formatRupiah(total_denda)}
          </p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 border-l-4 border-emerald-500 p-4">
          <p className="text-xs font-semibold text-gray-500 mb-0">
            Total Akhir
          </p>
          <p className="text-[22px] font-bold mb-0 text-emerald-700">
            {formatRupiah(total_akhir)}
          </p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 border-l-4 border-[#7181E0] p-4 md:col-span-3">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <p className="text-xs font-semibold text-gray-500 mb-0">
              Total Diterima
            </p>
            <p className="text-[22px] font-bold mb-0">
              {formatRupiah(totalDiterima)}
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
            <div className="rounded-lg bg-amber-50 p-3">
              <p className="text-xs font-semibold mb-0 text-amber-700">
                Diterima Tunai
              </p>
              <p className="text-lg font-bold mb-0">
                {formatRupiah(diterimaTunai)}
              </p>
            </div>
            <div className="rounded-lg bg-blue-50 p-3">
              <p className="text-xs font-semibold mb-0">Diterima Transfer</p>
              <p className="text-lg font-bold mb-0">
                {formatRupiah(diterimaTransfer)}
              </p>
            </div>
            <div className="rounded-lg bg-emerald-50 p-3">
              <p className="text-xs font-semibold mb-0">Diterima QRIS</p>
              <p className="text-lg font-bold mb-0">
                {formatRupiah(diterimaQris)}
              </p>
            </div>
          </div>
          <p className="text-xs text-gray-500 mt-3">
            Sisa piutang:{" "}
            {formatRupiah(Math.max(0, total_akhir - totalDiterima))}
          </p>
          {totalDpHangus > 0 && (
            <p className="text-xs text-red-500 mt-1">
              Total DP Hangus (pembatalan):{" "}
              <span className="font-semibold">{formatRupiah(totalDpHangus)}</span>
            </p>
          )}
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border-2 border-solid border-slate-200 bg-white shadow-lg">
        <table className="w-full table-fixed border-collapse whitespace-nowrap text-sm">
          <thead className="bg-slate-100 text-xs font-bold uppercase tracking-wide text-slate-600">
            <tr>
              <th className="px-4 py-3 text-left">Invoice</th>
              <th className="px-4 py-3 text-left">Penyewa</th>
              <th className="px-4 py-3 text-left">Tgl Selesai</th>
              <th className="px-4 py-3 text-left">Biaya</th>
              <th className="px-4 py-3 text-left text-red-700">Denda</th>
              <th className="px-4 py-3 text-left">Total Akhir</th>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 && (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-12 text-center italic text-gray-500"
                >
                  Belum ada transaksi selesai.
                </td>
              </tr>
            )}
            {sortedHal.map((t) => (
              <tr key={t.id} className="hover:bg-slate-50">
                <td className="border-b border-border px-4 py-3 text-xs text-text-muted font-mono">
                  {t.no_invoice}
                </td>
                <td className="px-4 py-3 font-bold">{t.penyewa}</td>
                <td className="px-4 py-3 text-xs">
                  {formatTanggal(t.waktu_kembali_aktual)}
                </td>
                <td className="px-4 py-3">{formatRupiah(t.biaya || 0)}</td>
                <td className="px-4 py-3 font-bold text-danger">
                  {t.denda > 0 ? formatRupiah(t.denda) : "-"}
                </td>
                <td className="px-4 py-3 font-black text-emerald-700">
                  {formatRupiah(t.total_akhir || 0)}
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
            className="rounded-lg border-0 bg-[#7181E0] px-4 py-2 text-sm font-semibold text-white hover:bg-[#5d6fcc]"
          >
            ‹ Sebelumnya
          </button>
          <span className="text-13 font-semibold">
            Halaman {halamanAman} / {jmlHalaman}
          </span>
          <button
            type="button"
            onClick={() => setHalaman((h) => Math.min(jmlHalaman, h + 1))}
            disabled={halamanAman >= jmlHalaman}
            className="rounded-lg border-0 bg-[#7181E0] px-4 py-2 text-sm font-semibold text-white hover:bg-[#5d6fcc]"
          >
            Berikutnya ›
          </button>
        </div>
      )}
        </>
      )}

      {tab === "alat" && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 border-l-4 border-[#7181E0] p-4">
              <p className="text-xs font-semibold text-gray-500 mb-0">
                Total Unit Keluar
              </p>
              <p className="text-[22px] font-bold mb-0">{totalUnitAlat}</p>
            </div>
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 border-l-4 border-emerald-500 p-4">
              <p className="text-xs font-semibold text-gray-500 mb-0">
                Jenis Alat
              </p>
              <p className="text-[22px] font-bold mb-0 text-emerald-700">
                {dataAlat.length}
              </p>
            </div>
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 border-l-4 border-amber-500 p-4">
              <p className="text-xs font-semibold text-gray-500 mb-0">
                Alat Terpopuler
              </p>
              <p className="text-lg font-bold mb-0 break-words">
                {dataAlat[0]?.nama || "-"}
              </p>
            </div>
          </div>

          <div className="overflow-x-auto rounded-xl border-2 border-solid border-slate-200 bg-white shadow-lg">
            <table className="w-full table-fixed border-collapse whitespace-nowrap text-sm">
              <thead className="bg-slate-100 text-xs font-bold uppercase tracking-wide text-slate-600">
                <tr>
                  <th className="w-12 px-4 py-3 text-left">#</th>
                  <th className="px-4 py-3 text-left">Nama Alat</th>
                  <th className="w-36 px-4 py-3 text-left">Jumlah Keluar</th>
                  <th className="w-36 px-4 py-3 text-left">Frekuensi Sewa</th>
                  <th className="w-40 px-4 py-3 text-left">Terakhir Keluar</th>
                </tr>
              </thead>
              <tbody>
                {dataAlat.length === 0 && (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-4 py-12 text-center italic text-gray-500"
                    >
                      Belum ada data alat pada periode ini.
                    </td>
                  </tr>
                )}
                {dataAlat.map((a, i) => (
                  <tr key={a.nama} className="hover:bg-slate-50">
                    <td className="border-b border-border px-4 py-3 text-xs text-text-muted font-mono">
                      {i + 1}
                    </td>
                    <td className="px-4 py-3 font-bold whitespace-normal">
                      {a.nama}
                    </td>
                    <td className="px-4 py-3">{a.totalUnit} unit</td>
                    <td className="px-4 py-3">{a.transaksi.size}x</td>
                    <td className="px-4 py-3 text-xs">
                      {a.terakhir && a.terakhir.getTime()
                        ? formatTanggal(a.terakhir)
                        : "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
