"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

const COOLDOWN = 60;

function maskEmail(value) {
  const email = typeof value === "string" ? value.trim() : "";
  const at = email.indexOf("@");
  if (at <= 0 || at === email.length - 1) return "alamat email Anda";
  const name = email.slice(0, at);
  const domain = email.slice(at + 1);
  const visible = name.length > 2 ? name.slice(0, 2) : name.slice(0, 1);
  return `${visible}${"•".repeat(Math.max(2, Math.min(5, name.length - visible.length)))}@${domain}`;
}

function VerifikasiEmailContent() {
  const searchParams = useSearchParams();
  const email = useMemo(() => searchParams.get("email") || "", [searchParams]);
  const [seconds, setSeconds] = useState(0);
  const [state, setState] = useState("idle");

  useEffect(() => {
    if (!seconds) return undefined;
    const timer = setInterval(() => setSeconds((current) => Math.max(0, current - 1)), 1000);
    return () => clearInterval(timer);
  }, [seconds]);

  async function handleResend() {
    if (seconds > 0) return;
    setState("loading");
    try {
      const response = await fetch("/api/auth/resend-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!response.ok) throw new Error("resend failed");
      setState("success");
      setSeconds(COOLDOWN);
    } catch {
      setState("error");
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-500 to-blue-700">
      <section className="bg-white rounded-2xl shadow-2xl p-8 max-w-md w-full text-center" aria-labelledby="verification-title">
        <div className="flex justify-center mb-4">
          <Image src="/logo/Sewara_Logo Apps.png" width={80} height={80} alt="Sewara" priority style={{ objectFit: "contain" }} />
        </div>
        <h1 id="verification-title" className="text-2xl font-semibold text-gray-800 mb-4">Cek email Anda</h1>
        <p className="text-gray-600 mt-2">
          Tautan verifikasi sudah dikirim ke
        </p>
        <p className="text-gray-800 font-semibold mt-0.5 break-words">
          {maskEmail(email)}
        </p>
        <p className="text-gray-600 mt-4 mb-6">
          Buka email tersebut, lalu klik tautan untuk mengaktifkan akun Anda. Periksa folder Spam jika belum terlihat.
        </p>

        {state === "success" && (
          <div className="text-green-600 mb-4" role="status"><p className="m-0">Email verifikasi berhasil dikirim ulang.</p></div>
        )}
        {state === "error" && (
          <div className="text-red-600 mb-4" role="alert"><p className="m-0">Email belum dapat dikirim ulang. Coba lagi nanti.</p></div>
        )}

        <button type="button" onClick={handleResend} disabled={seconds > 0 || state === "loading"} className="bg-blue-600 text-white px-6 py-3 rounded-lg font-medium hover:bg-blue-700 transition-colors w-full mt-6">
          {state === "loading" ? "Mengirim..." : seconds > 0 ? `Kirim ulang (${seconds} detik)` : "Kirim ulang email"}
        </button>
        <Link href="/" className="w-full block mt-3 text-center text-blue-600 hover:text-blue-700">
          Kembali ke Login
        </Link>
        <p className="text-gray-600 m-0 mt-6">Aplikasi Sewara &copy; 2026</p>
      </section>
    </main>
  );
}

export default function VerifikasiEmailPage() {
  return (
    <Suspense fallback={<main className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-500 to-blue-700"><section className="bg-white rounded-2xl shadow-2xl p-8 max-w-md w-full text-center"><p className="text-gray-600 m-0">Memuat...</p></section></main>}>
      <VerifikasiEmailContent />
    </Suspense>
  );
}
