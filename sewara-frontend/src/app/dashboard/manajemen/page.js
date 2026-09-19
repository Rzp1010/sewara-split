"use client";

import { useState, useEffect, useCallback } from "react";
import { toggleActive, unlockUser, createUser, deleteUser, updateUser, listOwners, getAdminLogs, setujuiPendaftaran, tolakPendaftaran, perpanjangLangganan } from "@/lib/db";
import { createPortal } from "react-dom";
import { api } from "@/lib/api-client";
import { LABEL_ROLE, SUPERADMIN_EMAIL } from "@/lib/role";
import { useNotify } from "@/components/NotificationProvider";
import PasswordInput from "@/components/PasswordInput";
import LoadingOverlay from "@/components/LoadingOverlay";

function formatTanggal(iso) {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function ManajemenPage() {
  const { notify, confirm: konfirm } = useNotify();
  const [email, setEmail] = useState("");
  const [owners, setOwners] = useState([]);
  const [logs, setLogs] = useState([]);
  const [tab, setTab] = useState("owners");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [showTambah, setShowTambah] = useState(false);
  const [editAkun, setEditAkun] = useState(null);
  const [editForm, setEditForm] = useState({ nama: "", username: "" });
  const [form, setForm] = useState({
    nama: "",
    emailBaru: "",
    password: "",
    konfirmasi: "",
    username: "",
  });
  const [saving, setSaving] = useState(false);
  const [passForm, setPassForm] = useState({ password: "", konfirmasi: "" });
  const [passAkun, setPassAkun] = useState(null);
  const [editLocks, setEditLocks] = useState({ nama: true, username: true });
  const [kini, setKini] = useState(() => Date.now());
  const [durasiModal, setDurasiModal] = useState(null);

  useEffect(() => {
    const iv = setInterval(() => setKini(Date.now()), 30000);
    return () => clearInterval(iv);
  }, []);

  const muat = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    let userEmail = "";
    try {
      const me = await api.auth.me();
      userEmail = me?.user?.email || "";
    } catch {}
    setEmail(userEmail);
    if (userEmail !== SUPERADMIN_EMAIL) {
      setLoading(false);
      return;
    }
    const [o, l] = await Promise.all([listOwners(), getAdminLogs()]);
    if (!o.ok) setLoadError(o.error || "");
    else setOwners(o.data);
    if (l.ok) setLogs(l.data);
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

  async function ubahAktifOwner(userEmail) {
    const st = owners.find((u) => u.email === userEmail);
    const menonaktifkan = st?.is_active === false ? false : true;
    const ok = await konfirm(
      menonaktifkan
        ? `Nonaktifkan owner:\n\n${userEmail}\n\nAkun tidak bisa login sampai diaktifkan kembali. Lanjut?`
        : `Aktifkan kembali owner:\n\n${userEmail}?`,
    );
    if (!ok) return;
    const hasil = await toggleActive(userEmail);
    if (!hasil.ok) return notify(`Gagal ubah status: ${hasil.error}`, "error");
    setOwners((prev) =>
      prev.map((u) =>
        u.email === userEmail ? { ...u, is_active: !u.is_active } : u,
      ),
    );
    notify("Status owner diubah.");
    muat();
  }

  async function bukaKunciOwner(userEmail) {
    const hasil = await unlockUser(userEmail);
    if (!hasil.ok)
      return notify(`Gagal membuka kunci: ${hasil.error}`, "error");
    notify(`Kunci akun ${userEmail} dibuka.`);
    muat();
  }

  const DURASI_OPT = [1, 3, 6, 12];
  function bukaSetujui(userEmail) {
    setDurasiModal({ email: userEmail, mode: "approve" });
  }
  function bukaPerpanjang(userEmail) {
    setDurasiModal({ email: userEmail, mode: "perpanjang" });
  }
  async function tolakPendaftar(userEmail) {
    const ok = await konfirm(
      `Tolak pendaftaran:\n\n${userEmail}?\n\nAkun akan dinonaktifkan dan tidak bisa login.`,
    );
    if (!ok) return;
    const hasil = await tolakPendaftaran(userEmail);
    if (!hasil.ok)
      return notify(`Gagal menolak pendaftaran: ${hasil.error}`, "error");
    notify("Akun ditolak.");
    muat();
  }
  async function prosesDurasi(d) {
    if (!durasiModal) return;
    const { email, mode } = durasiModal;
    const hasil =
      mode === "approve"
        ? await setujuiPendaftaran(email, d)
        : await perpanjangLangganan(email, d);
    if (!hasil.ok) return notify(`Gagal: ${hasil.error}`, "error");
    notify(mode === "approve" ? "Akun disetujui." : "Langganan diperpanjang.");
    setDurasiModal(null);
    muat();
  }

  async function hapusOwner(userEmail) {
    const ya1 = await konfirm(
      `⚠️ PERINGATAN PERTAMA (1/2)\n\nEmail: ${userEmail}\n\nSeluruh data bisnis (inventaris, transaksi, log) DAN semua stafnya akan dihapus permanen.\n\nLanjut?`,
    );
    if (!ya1) return;
    const ya2 = await konfirm(
      `⚠️ PERINGATAN TERAKHIR (2/2)\n\nEmail: ${userEmail}\n\nIni TIDAK BISA DIKEMBALIKAN.\n\nYakin benar-benar hapus?`,
    );
    if (!ya2) return;
    const hasil = await deleteUser(userEmail);
    if (!hasil.ok) return notify(`Gagal menghapus: ${hasil.error}`, "error");
    notify(`Akun ${userEmail} beserta data & stafnya telah dihapus.`);
    muat();
  }

  async function bukaEdit(u) {
    setEditAkun(u);
    setEditLocks({ nama: true, username: true });
    let nama = u.nama_lengkap || u.nama_invoice || "";
    let username = u.username || u.email || "";
    try {
      const profil = await api.profiles.getByEmail(u.email);
      const data = Array.isArray(profil) ? profil[0] : profil;
      if (data) {
        nama = data.nama_lengkap || data.nama_invoice || nama;
        username =
          data.username ||
          data.nama_lengkap ||
          data.nama_invoice ||
          u.email ||
          "";
      }
    } catch (e) {
      notify("Gagal membaca profil: " + e.message, "error");
    }
    setEditForm({ nama, username });
  }

  function bukaGantiPassword(u) {
    setPassAkun(u);
    setPassForm({ password: "", konfirmasi: "" });
  }

  async function simpanPassword() {
    if (!passAkun) return;
    if (!passForm.password)
      return notify("Password baru wajib diisi!", "error");
    if (passForm.password.length < 8)
      return notify("Password baru minimal 8 karakter!", "error");
    if (passForm.password !== passForm.konfirmasi)
      return notify("Konfirmasi password tidak cocok!", "error");
    setSaving(true);
    const hasil = await updateUser({
      email: passAkun.email,
      password: passForm.password,
    });
    setSaving(false);
    if (!hasil.ok)
      return notify(`Gagal mengubah password: ${hasil.error}`, "error");
    notify(`Password akun ${passAkun.email} berhasil diganti.`);
    setPassAkun(null);
  }

  async function simpanEdit() {
    if (!editAkun) return;
    if (!editForm.nama.trim())
      return notify("Nama lengkap wajib diisi!", "error");
    setSaving(true);
    const hasil = await updateUser({
      email: editAkun.email,
      nama_lengkap: editForm.nama.trim(),
      nama_invoice: editForm.nama.trim(),
      username: editForm.username.trim(),
    });
    setSaving(false);
    if (!hasil.ok) return notify(`Gagal menyimpan: ${hasil.error}`, "error");
    notify(`Akun ${editAkun.email} berhasil diperbarui.`);
    setEditAkun(null);
    muat();
  }

  async function tambahOwner() {
    if (!form.emailBaru.trim()) return notify("Email wajib diisi!", "error");
    if (!form.password) return notify("Password wajib diisi!", "error");
    if (form.password.length < 8)
      return notify("Password minimal 8 karakter!", "error");
    if (form.password !== form.konfirmasi)
      return notify("Konfirmasi password tidak cocok!", "error");
    setSaving(true);
    const hasil = await createUser({
      email: form.emailBaru,
      password: form.password,
      nama_lengkap: form.nama,
      nama_invoice: form.nama,
      role: "owner",
      username: form.username,
    });
    setSaving(false);
    if (!hasil.ok)
      return notify(`Gagal menambah owner: ${hasil.error}`, "error");
    notify("Owner berhasil ditambahkan!");
    setShowTambah(false);
    setForm({
      nama: "",
      emailBaru: "",
      password: "",
      konfirmasi: "",
      username: "",
    });
    muat();
  }

  if (loading) {
    return <LoadingOverlay />;
  }

  if (email !== SUPERADMIN_EMAIL) {
    return (
      <div className="min-h-full bg-surface px-6 py-6 text-center text-text-primary">
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm leading-relaxed text-red-700">
          Halaman ini khusus <strong>Super Admin</strong>. Anda tidak berhak
          mengakses.
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full bg-surface px-4 py-6 text-text-primary sm:px-6 lg:px-8">
      <div className="mb-6 flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold">Manajemen</h2>
          <p className="text-sm text-text-muted mb-0">
            Kelola daftar owner bisnis dan lihat log aktivitas.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setTab("owners")}
            className={`inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium transition px-3 py-1.5 text-xs ${tab === "owners" ? "bg-brand text-white shadow-sm hover:brightness-95" : "border border-border bg-surface-card text-text-primary hover:bg-surface-secondary"}`}
          >
            Owner
          </button>
          <button
            type="button"
            onClick={() => setTab("logs")}
            className={`inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium transition px-3 py-1.5 text-xs ${tab === "logs" ? "bg-brand text-white shadow-sm hover:brightness-95" : "border border-border bg-surface-card text-text-primary hover:bg-surface-secondary"}`}
          >
            Log Aktivitas
          </button>
        </div>
      </div>

      {loadError && (
        <div className="rounded-lg p-4 text-sm leading-relaxed rounded-lg border border-red-200 bg-red-50 p-4 text-red-700 mb-4">
          <p className="font-bold">Gagal memuat data:</p>
          <p className="mt-2 break-all font-mono text-xs">{loadError}</p>
          <button
            type="button"
            onClick={muat}
            className="inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium transition bg-red-500 text-white shadow-sm hover:bg-red-600 px-3 py-1.5 text-xs mt-4"
          >
            Coba Lagi
          </button>
        </div>
      )}

      {tab === "owners" && (
        <>
          <div className="mb-4 flex justify-end">
            <button
              type="button"
              onClick={() => setShowTambah(true)}
              className="inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium transition bg-brand text-white shadow-sm hover:brightness-95"
            >
              + Tambah Owner
            </button>
          </div>
          {(() => {
            const pendaftar = owners.filter((u) => u.status === "menunggu");
            if (pendaftar.length === 0) return null;
            return (
              <div className="rounded-lg border border-border bg-surface-card shadow-sm p-0 mb-4">
                <div className="flex items-center justify-between border-b border-border px-4 py-3">
                  <span className="text-xs font-bold text-text-muted">
                    Pendaftar Baru ({pendaftar.length})
                  </span>
                </div>
                <div className="overflow-x-auto rounded-xl border-2 border-solid border-slate-200 bg-white shadow-lg">
                  <table className="w-full table-fixed border-collapse whitespace-nowrap text-sm">
                    <thead className="bg-slate-100 text-xs font-bold uppercase tracking-wide text-slate-600">
                      <tr>
                        <th className="px-4 py-3 text-left">Nama</th>
                        <th className="px-4 py-3 text-left">Terdaftar</th>
                        <th className="px-4 py-3 text-left">Status</th>
                        <th className="px-4 py-3 text-left">Aksi</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pendaftar.map((u) => (
                        <tr key={u.email} className="hover:bg-slate-50">
                          <td className="px-4 py-3">
                            <p className="font-bold mb-0">
                              {u.nama_lengkap || "-"}
                            </p>
                            <p className="text-xs text-text-muted mb-0">
                              {u.email}
                            </p>
                          </td>
                          <td className="px-4 py-3 text-text-muted">
                            {formatTanggal(u.created_at)}
                          </td>
                          <td className="px-4 py-3">
                            <span className="rounded-full px-3 py-1 text-xs font-semibold bg-amber-100 text-amber-700">
                              Menunggu
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center justify-center gap-2">
                              <button
                                type="button"
                                onClick={() => bukaSetujui(u.email)}
                                className="inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium transition px-3 py-1.5 text-xs bg-brand text-white"
                              >
                                Setujui
                              </button>
                              <button
                                type="button"
                                onClick={() => tolakPendaftar(u.email)}
                                className="inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium transition px-3 py-1.5 text-xs bg-red-500 text-white shadow-sm hover:bg-red-600"
                              >
                                Tolak
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })()}
          <div className="rounded-lg border border-border bg-surface-card shadow-sm p-0">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <span className="text-xs font-bold text-text-muted">
                Daftar Owner ({owners.length})
              </span>
              <button
                type="button"
                onClick={muat}
                disabled={loading}
                className="inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium transition bg-transparent text-text-secondary hover:bg-gray-100 px-3 py-1.5 text-xs"
              >
                ↻ Muat Ulang
              </button>
            </div>
            <div className="overflow-x-auto rounded-xl border-2 border-solid border-slate-200 bg-white shadow-lg">
              <table className="w-full table-fixed border-collapse whitespace-nowrap text-sm">
                <thead className="bg-slate-100 text-xs font-bold uppercase tracking-wide text-slate-600">
                  <tr>
                    <th className="px-4 py-3 text-left">Owner</th>
                    <th className="px-4 py-3 text-left">Staf</th>
                    <th className="px-4 py-3 text-left">Terdaftar</th>
                    <th className="px-4 py-3 text-left">Langganan</th>
                    <th className="px-4 py-3 text-left">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {owners.length === 0 && (
                    <tr>
                      <td colSpan={5}>
                        <div className="py-12 text-center text-sm text-slate-400 italic">
                          Belum ada owner.
                        </div>
                      </td>
                    </tr>
                  )}
                  {owners.map((u) => (
                    <tr key={u.email} className="hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <p className="font-bold mb-0">
                          {u.nama_lengkap || "-"}
                        </p>
                        <p className="text-xs text-text-muted mb-0">
                          {u.email}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-text-secondary">
                        {u.jumlah_staff || 0}
                      </td>
                      <td className="px-4 py-3 text-text-muted">
                        {formatTanggal(u.created_at)}
                      </td>
                      <td className="px-4 py-3 text-text-muted">
                        {u.subscribed_until ? (
                          <div className="flex items-center gap-2">
                            <span>{formatTanggal(u.subscribed_until)}</span>
                            <button
                              type="button"
                              onClick={() => bukaPerpanjang(u.email)}
                              className="inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium transition px-3 py-1.5 text-xs bg-transparent text-text-secondary hover:bg-gray-100"
                            >
                              Perpanjang
                            </button>
                          </div>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-center gap-2">
                          <button
                            type="button"
                            onClick={() => bukaEdit(u)}
                            className="inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium transition px-3 py-1.5 text-xs bg-transparent text-text-secondary hover:bg-gray-100"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => bukaGantiPassword(u)}
                            className="inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium transition px-3 py-1.5 text-xs bg-transparent text-text-secondary hover:bg-gray-100"
                          >
                            Ganti Password
                          </button>
                          {u.locked_until &&
                            new Date(u.locked_until).getTime() > kini && (
                              <>
                                <span className="rounded-full px-3 py-1 text-xs font-semibold bg-red-100 text-red-700">
                                  Terkunci
                                </span>
                                <button
                                  type="button"
                                  onClick={() => bukaKunciOwner(u.email)}
                                  className="inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium transition px-3 py-1.5 text-xs bg-red-500 text-white shadow-sm hover:bg-red-600"
                                >
                                  Buka Kunci
                                </button>
                              </>
                            )}
                          <button
                            type="button"
                            onClick={() => ubahAktifOwner(u.email)}
                            className={`rounded-full px-3 py-1 text-xs font-semibold ${u.is_active === false ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700"}`}
                          >
                            {u.is_active === false ? "Nonaktif" : "Aktif"}
                          </button>
                          {u.is_active === false && (
                            <button
                              type="button"
                              onClick={() => hapusOwner(u.email)}
                              className="inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium transition px-3 py-1.5 text-xs bg-red-500 text-white shadow-sm hover:bg-red-600"
                            >
                              Hapus
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <p className="text-xs text-text-muted mt-4">
            Owner baru memulai bisnis kosong (0 inventaris, 0 transaksi) dan
            bisa membuat staf CS/Gudang sendiri melalui menu SDM. Tombol{" "}
            <strong>Hapus</strong> hanya muncul setelah akun dinonaktifkan,
            dengan konfirmasi dua tahap.
          </p>
        </>
      )}

      {tab === "logs" && (
        <div className="rounded-lg border border-border bg-surface-card shadow-sm p-0">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <span className="text-xs font-bold text-text-muted">
              Log Aktivitas Admin ({logs.length})
            </span>
          </div>
          <div className="overflow-x-auto rounded-xl border-2 border-solid border-slate-200 bg-white shadow-lg">
            <table className="w-full table-fixed border-collapse whitespace-nowrap text-sm">
              <thead className="bg-slate-100 text-xs font-bold uppercase tracking-wide text-slate-600">
                <tr>
                  <th className="px-4 py-3 text-left">Waktu</th>
                  <th className="px-4 py-3 text-left">Pelaku</th>
                  <th className="px-4 py-3 text-left">Aksi</th>
                  <th className="px-4 py-3 text-left">Target</th>
                  <th className="px-4 py-3 text-left">Detail</th>
                </tr>
              </thead>
              <tbody>
                {logs.length === 0 && (
                  <tr>
                    <td colSpan={5}>
                      <div className="py-12 text-center text-sm text-slate-400 italic">
                        Belum ada log.
                      </div>
                    </td>
                  </tr>
                )}
                {logs.map((l, i) => (
                  <tr key={i} className="hover:bg-slate-50">
                    <td className="px-4 py-3 text-text-muted">
                      {formatTanggal(l.created_at)}
                    </td>
                    <td className="px-4 py-3 font-semibold">{l.actor_email}</td>
                    <td className="px-4 py-3">
                      <span className="rounded-full px-3 py-1 text-xs font-semibold bg-indigo-100 text-indigo-700">
                        {l.aksi}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-text-secondary">
                      {l.target_email || "-"}
                    </td>
                    <td className="px-4 py-3 text-text-muted">
                      {l.detail || "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {typeof document !== "undefined" &&
        showTambah &&
        createPortal(
          <div
            onClick={() => setShowTambah(false)}
            className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm"
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="relative flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
            >
              <div className="flex items-center justify-between border-b border-border px-6 py-4">
                <h3 className="text-lg font-bold">Tambah Owner</h3>
                <button
                  type="button"
                  onClick={() => setShowTambah(false)}
                  className="rounded p-1 text-2xl leading-none text-text-muted hover:bg-gray-100"
                >
                  &times;
                </button>
              </div>
              <div className="flex-1 overflow-y-auto px-6 pb-6">
                <p className="text-xs text-text-muted mb-4">
                  Owner baru memulai bisnis kosong dan bisa membuat staf
                  sendiri.
                </p>
                <div className="flex-col gap-3">
                  <div className="block">
                    <label className="mb-1 block text-sm font-medium text-text-primary">
                      Nama
                    </label>
                    <input
                      value={form.nama}
                      onChange={(e) =>
                        setForm({ ...form, nama: e.target.value })
                      }
                      placeholder="mis. Pemilik Bisnis"
                      className="w-full rounded-md border border-border px-3 py-2 text-sm"
                    />
                    <p className="mt-2 text-xs leading-relaxed text-text-muted">
                      Nama ini juga akan tertulis di invoice &amp; riwayat
                      pelayan.
                    </p>
                  </div>
                  <div className="block">
                    <label className="mb-1 block text-sm font-medium text-text-primary">
                      Username
                    </label>
                    <input
                      value={form.username}
                      onChange={(e) =>
                        setForm({ ...form, username: e.target.value })
                      }
                      placeholder="opsional, fallback email"
                      className="w-full rounded-md border border-border px-3 py-2 text-sm"
                    />
                    <p className="mt-2 text-xs leading-relaxed text-text-muted">
                      Ditampilkan di navbar &amp; dropdown profil.
                    </p>
                  </div>
                  <div className="block">
                    <label className="mb-1 block text-sm font-medium text-text-primary">
                      Email (login)
                    </label>
                    <input
                      type="email"
                      value={form.emailBaru}
                      onChange={(e) =>
                        setForm({ ...form, emailBaru: e.target.value })
                      }
                      placeholder="owner@bisnis.com"
                      className="w-full rounded-md border border-border px-3 py-2 text-sm"
                    />
                  </div>
                  <div className="block">
                    <label className="mb-1 block text-sm font-medium text-text-primary">
                      Password Awal
                    </label>
                    <PasswordInput
                      value={form.password}
                      onChange={(e) =>
                        setForm({ ...form, password: e.target.value })
                      }
                      placeholder="minimal 8 karakter"
                      className="text-sm"
                    />
                  </div>
                  <div className="block">
                    <label className="mb-1 block text-sm font-medium text-text-primary">
                      Konfirmasi Password
                    </label>
                    <PasswordInput
                      value={form.konfirmasi}
                      onChange={(e) =>
                        setForm({ ...form, konfirmasi: e.target.value })
                      }
                      placeholder="ulangi password"
                      className="text-sm"
                    />
                  </div>
                </div>
              </div>
              <div className="flex gap-3 border-t border-border p-6">
                <button
                  type="button"
                  onClick={() => setShowTambah(false)}
                  className="inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium transition border border-border bg-surface-card text-text-primary hover:bg-surface-secondary flex-1"
                >
                  Batal
                </button>
                <button
                  type="button"
                  onClick={tambahOwner}
                  disabled={saving}
                  className="inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium transition bg-brand text-white shadow-sm hover:brightness-95 flex-1"
                >
                  {saving ? "Menyimpan..." : "Simpan"}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}

      {typeof document !== "undefined" &&
        editAkun &&
        createPortal(
          <div
            onClick={() => setEditAkun(null)}
            className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm"
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="relative flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
            >
              <div className="flex items-center justify-between border-b border-border px-6 py-4">
                <h3 className="text-lg font-bold">Edit Owner</h3>
                <button
                  type="button"
                  onClick={() => setEditAkun(null)}
                  className="rounded p-1 text-2xl leading-none text-text-muted hover:bg-gray-100"
                >
                  &times;
                </button>
              </div>
              <div className="flex-1 overflow-y-auto px-6 pb-6">
                <div className="flex-col gap-3">
                  <div className="block">
                    <label className="mb-1 block text-sm font-medium text-text-primary">
                      Email (login, tidak bisa diubah)
                    </label>
                    <input
                      value={editAkun.email}
                      disabled
                      className="w-full rounded-md border border-border px-3 py-2 text-sm text-text-muted"
                    />
                  </div>
                  <div className="block">
                    <label className="mb-1 block text-sm font-medium text-text-primary">
                      Nama
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        value={editForm.nama}
                        onChange={(e) =>
                          setEditForm({ ...editForm, nama: e.target.value })
                        }
                        disabled={editLocks.nama}
                        className={`min-w-0 flex-1 rounded-md border border-border px-3 py-2 text-sm ${editLocks.nama ? "cursor-not-allowed bg-gray-100 text-gray-500" : "bg-white text-slate-900"}`}
                      />
                      {editLocks.nama && (
                        <button
                          type="button"
                          onClick={() =>
                            setEditLocks((l) => ({ ...l, nama: false }))
                          }
                          className="inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium transition px-3 py-1.5 text-xs bg-transparent text-text-secondary hover:bg-gray-100"
                        >
                          Edit
                        </button>
                      )}
                    </div>
                    <p className="mt-2 text-xs leading-relaxed text-text-muted">
                      Nama ini juga akan tertulis di invoice &amp; riwayat
                      pelayan.
                    </p>
                  </div>
                  <div className="block">
                    <label className="mb-1 block text-sm font-medium text-text-primary">
                      Username
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        value={editForm.username}
                        onChange={(e) =>
                          setEditForm({ ...editForm, username: e.target.value })
                        }
                        disabled={editLocks.username}
                        className={`min-w-0 flex-1 rounded-md border border-border px-3 py-2 text-sm ${editLocks.username ? "cursor-not-allowed bg-gray-100 text-gray-500" : "bg-white text-slate-900"}`}
                      />
                      {editLocks.username && (
                        <button
                          type="button"
                          onClick={() =>
                            setEditLocks((l) => ({ ...l, username: false }))
                          }
                          className="inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium transition px-3 py-1.5 text-xs bg-transparent text-text-secondary hover:bg-gray-100"
                        >
                          Edit
                        </button>
                      )}
                    </div>
                    <p className="mt-2 text-xs leading-relaxed text-text-muted">
                      Ditampilkan di navbar &amp; dropdown profil.
                    </p>
                  </div>
                </div>
              </div>
              <div className="flex gap-3 border-t border-border p-6">
                <button
                  type="button"
                  onClick={() => setEditAkun(null)}
                  className="inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium transition border border-border bg-surface-card text-text-primary hover:bg-surface-secondary flex-1"
                >
                  Batal
                </button>
                <button
                  type="button"
                  onClick={simpanEdit}
                  disabled={saving}
                  className="inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium transition bg-brand text-white shadow-sm hover:brightness-95 flex-1"
                >
                  {saving ? "Menyimpan..." : "Simpan"}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}

      {typeof document !== "undefined" &&
        passAkun &&
        createPortal(
          <div
            onClick={() => setPassAkun(null)}
            className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm"
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="relative flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
            >
              <div className="flex items-center justify-between border-b border-border px-6 py-4">
                <h3 className="text-lg font-bold">Ganti Password</h3>
                <button
                  type="button"
                  onClick={() => setPassAkun(null)}
                  className="rounded p-1 text-2xl leading-none text-text-muted hover:bg-gray-100"
                >
                  &times;
                </button>
              </div>
              <div className="flex-1 overflow-y-auto px-6 pb-6">
                <div className="flex-col gap-3">
                  <p className="text-sm text-text-secondary mb-2">
                    Akun: <strong>{passAkun.email}</strong>
                  </p>
                  <div className="block">
                    <label className="mb-1 block text-sm font-medium text-text-primary">
                      Password Baru
                    </label>
                    <PasswordInput
                      value={passForm.password}
                      onChange={(e) =>
                        setPassForm({ ...passForm, password: e.target.value })
                      }
                      placeholder="minimal 8 karakter"
                      className="text-sm"
                    />
                  </div>
                  <div className="block">
                    <label className="mb-1 block text-sm font-medium text-text-primary">
                      Konfirmasi Password Baru
                    </label>
                    <PasswordInput
                      value={passForm.konfirmasi}
                      onChange={(e) =>
                        setPassForm({ ...passForm, konfirmasi: e.target.value })
                      }
                      placeholder="ulangi password baru"
                      className="text-sm"
                    />
                  </div>
                </div>
              </div>
              <div className="flex gap-3 border-t border-border p-6">
                <button
                  type="button"
                  onClick={() => setPassAkun(null)}
                  className="inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium transition border border-border bg-surface-card text-text-primary hover:bg-surface-secondary flex-1"
                >
                  Batal
                </button>
                <button
                  type="button"
                  onClick={simpanPassword}
                  disabled={saving}
                  className="inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium transition bg-brand text-white shadow-sm hover:brightness-95 flex-1"
                >
                  {saving ? "Menyimpan..." : "Simpan"}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}

      {typeof document !== "undefined" &&
        durasiModal &&
        createPortal(
          <div
            onClick={() => setDurasiModal(null)}
            className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm"
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="relative flex max-h-[90vh] w-full max-w-sm flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
            >
              <div className="flex items-center justify-between border-b border-border px-6 py-4">
                <h3 className="text-lg font-bold">
                  {durasiModal.mode === "approve"
                    ? "Setujui Pendaftaran"
                    : "Perpanjang Langganan"}
                </h3>
                <button
                  type="button"
                  onClick={() => setDurasiModal(null)}
                  aria-label="Tutup"
                  className="rounded p-1 text-2xl leading-none text-text-muted hover:bg-gray-100"
                >
                  &times;
                </button>
              </div>
              <div className="flex-1 overflow-y-auto px-6 pb-6">
                <p className="text-sm text-text-secondary mb-4">
                  Akun: <strong>{durasiModal.email}</strong>
                  <br />
                  Pilih durasi langganan (bulan):
                </p>
                <div className="grid-cols-2 gap-3">
                  {DURASI_OPT.map((d) => (
                    <button
                      type="button"
                      key={d}
                      onClick={() => prosesDurasi(d)}
                      className="inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium transition bg-brand text-white shadow-sm hover:brightness-95"
                    >
                      {d} Bulan
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
