"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "@/lib/api-client";
import {
  getBlacklist,
  tambahBlacklist,
  ubahBlacklist,
  hapusBlacklist,
} from "@/lib/db";
import { formatTanggal } from "@/lib/utils";
import { ROLE_OWNER, ROLE_SUPERADMIN } from "@/lib/role";
import { useNotify } from "@/components/NotificationProvider";
import LoadingOverlay from "@/components/LoadingOverlay";

const EMPTY = { nama: "", hp: "", alamat: "", alasan: "", fotoJaminan: [] };

// Asal entri: transaksi / member / manual.
function asalEntri(row) {
  if (row.transaksiId) return "Transaksi";
  if (row.memberId) return "Member";
  return "Manual";
}

export default function BlacklistPage() {
  const { notify, confirm: konfirm } = useNotify();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [userRole, setUserRole] = useState("");
  const [query, setQuery] = useState("");
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);

  const bolehEdit = userRole === ROLE_OWNER;
  const bolehTambah = userRole === ROLE_OWNER || userRole === ROLE_SUPERADMIN;

  const muat = async () => {
    setLoading(true);
    try {
      const [me, list] = await Promise.all([
        api.auth.me().catch(() => null),
        getBlacklist(),
      ]);
      setUserRole(me?.user?.role || "");
      setRows(list);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    muat();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter(
      (r) =>
        !q ||
        [r.nama, r.hp].some((v) =>
          String(v || "")
            .toLowerCase()
            .includes(q),
        ),
    );
  }, [rows, query]);

  function bukaTambah() {
    setEditing(null);
    setForm(EMPTY);
    setModal(true);
  }

  function bukaEdit(row) {
    setEditing(row);
    setForm({
      nama: row.nama || "",
      hp: row.hp || "",
      alamat: row.alamat || "",
      alasan: row.alasan || "",
      fotoJaminan: Array.isArray(row.fotoJaminan)
        ? row.fotoJaminan.filter((f) => f?.path)
        : [],
    });
    setModal(true);
  }

  async function simpan() {
    if (!form.nama.trim()) return notify("Nama wajib diisi.", "error");
    if (!form.alasan.trim()) return notify("Alasan wajib diisi.", "error");
    setSaving(true);
    try {
      const payload = {
        nama: form.nama.trim(),
        hp: form.hp || "",
        alamat: form.alamat || "",
        alasan: form.alasan.trim(),
        fotoJaminan: form.fotoJaminan,
      };
      const r = editing
        ? await ubahBlacklist(editing.id, payload)
        : await tambahBlacklist(payload);
      if (!r.ok) {
        return notify(
          r.code === "BLACKLIST_DUPLIKAT" || /duplikat/i.test(r.error || "")
            ? "Penyewa ini sudah ada di blacklist."
            : r.error || "Gagal menyimpan blacklist.",
          "error",
        );
      }
      setModal(false);
      notify(editing ? "Blacklist diperbarui." : "Penyewa ditambahkan ke blacklist.");
      muat();
    } finally {
      setSaving(false);
    }
  }

  async function hapus(row) {
    if (!(await konfirm(`Hapus ${row.nama} dari blacklist?`))) return;
    const r = await hapusBlacklist(row.id);
    if (!r.ok) return notify(r.error || "Gagal menghapus.", "error");
    notify("Entri blacklist dihapus.");
    muat();
  }

  if (loading) return <LoadingOverlay />;

  return (
    <div className="min-h-full">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Blacklist Penyewa</h2>
          <p className="text-sm text-gray-500">
            Daftar penyewa yang diblokir dari booking.
          </p>
        </div>
        {bolehTambah && (
          <button
            type="button"
            onClick={bukaTambah}
            className="rounded-lg border-0 bg-[#F04438] px-4 py-2 text-sm font-semibold text-white hover:bg-[#d03a2f]"
          >
            Tambah Manual
          </button>
        )}
      </div>

      <div className="overflow-hidden rounded-xl bg-white shadow-lg">
        <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-100 p-4">
          <span className="text-xs font-bold uppercase tracking-wide text-slate-600">
            Daftar Blacklist ({filtered.length})
          </span>
          <input
            className="w-full rounded-lg border border-solid border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-[#7181E0] focus:ring-2 focus:ring-[#7181E0]/20 sm:max-w-md"
            placeholder="Cari nama atau HP..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse whitespace-nowrap text-sm">
            <thead className="bg-slate-100 text-xs font-bold uppercase tracking-wide text-slate-600">
              <tr>
                <th className="px-4 py-3 text-left">Nama</th>
                <th className="px-4 py-3 text-left">HP</th>
                <th className="px-4 py-3 text-left">Alasan</th>
                <th className="px-4 py-3 text-left">Asal</th>
                <th className="px-4 py-3 text-left">Tanggal</th>
                <th className="px-4 py-3 text-left">Jaminan</th>
                {bolehEdit && <th className="px-4 py-3 text-left">Aksi</th>}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={bolehEdit ? 7 : 6}>
                    <div className="px-4 py-10 text-center text-sm text-gray-400">
                      Belum ada penyewa di blacklist.
                    </div>
                  </td>
                </tr>
              ) : (
                filtered.map((row) => (
                  <tr key={row.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-semibold text-gray-800">
                      {row.nama}
                    </td>
                    <td className="px-4 py-3">{row.hp || "-"}</td>
                    <td className="max-w-[16rem] whitespace-normal break-words px-4 py-3 text-gray-600">
                      {row.alasan || "-"}
                    </td>
                    <td className="px-4 py-3">
                      <span className="rounded-full bg-gray-100 px-2 py-1 text-xs font-medium text-gray-700">
                        {asalEntri(row)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500">
                      {formatTanggal(row.createdAt)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        {(row.fotoJaminan || []).slice(0, 5).map((f, i) => (
                          <a
                            key={i}
                            href={api.blacklist.photoUrl(f.path)}
                            target="_blank"
                            rel="noreferrer"
                            title={f.label || "Jaminan"}
                            className="block h-9 w-9 overflow-hidden rounded border border-gray-200 bg-gray-50"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={api.blacklist.photoUrl(f.path)}
                              alt={f.label || "Jaminan"}
                              className="h-full w-full object-cover"
                            />
                          </a>
                        ))}
                        {!(row.fotoJaminan || []).length && (
                          <span className="text-xs text-gray-400">-</span>
                        )}
                      </div>
                    </td>
                    {bolehEdit && (
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() => bukaEdit(row)}
                          className="rounded-lg border-0 bg-gray-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-gray-300"
                        >
                          Edit
                        </button>{" "}
                        <button
                          type="button"
                          onClick={() => hapus(row)}
                          className="rounded-lg border-0 bg-[#F04438] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#d03a2f]"
                        >
                          Hapus
                        </button>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {typeof document !== "undefined" &&
        modal &&
        createPortal(
          <div
            className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm"
            onClick={() => setModal(false)}
          >
            <div
              className="relative flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
                <h3 className="m-0 text-lg font-bold">
                  {editing ? "Edit" : "Tambah"} Blacklist
                </h3>
                <button
                  type="button"
                  aria-label="Tutup"
                  onClick={() => setModal(false)}
                  className="flex h-8 w-8 items-center justify-center rounded-lg border-0 bg-gray-100 text-xl text-gray-600 hover:bg-gray-200"
                >
                  ×
                </button>
              </div>
              <div className="flex-1 overflow-y-auto px-6 py-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label className="mb-1.5 block text-sm font-semibold text-slate-700">
                      Nama
                    </label>
                    <input
                      value={form.nama}
                      onChange={(e) => setForm({ ...form, nama: e.target.value })}
                      className="w-full rounded-md border border-solid border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none focus:border-[#7181E0] focus:ring-2 focus:ring-[#7181E0]/20"
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-sm font-semibold text-slate-700">
                      No HP
                    </label>
                    <input
                      value={form.hp}
                      onChange={(e) => setForm({ ...form, hp: e.target.value })}
                      className="w-full rounded-md border border-solid border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none focus:border-[#7181E0] focus:ring-2 focus:ring-[#7181E0]/20"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="mb-1.5 block text-sm font-semibold text-slate-700">
                      Alamat
                    </label>
                    <input
                      value={form.alamat}
                      onChange={(e) =>
                        setForm({ ...form, alamat: e.target.value })
                      }
                      className="w-full rounded-md border border-solid border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none focus:border-[#7181E0] focus:ring-2 focus:ring-[#7181E0]/20"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="mb-1.5 block text-sm font-semibold text-slate-700">
                      Alasan <span className="text-red-500">*</span>
                    </label>
                    <textarea
                      rows={3}
                      value={form.alasan}
                      onChange={(e) =>
                        setForm({ ...form, alasan: e.target.value })
                      }
                      placeholder="Cth: barang tidak dikembalikan, telat berulang, dll."
                      className="w-full rounded-md border border-solid border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none focus:border-[#7181E0] focus:ring-2 focus:ring-[#7181E0]/20"
                    />
                  </div>
                </div>
              </div>
              <div className="flex items-center justify-end gap-3 border-t border-gray-200 px-6 py-4">
                <button
                  type="button"
                  onClick={() => setModal(false)}
                  className="rounded-lg border-0 bg-gray-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-gray-300"
                >
                  Batal
                </button>
                <button
                  type="button"
                  onClick={simpan}
                  disabled={saving}
                  className="rounded-lg border-0 bg-[#F04438] px-4 py-2 text-sm font-semibold text-white hover:bg-[#d03a2f] disabled:opacity-60"
                >
                  {saving ? "Menyimpan..." : "Simpan"}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}