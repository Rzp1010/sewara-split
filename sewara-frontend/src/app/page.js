"use client";

import { useState, useEffect, useSyncExternalStore } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api-client";

const subscribe = () => () => {};
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

function formatCountdown(s) {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export default function LoginPage() {
  const router = useRouter();
  const [errorMsg, setErrorMsg] = useState("");
  const [fieldError, setFieldError] = useState(false);
  const [emailValid, setEmailValid] = useState(false);
  const [passwordValid, setPasswordValid] = useState(false);
  const [loading, setLoading] = useState(false);
  const [lockStatus, setLockStatus] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [showPass, setShowPass] = useState(false);
  const mounted = useSyncExternalStore(
    subscribe,
    getClientSnapshot,
    getServerSnapshot,
  );

  useEffect(() => {
    if (!lockStatus) return;
    const iv = setInterval(
      () =>
        setCountdown((c) => {
          if (c <= 1) {
            setLockStatus(false);
            return 0;
          }
          return c - 1;
        }),
      1000,
    );
    return () => clearInterval(iv);
  }, [lockStatus]);

  async function handleLogin() {
    setErrorMsg("");
    setLockStatus(false);
    setCountdown(0);
    setLoading(true);
    const user = document.getElementById("username").value;
    const pass = document.getElementById("password").value;
    try {
      await api.auth.login(user, pass); // backend set cookie sesi
      router.replace("/dashboard");
    } catch (err) {
      const errorText = err.message || "Email atau password salah.";
      setErrorMsg(errorText);
      setFieldError(true);
      if (err.status === 423 || err.status === 429) {
        setLockStatus(true);
        setCountdown(Math.max(1, Math.ceil((err.retryAfterMs || 0) / 1000)));
      }
    }
    setLoading(false);
  }

  function handleEmailChange(e) {
    if (fieldError) {
      setFieldError(false);
      setErrorMsg("");
    }
    const val = e.target.value;
    setEmailValid(val.includes("@") && val.includes("."));
  }

  function handlePasswordChange(e) {
    if (fieldError) {
      setFieldError(false);
      setErrorMsg("");
    }
    setPasswordValid(e.target.value.length >= 6);
  }

  function handleKeyDown(e) {
    if (e.key === "Enter") handleLogin();
  }

  const inputBase =
    "appearance-none border-solid rounded-md block w-full px-3 py-2.5 text-[14px] outline-none transition-colors duration-200 border";
  const stateClass = (valid) =>
    fieldError
      ? "border-red-600 bg-red-50 text-red-700 focus:border-red-600 focus:ring-2 focus:ring-red-600/20"
      : valid
        ? "border-green-600 bg-green-50 text-green-700 focus:border-green-600 focus:ring-2 focus:ring-green-600/20"
        : "border-gray-500 bg-white text-gray-900 focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20";

  if (!mounted)
    return (
      <div
        className="min-h-screen flex items-center justify-center p-4"
        style={{ background: "#0f172a" }}
      >
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm w-full max-w-[420px] px-8 py-10">
          <p className="text-gray-500 text-center">Loading...</p>
        </div>
      </div>
    );

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4"
      style={{ background: "#0f172a" }}
    >
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm w-full max-w-[420px] px-8 py-10">
        <div className="flex flex-col items-center mb-8">
          <div className="flex justify-center mb-1">
            <Image
              src="/logo/Sewara_Logo Apps.png"
              width={80}
              height={80}
              alt="Sewara"
              priority
              style={{ objectFit: "contain" }}
            />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 m-0 mb-0.5">
            Sewara
          </h1>
          <p className="text-sm text-gray-600 leading-snug m-0">
            Era Baru Manajemen Persewaan
          </p>
        </div>
        <div>
          <div className="mb-4">
            <label
              className="block mb-2 text-[13px] font-semibold text-gray-900"
              htmlFor="username"
            >
              Email
            </label>
            <input
              id="username"
              name="email"
              required
              type="email"
              autoComplete="email"
              className={`${inputBase} ${stateClass(emailValid)}`}
              placeholder="Masukkan email"
              onChange={handleEmailChange}
              onKeyDown={handleKeyDown}
            />
          </div>
          <div className="mb-6">
            <label
              className="block mb-2 text-[13px] font-semibold text-gray-900"
              htmlFor="password"
            >
              Password
            </label>
            <div className="relative flex items-center">
              <input
                id="password"
                name="password"
                required
                minLength={6}
                type={showPass ? "text" : "password"}
                autoComplete="current-password"
                className={`${inputBase} pr-10 ${stateClass(passwordValid)}`}
                placeholder="••••••••"
                onChange={handlePasswordChange}
                onKeyDown={handleKeyDown}
              />
              <div className="absolute right-3 flex items-center">
                <button
                  type="button"
                  onClick={() => setShowPass(!showPass)}
                  aria-label={
                    showPass ? "Sembunyikan password" : "Lihat password"
                  }
                  className={`focus:outline-none transition-colors bg-transparent border-0 p-0 ${showPass ? "text-blue-600" : "text-gray-400 hover:text-gray-600"}`}
                >
                  <svg
                    className="w-5 h-5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                    />
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                    />
                  </svg>
                </button>
              </div>
            </div>
          </div>
          {errorMsg && (
            <div className="text-red-600 text-sm mb-4">
              <p>{errorMsg}</p>
            </div>
          )}
          <button
            onClick={handleLogin}
            disabled={loading || lockStatus}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white text-[14px] font-semibold py-2.5 rounded-lg transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed border-0 focus:outline-none focus:ring-4 focus:ring-blue-600/30"
          >
            {loading
              ? "Memproses..."
              : lockStatus && countdown > 0
                ? `Login (${formatCountdown(countdown)})`
                : "Login"}
          </button>
        </div>
        <div className="mt-8 flex flex-col items-center gap-0.5">
          <p className="text-sm text-gray-500 m-0">
            Belum punya akun?{" "}
            <Link
              href="/daftar"
              className="text-blue-600 hover:text-blue-700 hover:underline"
            >
              Daftar di sini
            </Link>
          </p>
          <p className="text-sm text-gray-500 m-0">
            Aplikasi Sewara &copy; 2026
          </p>
        </div>
      </div>
    </div>
  );
}
