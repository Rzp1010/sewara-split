"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import PasswordInput from "@/components/PasswordInput";
import { api } from "@/lib/api-client";

const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function DaftarPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    nama_lengkap: "",
    email: "",
    password: "",
    konfirmasi: "",
    nama_bisnis: "",
  });
  const [errorMsg, setErrorMsg] = useState("");
  const [loading, setLoading] = useState(false);
  const [sukses, setSukses] = useState(false);

  async function handleDaftar(e) {
    e.preventDefault();
    setErrorMsg("");
    const nama_lengkap = form.nama_lengkap.trim();
    const email = form.email.trim().toLowerCase();
    if (!nama_lengkap) {
      setErrorMsg("Nama lengkap wajib diisi.");
      return;
    }
    if (!RE_EMAIL.test(email)) {
      setErrorMsg("Format email tidak valid.");
      return;
    }
    if (form.password.length < 8) {
      setErrorMsg("Password minimal 8 karakter.");
      return;
    }
    if (form.password !== form.konfirmasi) {
      setErrorMsg("Konfirmasi password tidak sama.");
      return;
    }

    setLoading(true);
    try {
      const hasil = await api.auth.register(
        email,
        form.password,
        nama_lengkap,
        form.nama_bisnis.trim(),
      );
      setLoading(false);
      if (!hasil.ok) {
        setErrorMsg(hasil.error || "Terjadi kesalahan. Coba lagi nanti.");
        return;
      }
      router.push(`/verifikasi-email?email=${encodeURIComponent(email)}`);
    } catch (err) {
      setLoading(false);
      setErrorMsg(err.message || "Gagal mendaftar. Coba lagi.");
    }
  }

  function handleChange(e) {
    setForm({ ...form, [e.target.name]: e.target.value });
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4"
      style={{ background: "#0f172a" }}
    >
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm w-full max-w-[420px] px-8 py-10">
        {sukses ? (
          <>
            <div className="flex justify-center mb-4">
              <Image
                src="/logo/Sewara_Logo Apps.png"
                width={80}
                height={80}
                alt="Sewara"
                priority
                style={{ objectFit: "contain" }}
              />
            </div>
            <h1 className="text-xl font-bold text-gray-900 mb-4 text-center">
              Pendaftaran Diterima!
            </h1>
            <p
              className="text-gray-500 text-center mb-2"
              style={{ marginTop: 4 }}
            >
              Akun Anda menunggu persetujuan admin.
            </p>
            <p
              className="text-gray-500 text-center mb-2"
              style={{ marginTop: 4 }}
            >
              Anda akan mendapat akses setelah disetujui.
            </p>
            <Link
              href="/"
              className="block w-full rounded-lg bg-[#579171] px-4 py-3 text-center text-sm font-semibold text-white hover:bg-[#4a7d62]"
            >
              Kembali ke Halaman Masuk
            </Link>
          </>
        ) : (
          <>
            <div className="flex justify-center mb-6">
              <Image
                src="/logo/Sewara_Logo Apps.png"
                width={100}
                height={100}
                alt="Sewara"
                priority
                style={{ objectFit: "contain" }}
              />
            </div>
            <h1 className="text-2xl font-bold text-gray-900 mb-2 text-center">
              Buat Akun Baru
            </h1>
            <p className="text-sm text-gray-500 text-center mb-6">
              Lengkapi data di bawah untuk mendaftar.
            </p>

            {errorMsg && (
              <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
                {errorMsg}
              </div>
            )}

            <form onSubmit={handleDaftar} className="space-y-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">
                  Nama Lengkap
                </label>
                <input
                  type="text"
                  name="nama_lengkap"
                  value={form.nama_lengkap}
                  onChange={handleChange}
                  required
                  className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm outline-none focus:border-[#7181E0] focus:ring-2 focus:ring-[#7181E0]/20"
                  placeholder="Masukkan nama lengkap"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">
                  Email
                </label>
                <input
                  type="email"
                  name="email"
                  value={form.email}
                  onChange={handleChange}
                  required
                  className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm outline-none focus:border-[#7181E0] focus:ring-2 focus:ring-[#7181E0]/20"
                  placeholder="contoh@email.com"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">
                  Nama Bisnis / Brand
                </label>
                <input
                  type="text"
                  name="nama_bisnis"
                  value={form.nama_bisnis}
                  onChange={handleChange}
                  required
                  className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm outline-none focus:border-[#7181E0] focus:ring-2 focus:ring-[#7181E0]/20"
                  placeholder="Nama bisnis atau brand"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">
                  Password
                </label>
                <PasswordInput
                  name="password"
                  value={form.password}
                  onChange={handleChange}
                  required
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">
                  Konfirmasi Password
                </label>
                <PasswordInput
                  name="konfirmasi"
                  value={form.konfirmasi}
                  onChange={handleChange}
                  required
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-lg bg-[#7181E0] px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#5d6fcc] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loading ? "Memproses..." : "Daftar Sekarang"}
              </button>
            </form>

            <div className="mt-6 text-center">
              <p className="text-sm text-gray-600">
                Sudah punya akun?{" "}
                <Link
                  href="/"
                  className="text-blue-600 hover:text-blue-700 hover:underline"
                >
                  Masuk di sini
                </Link>
              </p>
              <p className="text-sm text-gray-500 m-0">
                Aplikasi Sewara &copy; 2026
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
