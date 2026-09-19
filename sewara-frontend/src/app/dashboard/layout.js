"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { getSetting, updateUser, hapusSemuaData, initSettings } from "@/lib/db";
import Image from "next/image";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import dynamic from "next/dynamic";
import NotificationProvider, {
  useNotify,
} from "@/components/NotificationProvider";
const SettingsModal = dynamic(() => import("./SettingsModal"), { ssr: false });
import ThemeProvider, { useTheme } from "@/components/ThemeProvider";
import { VERSI_APLIKASI } from "@/lib/version";
import { api } from "@/lib/api-client";
import { getFITUR } from "@/lib/features";
// Full Tailwind migration in progress
import {
  roleBolehAkses,
  LABEL_ROLE,
  ROLE_OWNER,
  ROLE_CS,
  ROLE_GUDANG,
  ROLE_SUPERADMIN,
} from "@/lib/role";

const subscribeHydrated = () => () => {};
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

/* Ikon SVG stroke (stroke-width 1.5) */
const I = {
  grid: () => (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  ),
  bag: () => (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20 7H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z" />
      <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
    </svg>
  ),
  dollar: () => (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="12" y1="1" x2="12" y2="23" />
      <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </svg>
  ),
  users: () => (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  ),
  gear: () => (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 4.93a10 10 0 0 0 0 14.14" />
    </svg>
  ),
  pen: () => (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
    </svg>
  ),
  check: () => (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="9 11 12 14 22 4" />
      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
    </svg>
  ),
  calendar: () => (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  ),
  search: () => (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  ),
  file: () => (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
    </svg>
  ),
  file2: () => (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  ),
  user: () => (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
    </svg>
  ),
  list: () => (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <line x1="9" y1="9" x2="15" y2="9" />
      <line x1="9" y1="13" x2="15" y2="13" />
      <line x1="9" y1="17" x2="13" y2="17" />
    </svg>
  ),
};

/* Struktur menu 2 level (5 grup). Progres & Manajemen sengaja tidak ditampilkan. */
const MENU_GRUP = [
  {
    id: "operasional",
    label: "Operasional",
    icon: I.grid,
    items: [
      { href: "/dashboard", label: "Dashboard", icon: I.grid },
      { href: "/dashboard/booking", label: "Booking Baru", icon: I.pen },
      { href: "/dashboard/status", label: "Status Sewa", icon: I.check },
      {
        href: "/dashboard/kalender",
        label: "Kalender Jadwal",
        icon: I.calendar,
      },
      { href: "/dashboard/tracking", label: "Tracking Alat", icon: I.search },
      { href: "/dashboard/manajemen", label: "Manajemen", icon: I.users },
    ],
  },
  {
    id: "inventaris",
    label: "Inventaris",
    icon: I.bag,
    items: [
      {
        href: "/dashboard/inventaris",
        label: "Katalog & Inventaris",
        icon: I.bag,
      },
      { href: "/dashboard/log", label: "Log Aktivitas", icon: I.file },
    ],
  },
  {
    id: "keuangan",
    label: "Keuangan",
    icon: I.dollar,
    items: [
      { href: "/dashboard/laporan", label: "Laporan Keuangan", icon: I.dollar },
      { href: "/dashboard/riwayat", label: "Riwayat Invoice", icon: I.file2 },
    ],
  },
  {
    id: "sdm",
    label: "Manajemen Karyawan",
    icon: I.users,
    items: [
      { href: "/dashboard/sdm", label: "Manajemen Karyawan", icon: I.user },
      { href: "/dashboard/loginlog", label: "Log Login", icon: I.gear },
    ],
  },
  {
    id: "pelanggan",
    label: "Pelanggan",
    icon: I.user,
    items: [
      {
        href: "/dashboard/member",
        label: "Member",
        icon: I.user,
        fitur: "memberPromo",
      },
      { href: "/dashboard/pelanggan", label: "Data Pelanggan", icon: I.users },
      {
        href: "/dashboard/promo",
        label: "Kode Promo",
        icon: I.list,
        fitur: "memberPromo",
      },
    ],
  },
  {
    id: "sistem",
    label: "Sistem",
    icon: I.gear,
    items: [
      { href: "/dashboard/todo", label: "To Do", icon: I.list },
      { href: "/dashboard/pengaturan", label: "Pengaturan", icon: I.gear },
    ],
  },
];

