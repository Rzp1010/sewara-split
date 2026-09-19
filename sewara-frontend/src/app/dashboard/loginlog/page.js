"use client";

import { useState, useEffect, useCallback } from "react";
import { getSettingTenant, setSettingTenant, getLoginLogs } from "@/lib/db";
import { createPortal } from "react-dom";
import { api, API_BASE } from "@/lib/api-client";
import { formatTanggal } from "@/lib/utils";
import { ROLE_SUPERADMIN } from "@/lib/role";
import { useNotify } from "@/components/NotificationProvider";
import LoadingOverlay from "@/components/LoadingOverlay";
import PasswordInput from "@/components/PasswordInput";
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
  const { notify } = useNotify();
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [userRole, setUserRole] = useState("");

  // Config Notifikasi Telegram (superadmin only)
  const [showTgModal, setShowTgModal] = useState(false);
  const [tgAktif, setTgAktif] = useState(false);
  const [tgBotToken, setTgBotToken] = useState("");
  const [tgChatId, setTgChatId] = useState("");
  const [tgKirimSukses, setTgKirimSukses] = useState(true);
  const [tgKirimGagal, setTgKirimGagal] = useState(true);
  const [tgTopicLogin, setTgTopicLogin] = useState("4");
  const [tgSaving, setTgSaving] = useState(false);
  const [tgTesting, setTgTesting] = useState(false);

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

  // Muat config Telegram milik superadmin
  useEffect(() => {
    if (userRole !== ROLE_SUPERADMIN) return;
    let aktif = true;
    (async () => {
      const cfg = await getSettingTenant("telegram_login_notif", {});
      if (!aktif) return;
      setTgAktif(Boolean(cfg?.aktif));
      setTgBotToken(cfg?.botToken || "");
      setTgChatId(cfg?.chatId || "");
      setTgKirimSukses(cfg?.kirimSukses !== false);
      setTgKirimGagal(cfg?.kirimGagal !== false);
      setTgTopicLogin(cfg?.topicLogin != null ? String(cfg.topicLogin) : "4");
    })();
    return () => {
      aktif = false;
    };
  }, [userRole]);

  async function simpanTg() {
    setTgSaving(true);
    const hasil = await setSettingTenant("telegram_login_notif", {
      aktif: tgAktif,
      botToken: tgBotToken.trim(),
      chatId: tgChatId.trim(),
      kirimSukses: tgKirimSukses,
      kirimGagal: tgKirimGagal,
      topicLogin: tgTopicLogin === "" ? null : parseInt(tgTopicLogin, 10),
    });
    setTgSaving(false);
    if (!hasil.ok) return notify(`Gagal menyimpan: ${hasil.error}`, "error");
    notify("Pengaturan notifikasi Telegram disimpan.");
  }

  async function tesTg() {
    setTgTesting(true);
    try {
      const res = await fetch(`${API_BASE}/api/telegram/test`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok)
        return notify(data.error || "Gagal mengirim pesan uji.", "error");
      notify("Pesan uji terkirim ke Telegram. Cek chat Anda.");
    } catch (e) {
      notify("Gagal mengirim pesan uji.", "error");
    } finally {
      setTgTesting(false);
    }
  }

  if (loading) {
    return <LoadingOverlay />;
  }

  const isSuperadmin = userRole === ROLE_SUPERADMIN;

  return (
    <div className="page">
      <div className="flex items-center justify-between flex-wrap gap-4 mb-6">
        <div>
          <h2 className="page-title">Log Login</h2>
          <p className="page-sub mb-0">
            Riwayat login, logout, dan percobaan gagal di bisnis Anda.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isSuperadmin && (
            <button
              onClick={() => setShowTgModal(true)}
              className="rounded-lg border-0 bg-[#7181E0] px-4 py-2 text-sm font-semibold text-white hover:bg-[#5d6fcc]"
            >
              Notifikasi Telegram
            </button>
          )}
          <button
            onClick={muat}
            className="rounded-lg border-0 bg-gray-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-gray-300"
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

      {isSuperadmin &&
        typeof document !== "undefined" &&
        showTgModal &&
        createPortal(
          <div
            onClick={() => setShowTgModal(false)}
            className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm"
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="relative flex max-h-[90vh] w-full flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
            >
              <div className="modal-header">
                <h3 className="modal-title">Notifikasi Telegram</h3>
                <button
                  onClick={() => setShowTgModal(false)}
                  className="modal-close"
                >
                  &times;
                </button>
              </div>
              <div className="flex-1 overflow-y-auto px-6 pb-6">
                <div className="flex flex-col gap-1">
                  <div className="field">
                    <label className="switch">
                      <input
                        type="checkbox"
                        checked={tgAktif}
                        onChange={(e) => setTgAktif(e.target.checked)}
                      />
                      <span className="switch-track" />
                      <span className="switch-label">
                        Aktifkan notifikasi login ke Telegram
                      </span>
                    </label>
                    <p className="field-hint">
                      Superadmin menerima notifikasi untuk SEMUA login di
                      aplikasi (sukses &amp; gagal), lintas tenant.
                    </p>
                  </div>

                  <div className="field">
                    <label className="label">Bot Token</label>
                    <PasswordInput
                      value={tgBotToken}
                      onChange={(e) => setTgBotToken(e.target.value)}
                      placeholder="123456:ABC-DEF..."
                    />
                    <p className="field-hint">
                      Dari @BotFather di Telegram. Disimpan di pengaturan akun
                      Anda.
                    </p>
                  </div>

                  <div className="field">
                    <label className="label">Chat ID</label>
                    <input
                      value={tgChatId}
                      onChange={(e) => setTgChatId(e.target.value)}
                      placeholder="mis. 123456789"
                      className="input text-13"
                    />
                    <p className="field-hint">
                      ID chat Telegram Anda. Cara dapat: kirim pesan ke bot,
                      lalu buka
                      https://api.telegram.org/bot&lt;TOKEN&gt;/getUpdates
                    </p>
                  </div>

                  <div className="field">
                    <label className="label">Topic ID (Log Login)</label>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={tgTopicLogin}
                      onChange={(e) =>
                        setTgTopicLogin(e.target.value.replace(/\D/g, ""))
                      }
                      placeholder="mis. 4"
                      className="input text-13"
                    />
                    <p className="field-hint">
                      ID topic di supergrup. Cara dapat: buat topic, kirim pesan
                      apa saja ke sana, lalu buka
                      https://api.telegram.org/bot&lt;TOKEN&gt;/getUpdates —
                      cari &quot;message_thread_id&quot;.
                    </p>
                  </div>

                  <div className="flex items-center gap-4 flex-wrap">
                    <label className="switch">
                      <input
                        type="checkbox"
                        checked={tgKirimSukses}
                        onChange={(e) => setTgKirimSukses(e.target.checked)}
                      />
                      <span className="switch-track" />
                      <span className="switch-label">
                        Kirim saat login sukses
                      </span>
                    </label>
                    <label className="switch">
                      <input
                        type="checkbox"
                        checked={tgKirimGagal}
                        onChange={(e) => setTgKirimGagal(e.target.checked)}
                      />
                      <span className="switch-track" />
                      <span className="switch-label">
                        Kirim saat login gagal
                      </span>
                    </label>
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button
                  onClick={() => setShowTgModal(false)}
                  className="min-w-0 flex-1 rounded-lg border border-solid border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Tutup
                </button>
                <button
                  onClick={tesTg}
                  disabled={tgTesting || !tgAktif}
                  className="min-w-0 flex-1 rounded-lg border border-solid border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  {tgTesting ? "Mengirim..." : "Kirim Pesan Uji"}
                </button>
                <button
                  onClick={simpanTg}
                  disabled={tgSaving}
                  className="min-w-0 flex-1 rounded-lg border-0 bg-[#7181E0] px-4 py-2 text-sm font-semibold text-white hover:bg-[#5d6fcc]"
                >
                  {tgSaving ? "Menyimpan..." : "Simpan"}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}

      <div className="card card-flush">
        <div className="card-header">
          <span className="text-xs font-bold text-muted">
            Riwayat Login ({logs.length})
          </span>
        </div>
        <div className="overflow-x-auto rounded-xl border-2 border-solid border-slate-200 bg-white shadow-lg">
          <table className="w-full table-fixed border-collapse whitespace-nowrap text-sm">
            <thead className="bg-slate-100 text-xs font-bold uppercase tracking-wide text-slate-600">
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
                    className="text-center text-gray-500 py-8 px-4"
                  >
                    Belum ada log login.
                  </td>
                </tr>
              )}
              {logs.map((l) => (
                <tr key={l.id} className="hover:bg-slate-50">
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
