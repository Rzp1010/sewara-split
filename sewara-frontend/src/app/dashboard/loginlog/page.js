"use client";

import { useState, useEffect, useCallback } from "react";
import { getLoginLogs } from "@/lib/db";
import { api } from "@/lib/api-client";
import { formatTanggal } from "@/lib/utils";
import LoadingOverlay from "@/components/LoadingOverlay";
import { Button } from "@/components/ui";

const LABEL_EVENT = {
  login_sukses: "Login Sukses",
  login_gagal: "Login Gagal",
  logout: "Logout",
};

const BADGE_EVENT = {
  login_sukses: "badge badge-success",
  login_gagal: "badge badge-danger",
  logout: "badge badge-neutral",
};

export default function LoginLogPage() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [userRole, setUserRole] = useState("");

  const muat = useCallback(async () => {
    setLoading(true);
    const hasil = await getLoginLogs();
    if (!hasil.ok) setError(hasil.error);
    else setLogs(hasil.data);
    setLoading(false);
  }, []);

  useEffect(() => {
    (async () => {
      await Promise.resolve();
      try {
        const me = await api.auth.me();
        setUserRole(me?.user?.role || "");
      } catch {
        setUserRole("");
      }
      await muat();
    })();
  }, [muat]);

  useEffect(() => {
    const handler = () => {
      (async () => {
        await muat();
      })();
    };
    window.addEventListener("dataChanged", handler);
    return () => window.removeEventListener("dataChanged", handler);
  }, [muat]);

  if (loading) {
    return <LoadingOverlay />;
  }

  return (
    <div className="page">
      <div className="flex items-center justify-between flex-wrap gap-4 mb-6">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Log Login</h2>
          <p className="mb-0 text-sm text-[var(--text-muted)]">
            Riwayat login, logout, dan percobaan gagal di bisnis Anda.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={muat}
            className="rounded-lg border-0 bg-[var(--bg-subtle)] px-4 py-2 text-sm font-semibold text-[var(--text-primary)] hover:bg-[var(--border-color)]"
          >
            ↻ Muat Ulang
          </button>
        </div>
      </div>

      {error && (
        <div className="alert alert-danger mb-4">
          <p className="font-bold">Gagal memuat data:</p>
          <p className="text-xs mt-2 font-mono break-all">{error}</p>
          <button
            onClick={muat}
            className="mt-4 rounded-lg border-0 bg-[#F04438] px-4 py-2 text-sm font-semibold text-white hover:bg-[#d03a2f]"
          >
            Coba Lagi
          </button>
        </div>
      )}

      <div className="card card-flush">
        <div className="card-header">
          <span className="text-xs font-bold text-muted">
            Riwayat Login ({logs.length})
          </span>
        </div>
        <div className="overflow-x-auto rounded-xl border-2 border-solid border-[var(--border-color)] bg-[var(--bg-surface)] shadow-lg">
          <table className="w-full min-w-[640px] border-collapse whitespace-nowrap text-sm">
            <thead className="bg-[var(--bg-subtle)] text-xs font-bold uppercase tracking-wide text-[var(--text-secondary)]">
              <tr>
                <th className="px-4 py-3 text-left">Waktu</th>
                <th className="px-4 py-3 text-left">Email</th>
                <th className="px-4 py-3 text-left">Event</th>
                <th className="px-4 py-3 text-left">Detail</th>
                <th className="px-4 py-3 text-left">IP</th>
              </tr>
            </thead>
            <tbody>
              {!loading && logs.length === 0 && (
                <tr>
                  <td
                    colSpan={5}
                    className="text-center text-[var(--text-muted)] py-8 px-4"
                  >
                    Belum ada log login.
                  </td>
                </tr>
              )}
              {logs.map((l) => (
                <tr key={l.id} className="hover:bg-[var(--bg-subtle)]">
                  <td className="px-4 py-3 text-xs text-muted">
                    {formatTanggal(l.created_at)}
                  </td>
                  <td className="px-4 py-3 font-semibold">{l.email}</td>
                  <td className="px-4 py-3">
                    <span
                      className={BADGE_EVENT[l.event] || "badge badge-neutral"}
                    >
                      {LABEL_EVENT[l.event] || l.event}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-secondary">
                    {l.detail || "-"}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted">
                    {l.ip || "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
