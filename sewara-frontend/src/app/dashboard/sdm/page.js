"use client";
import { useState, useEffect, useCallback } from "react";
import { setRole, toggleActive, unlockUser, createUser, deleteUser, updateUser, listStaff } from "@/lib/db";
import { createPortal } from "react-dom";
import { api } from "@/lib/api-client";
import { ROLE_OWNER, ROLE_CS, ROLE_GUDANG } from "@/lib/role";
import { useNotify } from "@/components/NotificationProvider";
import PasswordInput from "@/components/PasswordInput";
import LoadingOverlay from "@/components/LoadingOverlay";
import { EmptyState } from "@/components/ui";
const OPSI_ROLE = [
  {
    value: ROLE_CS,
    label: "CS",
    desc: "Booking, status sewa, riwayat, kalender, laporan",
  },
  {
    value: ROLE_GUDANG,
    label: "Gudang",
    desc: "Katalog & inventaris, tracking, log S/N",
  },
];
export default function SDMPage() {
  const { notify, confirm: konfirm } = useNotify();
  const [userRole, setUserRole] = useState("");
  const [staff, setStaff] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [showTambah, setShowTambah] = useState(false);
  const [editAkun, setEditAkun] = useState(null);
  const [editForm, setEditForm] = useState({
    nama: "",
    username: "",
    role: ROLE_CS,
  });
  const [form, setForm] = useState({
    nama: "",
    emailBaru: "",
    password: "",
    konfirmasi: "",
    role: ROLE_CS,
    username: "",
  });
  const [saving, setSaving] = useState(false);
  const [passForm, setPassForm] = useState({ password: "", konfirmasi: "" });
  const [passAkun, setPassAkun] = useState(null);
  const [editLocks, setEditLocks] = useState({ nama: true, username: true });
  const [deletingEmail, setDeletingEmail] = useState(null);
  const [kini, setKini] = useState(() => Date.now());
  useEffect(() => {
    const iv = setInterval(() => setKini(Date.now()), 30000);
    return () => clearInterval(iv);
  }, []);
  const muat = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    let role = "";
    try {
      const me = await api.auth.me();
      role = me?.user?.role || "";
    } catch {}
    setUserRole(role);
    if (role !== ROLE_OWNER) {
      setLoading(false);
      return;
    }
    const hasil = await listStaff();
    if (!hasil.ok) {
      setLoadError(hasil.error);
      setStaff([]);
    } else {
      setStaff(hasil.data);
    }
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
  async function ubahAktif(userEmail) {
    const st = staff.find((u) => u.email === userEmail);
    const menonaktifkan = st?.is_active === false ? false : true;
    const ok = await konfirm(
      menonaktifkan
        ? `Nonaktifkan akun:\n\n${userEmail}\n\nAkun tidak bisa masuk dashboard sampai diaktifkan kembali. Lanjut?`
        : `Aktifkan kembali akun:\n\n${userEmail}?`,
    );
    if (!ok) return;
    const hasil = await toggleActive(userEmail);
    if (!hasil.ok) return notify(`Gagal ubah status: ${hasil.error}`, "error");
    setStaff((prev) =>
      prev.map((u) =>
        u.email === userEmail ? { ...u, is_active: !u.is_active } : u,
      ),
    );
    notify("Status staf diubah.");
  }
  async function bukaKunciStaf(userEmail) {
    const hasil = await unlockUser(userEmail);
    if (!hasil.ok)
      return notify(`Gagal membuka kunci: ${hasil.error}`, "error");
    notify(`Kunci akun ${userEmail} dibuka.`);
    muat();
  }
  const hapusStaf = useCallback(
    async (userEmail) => {
      if (deletingEmail) return;
      const ya = await konfirm(
        `HAPUS PERMANEN:\n\nEmail: ${userEmail}\n\nAkun staf ini akan dihapus (data bisnis Anda tetap aman). TIDAK BISA DIKEMBALIKAN.\n\nLanjut?`,
      );
      if (!ya) return;
      setDeletingEmail(userEmail);
      try {
        const hasil = await deleteUser(userEmail);
        if (!hasil.ok) {
          notify(`Gagal menghapus: ${hasil.error}`, "error");
          return;
        }
        notify(`Staf ${userEmail} telah dihapus.`);
        await muat();
      } finally {
        setDeletingEmail(null);
      }
    },
    [deletingEmail, konfirm, notify, muat],
  );
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
    setEditForm({ nama, username, role: u.role || ROLE_CS });
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
    if (!hasil.ok) {
      setSaving(false);
      return notify(`Gagal menyimpan: ${hasil.error}`, "error");
    }
    if (editForm.role !== (editAkun.role || ROLE_CS)) {
      const hasilRole = await setRole(editAkun.email, editForm.role);
      if (!hasilRole.ok) {
        setSaving(false);
        return notify(
          `Profil tersimpan, tapi gagal ubah role: ${hasilRole.error}`,
          "error",
        );
      }
    }
    setSaving(false);
    notify(`Akun ${editAkun.email} berhasil diperbarui.`);
    setEditAkun(null);
    muat();
  }
  async function tambahStaf() {
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
      role: form.role,
      username: form.username,
    });
    setSaving(false);
    if (!hasil.ok)
      return notify(`Gagal menambah staf: ${hasil.error}`, "error");
    notify("Staf berhasil ditambahkan!");
    setShowTambah(false);
    setForm({
      nama: "",
      emailBaru: "",
      password: "",
      konfirmasi: "",
      role: ROLE_CS,
      username: "",
    });
    muat();
  }
  if (loading) {
    return <LoadingOverlay />;
  }
  if (userRole !== ROLE_OWNER) {
    return (
      <div className="w-full max-w-7xl mx-auto p-6 text-center">
        {" "}
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-red-700 dark:text-red-300">
          {" "}
          Halaman ini khusus <strong>Owner</strong>. Anda tidak berhak
          mengakses.{" "}
        </div>{" "}
      </div>
    );
  }
  return (
    <div className="w-full max-w-7xl mx-auto">
      {" "}
      <div className="flex items-center justify-between flex-wrap gap-4 mb-6">
        {" "}
        <div>
          {" "}
          <h2 className="text-2xl font-bold">Manajemen Karyawan</h2>{" "}
          <p className="text-slate-600 mb-0">
            Kelola staf CS &amp; Gudang di bisnis Anda. Staf melihat data bisnis
            yang sama dengan Anda.
          </p>{" "}
        </div>{" "}
        <button
          type="button"
          onClick={() => setShowTambah(true)}
          className="rounded-lg border-0 bg-[#7181E0] px-4 py-2 text-sm font-semibold text-white hover:bg-[#5d6fcc]"
        >
          Tambah Staf
        </button>{" "}
      </div>{" "}
      {loadError && (
        <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-red-700 dark:text-red-300">
          {" "}
          <p className="font-bold">Gagal memuat daftar staf:</p>{" "}
          <p className="text-xs mt-2 break-all font-mono">{loadError}</p>{" "}
          <p className="text-xs mt-2">
            Pastikan SQL migrasi{" "}
            <code className="text-xs">migration_daftar_langganan.sql</code>{" "}
            sudah
          </p>{" "}
          <button
            type="button"
            onClick={muat}
            className="rounded-lg border-0 bg-gray-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-gray-300 mt-4"
          >
            Coba Lagi
          </button>{" "}
        </div>
      )}{" "}
      <div className="p-0">
        {" "}
        <div className="flex items-center justify-between gap-3 p-4">
          {" "}
          <span className="text-xs font-bold text-slate-600">
            Daftar Staf ({staff.length})
          </span>{" "}
          <button
            type="button"
            onClick={muat}
            disabled={loading}
            className="rounded-lg border-0 bg-gray-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-gray-300 disabled:cursor-not-allowed"
          >
            ↻ Muat Ulang
          </button>{" "}
        </div>{" "}
        <div className="overflow-x-auto rounded-xl border-2 border-solid border-slate-200 bg-white shadow-lg">
          <table className="w-full table-fixed border-collapse whitespace-nowrap text-sm">
            <thead className="bg-slate-100 text-xs font-bold uppercase tracking-wide text-slate-600">
              <tr>
                <th className="px-4 py-3 text-left">Staf</th>
                <th className="px-4 py-3 text-left">Role</th>
                <th className="px-4 py-3 text-center">Status</th>
              </tr>
            </thead>
            <tbody>
              {staff.length === 0 && (
                <tr>
                  <td colSpan={3}>
                    <EmptyState message='Belum ada staf. Klik "+ Tambah Staf" untuk membuat CS atau Gudang.' />
                  </td>
                </tr>
              )}
              {staff.map((u, idx) => {
                const isEven = idx % 2 === 0;
                return (
                  <tr
                    key={u.email}
                    className={isEven ? "bg-white" : "bg-slate-50"}
                  >
                    <td className="px-4 py-3">
                      <p className="mb-0 font-bold">{u.nama_lengkap || "-"}</p>
                      <p className="mb-0 text-xs text-slate-600">{u.email}</p>
                    </td>
                    <td className="px-4 py-3">
                      <span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-semibold text-[#7181E0]">
                        {OPSI_ROLE.find((r) => r.value === u.role)?.label ||
                          u.role ||
                          "CS"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-2">
                        <button
                          type="button"
                          onClick={() => bukaEdit(u)}
                          className="rounded-lg border-0 bg-gray-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-gray-300"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => bukaGantiPassword(u)}
                          className="rounded-lg border-0 bg-gray-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-gray-300"
                        >
                          Ganti Password
                        </button>
                        {u.locked_until &&
                          new Date(u.locked_until).getTime() > kini && (
                            <>
                              <span className="inline-block rounded-full bg-red-500/10 px-2 py-1 text-red-700 dark:text-red-300">
                                Terkunci
                              </span>
                              <button
                                type="button"
                                onClick={() => bukaKunciStaf(u.email)}
                                className="rounded-lg border-0 bg-[#F04438] px-4 py-2 text-sm font-semibold text-white hover:bg-[#d03a2f]"
                              >
                                Buka Kunci
                              </button>
                            </>
                          )}
                        <button
                          type="button"
                          onClick={() => ubahAktif(u.email)}
                          className={`rounded-lg border-0 px-3 py-2 text-xs font-semibold ${
                            u.is_active === false
                              ? "bg-red-100 text-[#F04438]"
                              : "bg-green-100 text-[#579171]"
                          }`}
                        >
                          {u.is_active === false ? "Nonaktif" : "Aktif"}
                        </button>
                        <button
                          type="button"
                          onClick={() => hapusStaf(u.email)}
                          disabled={deletingEmail === u.email}
                          className="rounded-lg border-0 bg-[#F04438] px-4 py-2 text-sm font-semibold text-white hover:bg-[#d03a2f]"
                        >
                          Hapus
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>{" "}
      </div>{" "}
      <p className="text-xs text-slate-600 mt-4">
        {" "}
        Akun staf yang dinonaktifkan tidak bisa masuk dashboard sampai
        diaktifkan kembali.{" "}
      </p>{" "}
      {typeof document !== "undefined" &&
        showTambah &&
        createPortal(
          <div
            onClick={() => setShowTambah(false)}
            className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm"
          >
            {" "}
            <div
              onClick={(e) => e.stopPropagation()}
              className="relative flex max-h-[90vh] w-full flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
            >
              {" "}
              <div className="flex items-center justify-between px-6 pb-4 pt-6">
                {" "}
                <h3 className="text-lg font-bold">Tambah Staf</h3>{" "}
                <button
                  type="button"
                  onClick={() => setShowTambah(false)}
                  className="rounded-lg border-0 bg-transparent hover:bg-gray-100 px-2 py-2 text-xl text-slate-600 transition-colors"
                >
                  &times;
                </button>{" "}
              </div>{" "}
              <div className="flex-1 overflow-y-auto px-6 pb-6">
                {" "}
                <div className="flex flex-col gap-4">
                  {" "}
                  <div className="block">
                    {" "}
                    <label className="block text-xs font-bold text-slate-700 mb-2">
                      Nama
                    </label>{" "}
                    <input
                      value={form.nama}
                      onChange={(e) =>
                        setForm({ ...form, nama: e.target.value })
                      }
                      placeholder="mis. Budi Santoso"
                      className="w-full rounded-md border border-solid border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-[#7181E0] focus:ring-2 focus:ring-[#7181E0]/20 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:opacity-60"
                    />{" "}
                    <p className="text-xs text-slate-600 mt-2 leading-normal">
                      Nama ini juga akan tertulis di invoice &amp; riwayat
                      pelayan.
                    </p>{" "}
                  </div>{" "}
                  <div className="block">
                    {" "}
                    <label className="block text-xs font-bold text-slate-700 mb-2">
                      Username
                    </label>{" "}
                    <input
                      value={form.username}
                      onChange={(e) =>
                        setForm({ ...form, username: e.target.value })
                      }
                      placeholder="opsional, fallback email"
                      className="w-full rounded-md border border-solid border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-[#7181E0] focus:ring-2 focus:ring-[#7181E0]/20 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:opacity-60"
                    />{" "}
                    <p className="text-xs text-slate-600 mt-2 leading-normal">
                      Ditampilkan di navbar &amp; dropdown profil.
                    </p>{" "}
                  </div>{" "}
                  <div className="block">
                    {" "}
                    <label className="block text-xs font-bold text-slate-700 mb-2">
                      Email (login)
                    </label>{" "}
                    <input
                      type="email"
                      value={form.emailBaru}
                      onChange={(e) =>
                        setForm({ ...form, emailBaru: e.target.value })
                      }
                      placeholder="nama@contoh.com"
                      className="w-full rounded-md border border-solid border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-[#7181E0] focus:ring-2 focus:ring-[#7181E0]/20 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:opacity-60"
                    />{" "}
                  </div>{" "}
                  <div className="block">
                    {" "}
                    <label className="block text-xs font-bold text-slate-700 mb-2">
                      Password Awal
                    </label>{" "}
                    <PasswordInput
                      value={form.password}
                      onChange={(e) =>
                        setForm({ ...form, password: e.target.value })
                      }
                      placeholder="minimal 8 karakter"
                      className="rounded-md border border-solid border-gray-300 bg-white px-3 py-2.5 pr-12 text-sm text-gray-900 outline-none transition focus:border-[#7181E0] focus:ring-2 focus:ring-[#7181E0]/20 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:opacity-60"
                    />{" "}
                  </div>{" "}
                  <div className="block">
                    {" "}
                    <label className="block text-xs font-bold text-slate-700 mb-2">
                      Konfirmasi Password
                    </label>{" "}
                    <PasswordInput
                      value={form.konfirmasi}
                      onChange={(e) =>
                        setForm({ ...form, konfirmasi: e.target.value })
                      }
                      placeholder="ulangi password"
                      className="rounded-md border border-solid border-gray-300 bg-white px-3 py-2.5 pr-12 text-sm text-gray-900 outline-none transition focus:border-[#7181E0] focus:ring-2 focus:ring-[#7181E0]/20 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:opacity-60"
                    />{" "}
                  </div>{" "}
                  <div className="block">
                    {" "}
                    <label className="block text-xs font-bold text-slate-700 mb-2">
                      Role
                    </label>{" "}
                    <div className="flex-col gap-2 mt-2">
                      {" "}
                      {OPSI_ROLE.map((r) => (
                        <label
                          key={r.value}
                          className="flex items-start gap-2 rounded-lg border border-solid border-slate-200 bg-white p-3 text-sm cursor-pointer hover:bg-slate-50 transition-colors"
                        >
                          {" "}
                          <input
                            type="radio"
                            name="role_baru"
                            checked={form.role === r.value}
                            onChange={() => setForm({ ...form, role: r.value })}
                            className="mt-0.5 h-4 w-4 accent-[#7181E0]"
                          />{" "}
                          <span>
                            {" "}
                            <span className="font-bold">{r.label}</span>{" "}
                            <span className="text-xs text-slate-600">
                              {r.desc}
                            </span>{" "}
                          </span>{" "}
                        </label>
                      ))}{" "}
                    </div>{" "}
                  </div>{" "}
                </div>{" "}
              </div>{" "}
              <div className="flex gap-2 px-6 pb-6 pt-4">
                {" "}
                <button
                  type="button"
                  onClick={() => setShowTambah(false)}
                  className="rounded-lg border-0 bg-gray-200 hover:bg-gray-300 px-4 py-2 text-sm font-semibold text-slate-700 transition-colors flex-1"
                >
                  Batal
                </button>{" "}
                <button
                  type="button"
                  onClick={tambahStaf}
                  disabled={saving}
                  className="rounded-lg border-0 bg-[#7181E0] hover:bg-[#5d6fcc] px-4 py-2 text-sm font-semibold text-white transition-colors flex-1"
                >
                  {" "}
                  {saving ? "Menyimpan..." : "Simpan"}{" "}
                </button>{" "}
              </div>{" "}
            </div>{" "}
          </div>,
          document.body,
        )}{" "}
      {typeof document !== "undefined" &&
        editAkun &&
        createPortal(
          <div
            onClick={() => setEditAkun(null)}
            className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm"
          >
            {" "}
            <div
              onClick={(e) => e.stopPropagation()}
              className="relative flex max-h-[90vh] w-full flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
            >
              {" "}
              <div className="flex items-center justify-between px-6 pb-4 pt-6">
                {" "}
                <h3 className="text-lg font-bold">Edit Staf</h3>{" "}
                <button
                  type="button"
                  onClick={() => setEditAkun(null)}
                  className="rounded-lg border-0 bg-transparent hover:bg-gray-100 px-2 py-2 text-xl text-slate-600 transition-colors"
                >
                  &times;
                </button>{" "}
              </div>{" "}
              <div className="flex-1 overflow-y-auto px-6 pb-6">
                {" "}
                <div className="flex flex-col gap-4">
                  {" "}
                  <div className="block">
                    {" "}
                    <label className="block text-xs font-bold text-slate-700 mb-2">
                      Email (login, tidak bisa diubah)
                    </label>{" "}
                    <input
                      value={editAkun.email}
                      readOnly
                      className="w-full rounded-md border border-solid border-gray-300 bg-slate-100 px-3 py-2.5 text-sm text-slate-600 outline-none cursor-not-allowed"
                    />{" "}
                  </div>{" "}
                  <div className="block">
                    {" "}
                    <label className="block text-xs font-bold text-slate-700 mb-2">
                      Nama
                    </label>{" "}
                    <div
                      className="flex items-center gap-2"
                      style={{ alignItems: "center" }}
                    >
                      {" "}
                      <input
                        value={editForm.nama}
                        onChange={(e) =>
                          setEditForm({ ...editForm, nama: e.target.value })
                        }
                        disabled={editLocks.nama}
                        className="w-full rounded-md border border-solid border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-[#7181E0] focus:ring-2 focus:ring-[#7181E0]/20 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:opacity-60"
                        style={{
                          flex: 1,
                          ...(editLocks.nama
                            ? {
                                background: "#F8FAFC",
                                color: "#64748B",
                                cursor: "not-allowed",
                              }
                            : {}),
                        }}
                      />{" "}
                      {editLocks.nama && (
                        <button
                          type="button"
                          onClick={() =>
                            setEditLocks((l) => ({ ...l, nama: false }))
                          }
                          className="rounded-lg border-0 bg-transparent hover:bg-gray-100 px-3 py-2 text-xs font-semibold text-slate-600 transition-colors flex-shrink-0"
                        >
                          Edit
                        </button>
                      )}{" "}
                    </div>{" "}
                    <p className="text-xs text-slate-600 mt-2 leading-normal">
                      Nama ini juga akan tertulis di invoice &amp; riwayat
                      pelayan.
                    </p>{" "}
                  </div>{" "}
                  <div className="block">
                    {" "}
                    <label className="block text-xs font-bold text-slate-700 mb-2">
                      Username
                    </label>{" "}
                    <div
                      className="flex items-center gap-2"
                      style={{ alignItems: "center" }}
                    >
                      {" "}
                      <input
                        value={editForm.username}
                        onChange={(e) =>
                          setEditForm({ ...editForm, username: e.target.value })
                        }
                        disabled={editLocks.username}
                        className="w-full rounded-md border border-solid border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-[#7181E0] focus:ring-2 focus:ring-[#7181E0]/20 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:opacity-60"
                        style={{
                          flex: 1,
                          ...(editLocks.username
                            ? {
                                background: "#F8FAFC",
                                color: "#64748B",
                                cursor: "not-allowed",
                              }
                            : {}),
                        }}
                      />{" "}
                      {editLocks.username && (
                        <button
                          type="button"
                          onClick={() =>
                            setEditLocks((l) => ({ ...l, username: false }))
                          }
                          className="rounded-lg border-0 bg-transparent hover:bg-gray-100 px-3 py-2 text-xs font-semibold text-slate-600 transition-colors flex-shrink-0"
                        >
                          Edit
                        </button>
                      )}{" "}
                    </div>{" "}
                    <p className="text-xs text-slate-600 mt-2 leading-normal">
                      Ditampilkan di navbar &amp; dropdown profil.
                    </p>{" "}
                  </div>{" "}
                  <div className="block">
                    {" "}
                    <label className="block text-xs font-bold text-slate-700 mb-2">
                      Role
                    </label>{" "}
                    <div className="flex-col gap-2 mt-2">
                      {" "}
                      {OPSI_ROLE.map((r) => (
                        <label
                          key={r.value}
                          className="flex items-start gap-2 rounded-lg border border-solid border-slate-200 bg-white p-3 text-sm cursor-pointer hover:bg-slate-50 transition-colors"
                        >
                          {" "}
                          <input
                            type="radio"
                            name="role_edit"
                            checked={editForm.role === r.value}
                            onChange={() =>
                              setEditForm({ ...editForm, role: r.value })
                            }
                            className="mt-0.5 h-4 w-4 accent-[#7181E0]"
                          />{" "}
                          <span>
                            {" "}
                            <span className="font-bold">{r.label}</span>{" "}
                            <span className="text-xs text-slate-600">
                              {r.desc}
                            </span>{" "}
                          </span>{" "}
                        </label>
                      ))}{" "}
                    </div>{" "}
                  </div>{" "}
                </div>{" "}
              </div>{" "}
              <div className="flex gap-2 px-6 pb-6 pt-4">
                {" "}
                <button
                  type="button"
                  onClick={() => setEditAkun(null)}
                  className="rounded-lg border-0 bg-gray-200 hover:bg-gray-300 px-4 py-2 text-sm font-semibold text-slate-700 transition-colors flex-1"
                >
                  Batal
                </button>{" "}
                <button
                  type="button"
                  onClick={simpanEdit}
                  disabled={saving}
                  className="rounded-lg border-0 bg-[#7181E0] hover:bg-[#5d6fcc] px-4 py-2 text-sm font-semibold text-white transition-colors flex-1"
                >
                  {" "}
                  {saving ? "Menyimpan..." : "Simpan"}{" "}
                </button>{" "}
              </div>{" "}
            </div>{" "}
          </div>,
          document.body,
        )}{" "}
      {typeof document !== "undefined" &&
        passAkun &&
        createPortal(
          <div
            onClick={() => setPassAkun(null)}
            className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm"
          >
            {" "}
            <div
              onClick={(e) => e.stopPropagation()}
              className="relative flex max-h-[90vh] w-full flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
            >
              {" "}
              <div className="flex items-center justify-between px-6 pb-4 pt-6">
                {" "}
                <h3 className="text-lg font-bold">Ganti Password</h3>{" "}
                <button
                  type="button"
                  onClick={() => setPassAkun(null)}
                  className="rounded-lg border-0 bg-transparent hover:bg-gray-100 px-2 py-2 text-xl text-slate-600 transition-colors"
                >
                  &times;
                </button>{" "}
              </div>{" "}
              <div className="flex-1 overflow-y-auto px-6 pb-6">
                {" "}
                <div className="flex flex-col gap-4">
                  {" "}
                  <p className="text-sm text-slate-700 mb-2">
                    Akun: <strong>{passAkun.email}</strong>
                  </p>{" "}
                  <div className="block">
                    {" "}
                    <label className="block text-xs font-bold text-slate-700 mb-2">
                      Password Baru
                    </label>{" "}
                    <PasswordInput
                      value={passForm.password}
                      onChange={(e) =>
                        setPassForm({ ...passForm, password: e.target.value })
                      }
                      placeholder="minimal 8 karakter"
                      className="rounded-md border border-solid border-gray-300 bg-white px-3 py-2.5 pr-12 text-sm text-gray-900 outline-none transition focus:border-[#7181E0] focus:ring-2 focus:ring-[#7181E0]/20 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:opacity-60"
                    />{" "}
                  </div>{" "}
                  <div className="block">
                    {" "}
                    <label className="block text-xs font-bold text-slate-700 mb-2">
                      Konfirmasi Password Baru
                    </label>{" "}
                    <PasswordInput
                      value={passForm.konfirmasi}
                      onChange={(e) =>
                        setPassForm({ ...passForm, konfirmasi: e.target.value })
                      }
                      placeholder="ulangi password baru"
                      className="rounded-md border border-solid border-gray-300 bg-white px-3 py-2.5 pr-12 text-sm text-gray-900 outline-none transition focus:border-[#7181E0] focus:ring-2 focus:ring-[#7181E0]/20 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:opacity-60"
                    />{" "}
                  </div>{" "}
                </div>{" "}
              </div>{" "}
              <div className="flex gap-2 px-6 pb-6 pt-4">
                {" "}
                <button
                  type="button"
                  onClick={() => setPassAkun(null)}
                  className="rounded-lg border-0 bg-gray-200 hover:bg-gray-300 px-4 py-2 text-sm font-semibold text-slate-700 transition-colors flex-1"
                >
                  Batal
                </button>{" "}
                <button
                  type="button"
                  onClick={simpanPassword}
                  disabled={saving}
                  className="rounded-lg border-0 bg-[#7181E0] hover:bg-[#5d6fcc] px-4 py-2 text-sm font-semibold text-white transition-colors flex-1"
                >
                  {" "}
                  {saving ? "Menyimpan..." : "Simpan"}{" "}
                </button>{" "}
              </div>{" "}
            </div>{" "}
          </div>,
          document.body,
        )}{" "}
    </div>
  );
}
