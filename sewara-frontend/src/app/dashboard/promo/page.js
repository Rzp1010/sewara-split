"use client";

import { useState, useEffect, useCallback } from "react";
import { getPromoCodes, simpanPromo, hapusPromo } from "@/lib/db";
import { createPortal } from "react-dom";
import { api } from "@/lib/api-client";
import { getFITUR } from "@/lib/features";
import { ROLE_OWNER, ROLE_CS } from "@/lib/role";
import { formatTanggal } from "@/lib/utils";
import { useNotify } from "@/components/NotificationProvider";
import LoadingOverlay from "@/components/LoadingOverlay";
import { EmptyState } from "@/components/ui";
import DateTimePicker from "@/components/DateTimePicker";

const FORM_KOSONG = {
  kode: "",
  diskon_persen: "",
  berlaku_dari: null,
  berlaku_sampai: null,
  kuota: "",
  status: "aktif",
};

export default function PromoPage() {
  const { notify, confirm: konfirm } = useNotify();
  const [userRole, setUserRole] = useState("");
  const [memberPromo, setMemberPromo] = useState(true);
  const [promos, setPromos] = useState([]);
  const [loading, setLoading] = useState(true);

  // Modal tambah/edit
  const [showTambah, setShowTambah] = useState(false);
  const [editPromo, setEditPromo] = useState(null);
  const [form, setForm] = useState(FORM_KOSONG);
  const [saving, setSaving] = useState(false);

  const muat = useCallback(async () => {
    setLoading(true);
    const fitur = getFITUR();
    setMemberPromo(fitur.memberPromo);
    // Versi LAMA: tanpa fetch data, tampilkan info alert.
    if (!fitur.memberPromo) {
      setUserRole("");
      setPromos([]);
      setLoading(false);
      return;
    }
    let role = "";
    try {
      const me = await api.auth.me();
      role = me?.user?.role || "";
    } catch {}
    setUserRole(role);
    if (role !== ROLE_OWNER && role !== ROLE_CS) {
      setLoading(false);
      return;
    }
    const hasil = await getPromoCodes();
    setPromos(hasil);
    setLoading(false);
  }, []);

  useEffect(() => {
    let aktif = true;
    (async () => {
      await Promise.resolve();
      if (aktif) muat();
    })();
    return () => {
      aktif = false;
    };
  }, [muat]);

  // ---- CRUD promo ----
  function bukaTambah() {
    setEditPromo(null);
    setForm(FORM_KOSONG);
    setShowTambah(true);
  }

  function bukaEdit(p) {
    setEditPromo(p);
    setForm({
      kode: p.kode || "",
      diskon_persen: p.diskon_persen != null ? String(p.diskon_persen) : "",
      berlaku_dari: p.berlaku_dari ? new Date(p.berlaku_dari) : null,
      berlaku_sampai: p.berlaku_sampai ? new Date(p.berlaku_sampai) : null,
      kuota: p.kuota != null ? String(p.kuota) : "",
      status: p.status || "aktif",
    });
    setShowTambah(true);
  }

  async function simpanPromoForm() {
    const kode = form.kode.trim().toUpperCase();
    if (!kode) return notify("Kode promo wajib diisi!", "error");
    let diskon = parseInt(form.diskon_persen, 10);
    if (Number.isNaN(diskon)) diskon = 0;
    diskon = Math.min(100, Math.max(0, diskon));
    const data = {
      kode,
      diskon_persen: diskon,
      berlaku_dari: form.berlaku_dari ? form.berlaku_dari.toISOString() : null,
      berlaku_sampai: form.berlaku_sampai
        ? form.berlaku_sampai.toISOString()
        : null,
      kuota: form.kuota.trim() === "" ? null : parseInt(form.kuota, 10),
      status: form.status,
    };
    if (editPromo?.id) data.id = editPromo.id;
    setSaving(true);
    const hasil = await simpanPromo(data);
    setSaving(false);
    if (!hasil.ok)
      return notify(`Gagal menyimpan kode promo: ${hasil.error}`, "error");
    notify(editPromo ? "Kode promo diperbarui." : "Kode promo ditambahkan.");
    setShowTambah(false);
    setEditPromo(null);
    setForm(FORM_KOSONG);
    muat();
  }

  async function hapusPromoRow(p) {
    const ya = await konfirm(
      `Hapus kode promo:\n\n${p.kode}\n\nKode promo ini akan dihapus permanen. Lanjut?`,
    );
    if (!ya) return;
    const hasil = await hapusPromo(p.id);
    if (!hasil.ok)
      return notify(`Gagal menghapus kode promo: ${hasil.error}`, "error");
    notify(`Kode promo ${p.kode} dihapus.`);
    muat();
  }

  if (loading) {
    return <LoadingOverlay />;
  }

  // Versi LAMA: fitur tidak tersedia — info alert, tanpa fetch data.
  if (!memberPromo) {
    return (
      <div className="w-full max-w-7xl mx-auto p-6">
        <h2 className="mb-6 text-2xl font-bold tracking-tight leading-tight">
          Kode Promo
        </h2>
        <p className="text-sm text-gray-600 mb-4">
          Atur kode promo dan diskonnya.
        </p>
        <div className="rounded-lg border border-solid border-blue-200 bg-blue-50 p-4 text-sm text-blue-700">
          Fitur Kode Promo hanya tersedia di versi BARU.
        </div>
      </div>
    );
  }

  // Role lain / belum login.
  if (userRole !== ROLE_OWNER && userRole !== ROLE_CS) {
    return (
      <div className="w-full max-w-7xl mx-auto p-6 text-center">
        <div className="rounded-lg border border-solid border-red-200 bg-red-50 p-4 text-sm text-[#F04438]">
          Anda tidak berhak mengakses.
        </div>
      </div>
    );
  }

  const isOwner = userRole === ROLE_OWNER;

  return (
    <div className="w-full max-w-7xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-4 mb-6">
        <div>
          <h2 className="mb-6 text-2xl font-bold tracking-tight leading-tight">
            Kode Promo
          </h2>
          <p className="text-sm text-gray-600 mb-0">
            Atur kode promo dan diskonnya.
          </p>
        </div>
        {isOwner && (
          <button
            type="button"
            onClick={bukaTambah}
            className="rounded-lg border-0 bg-[#7181E0] px-4 py-2 text-sm font-semibold text-white hover:bg-[#5d6fcc]"
          >
            Tambah Promo
          </button>
        )}
      </div>

      <div>
        <div className="flex items-center justify-between p-4">
          <span className="text-xs font-bold text-slate-600">
            Daftar Kode Promo ({promos.length})
          </span>
          <button
            type="button"
            onClick={muat}
            disabled={loading}
            className="rounded-lg border-0 bg-gray-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-gray-300"
          >
            ↻ Muat Ulang
          </button>
        </div>
        <div className="overflow-x-auto rounded-xl border-2 border-solid border-slate-200 bg-white shadow-lg">
          <table className="w-full table-fixed border-collapse whitespace-nowrap text-sm">
            <thead className="bg-slate-100 text-xs font-bold uppercase tracking-wide text-slate-600">
              <tr>
                <th className="px-4 py-3 text-left">Kode</th>
                <th className="px-4 py-3 text-center">Diskon</th>
                <th className="px-4 py-3 text-left">Berlaku</th>
                <th className="px-4 py-3 text-center">Kuota</th>
                <th className="px-4 py-3 text-center">Status</th>
                {isOwner && <th className="px-4 py-3 text-center">Aksi</th>}
              </tr>
            </thead>
            <tbody>
              {promos.length === 0 && (
                <tr>
                  <td colSpan={isOwner ? 6 : 5}>
                    <EmptyState
                      message={`Belum ada kode promo.${isOwner ? ' Klik "+ Tambah Promo" untuk menambahkan.' : ""}`}
                    />
                  </td>
                </tr>
              )}
              {promos.map((p) => (
                <tr
                  key={p.id}
                  className={
                    promos.indexOf(p) % 2 === 0 ? "bg-white" : "bg-slate-50"
                  }
                >
                  <td className="px-4 py-3">
                    <span className="rounded-full px-3 py-1 text-xs font-semibold bg-blue-100 text-blue-700 font-mono">
                      {p.kode}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    {p.diskon_persen != null ? `${p.diskon_persen}%` : "0%"}
                  </td>
                  <td className="px-4 py-3">
                    {p.berlaku_dari || p.berlaku_sampai ? (
                      <span className="text-sm">
                        {formatTanggal(p.berlaku_dari)} →{" "}
                        {formatTanggal(p.berlaku_sampai)}
                      </span>
                    ) : (
                      <span className="text-sm text-slate-600">
                        Tanpa batas
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {p.terpakai || 0}/{p.kuota != null ? p.kuota : "∞"}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {p.status === "expired" ? (
                      <span className="rounded-full px-3 py-1 text-xs font-semibold bg-gray-100 text-slate-700">
                        Expired
                      </span>
                    ) : p.status === "aktif" ? (
                      <span className="rounded-full px-3 py-1 text-xs font-semibold bg-green-100 text-[#579171]">
                        Aktif
                      </span>
                    ) : (
                      <span className="rounded-full px-3 py-1 text-xs font-semibold bg-gray-100 text-slate-700">
                        Nonaktif
                      </span>
                    )}
                  </td>
                  {isOwner && (
                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center gap-2">
                        <button
                          type="button"
                          onClick={() => bukaEdit(p)}
                          disabled={p.status === "expired"}
                          className="rounded-lg border-0 bg-[#7181E0] px-4 py-2 text-sm font-semibold text-white hover:bg-[#5d6fcc]"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => hapusPromoRow(p)}
                          className="rounded-lg border-0 bg-[#F04438] px-4 py-2 text-sm font-semibold text-white hover:bg-[#d03a2f]"
                        >
                          Hapus
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {typeof document !== "undefined" &&
        showTambah &&
        isOwner &&
        createPortal(
          <div
            onClick={() => setShowTambah(false)}
            className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm"
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="relative flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-xl border-2 border-solid border-slate-200 bg-white shadow-2xl"
            >
              <div className="flex items-center justify-between border-b border-solid border-slate-200 p-6">
                <h3 className="text-lg font-bold text-slate-800">
                  {editPromo ? "Edit Kode Promo" : "Tambah Kode Promo"}
                </h3>
                <button
                  type="button"
                  aria-label="Tutup modal"
                  onClick={() => setShowTambah(false)}
                  className="text-2xl text-slate-600 hover:text-slate-900"
                >
                  &times;
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-6 space-y-4">
                <div className="space-y-2">
                  <div className="space-y-2">
                    <label className="block text-xs font-bold text-slate-700 mb-2">
                      Kode
                    </label>
                    <input
                      value={form.kode}
                      onChange={(e) =>
                        setForm({ ...form, kode: e.target.value.toUpperCase() })
                      }
                      placeholder="mis. HEMAT50"
                      className="rounded-md border border-solid border-gray-300 px-3 py-2.5 text-sm focus:border-[#7181E0] focus:ring-2 focus:ring-[#7181E0]/20"
                    />
                    <p className="text-xs text-slate-600">
                      Disimpan otomatis dalam huruf besar (uppercase).
                    </p>
                  </div>
                  <div className="space-y-2">
                    <label className="block text-xs font-bold text-slate-700 mb-2">
                      Diskon (%)
                    </label>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={form.diskon_persen}
                      onChange={(e) => {
                        let v = e.target.value.replace(/\D/g, "");
                        if (v !== "" && parseInt(v, 10) > 100) v = "100";
                        setForm({ ...form, diskon_persen: v });
                      }}
                      placeholder="mis. 25"
                      className="rounded-md border border-solid border-gray-300 px-3 py-2.5 text-sm focus:border-[#7181E0] focus:ring-2 focus:ring-[#7181E0]/20"
                    />
                    <p className="text-xs text-slate-600">
                      Potongan harga, 0–100%.
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="block text-xs font-bold text-slate-700 mb-2">
                        Berlaku dari
                      </label>
                      <div className="flex items-center gap-2">
                        <div className="flex-1">
                          <DateTimePicker
                            value={form.berlaku_dari}
                            onChange={(d) =>
                              setForm({ ...form, berlaku_dari: d })
                            }
                            showTime
                            placeholder="Pilih tgl & jam"
                          />
                        </div>
                        {form.berlaku_dari && (
                          <button
                            type="button"
                            onClick={() =>
                              setForm({ ...form, berlaku_dari: null })
                            }
                            className="shrink-0 rounded-lg border-0 bg-gray-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-gray-300"
                          >
                            Hapus
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="space-y-2">
                      <label className="block text-xs font-bold text-slate-700 mb-2">
                        Berlaku sampai
                      </label>
                      <div className="flex items-center gap-2">
                        <div className="flex-1">
                          <DateTimePicker
                            value={form.berlaku_sampai}
                            onChange={(d) =>
                              setForm({ ...form, berlaku_sampai: d })
                            }
                            minDate={form.berlaku_dari || undefined}
                            showTime
                            placeholder="Pilih tgl & jam"
                          />
                        </div>
                        {form.berlaku_sampai && (
                          <button
                            type="button"
                            onClick={() =>
                              setForm({ ...form, berlaku_sampai: null })
                            }
                            className="shrink-0 rounded-lg border-0 bg-gray-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-gray-300"
                          >
                            Hapus
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                  <p className="text-xs text-slate-600 mb-0 -mt-2">
                    Kosongkan tanggal = berlaku tanpa batas waktu.
                  </p>
                  <div className="space-y-2">
                    <label className="block text-xs font-bold text-slate-700 mb-2">
                      Kuota Pemakaian
                    </label>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={form.kuota}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          kuota: e.target.value.replace(/\D/g, ""),
                        })
                      }
                      placeholder="mis. 100"
                      className="rounded-md border border-solid border-gray-300 px-3 py-2.5 text-sm focus:border-[#7181E0] focus:ring-2 focus:ring-[#7181E0]/20"
                    />
                    <p className="text-xs text-slate-600">
                      Batas maksimal pemakaian. Kosongkan = tanpa batas (∞).
                    </p>
                  </div>
                  <div className="space-y-2">
                    <label className="block text-xs font-bold text-slate-700 mb-2">
                      Status
                    </label>
                    <select
                      value={form.status}
                      onChange={(e) =>
                        setForm({ ...form, status: e.target.value })
                      }
                      className="rounded-md border border-solid border-gray-300 px-3 py-2.5 text-sm focus:border-[#7181E0] focus:ring-2 focus:ring-[#7181E0]/20"
                    >
                      <option value="aktif">Aktif</option>
                      <option value="nonaktif">Nonaktif</option>
                    </select>
                  </div>
                </div>
              </div>
              <div className="flex items-center justify-end gap-3 border-t border-solid border-slate-200 p-6">
                <button
                  type="button"
                  onClick={() => setShowTambah(false)}
                  className="flex-1 rounded-lg border-0 bg-gray-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-gray-300"
                >
                  Batal
                </button>
                <button
                  type="button"
                  onClick={simpanPromoForm}
                  disabled={saving}
                  className="flex-1 rounded-lg border-0 bg-[#7181E0] px-4 py-2 text-sm font-semibold text-white hover:bg-[#5d6fcc]"
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