const LABEL_TAB = {
  tampilan: "Tampilan",
  profil: "Profil",
  invoice: "Invoice",
  notifikasi: "Notifikasi",
  aturan: "Aturan Sewa",
  laporan: "Laporan & Pendapatan",
  pengembangan: "Pengembangan",
  info: "Info Aplikasi",
};

// Item menu dengan properti `fitur` hanya tampil saat fitur aktif (getFITUR)
function itemMenuBoleh(it) {
  if (!it.fitur) return true;
  return !!getFITUR()[it.fitur];
}

function SidebarContent({ children }) {
  const router = useRouter();
  const pathname = usePathname();
  /* Full-screen: halaman tanpa icon sidebar + submenu (konten penuh).
     Navbar tetap tampil (akun, logout, timer). Kembali via tombol di navbar. */
  const isFullscreen = pathname === "/dashboard/pengaturan";
  const { confirm, confirmChoice, notify } = useNotify();
  const { theme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(
    subscribeHydrated,
    getClientSnapshot,
    getServerSnapshot,
  );
  const [waktu, setWaktu] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [userEmail, setUserEmail] = useState("");
  const [userNama, setUserNama] = useState("");
  const [userUsername, setUserUsername] = useState("");
  const [profilUsername, setProfilUsername] = useState("");
  const [profilNama, setProfilNama] = useState("");
  const [profilLocks, setProfilLocks] = useState({
    nama: true,
    username: true,
  });
  const [userRole, setUserRole] = useState("");
  const [userActive, setUserActive] = useState(true);
  const [profilHilang, setProfilHilang] = useState(false);
  const [profilSubscribed, setProfilSubscribed] = useState(null);
  const [kini, setKini] = useState(() => Date.now());
  /* Grup terbuka saat mount mengikuti pathname (deep-link), default Operasional.
     Setelah mount: klik icon = pin (toggle), hover icon = flyout buka sementara.
     Hover menang atas pin saat aktif; keluar dari zona nav → hover hilang. */
  const [aktifGrup, setAktifGrup] = useState(() => {
    const g = MENU_GRUP.find((grp) =>
      grp.items.some((it) => it.href === pathname),
    );
    return g ? g.id : "operasional";
  });
  const [hoverGrup, setHoverGrup] = useState(null);
  const [navOpen, setNavOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const handler = () => setIsMobile(mq.matches);
    handler();
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  const [invPrefix, setInvPrefix] = useState("");
  const [invDigit, setInvDigit] = useState("6");
  const [invMulai, setInvMulai] = useState("1");
  const [invFooter, setInvFooter] = useState("");
  const [notifJam, setNotifJam] = useState("2");
  const [aturanAmbilCepat, setAturanAmbilCepat] = useState("rencana");
  const [aturanAmbilTelat, setAturanAmbilTelat] = useState("aktual");
  const [aturanDp, setAturanDp] = useState("bebas");
  const [gabungStatus, setGabungStatus] = useState("booking");
  const [jamMode, setJamMode] = useState("buka_tutup");
  const [jamBuka, setJamBuka] = useState("6");
  const [jamTutup, setJamTutup] = useState("22");
  const [basisPendapatan, setBasisPendapatan] = useState("selesai");
  const [dendaAktif, setDendaAktif] = useState("1");
  const [dendaDispensasi, setDendaDispensasi] = useState("15");
  const [tabSetting, setTabSetting] = useState("tampilan");
  const [autoLogoutMin, setAutoLogoutMin] = useState(15);

  useEffect(() => {
    (async () => {
      try {
        const { user } = await api.auth.me();
        if (!user) {
          router.push("/");
          return;
        }
        await initSettings();
        setUserEmail(user.email || "");
        setUserNama(user.nama_lengkap || "");
        setUserUsername(user.username || "");
        setUserRole(user.role || "");
        setUserActive(user.is_active !== false);
        setProfilHilang(!user.role);
        setProfilSubscribed(user.subscribed_until || null);

        // auto_logout_minutes = setting tenant, ambil best-effort
        try {
          const { setting } = await api.settings.get("auto_logout_minutes");
          if (setting?.value) setAutoLogoutMin(Number(setting.value));
        } catch {}
      } catch {
        // 401 = tidak login
        router.push("/");
      }
    })();
  }, [router]);

  useEffect(() => {
    function tick() {
      setWaktu(
        new Date().toLocaleString("id-ID", {
          weekday: "long",
          day: "2-digit",
          month: "long",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }),
      );
    }
    tick();
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    const iv = setInterval(() => setKini(Date.now()), 30000);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    function handler(e) {
      if (accountOpen && !e.target.closest(".account-dropdown, .flex"))
        setAccountOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [accountOpen]);

  useEffect(() => {
    if (settingsOpen) {
      (async () => {
        setInvPrefix(getSetting("invoice_prefix", "INV"));
        setInvDigit(getSetting("invoice_digit", "6"));
        setInvMulai(getSetting("invoice_mulai", "1"));
        setInvFooter(getSetting("invoice_footer", ""));
        setNotifJam(getSetting("notif_jam", "2"));
        setAturanAmbilCepat(getSetting("aturan_ambil_cepat", "rencana"));
        setAturanAmbilTelat(getSetting("aturan_ambil_telat", "aktual"));
        setAturanDp(getSetting("aturan_dp", "bebas"));
        setGabungStatus(getSetting("gabung_status", "booking"));
        setJamMode(getSetting("jam_mode", "buka_tutup"));
        setJamBuka(getSetting("jam_buka", "6"));
        setJamTutup(getSetting("jam_tutup", "22"));
        setBasisPendapatan(getSetting("basis_pendapatan", "selesai"));
        setDendaAktif(getSetting("denda_aktif", "1"));
        setDendaDispensasi(getSetting("denda_dispensasi_menit", "15"));
        setProfilUsername(userUsername);
        setProfilNama(userNama);
        setProfilLocks({ nama: true, username: true });
        try {
          const { setting } = await api.settings.get("auto_logout_minutes");
          if (setting?.value) setAutoLogoutMin(Number(setting.value));
        } catch {}
      })();
    }
  }, [settingsOpen, userUsername, userNama]);

  /* Grup menu sesuai pathname saat ini (fallback Operasional) */
  function grupUntukPath() {
    const g = MENU_GRUP.find((grp) =>
      grp.items.some((it) => it.href === pathname),
    );
    return g ? g.id : "operasional";
  }

  // Auto-logout: catat aktivitas terakhir (debounce) ke localStorage
  useEffect(() => {
    let timer = null;
    const simpan = () =>
      localStorage.setItem("rentalpro_last_activity", String(Date.now()));
    const handler = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(simpan, 500);
    };
    const events = ["mousedown", "keydown", "touchstart", "scroll"];
    events.forEach((ev) =>
      window.addEventListener(ev, handler, { passive: true }),
    );
    simpan();
    return () => {
      events.forEach((ev) => window.removeEventListener(ev, handler));
      if (timer) clearTimeout(timer);
    };
  }, []);

  // Auto-logout: cek tiap menit + cek saat mount (tutup browser -> buka lagi setelah batas -> logout)
  useEffect(() => {
    const cek = async () => {
      if (autoLogoutMin <= 0) return;
      const last =
        Number(localStorage.getItem("rentalpro_last_activity")) || Date.now();
      if (Date.now() - last > autoLogoutMin * 60000) {
        try {
          await api.auth.logout();
        } catch {}
        window.location.href = "/";
      }
    };
    cek();
    const iv = setInterval(cek, 60000);
    return () => clearInterval(iv);
  }, [router, autoLogoutMin]);

  function toggleSubmenu(id) {
    setAktifGrup((prev) => (prev === id ? null : id));
  }

  /* Mobile: buka menu + submenu sekalian; tutup juga barengan */
  function tutupNavigasi() {
    setNavOpen(false);
    setAktifGrup(null);
    setHoverGrup(null);
  }

  async function handleLogout() {
    const ok = await confirm("Yakin ingin keluar?");
    if (ok) {
      try {
        await api.auth.logout();
      } catch {}
      window.location.href = "/";
    }
  }

  async function kosongkanSemua() {
    const ok1 = await confirmChoice(
      "⚠️ KOSONGKAN SEMUA DATA? Semua inventaris (item & S/N), semua transaksi/booking/riwayat, dan semua log S/N akan dihapus PERMANEN. Nomor invoice ikut di-reset. Data yang dihapus TIDAK BISA DIKEMBALIKAN. Lanjut?",
      [{ label: "Ya, Lanjut", value: "ya", bg: "block" }],
    );
    if (ok1 !== "ya") return;
    const ok2 = await confirmChoice(
      "⚠️ KONFIRMASI TERAKHIR. Yakin hapus SEMUA data? Tindakan ini permanen dan tidak bisa diulang. Tidak ada backup otomatis.",
      [{ label: "Ya, Saya Yakin — Hapus Semua", value: "ya", bg: "block" }],
    );
    if (ok2 !== "ya") return;
    const total = await hapusSemuaData();
    if (total)
      notify(
        `Semua data berhasil dikosongkan: ${total.inventaris} inventaris, ${total.transaksi} transaksi, ${total.log} log.`,
      );
  }

  async function simpanProfil() {
    const hasil = await updateUser({
      email: userEmail,
      username: profilUsername.trim(),
      nama_lengkap: profilNama.trim(),
      nama_invoice: profilNama.trim(),
    });
    if (!hasil.ok)
      return notify(`Gagal menyimpan profil: ${hasil.error}`, "error");
    setUserUsername(profilUsername.trim());
    setUserNama(profilNama.trim());
    notify("Profil berhasil diperbarui.");
  }

  if (!mounted) return null;

  return (
    <>
      {/* NAVBAR (blueprint) */}
      <nav className="fixed top-0 left-0 right-0 z-50 flex h-16 items-center justify-between bg-[#0f172a] px-4 text-white">
        <div className="flex items-center gap-3">
          {isFullscreen ? (
            <Link
              href="/dashboard"
              className="flex items-center gap-2 rounded-lg bg-white/10 px-3 py-1.5 text-sm text-white transition-colors hover:bg-white/20"
              style={{ textDecoration: "none" }}
            >
              <span aria-hidden="true">←</span>
              <span className="hidden sm:inline">Kembali ke Dashboard</span>
            </Link>
          ) : (
            <button
              type="button"
              aria-label="Buka menu"
              onClick={() =>
                navOpen
                  ? tutupNavigasi()
                  : (() => {
                      setNavOpen(true);
                      setAktifGrup((prev) => prev || grupUntukPath());
                    })()
              }
              className="rounded p-2 md:hidden"
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
              >
                <path d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
          )}
          <Image
            src="/logo/Sewara_Logo With Text Color  White.png"
            width={150}
            height={84}
            alt="Sewara"
            priority
            style={{
              objectFit: "contain",
              maxHeight: 64,
              width: "auto",
              marginTop: 8,
            }}
          />
        </div>
        <div className="flex items-center gap-4">
          {waktu && (
            <span className="hidden text-sm opacity-75 md:inline">{waktu}</span>
          )}
          <div className="account-dropdown relative">
            <button
              type="button"
              onClick={() => setAccountOpen(!accountOpen)}
              aria-haspopup="true"
              aria-expanded={accountOpen}
              className="flex items-center gap-2 rounded-lg bg-white/10 hover:bg-white/20 px-3 py-1.5 text-white transition-colors border-0"
            >
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#7181E0] text-xs font-bold text-white">
                {userUsername || userNama || userEmail
                  ? (userUsername || userNama || userEmail)[0].toUpperCase()
                  : "A"}
              </span>
              <span className="max-w-36 truncate text-sm">
                {userUsername || userNama || userEmail || "..."}
              </span>
              <span className="text-xs opacity-80">▾</span>
            </button>
            {accountOpen && (
              <div className="absolute right-0 top-full z-50 mt-2 w-72 rounded border border-gray-200 bg-white text-gray-900 shadow-lg overflow-hidden">
                <div className="flex items-center gap-3 p-4 border-b border-gray-200">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#7181E0] text-lg font-bold text-white">
                    {userUsername || userNama || userEmail
                      ? (userUsername || userNama || userEmail)[0].toUpperCase()
                      : "A"}
                  </div>
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <p className="truncate text-sm font-medium text-gray-900 m-0">
                      {userUsername || userNama || "..."}
                    </p>
                    <p className="break-words text-xs text-gray-600 m-0">
                      {userEmail || "..."}
                    </p>
                    {userRole && (
                      <p className="text-xs font-medium text-blue-600 m-0">
                        {LABEL_ROLE[userRole] || userRole}
                      </p>
                    )}
                  </div>
                </div>
                <div className="bg-white">
                  {(userRole === ROLE_OWNER ||
                    userRole === ROLE_SUPERADMIN ||
                    userRole === ROLE_CS ||
                    userRole === ROLE_GUDANG) && (
                    <button
                      onClick={() => {
                        setAccountOpen(false);
                        setSettingsOpen(true);
                      }}
                      className="block w-full px-4 py-2.5 text-left text-sm hover:bg-gray-50 border-0 transition-colors"
                    >
                      Pengaturan
                    </button>
                  )}
                  {profilHilang && (
                    <div className="px-4 py-2.5 text-sm text-red-600">
                      Profil akun tidak ditemukan. Hubungi admin.
                    </div>
                  )}
                  <button
                    onClick={() => {
                      setAccountOpen(false);
                      handleLogout();
                    }}
                    className="block w-full px-4 py-2.5 text-left text-sm text-red-600 hover:bg-red-50 border-0 transition-colors"
                  >
                    Logout
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </nav>

      {/* Backdrop drawer mobile */}
      {navOpen && (
        <div
          className="fixed inset-0 z-20 bg-black/40 md:hidden"
          onClick={tutupNavigasi}
        />
      )}

      {/* ICON SIDEBAR (blueprint) — disembunyikan saat fullscreen (pengaturan) */}
      {!isFullscreen && (
      <aside
        className={`fixed left-0 top-16 z-30 flex h-[calc(100vh-4rem)] w-16 flex-col items-center gap-2 bg-gray-800 p-2 transition-transform ${navOpen ? "translate-x-0" : "-translate-x-full"} md:translate-x-0`}
        onMouseLeave={() => {
          if (!isMobile) setHoverGrup(null);
        }}
      >
        {MENU_GRUP.map((g) =>
          g.items.some(
            (it) => roleBolehAkses(userRole, it.href) && itemMenuBoleh(it),
          ) ? (
            <div
              key={g.id}
              role="button"
              tabIndex={0}
              title={g.label}
              aria-label={g.label}
              onClick={() => toggleSubmenu(g.id)}
              onMouseEnter={() => {
                if (!isMobile) setHoverGrup(g.id);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  toggleSubmenu(g.id);
                }
              }}
              className={`sidebar-icon-btn flex h-12 w-12 items-center justify-center rounded-lg border-0 ring-0 shadow-none transition-colors cursor-pointer ${aktifGrup === g.id ? "bg-[#7181E0] text-white" : "text-text-muted hover:bg-gray-700 hover:text-white"}`}
            >
              <span className="flex h-6 w-6 items-center justify-center [&>svg]:h-6 [&>svg]:w-6">
                <g.icon />
              </span>
            </div>
          ) : null,
        )}
      </aside>
      )}

      {/* SUBMENU PANEL per grup (blueprint) — disembunyikan saat fullscreen */}
      {!isFullscreen && MENU_GRUP.map((g) => (
        <div
          key={g.id}
          id={`submenu-${g.id}`}
          onMouseEnter={() => {
            if (!isMobile) setHoverGrup(g.id);
          }}
          onMouseLeave={() => {
            if (!isMobile) setHoverGrup(null);
          }}
          className={`fixed left-16 top-16 z-30 h-[calc(100vh-4rem)] w-64 overflow-y-auto bg-white p-4 shadow-lg ${(hoverGrup || aktifGrup) === g.id ? "block" : "hidden"}`}
        >
          <div className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-500">
            {g.label}
          </div>
          <div className="flex-col gap-1">
            {g.items
              .filter(
                (it) => roleBolehAkses(userRole, it.href) && itemMenuBoleh(it),
              )
              .map((it) => (
                <Link
                  key={it.href}
                  href={it.href}
                  onClick={() => setNavOpen(false)}
                  className={`flex items-center gap-2 rounded px-3 py-2 text-sm transition-colors ${pathname === it.href ? "bg-[#7181E0] text-white" : "text-gray-900 hover:bg-gray-100"}`}
                  style={{ textDecoration: "none" }}
                >
                  <span
                    className="text-base"
                    style={{ textDecoration: "none" }}
                  >
                    <it.icon />
                  </span>
                  <span style={{ textDecoration: "none" }}>{it.label}</span>
                </Link>
              ))}
          </div>
        </div>
      ))}

      {/* MAIN CONTENT */}
      <main
        className={`mt-16 min-h-[calc(100vh-4rem)] overflow-x-hidden overflow-y-auto bg-gray-100 px-7 py-7 transition-[margin-left] ${
          isFullscreen
            ? "ml-0"
            : hoverGrup || aktifGrup
              ? "ml-0 md:ml-80"
              : "ml-0 md:ml-16"
        }`}
      >
        {!userActive && !profilHilang ? (
          <div className="block">
            <div className="block">
              <div className="block">
                <Image
                  src="/icons/no-entry.png"
                  width={40}
                  height={40}
                  alt="Dinonaktifkan"
                />
              </div>
              <p className="block">Akun dinonaktifkan</p>
              <p className="block">
                Akun Anda telah dinonaktifkan oleh owner. Hubungi admin.
              </p>
            </div>
          </div>
        ) : profilHilang && pathname !== "/dashboard" ? (
          <div className="block">
            <div className="block">
              <div className="block">
                <Image
                  src="/icons/no-entry.png"
                  width={40}
                  height={40}
                  alt="Profil tidak ditemukan"
                />
              </div>
              <p className="block">
                Profil akun tidak ditemukan. Hubungi admin.
              </p>
              <p className="block">
                Menu tidak tersedia karena profil akun tidak ditemukan.
              </p>
            </div>
          </div>
        ) : userRole && !roleBolehAkses(userRole, pathname) ? (
          <div className="block">
            <div className="block">
              <div className="block">
                <Image
                  src="/icons/lock.png"
                  width={40}
                  height={40}
                  alt="Terkunci"
                />
              </div>
              <p className="block">Akses Ditolak</p>
              <p className="block">
                Menu ini tidak tersedia untuk role{" "}
                <strong>{LABEL_ROLE[userRole] || userRole}</strong>.
              </p>
            </div>
          </div>
        ) : (
          <div key={pathname} className="block">
            {children}
          </div>
        )}
      </main>

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        userRole={userRole}
        theme={theme}
        setTheme={setTheme}
        tabSetting={tabSetting}
        setTabSetting={setTabSetting}
        autoLogoutMin={autoLogoutMin}
        setAutoLogoutMin={setAutoLogoutMin}
        profilSubscribed={profilSubscribed}
        kini={kini}
        profilUsername={profilUsername}
        setProfilUsername={setProfilUsername}
        profilNama={profilNama}
        setProfilNama={setProfilNama}
        profilLocks={profilLocks}
        setProfilLocks={setProfilLocks}
        simpanProfil={simpanProfil}
        kosongkanSemua={kosongkanSemua}
        invPrefix={invPrefix}
        setInvPrefix={setInvPrefix}
        invDigit={invDigit}
        setInvDigit={setInvDigit}
        invMulai={invMulai}
        setInvMulai={setInvMulai}
        invFooter={invFooter}
        setInvFooter={setInvFooter}
        notifJam={notifJam}
        setNotifJam={setNotifJam}
        aturanAmbilCepat={aturanAmbilCepat}
        setAturanAmbilCepat={setAturanAmbilCepat}
        aturanAmbilTelat={aturanAmbilTelat}
        setAturanAmbilTelat={setAturanAmbilTelat}
        aturanDp={aturanDp}
        setAturanDp={setAturanDp}
        gabungStatus={gabungStatus}
        setGabungStatus={setGabungStatus}
        jamMode={jamMode}
        setJamMode={setJamMode}
        jamBuka={jamBuka}
        setJamBuka={setJamBuka}
        jamTutup={jamTutup}
        setJamTutup={setJamTutup}
        basisPendapatan={basisPendapatan}
        setBasisPendapatan={setBasisPendapatan}
        dendaAktif={dendaAktif}
        setDendaAktif={setDendaAktif}
        dendaDispensasi={dendaDispensasi}
        setDendaDispensasi={setDendaDispensasi}
      />
    </>
  );
}

export default function DashboardLayout({ children }) {
  return (
    <NotificationProvider>
      <ThemeProvider>
        <SidebarContent>{children}</SidebarContent>
      </ThemeProvider>
    </NotificationProvider>
  );
}
