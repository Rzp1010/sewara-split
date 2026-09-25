"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api-client";
import { formatRupiah } from "@/lib/utils";
import { ROLE_SUPERADMIN } from "@/lib/role";
import DateTimePicker from "@/components/DateTimePicker";
import LoadingOverlay from "@/components/LoadingOverlay";
import BannerBackupBukti from "@/components/BannerBackupBukti";

const fmtYMD = (d) =>
  d
    ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
    : "";

export default function DashboardPage() {
  const router = useRouter();
  const [role, setRole] = useState(null);
  const [userId, setUserId] = useState(null);
  const [stats, setStats] = useState({
    barang: 0,
    aktif: 0,
    selesai: 0,
    pendapatan: 0,
  });
  const [mng, setMng] = useState({
    totalOwner: 0,
    ownerAktif: 0,
    ownerNonaktif: 0,
    totalStaf: 0,
    stafAktif: 0,
    stafNonaktif: 0,
    totalAkun: 0,
  });
  const [rentangKey, setRentangKey] = useState(() => {
    if (typeof window === "undefined") return "hari";
    return window.localStorage.getItem("rentalpro_dashboard_rentang") || "hari";
  });
  const [customMulai, setCustomMulai] = useState("");
  const [customAkhir, setCustomAkhir] = useState("");
  const [rekap, setRekap] = useState({
    booking: 0,
    disewa: 0,
    mendekati: 0,
    telat: 0,
    belumSelesai: 0,
    selesai: 0,
  });
  const [bayar, setBayar] = useState({
    total_akhir: 0,
    diterima: 0,
    tunai: 0,
    transfer: 0,
    qris: 0,
  });
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    async function init() {
      try {
      const { user } = await api.auth.me();
      setRole(user.role || "");
      if (user.id) setUserId(user.id);
      } catch (e) {
        console.error("Failed to fetch user profile:", e);
      }
    }
    init();
  }, []);

  function buatRentang(key, mulaiCustom, akhirCustom) {
    if (key === "semua") return null;

    let akhir = new Date();
    akhir.setHours(23, 59, 59, 999);
    let mulai;
    if (key === "hari") {
      mulai = new Date();
      mulai.setHours(0, 0, 0, 0);
    } else if (key === "3hari") {
      mulai = new Date();
      mulai.setDate(mulai.getDate() - 2);
      mulai.setHours(0, 0, 0, 0);
    } else if (key === "7hari") {
      mulai = new Date();
      mulai.setDate(mulai.getDate() - 6);
      mulai.setHours(0, 0, 0, 0);
    } else if (key === "30hari") {
      mulai = new Date();
      mulai.setDate(mulai.getDate() - 29);
      mulai.setHours(0, 0, 0, 0);
    } else {
      if (!mulaiCustom || !akhirCustom) return null;
      mulai = new Date(mulaiCustom);
      mulai.setHours(0, 0, 0, 0);
      akhir = new Date(akhirCustom);
      akhir.setHours(23, 59, 59, 999);
    }
    return { mulai: mulai.toISOString(), akhir: akhir.toISOString() };
  }

  useEffect(() => {
    async function hitung() {
      setIsRefreshing(true);
      try {
        if (role === ROLE_SUPERADMIN) {
          const data = await api.dashboard.getManajemen();
          setMng(data.manajemen || {
            totalOwner: 0,
            ownerAktif: 0,
            ownerNonaktif: 0,
            totalStaf: 0,
            stafAktif: 0,
            stafNonaktif: 0,
            totalAkun: 0,
          });
        } else if (role && userId) {
          const rt = buatRentang(rentangKey, customMulai, customAkhir);
          const params = rt ? { mulai: rt.mulai, akhir: rt.akhir } : {};
          const data = await api.dashboard.getStats(params);
          
          const rekap = data.rekapStatus || {};
          const bayar = data.pembayaran || {};
          
          // Map ke stats card: barang (dari inventory), aktif (booking+disewa), selesai, pendapatan
          let invCount = 0;
          try {
            const inv = await api.inventory.getAll();
            const arr = inv?.inventory || inv;
            invCount = Array.isArray(arr) ? arr.length : 0;
          } catch (invErr) {
            console.error("[Dashboard] inventory.getAll error:", invErr);
          }
          
          setStats({
            barang: invCount,
            aktif: (rekap.booking || 0) + (rekap.disewa || 0),
            selesai: rekap.selesai || 0,
            pendapatan: bayar.diterima || 0,
          });
          
          setRekap({
            booking: rekap.booking || 0,
            disewa: rekap.disewa || 0,
            mendekati: rekap.mendekati || 0,
            telat: rekap.telat || 0,
            belumSelesai: rekap.belumSelesai || 0,
            selesai: rekap.selesai || 0,
          });
          
          setBayar({
            total_akhir: bayar.total_akhir || 0,
            diterima: bayar.diterima || 0,
            tunai: bayar.tunai || 0,
            transfer: bayar.transfer || 0,
            qris: bayar.qris || 0,
          });
        }
      } catch (e) {
        console.error("Dashboard stats error:", e);
      } finally {
        setIsRefreshing(false);
      }
    }
    hitung();
    let timer = null;
    const debounced = () => {
      clearTimeout(timer);
      timer = setTimeout(hitung, 200);
    };
    window.addEventListener("storage", debounced);
    window.addEventListener("dataChanged", debounced);
    window.addEventListener("settingChanged", debounced);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("storage", debounced);
      window.removeEventListener("dataChanged", debounced);
      window.removeEventListener("settingChanged", debounced);
    };
  }, [role, userId, rentangKey, customMulai, customAkhir]);

  async function handleLogout() {
    await api.auth.logout();
    resetOwnerIdCache();
    router.replace("/");
  }

  if (role === null) {
    return <LoadingOverlay />;
  }

  if (role === "") {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-center">
          <div className="text-[40px]">🚫</div>
          <p className="text-base font-bold text-red-700">
            Profil akun tidak ditemukan. Hubungi admin.
          </p>
          <button
            onClick={handleLogout}
            className="rounded bg-red-500 px-4 py-2 text-white mt-4"
          >
            Logout
          </button>
        </div>
      </div>
    );
  }

  if (role === ROLE_SUPERADMIN) {
    const cards = [
      { label: "Total Owner", value: mng.totalOwner, accent: "primary" },
      { label: "Owner Aktif", value: mng.ownerAktif, accent: "success" },
      { label: "Owner Nonaktif", value: mng.ownerNonaktif, accent: "danger" },
      { label: "Total Staf", value: mng.totalStaf, accent: "info" },
      { label: "Staf Aktif", value: mng.stafAktif, accent: "success" },
      { label: "Staf Nonaktif", value: mng.stafNonaktif, accent: "warning" },
      { label: "Total Akun", value: mng.totalAkun, accent: "primary" },
    ];
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-bold">Dashboard Manajemen</h2>
        <p className="text-sm text-slate-500">
          Rekap akun owner dan staf di seluruh sistem.
        </p>
        {isRefreshing && (
          <div className="text-sm text-slate-500">Memuat ulang data...</div>
        )}

        <div className="grid grid-cols-4 gap-5 max-[1100px]:grid-cols-2 max-[700px]:grid-cols-1">
          {cards.map((c) => (
            <div
              key={c.label}
              className={`rounded-lg border border-border bg-surface-card p-5 shadow-sm border-l-4 ${c.accent === "info" ? "border-blue-500" : c.accent === "success" ? "border-green-500" : c.accent === "warning" ? "border-yellow-500" : c.accent === "primary" ? "border-blue-500" : "border-gray-500"}`}
            >
              <p className="text-sm text-slate-500">{c.label}</p>
              <p className="text-2xl font-bold">{c.value}</p>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const cards = [
    { label: "Total Katalog", value: stats.barang, accent: "info" },
    { label: "Transaksi Berlangsung", value: stats.aktif, accent: "warning" },
    { label: "Transaksi Selesai", value: stats.selesai, accent: "success" },
    {
      label: "Total Pendapatan",
      value: formatRupiah(stats.pendapatan),
      accent: "primary",
    },
  ];

  const opsiRentang = [
    { k: "semua", l: "Semua" },
    { k: "hari", l: "Hari Ini" },
    { k: "3hari", l: "3 Hari" },
    { k: "7hari", l: "7 Hari" },
    { k: "30hari", l: "30 Hari" },
    { k: "custom", l: "Custom" },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-4 mb-4">
        <div>
          <h2 className="text-xl font-bold">Dashboard Utama</h2>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/dashboard/booking"
            className="rounded-lg bg-[#7181E0] hover:bg-[#5d6fcc] px-4 py-2 text-sm font-medium text-white transition-colors"
            style={{ textDecoration: "none" }}
          >
            Booking Baru
          </Link>
        </div>
      </div>

      <BannerBackupBukti />

      {/* Rentang waktu statistik */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        {opsiRentang.map((o) => (
          <button
            key={o.k}
            type="button"
            onClick={() => {
              setRentangKey(o.k);
              window.localStorage.setItem("rentalpro_dashboard_rentang", o.k);
            }}
            className={`rounded-full px-4 py-2 text-sm font-medium transition-colors outline-none focus:outline-none ${rentangKey === o.k ? "bg-[#7181E0] hover:bg-[#5d6fcc] text-white border-0" : "bg-gray-200 hover:bg-gray-300 text-slate-700 border-0"}`}
          >
            {o.l}
          </button>
        ))}
        {rentangKey === "custom" && (
          <>
            <div className="w-[150px] max-w-full">
              <DateTimePicker
                value={customMulai ? new Date(`${customMulai}T00:00:00`) : null}
                onChange={(d) => setCustomMulai(fmtYMD(d))}
                showTime={false}
                placeholder="dd/mm/yyyy"
              />
            </div>
            <span className="text-xs text-slate-500 self-center">s.d.</span>
            <div className="w-[150px] max-w-full">
              <DateTimePicker
                value={customAkhir ? new Date(`${customAkhir}T00:00:00`) : null}
                onChange={(d) => setCustomAkhir(fmtYMD(d))}
                showTime={false}
                placeholder="dd/mm/yyyy"
              />
            </div>
          </>
        )}
      </div>

      {/* Kartu statistik utama */}
      <div className="grid grid-cols-4 gap-5 max-[1100px]:grid-cols-2 max-[700px]:grid-cols-1">
        {cards.map((c, idx) => (
          <div
            key={c.label}
            className={
              idx === 3
                ? "bg-[#7181E0] rounded-xl shadow-lg p-5"
                : "bg-white rounded-xl border border-gray-100 shadow-lg p-5"
            }
          >
            <p
              className={
                idx === 3
                  ? "text-sm font-medium text-indigo-200 mb-3"
                  : "text-sm font-medium text-gray-500 mb-3"
              }
            >
              {c.label}
            </p>
            <p
              className={
                idx === 3
                  ? "text-3xl font-bold text-white"
                  : "text-3xl font-bold text-gray-900"
              }
            >
              {c.value}
            </p>
            <p
              className={
                idx === 3
                  ? "text-xs text-indigo-300 mt-1"
                  : "text-xs text-gray-400 mt-1"
              }
            >
              {idx === 0
                ? "item tersedia"
                : idx === 1
                  ? "transaksi aktif"
                  : idx === 2
                    ? "dalam periode ini"
                    : rentangKey === "hari"
                      ? "hari ini"
                      : rentangKey === "3hari"
                        ? "3 hari terakhir"
                        : rentangKey === "7hari"
                          ? "7 hari terakhir"
                          : rentangKey === "30hari"
                            ? "30 hari terakhir"
                            : "periode ini"}
            </p>
          </div>
        ))}
      </div>

      {/* Rekap status + Total Diterima (berdampingan) */}
      <div className="grid grid-cols-2 gap-5 mt-6 max-[700px]:grid-cols-1">
        <div className="rounded-xl border border-gray-100 bg-white shadow-lg">
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
            <div>
              <h3 className="text-sm font-semibold text-gray-900">
                Rekap Persewaan
              </h3>
              <p className="text-xs text-gray-400 mt-0.5">
                Status transaksi periode ini
              </p>
            </div>
            <span className="text-xs font-medium bg-indigo-50 text-indigo-600 px-2.5 py-1 rounded-full">
              Terkini
            </span>
          </div>
          <div className="divide-y divide-gray-50">
            {[
              {
                label: "Booking",
                value: rekap.booking,
                color: "amber",
                dotColor: "bg-amber-500",
                barColor: "bg-amber-500",
                bgClass: "",
              },
              {
                label: "Disewa",
                value: rekap.disewa,
                color: "blue",
                dotColor: "bg-blue-500",
                barColor: "bg-blue-500",
                bgClass: "",
              },
              {
                label: "Mendekati",
                value: rekap.mendekati,
                color: "yellow",
                dotColor: "bg-yellow-500",
                barColor: "bg-yellow-500",
                bgClass: "",
              },
              {
                label: "Telat",
                value: rekap.telat,
                color: "red",
                dotColor: "bg-[#F04438]",
                barColor: "bg-[#F04438]",
                bgClass: "bg-red-50",
              },
              {
                label: "Belum Selesai",
                value: rekap.belumSelesai,
                color: "indigo",
                dotColor: "bg-indigo-500",
                barColor: "bg-indigo-500",
                bgClass: "",
              },
              {
                label: "Selesai",
                value: rekap.selesai,
                color: "green",
                dotColor: "bg-[#579171]",
                barColor: "bg-[#579171]",
                bgClass: "",
              },
            ].map((item) => {
              const total =
                rekap.booking +
                rekap.disewa +
                rekap.mendekati +
                rekap.telat +
                rekap.belumSelesai +
                rekap.selesai;
              const percentage = total > 0 ? (item.value / total) * 100 : 0;
              return (
                <div
                  key={item.label}
                  className={`flex items-center justify-between px-5 py-3.5 ${item.bgClass}`}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-2 h-2 rounded-full ${item.dotColor}`}
                    ></div>
                    <span
                      className={`text-sm ${item.bgClass ? "font-medium text-red-700" : "text-gray-700"}`}
                    >
                      {item.label}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className={`w-24 rounded-full h-1.5 bg-gray-100`}>
                      <div
                        className={`h-1.5 rounded-full ${item.barColor}`}
                        style={{ width: `${percentage}%` }}
                      ></div>
                    </div>
                    <span
                      className={`text-sm w-4 text-right ${item.bgClass ? "font-bold text-red-600" : "font-semibold text-gray-900"}`}
                    >
                      {item.value}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Detail Total Diterima */}
        <div className="rounded-xl border border-gray-100 bg-white shadow-lg">
          <div className="px-5 py-4 border-b border-gray-100">
            <h3 className="text-sm font-semibold text-gray-900">
              Total Diterima
            </h3>
            <p className="text-xs text-gray-400 mt-0.5">
              Breakdown metode pembayaran
            </p>
          </div>
          <div className="px-5 py-5">
            {/* Big number */}
            <p className="text-3xl font-bold text-gray-900">
              {formatRupiah(bayar.diterima)}
            </p>
            <p className="text-xs text-gray-400 mt-1">
              dari total {formatRupiah(bayar.total_akhir)} yang tercatat
            </p>

            {/* Progress bar */}
            <div className="mt-3 w-full bg-gray-100 rounded-full h-2">
              <div
                className="bg-[#7181E0] h-2 rounded-full"
                style={{
                  width: `${bayar.total_akhir > 0 ? (bayar.diterima / bayar.total_akhir) * 100 : 0}%`,
                }}
              ></div>
            </div>
            <div className="flex justify-between text-xs text-gray-400 mt-1">
              <span>Diterima</span>
              <span>
                {bayar.total_akhir > 0
                  ? ((bayar.diterima / bayar.total_akhir) * 100).toFixed(1)
                  : 0}
                %
              </span>
            </div>

            {/* Breakdown */}
            <div className="mt-5 space-y-2.5">
              <div className="flex items-center justify-between py-2.5 px-3 bg-gray-50 rounded-lg">
                <span className="text-sm font-medium text-gray-700">Tunai</span>
                <span
                  className={`text-sm font-semibold ${bayar.tunai > 0 ? "text-gray-900" : "text-gray-400"}`}
                >
                  {formatRupiah(bayar.tunai)}
                </span>
              </div>
              <div className="flex items-center justify-between py-2.5 px-3 bg-gray-50 rounded-lg">
                <span className="text-sm font-medium text-gray-700">
                  Transfer
                </span>
                <span
                  className={`text-sm font-semibold ${bayar.transfer > 0 ? "text-gray-900" : "text-gray-400"}`}
                >
                  {formatRupiah(bayar.transfer)}
                </span>
              </div>
              <div className="flex items-center justify-between py-2.5 px-3 bg-gray-50 rounded-lg">
                <span className="text-sm font-medium text-gray-700">QRIS</span>
                <span
                  className={`text-sm font-semibold ${bayar.qris > 0 ? "text-gray-900" : "text-gray-400"}`}
                >
                  {formatRupiah(bayar.qris)}
                </span>
              </div>
            </div>

            {/* Sisa piutang */}
            {bayar.total_akhir > bayar.diterima && (
              <div className="mt-3 flex items-center justify-between py-2.5 px-3 bg-orange-50 border border-orange-100 rounded-lg">
                <span className="text-sm font-medium text-orange-700">
                  Sisa Piutang
                </span>
                <span className="text-sm font-bold text-orange-600">
                  {formatRupiah(
                    Math.max(0, bayar.total_akhir - bayar.diterima),
                  )}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
