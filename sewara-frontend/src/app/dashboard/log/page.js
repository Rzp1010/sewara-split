"use client";

import { useState, useEffect, useCallback } from "react";
import { getLogsTerbaru } from "@/lib/db";
import { formatTanggal } from "@/lib/utils";
import { Button, EmptyState } from "@/components/ui";

// Fallback utk log lama (sebelum kolom pelayan/trx_info ada): tebak dari catatan/detail lama
function trxInfoFallback(log) {
  const pyw = (log.catatan || "").match(/Oleh:\s*(.+)/)?.[1];
  const inv = (log.detail || "").match(/Invoice:\s*([A-Za-z0-9-]+)/)?.[1];
  const parts = [pyw, inv].filter(Boolean);
  return parts.length ? parts.join(" • ") : "-";
}

export default function LogPage() {
  const [logs, setLogs] = useState([]);
  const [offset, setOffset] = useState(0);
  const [habis, setHabis] = useState(false);
  const [memuat, setMemuat] = useState(false);

  const muat = useCallback(async (dariOffset, ganti) => {
    const l = await getLogsTerbaru(dariOffset);
    setLogs((prev) => (ganti ? l : [...prev, ...l]));
    setOffset(dariOffset + l.length);
    if (l.length === 0) setHabis(true);
  }, []);

  useEffect(() => {
    (async () => {
      setMemuat(true);
      await muat(0, true);
      setMemuat(false);
    })();
  }, [muat]);

  useEffect(() => {
    const handler = () => {
      (async () => {
        await muat(0, true);
      })();
    };
    window.addEventListener("dataChanged", handler);
    return () => window.removeEventListener("dataChanged", handler);
  }, [muat]);

  return (
    <div className="log-page">
      <h2 className="log-page-title mb-6">Log Aktivitas</h2>
      <div className="overflow-x-auto rounded-xl border-2 border-solid border-slate-200 bg-white shadow-lg">
        <table className="w-full table-fixed border-collapse whitespace-nowrap text-sm">
          <thead className="bg-slate-100 text-xs font-bold uppercase tracking-wide text-slate-600">
            <tr>
              <th className="px-4 py-3 text-left">Waktu</th>
              <th className="px-4 py-3 text-left">Aktivitas</th>
              <th className="px-4 py-3 text-left">Dilayani Oleh</th>
              <th className="px-4 py-3 text-left">Penyewa</th>
              <th className="px-4 py-3 text-left">Catatan</th>
            </tr>
          </thead>
          <tbody>
            {logs.length === 0 && !memuat && (
              <tr>
                <td colSpan={5}>
                  <EmptyState message="Belum ada log aktivitas." />
                </td>
              </tr>
            )}
            {logs.map((log, idx) => (
              <tr key={`${log.id}-${idx}`} className="hover:bg-slate-50">
                <td className="px-4 py-3 text-xs text-gray-500">
                  {formatTanggal(log.waktu)}
                </td>
                <td
                  className={`px-4 py-3 font-medium ${(log.aktivitas || "").includes("Keluar") ? "text-blue-700" : (log.aktivitas || "").includes("Masuk") || (log.aktivitas || "").includes("Selesai") ? "text-emerald-700" : (log.aktivitas || "").includes("Dibatalkan") ? "text-red-700" : (log.aktivitas || "").includes("Pembayaran") ? "text-[#7181E0]" : "text-gray-700"}`}
                >
                  {log.aktivitas}
                </td>
                <td className="px-4 py-3 text-xs">{log.pelayan || "-"}</td>
                <td className="px-4 py-3 text-xs">
                  {log.trx_info || trxInfoFallback(log)}
                </td>
                <td className="px-4 py-3 text-xs text-red-700">
                  {log.catatan || "-"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-center mt-4">
        <Button
          variant="ghost"
          onClick={() => {
            (async () => {
              setMemuat(true);
              await muat(offset, false);
              setMemuat(false);
            })();
          }}
          disabled={habis || memuat}
          loading={memuat}
          className="rounded-lg border-0 bg-gray-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-gray-300"
        >
          {habis ? "Semua log sudah dimuat" : "Muat Lagi"}
        </Button>
      </div>
    </div>
  );
}
