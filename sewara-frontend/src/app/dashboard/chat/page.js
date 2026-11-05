"use client";

import { useState, useEffect, useRef } from "react";
import {
  getChatMessages,
  kirimChat,
  hapusChat,
  tandaiChatDibaca,
  getChatUnread,
  getTransactionsRingkas,
} from "@/lib/db";
import { api } from "@/lib/api-client";
import { Button, EmptyState } from "@/components/ui";
import ErrorMuat from "@/components/ErrorMuat";
import { ROLE_OWNER, ROLE_SUPERADMIN } from "@/lib/role";

function formatJam(iso) {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("id-ID", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Chat internal tenant: ruang gabungan semua pesan (bebas atau menempel invoice).
export default function ChatPage() {
  const [pesan, setPesan] = useState([]);
  const [invMap, setInvMap] = useState({});
  const [filterTrx, setFilterTrx] = useState("");
  const [isi, setIsi] = useState("");
  const [trxKirim, setTrxKirim] = useState("");
  const [busy, setBusy] = useState(false);
  const [memuat, setMemuat] = useState(true);
  const [error, setError] = useState("");
  const [me, setMe] = useState(null);
  const [belumAwal, setBelumAwal] = useState(0);
  const unreadSudahDiambil = useRef(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let hidup = true;
    const muat = async () => {
      try {
        const data = await getChatMessages({ limit: 200 });
        if (!hidup) return;
        setPesan(data);
        setError("");
      } catch (e) {
        if (hidup) setError(e.message || "Gagal memuat chat");
      } finally {
        if (hidup) setMemuat(false);
      }
    };
    const inisialisasi = async () => {
      try {
        if (!unreadSudahDiambil.current) {
          const unread = await getChatUnread();
          if (!hidup) return;
          setBelumAwal(Number(unread?.room) || 0);
          unreadSudahDiambil.current = true;
        }
        await tandaiChatDibaca({});
      } catch (e) {
        if (hidup) setError(e.message || "Gagal memuat chat");
      }
      if (hidup) await muat();
    };
    inisialisasi();
    api.auth
      .me()
      .then((me_) => {
        if (hidup) setMe(me_?.user || null);
      })
      .catch(() => null);
    getTransactionsRingkas()
      .then((list) => {
        if (!hidup) return;
        const map = {};
        for (const t of list || []) map[t.id] = t.no_invoice || "";
        setInvMap(map);
      })
      .catch(() => null);
    const timer = setInterval(() => {
      if (unreadSudahDiambil.current) muat();
    }, 15000);
    return () => {
      hidup = false;
      clearInterval(timer);
    };
  }, [reload]);

  const bolehHapus = (m) =>
    (me?.id && m.authorId === me.id) ||
    me?.role === ROLE_OWNER ||
    me?.role === ROLE_SUPERADMIN;

  const kirim = async (e) => {
    e.preventDefault();
    const teks = isi.trim();
    if (!teks || busy) return;
    setBusy(true);
    try {
      const baru = await kirimChat({ trxId: trxKirim || null, pesan: teks });
      setIsi("");
      setError("");
      if (baru) setPesan((p) => [...p, baru]);
    } catch (err) {
      setError(err.message || "Gagal mengirim pesan");
    } finally {
      setBusy(false);
    }
  };

  const hapus = async (id) => {
    try {
      await hapusChat(id);
      setPesan((p) => p.filter((m) => m.id !== id));
    } catch (err) {
      setError(err.message || "Gagal menghapus pesan");
    }
  };

  const labelInvoice = (trxId) => invMap[trxId] || `Invoice ${trxId.slice(0, 8)}`;
  const daftarInvoice = [...new Set(pesan.map((m) => m.trxId).filter(Boolean))];
  const tampil = filterTrx ? pesan.filter((m) => m.trxId === filterTrx) : pesan;
  const jumlahBelumDibaca = (trxId) =>
    pesan.filter((m) => m.trxId === trxId && m.authorId !== me?.id).length;
  let sekatBelumIndex = -1;
  if (me?.id && belumAwal > 0) {
    let hitung = 0;
    for (let i = pesan.length - 1; i >= 0; i--) {
      if (pesan[i].authorId !== me.id && ++hitung === belumAwal) {
        sekatBelumIndex = i;
        break;
      }
    }
  }

  return (
    <div>
      <h2 className="mb-2 text-2xl font-bold tracking-tight">Chat Internal</h2>
      <p className="mb-4 text-sm text-[var(--text-muted)]">
        Catatan antar-CS soal bookingan. Pesan boleh ditempelkan ke invoice
        tertentu atau dibiarkan bebas.
      </p>

      <form
        onSubmit={kirim}
        className="mb-4 flex flex-col gap-2 rounded-xl border-2 border-solid border-[var(--border-color)] bg-[var(--bg-surface)] p-4 shadow-lg sm:flex-row sm:items-end"
      >
        <label className="flex flex-col gap-1 text-xs font-semibold text-[var(--text-secondary)]">
          Tempel ke invoice
          <select
            value={trxKirim}
            onChange={(e) => setTrxKirim(e.target.value)}
            className="min-w-44 rounded-lg border border-solid border-[var(--border-color)] bg-[var(--bg-body)] px-3 py-2 text-sm text-[var(--text-primary)]"
          >
            <option value="">Tanpa invoice (catatan bebas)</option>
            {daftarInvoice.map((id) => (
              <option key={id} value={id}>
                {labelInvoice(id)}
              </option>
            ))}
          </select>
        </label>
        <textarea
          value={isi}
          onChange={(e) => setIsi(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              kirim(e);
            }
          }}
          rows={2}
          placeholder="Tulis pesan untuk CS lain…"
          className="flex-1 resize-none rounded-lg border border-solid border-[var(--border-color)] bg-[var(--bg-body)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[#7181E0]/40"
        />
        <Button type="submit" disabled={busy || !isi.trim()} loading={busy}>
          Kirim
        </Button>
      </form>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setFilterTrx("")}
          className={`rounded-full border border-solid border-[var(--border-color)] px-3 py-1 text-xs font-semibold transition-colors ${
            filterTrx === ""
              ? "bg-[#7181E0] text-white"
              : "bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:bg-[var(--bg-subtle)]"
          }`}
        >
          Semua
        </button>
        {daftarInvoice.map((id) => {
          const jumlah = jumlahBelumDibaca(id);
          return (
            <button
              key={id}
              type="button"
              onClick={() => setFilterTrx(id)}
              className={`rounded-full border border-solid border-[var(--border-color)] px-3 py-1 text-xs font-semibold transition-colors ${
                filterTrx === id
                  ? "bg-[#7181E0] text-white"
                  : "bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:bg-[var(--bg-subtle)]"
              }`}
            >
              {labelInvoice(id)}
              {jumlah > 0 && (
                <span className="ml-1.5 rounded-full bg-[var(--color-primary-soft,#e0e7ff)] px-1.5 text-[var(--color-primary-soft-text,#4338ca)]">
                  {jumlah}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {error && (
        <p className="mb-3 rounded-lg border border-solid border-[var(--border-color)] bg-[var(--color-danger-soft)] px-3 py-2 text-xs text-[var(--color-danger-text)]">
          {error}
        </p>
      )}

      {memuat && pesan.length === 0 ? (
        <p
          role="status"
          className="py-12 text-center text-sm text-[var(--text-muted)]"
        >
          Memuat chat…
        </p>
      ) : error && pesan.length === 0 ? (
        <ErrorMuat
          onRetry={() => {
            setMemuat(true);
            setReload((r) => r + 1);
          }}
        />
      ) : tampil.length === 0 ? (
        <div className="rounded-xl border-2 border-solid border-[var(--border-color)] bg-[var(--bg-surface)] shadow-lg">
          <EmptyState message="Belum ada pesan." />
        </div>
      ) : (
        <div className="flex flex-col gap-2 rounded-xl border-2 border-solid border-[var(--border-color)] bg-[var(--bg-surface)] p-4 shadow-lg">
          {tampil.map((m, index) => {
            const sendiri = Boolean(me?.id) && m.authorId === me.id;
            return (
              <div key={m.id}>
              {filterTrx === "" && pesan[index]?.id === pesan[sekatBelumIndex]?.id && sekatBelumIndex >= 0 && (
                <div className="flex items-center gap-2 py-1 text-[10px] font-semibold text-[var(--color-danger-text)]">
                  <span className="h-px flex-1 bg-[var(--color-danger-soft)]" />
                  Belum dibaca
                  <span className="h-px flex-1 bg-[var(--color-danger-soft)]" />
                </div>
              )}
              <div
                key={m.id}
                className={`flex flex-col rounded-lg border border-solid border-[var(--border-color)] p-3 ${
                  sendiri
                    ? "bg-[var(--color-primary-soft,#e0e7ff)]"
                    : "bg-[var(--bg-subtle)]"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <span className="text-xs font-bold text-[var(--text-primary)]">
                      {m.authorNama || "-"}
                    </span>
                    <span className="ml-2 text-[10px] text-[var(--text-secondary)]">
                      {formatJam(m.createdAt)}
                    </span>
                    {m.trxId && (
                      <button
                        type="button"
                        onClick={() => setFilterTrx(m.trxId)}
                        className="ml-2 rounded-full border-0 bg-[var(--bg-surface)] px-2 py-0.5 font-mono text-[10px] text-[var(--text-secondary)] hover:bg-[var(--bg-body)]"
                      >
                        {labelInvoice(m.trxId)}
                      </button>
                    )}
                  </div>
                  {bolehHapus(m) && (
                    <button
                      type="button"
                      onClick={() => hapus(m.id)}
                      className="shrink-0 rounded border-0 bg-transparent px-1 text-xs text-[var(--color-danger-text,#dc2626)] hover:bg-[var(--bg-body)]"
                      aria-label="Hapus pesan"
                    >
                      Hapus
                    </button>
                  )}
                </div>
                <p className="mb-0 mt-1 whitespace-pre-wrap break-words text-sm text-[var(--text-primary)]">
                  {m.pesan}
                </p>
              </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
