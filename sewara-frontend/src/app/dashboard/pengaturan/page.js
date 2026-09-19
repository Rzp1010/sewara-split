"use client";

import { useState, useEffect } from "react";
import { getSetting, getSettingTenant, setSetting, setSettingTenant } from "@/lib/db";
import { api, API_BASE } from "@/lib/api-client";
import { ROLE_SUPERADMIN } from "@/lib/role";
import { useNotify } from "@/components/NotificationProvider";
import LoadingOverlay from "@/components/LoadingOverlay";
import PasswordInput from "@/components/PasswordInput";

/* ===== Konstanta UI ===== */

const INPUT_CLS =
  "w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-[#7181E0] focus:ring-2 focus:ring-[#7181E0]/20";

const BTN_UTAMA =
  "rounded-lg border-0 bg-[#7181E0] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#5d6fcc] disabled:cursor-not-allowed disabled:bg-gray-300 disabled:hover:bg-gray-300";

const BTN_SEKUNDER =
  "rounded-lg border-0 bg-gray-200 px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-gray-300 disabled:cursor-not-allowed disabled:opacity-60";

const TABS = [
  { id: "invoice", label: "Invoice & Dokumen" },
  { id: "operasional", label: "Operasional" },
  { id: "tampilan", label: "Tampilan" },
  { id: "integrasi", label: "Integrasi & Notifikasi" },
  { id: "diskon", label: "Diskon & Promo" },
];

const KEYS_TAB = {
  invoice: ["invoice_prefix", "invoice_digit", "invoice_mulai", "invoice_footer"],
  operasional: [
    "jam_mode",
    "jam_buka",
    "jam_tutup",
    "notif_jam",
    "aturan_ambil_cepat",
    "aturan_ambil_telat",
    "aturan_dp",
    "gabung_status",
    "basis_pendapatan",
    "denda_aktif",
    "denda_dispensasi_menit",
    "auto_logout_minutes",
    "dp_hangus_aktif",
    "dp_hangus_aturan",
    "printilan_daftar",
    "printilan_invoice_mode",
  ],
  tampilan: [
    "board_mode",
    "cari_sembunyikan_riwayat",
    "kalender_selesai",
  ],
  integrasi: [
    "tg_aktif",
    "tg_botToken",
    "tg_chatId",
    "tg_kirimSukses",
    "tg_kirimGagal",
    "tg_topicLogin",
  ],
  diskon: ["diskon_stack", "diskon_maks_persen", "promo_min_transaksi"],
};

/* Ikon kecil stroke 1.5 (mengikuti gaya ikon layout) */
const Ikon = {
  dok: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
    </svg>
  ),
  jam: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  ),
  mata: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  ),
  plug: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 2v6" />
      <path d="M15 2v6" />
      <path d="M6 8h12v4a6 6 0 0 1-12 0z" />
      <path d="M12 18v4" />
    </svg>
  ),
  tag: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
      <line x1="7" y1="7" x2="7.01" y2="7" />
    </svg>
  ),
};

const IKON_TAB = {
  invoice: Ikon.dok,
  operasional: Ikon.jam,
  tampilan: Ikon.mata,
  integrasi: Ikon.plug,
  diskon: Ikon.tag,
};

/* ===== Komponen kecil ===== */

function Field({ label, hint, children }) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-gray-700">
        {label}
      </label>
      {children}
      {hint && (
        <p className="mt-1.5 text-xs leading-relaxed text-gray-500">{hint}</p>
      )}
    </div>
  );
}

/* Kontrol segmented (pengganti 2 tombol terpisah di SettingsModal) */
function Seg({ value, onChange, options }) {
  return (
    <div className="inline-flex flex-wrap gap-1 rounded-lg bg-gray-100 p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          aria-pressed={value === o.value}
          className={`rounded-md border-0 px-3.5 py-1.5 text-sm font-medium transition-colors ${
            value === o.value
              ? "bg-[#7181E0] text-white shadow-sm"
              : "text-gray-600 hover:bg-white hover:text-gray-900"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function KartuSeksi({ ikon, judul, deskripsi, children }) {
  return (
    <section className="pengaturan-in rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="flex items-start gap-3 border-b border-gray-100 px-6 py-5">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#7181E0]/10 text-[#7181E0] [&>svg]:h-5 [&>svg]:w-5">
          {ikon}
        </span>
        <div>
          <h3 className="m-0 text-base font-semibold text-gray-900">{judul}</h3>
          {deskripsi && (
            <p className="m-0 mt-1 text-xs leading-relaxed text-gray-500">
              {deskripsi}
            </p>
          )}
        </div>
      </div>
      <div className="space-y-5 p-6">{children}</div>
    </section>
  );
}

/* ===== DP Hangus Aturan Editor (table) ===== */
const DEFAULT_ATURAN_DP = [
  { min_hari: 7, persentase: 100 },
  { min_hari: 3, persentase: 100 },
  { min_hari: 0, persentase: 100 },
];

function DpHangusAturanEditor({ value, onChange }) {
  let rows = [];
  try {
    rows = value ? (typeof value === "string" ? JSON.parse(value) : value) : [];
  } catch { /* ignore */ }
  if (!rows.length) rows = DEFAULT_ATURAN_DP;

  const update = (newRows) => onChange(JSON.stringify(newRows));

  const tambah = () => {
    const last = rows[rows.length - 1];
    update([...rows, { min_hari: (last?.min_hari || 0) - 1, persentase: 100 }]);
  };

  const hapus = (idx) => {
    update(rows.filter((_, i) => i !== idx));
  };

  const ubahField = (idx, field, val) => {
    const copy = rows.map((r, i) =>
      i === idx ? { ...r, [field]: Number(val) || 0 } : r,
    );
    update(copy);
  };

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-xs uppercase text-gray-500">
          <tr>
            <th className="px-4 py-2 text-left">Hari Sebelum Jadwal (≥)</th>
            <th className="px-4 py-2 text-left">DP Hangus (%)</th>
            <th className="px-4 py-2 text-center w-16">Aksi</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-gray-100">
              <td className="px-4 py-2">
                <input
                  type="number"
                  min="0"
                  value={r.min_hari}
                  onChange={(e) => ubahField(i, "min_hari", e.target.value)}
                  className="w-24 rounded border border-gray-200 px-2 py-1 text-sm outline-none focus:border-[#7181E0]"
                />
              </td>
              <td className="px-4 py-2">
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={r.persentase}
                  onChange={(e) => ubahField(i, "persentase", e.target.value)}
                  className="w-24 rounded border border-gray-200 px-2 py-1 text-sm outline-none focus:border-[#7181E0]"
                />
                <span className="ml-1 text-xs text-gray-400">%</span>
              </td>
              <td className="px-4 py-2 text-center">
                <button
                  type="button"
                  onClick={() => hapus(i)}
                  className="rounded p-1 text-red-400 hover:bg-red-50 hover:text-red-600"
                  title="Hapus aturan ini"
                >
                  &times;
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="border-t border-gray-100 px-4 py-2">
        <button
          type="button"
          onClick={tambah}
          className="text-xs font-medium text-[#7181E0] hover:underline"
        >
          + Tambah Tier
        </button>
      </div>
    </div>
  );
}

function BarisSimpan({ dirty, saving, onSimpan, label = "Simpan Perubahan" }) {
  return (
    <div className="flex items-center justify-end gap-3 pt-1">
      {dirty && !saving && (
        <span className="text-xs font-medium text-amber-600">
          Ada perubahan belum disimpan
        </span>
      )}
      {saving && <span className="text-xs text-gray-500">Menyimpan…</span>}
      <button
        type="button"
        onClick={onSimpan}
        disabled={!dirty || saving}
        className={BTN_UTAMA}
      >
        {label}
      </button>
    </div>
  );
}

/* ===== Halaman ===== */

export default function PengaturanPage() {
  const { notify } = useNotify();
  const [userRole, setUserRole] = useState("");
  const [tab, setTab] = useState("invoice");
  const [form, setForm] = useState(null);
  const [init, setInit] = useState(null);
  const [saving, setSaving] = useState(false);
  const [printilanBaru, setPrintilanBaru] = useState("");

  /* Muat semua setting + role (pola halaman dashboard lain) */
  useEffect(() => {
    let aktif = true;
    (async () => {
      let email = "";
      let role = "";
      try {
        const me = await api.auth.me();
        email = me?.user?.email || "";
        role = me?.user?.role || "";
      } catch {}
      if (!aktif) return;
      setUserRole(role);

      /* Setting diskon dibaca tenant (sama seperti halaman member/booking) */
      const [diskStack, diskMaks, promoMin, printilanDaftar, printilanMode] =
        await Promise.all([
          getSettingTenant("diskon_stack", "terbesar"),
          getSettingTenant("diskon_maks_persen", 50),
          getSettingTenant("promo_min_transaksi", 0),
          getSettingTenant("printilan_daftar", []),
          getSettingTenant("printilan_invoice_mode", "dicentang"),
        ]);

      const f = {
        invoice_prefix: getSetting("invoice_prefix", "INV") || "",
        invoice_digit: String(getSetting("invoice_digit", "6") || "6"),
        invoice_mulai: String(getSetting("invoice_mulai", "1") || "1"),
        invoice_footer: getSetting("invoice_footer", "") || "",
        jam_mode: getSetting("jam_mode", "buka_tutup") || "buka_tutup",
        jam_buka: String(getSetting("jam_buka", "6") ?? "6"),
        jam_tutup: String(getSetting("jam_tutup", "22") ?? "22"),
        notif_jam: String(getSetting("notif_jam", "2") || "2"),
        aturan_ambil_cepat:
          getSetting("aturan_ambil_cepat", "rencana") || "rencana",
        aturan_ambil_telat:
          getSetting("aturan_ambil_telat", "aktual") || "aktual",
        aturan_dp: getSetting("aturan_dp", "bebas") || "bebas",
        gabung_status: getSetting("gabung_status", "booking") || "booking",
        basis_pendapatan:
          getSetting("basis_pendapatan", "selesai") || "selesai",
        denda_aktif: getSetting("denda_aktif", "1") || "1",
        denda_dispensasi_menit: String(
          getSetting("denda_dispensasi_menit", "15") ?? "15",
        ),
        auto_logout_minutes: String(
          getSetting("auto_logout_minutes", "15") ?? "15",
        ),
        dp_hangus_aktif: getSetting("dp_hangus_aktif", "1") === "1" ? "1" : "0",
        dp_hangus_aturan: getSetting("dp_hangus_aturan", "") || "",
        board_mode: getSetting("board_mode", "scroll") || "scroll",
        cari_sembunyikan_riwayat:
          getSetting("cari_sembunyikan_riwayat", "0") || "0",
        kalender_selesai: getSetting("kalender_selesai", "tampil") || "tampil",
        
        diskon_stack: diskStack || "terbesar",
        diskon_maks_persen: String(diskMaks ?? 50),
        promo_min_transaksi: String(promoMin ?? 0),
        printilan_daftar: Array.isArray(printilanDaftar) ? printilanDaftar : [],
        printilan_invoice_mode: printilanMode || "dicentang",
        /* Telegram — config milik superadmin (pola halaman Log Login) */
        tg_aktif: false,
        tg_botToken: "",
        tg_chatId: "",
        tg_kirimSukses: true,
        tg_kirimGagal: true,
        tg_topicLogin: "4",
      };

      if (role === ROLE_SUPERADMIN) {
        const cfg = await getSettingTenant("telegram_login_notif", {});
        f.tg_aktif = Boolean(cfg?.aktif);
        f.tg_botToken = cfg?.botToken || "";
        f.tg_chatId = cfg?.chatId || "";
        f.tg_kirimSukses = cfg?.kirimSukses !== false;
        f.tg_kirimGagal = cfg?.kirimGagal !== false;
        f.tg_topicLogin =
          cfg?.topicLogin != null ? String(cfg.topicLogin) : "4";
      }

      if (!aktif) return;
      setForm(f);
      setInit(f);
    })();
    return () => {
      aktif = false;
    };
  }, []);

  const ubah = (k) => (e) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  /* Input angka: hanya digit, opsional batas atas */
  const ubahAngka = (k, maks = null) => (e) => {
    let v = e.target.value.replace(/\D/g, "");
    if (maks != null && v !== "" && Number(v) > maks) v = String(maks);
    setForm((f) => ({ ...f, [k]: v }));
  };

  const setNilai = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const tambahPrintilan = () => {
    const val = printilanBaru.trim();
    if (!val) return;
    setForm((f) => {
      const arr = f.printilan_daftar || [];
      if (arr.includes(val)) return f;
      return { ...f, printilan_daftar: [...arr, val] };
    });
    setPrintilanBaru("");
  };

  const dirtyTab = (keys) =>
    !!form && !!init && keys.some((k) => form[k] !== init[k]);

  const selesaiSimpan = (keys, labelSeksi) => {
    setInit((prev) => {
      const baru = { ...prev };
      keys.forEach((k) => {
        baru[k] = form[k];
      });
      return baru;
    });
    window.dispatchEvent(new CustomEvent("settingChanged"));
    notify(`Pengaturan ${labelSeksi} disimpan.`);
  };

  async function simpanSeksi() {
    if (!form) return;
    setSaving(true);
    const f = form;
    try {
      if (tab === "invoice") {
        const prefix = f.invoice_prefix.trim() || "INV";
        const digit =
          f.invoice_digit === "" ? "6" : String(Math.max(1, Math.min(10, Number(f.invoice_digit))));
        const mulai =
          f.invoice_mulai === "" || Number(f.invoice_mulai) < 1
            ? "1"
            : f.invoice_mulai;
        setSetting("invoice_prefix", prefix);
        setSetting("invoice_digit", digit);
        setSetting("invoice_mulai", mulai);
        /* Samakan perilaku SettingsModal: reset counter biar nomor berikutnya mulai dari nilai baru */
        setSetting("invoice_counter", String((parseInt(mulai, 10) || 1) - 1));
        setSetting("invoice_footer", f.invoice_footer);
        setForm((p) => ({
          ...p,
          invoice_prefix: prefix,
          invoice_digit: digit,
          invoice_mulai: mulai,
        }));
        selesaiSimpan(["invoice_prefix", "invoice_digit", "invoice_mulai", "invoice_footer"], "Invoice");
      } else if (tab === "operasional") {
        setSetting("jam_mode", f.jam_mode || "buka_tutup");
        setSetting("jam_buka", f.jam_buka === "" ? 6 : Number(f.jam_buka));
        setSetting("jam_tutup", f.jam_tutup === "" ? 22 : Number(f.jam_tutup));
        setSetting("notif_jam", f.notif_jam === "" ? "2" : f.notif_jam);
        setSetting("aturan_ambil_cepat", f.aturan_ambil_cepat || "rencana");
        setSetting("aturan_ambil_telat", f.aturan_ambil_telat || "aktual");
        setSetting("aturan_dp", f.aturan_dp || "bebas");
        setSetting("gabung_status", f.gabung_status || "booking");
        setSetting("basis_pendapatan", f.basis_pendapatan || "selesai");
        setSetting("denda_aktif", f.denda_aktif === "1" ? "1" : "0");
        setSetting(
          "denda_dispensasi_menit",
          f.denda_dispensasi_menit === "" ? "15" : f.denda_dispensasi_menit,
        );
        setSetting(
          "auto_logout_minutes",
          f.auto_logout_minutes === "" ? "0" : f.auto_logout_minutes,
        );
        setSetting("dp_hangus_aktif", f.dp_hangus_aktif === "1" ? "1" : "0");
        setSetting("dp_hangus_aturan", f.dp_hangus_aturan || "");
        // Printilan: daftar disimpan sebagai array (setSettingTenant), mode sebagai string (setSetting)
        await setSettingTenant("printilan_daftar", f.printilan_daftar || []);
        setSetting("printilan_invoice_mode", f.printilan_invoice_mode || "dicentang");
        selesaiSimpan(KEYS_TAB.operasional, "Operasional");
      } else if (tab === "tampilan") {
        setSetting("board_mode", f.board_mode === "stack" ? "stack" : "scroll");
        setSetting(
          "cari_sembunyikan_riwayat",
          f.cari_sembunyikan_riwayat === "1" ? "1" : "0",
        );
        setSetting(
          "kalender_selesai",
          f.kalender_selesai === "sembunyi" ? "sembunyi" : "tampil",
        );
        selesaiSimpan(KEYS_TAB.tampilan, "Tampilan");
      } else if (tab === "integrasi") {
        if (userRole === ROLE_SUPERADMIN) {
          const hasil = await setSettingTenant("telegram_login_notif", {
            aktif: f.tg_aktif,
            botToken: f.tg_botToken.trim(),
            chatId: f.tg_chatId.trim(),
            kirimSukses: f.tg_kirimSukses,
            kirimGagal: f.tg_kirimGagal,
            topicLogin:
              f.tg_topicLogin === "" ? null : parseInt(f.tg_topicLogin, 10),
          });
          if (!hasil.ok)
            return notify(`Gagal menyimpan Telegram: ${hasil.error}`, "error");
        }
        selesaiSimpan(KEYS_TAB.integrasi, "Integrasi & Notifikasi");
      } else if (tab === "diskon") {
        setSetting("diskon_stack", f.diskon_stack || "terbesar");
        const maks = Math.min(
          100,
          Math.max(0, parseInt(f.diskon_maks_persen, 10) || 0),
        );
        const min = Math.max(0, parseInt(f.promo_min_transaksi, 10) || 0);
        setSetting("diskon_maks_persen", maks);
        setSetting("promo_min_transaksi", min);
        setForm((p) => ({
          ...p,
          diskon_maks_persen: String(maks),
          promo_min_transaksi: String(min),
        }));
        selesaiSimpan(["diskon_stack", "diskon_maks_persen", "promo_min_transaksi"], "Diskon & Promo");
      }
    } finally {
      setSaving(false);
    }
  }

  async function tesTelegram() {
    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/api/telegram/test`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok)
        return notify(data.error || "Gagal mengirim pesan uji.", "error");
      notify("Pesan uji terkirim ke Telegram. Cek chat Anda.");
    } catch {
      notify("Gagal mengirim pesan uji.", "error");
    } finally {
      setSaving(false);
    }
  }

  if (!form) {
    return <LoadingOverlay />;
  }

  const f = form;
  const contohInvoice = `${f.invoice_prefix || "INV"}-${String(
    f.invoice_mulai || "1",
  ).padStart(
    Math.max(1, Math.min(10, Number(f.invoice_digit) || 6)),
    "0",
  )}`;

  return (
    <div className="w-full max-w-6xl mx-auto">
      <style>{`
        @keyframes pengaturanIn {
          from { opacity: 0; transform: translateY(6px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .pengaturan-in { animation: pengaturanIn .28s ease both; }
      `}</style>

      <div className="mb-6">
        <h2 className="text-2xl font-bold tracking-tight leading-tight">
          Pengaturan
        </h2>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-4">
        {/* Menu tab — vertikal & sticky di layar lebar, baris scroll di mobile */}
        <aside className="lg:col-span-1">
          <nav className="flex gap-1 overflow-x-auto pb-1 lg:sticky lg:top-6 lg:flex-col lg:gap-1 lg:overflow-visible lg:pb-0">
            {TABS.filter(
              (t) => t.id !== "integrasi" || userRole === ROLE_SUPERADMIN,
            ).map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                aria-pressed={tab === t.id}
                aria-current={tab === t.id ? "page" : undefined}
                className={`flex shrink-0 items-center gap-2 whitespace-nowrap rounded-lg border-0 px-3.5 py-2 text-sm font-semibold transition-colors lg:w-full lg:justify-start ${
                  tab === t.id
                    ? "bg-[#7181E0] text-white"
                    : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                }`}
              >
                <span className="h-4 w-4 shrink-0 [&>svg]:h-4 [&>svg]:w-4">
                  {IKON_TAB[t.id]}
                </span>
                {t.label}
              </button>
            ))}
          </nav>
        </aside>

        {/* ===== Konten tab aktif ===== */}
        <div className="min-w-0 lg:col-span-3">
      {/* ===== Tab: Invoice & Dokumen ===== */}
      {tab === "invoice" && (
        <KartuSeksi
          ikon={Ikon.dok}
          judul="Invoice & Dokumen"
          deskripsi="Format penomoran dan teks yang tampil pada invoice dan nota penyewa."
        >
          <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
            <Field label="Awalan Nomor Invoice" >
              <input
                value={f.invoice_prefix}
                onChange={ubah("invoice_prefix")}
                className={INPUT_CLS}
                placeholder="INV"
              />
            </Field>
            <Field
              label="Jumlah Digit"
            >
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={f.invoice_digit}
                onChange={ubahAngka("invoice_digit", 10)}
                className={INPUT_CLS}
                placeholder="6"
              />
            </Field>
            <Field
              label="Mulai Dari Nomor"
            >
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={f.invoice_mulai}
                onChange={ubahAngka("invoice_mulai")}
                className={INPUT_CLS}
                placeholder="1"
              />
            </Field>
          </div>

          <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 px-4 py-3">
            <p className="m-0 text-xs font-semibold uppercase tracking-wide text-gray-500">
              Contoh nomor berikutnya
            </p>
            <p className="m-0 mt-1 font-mono text-lg font-bold tracking-wide text-[#7181E0]">
              {contohInvoice}
            </p>
          </div>

          <Field
            label="Footer Invoice"
            hint="Tampil di bagian bawah invoice."
          >
            <textarea
              value={f.invoice_footer}
              onChange={ubah("invoice_footer")}
              rows={3}
              className={INPUT_CLS}
              placeholder="Terima kasih. Harap kembalikan barang lengkap sesuai Nomor Seri..."
            />
          </Field>

          <BarisSimpan
            dirty={dirtyTab(KEYS_TAB.invoice)}
            saving={saving}
            onSimpan={simpanSeksi}
          />
        </KartuSeksi>
      )}

      {/* ===== Tab: Operasional ===== */}
      {tab === "operasional" && (
        <KartuSeksi
          ikon={Ikon.jam}
          judul="Operasional"
          deskripsi="Jam operasional toko, aturan sewa, denda, dan keamanan akun."
        >
          <Field label="Jam Operasional">
            <Seg
              value={f.jam_mode}
              onChange={(v) => setNilai("jam_mode", v)}
              options={[
                { value: "buka_tutup", label: "Mengikuti Jam Buka-Tutup" },
                { value: "fleksibel", label: "Fleksibel (bebas 24 jam)" },
              ]}
            />
          </Field>

          {f.jam_mode === "buka_tutup" && (
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
              <Field label="Jam Buka">
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={f.jam_buka}
                  onChange={ubahAngka("jam_buka", 23)}
                  className={INPUT_CLS}
                  placeholder="6"
                />
              </Field>
              <Field label="Jam Tutup">
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={f.jam_tutup}
                  onChange={ubahAngka("jam_tutup", 23)}
                  className={INPUT_CLS}
                  placeholder="22"
                />
              </Field>
            </div>
          )}
          {f.jam_mode === "buka_tutup" ? (
            <p className="-mt-2 text-xs leading-relaxed text-gray-500">
              Di form booking, waktu ambil di luar rentang jam{" "}
              <strong>{f.jam_buka || "6"}:00</strong> s/d{" "}
              <strong>{f.jam_tutup || "22"}:00</strong> tidak bisa dipilih.
              Waktu kembali tetap bebas.
            </p>
          ) : (
            <p className="-mt-2 text-xs leading-relaxed text-gray-500">
              Waktu ambil bisa dipilih kapan saja (24 jam) di form booking.
            </p>
          )}

          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            <Field
              label="Peringatan Mendekati Kembali (jam)"
              hint={`Transaksi dengan sisa waktu ≤ ${
                f.notif_jam || "2"
              } jam masuk board Mendekati.`}
            >
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={f.notif_jam}
                onChange={ubahAngka("notif_jam")}
                className={INPUT_CLS}
                placeholder="2"
              />
            </Field>
            <Field
              label="Logout Otomatis (menit)"
              hint="Semua akun di bisnis Anda logout otomatis setelah tidak ada aktivitas selama menit ini. 0 = nonaktif."
            >
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={f.auto_logout_minutes}
                onChange={ubahAngka("auto_logout_minutes")}
                className={INPUT_CLS}
                placeholder="15"
              />
            </Field>
          </div>

          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            <Field
              label="Jika Ambil SEBELUM Jadwal"
              hint="Mempengaruhi hitungan biaya sewa."
            >
              <select
                value={f.aturan_ambil_cepat}
                onChange={ubah("aturan_ambil_cepat")}
                className={INPUT_CLS}
              >
                <option value="rencana">Ikuti Jadwal (dari jadwal awal)</option>
                <option value="aktual">
                  Ikuti Aktual (dari waktu ambil sebenarnya)
                </option>
              </select>
            </Field>
            <Field
              label="Jika Ambil SETELAH Jadwal"
              hint="Mempengaruhi hitungan biaya saat Serahkan / Terima Kembali."
            >
              <select
                value={f.aturan_ambil_telat}
                onChange={ubah("aturan_ambil_telat")}
                className={INPUT_CLS}
              >
                <option value="rencana">Ikuti Jadwal (dari jadwal awal)</option>
                <option value="aktual">
                  Ikuti Aktual (dari waktu ambil sebenarnya)
                </option>
              </select>
            </Field>
          </div>

          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            <Field label="Aturan DP (Uang Muka)">
              <select
                value={f.aturan_dp}
                onChange={ubah("aturan_dp")}
                className={INPUT_CLS}
              >
                <option value="bebas">Bebas</option>
                <option value="wajib">Wajib DP</option>
              </select>
              <p className="mt-1.5 text-xs leading-relaxed text-gray-500">
                {f.aturan_dp === "wajib"
                  ? "Form booking mewajibkan isi DP sebelum transaksi bisa disimpan."
                  : "Booking boleh tanpa DP — ditandai Belum DP (belum terkunci) sampai DP dibayar."}
              </p>
            </Field>
            <Field
              label="Gabung Booking Identitas Sama"
              hint="Tawaran gabung item muncul saat identitas penyewa & periode sama persis dengan booking aktif."
            >
              <select
                value={f.gabung_status}
                onChange={ubah("gabung_status")}
                className={INPUT_CLS}
              >
                <option value="booking">Hanya status Booking (belum diambil)</option>
                <option value="booking_disewa">Booking & Disewa (sudah diambil)</option>
              </select>
            </Field>
          </div>

          <Field
            label="Basis Pendapatan"
            hint="Mempengaruhi kartu Total Pendapatan di Dashboard dan rekap di Laporan Keuangan."
          >
            <select
              value={f.basis_pendapatan}
              onChange={ubah("basis_pendapatan")}
              className={INPUT_CLS}
            >
              <option value="selesai">Hanya Selesai</option>
              <option value="aktif">Selesai + Sedang Disewa</option>
              <option value="semua">Semua (termasuk Booking)</option>
            </select>
          </Field>

          <Field label="Denda Keterlambatan">
            <Seg
              value={f.denda_aktif}
              onChange={(v) => setNilai("denda_aktif", v)}
              options={[
                { value: "1", label: "Aktif" },
                { value: "0", label: "Mati" },
              ]}
            />
            <p className="mt-1.5 text-xs leading-relaxed text-gray-500">
              {f.denda_aktif === "1"
                ? "Transaksi telat dihitung denda otomatis — admin masih bisa memilih tanpa denda saat Terima Kembali."
                : "Transaksi telat diproses tanpa peringatan denda sama sekali."}
            </p>
          </Field>

          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            <Field
              label="Dispensasi Terlambat Bebas Denda (menit)"
              hint="Keterlambatan di bawah angka ini tidak dikenakan denda."
            >
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={f.denda_dispensasi_menit}
                onChange={ubahAngka("denda_dispensasi_menit")}
                className={INPUT_CLS}
                placeholder="15"
              />
            </Field>
          </div>

          <div className="border-t border-gray-100 pt-5">
            <Field label="Aturan DP Hangus (saat pembatalan)">
              <Seg
                value={f.dp_hangus_aktif}
                onChange={(v) => setNilai("dp_hangus_aktif", v)}
                options={[
                  { value: "1", label: "Otomatis" },
                  { value: "0", label: "Manual" },
                ]}
              />
              <p className="mt-1.5 text-xs leading-relaxed text-gray-500">
                {f.dp_hangus_aktif === "1"
                  ? "Saat booking dibatalkan, jumlah DP hangus dihitung otomatis berdasarkan aturan di bawah."
                  : "Saat booking dibatalkan, admin menginput jumlah DP hangus secara manual."}
              </p>
            </Field>
            {f.dp_hangus_aktif === "1" && (
              <div className="mt-4">
                <label className="mb-2 block text-sm font-medium text-gray-700">
                  Tabel Aturan (berdasarkan hari sebelum jadwal ambil)
                </label>
                <p className="mb-3 text-xs text-gray-500">
                  Aturan diterapkan dari tier terbesar ke terkecil. Persentase = bagian DP yang hangus (tidak dikembalikan).
                </p>
                <DpHangusAturanEditor
                  value={f.dp_hangus_aturan}
                  onChange={(v) => setNilai("dp_hangus_aturan", v)}
                />
              </div>
            )}
          </div>

          <div className="border-t border-gray-100 pt-5">
            <Field
              label="Daftar Printilan"
              hint="Item yang muncul sebagai pilihan checklist saat membuat booking."
            >
              <div className="mb-3 flex flex-wrap gap-2">
                {(f.printilan_daftar || []).map((item, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-3 py-1 text-sm font-medium text-gray-700"
                  >
                    {item}
                    <button
                      type="button"
                      onClick={() => {
                        const arr = [...(f.printilan_daftar || [])];
                        arr.splice(i, 1);
                        setNilai("printilan_daftar", arr);
                      }}
                      className="border-0 bg-transparent px-0.5 text-gray-400 hover:text-red-500"
                      title="Hapus printilan ini"
                    >
                      &times;
                    </button>
                  </span>
                ))}
                {!(f.printilan_daftar || []).length && (
                  <span className="text-xs text-gray-400">
                    Belum ada printilan.
                  </span>
                )}
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={printilanBaru}
                  onChange={(e) => setPrintilanBaru(e.target.value)}
                  placeholder="Nama printilan..."
                  className={INPUT_CLS}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter") return;
                    e.preventDefault();
                    tambahPrintilan();
                  }}
                />
                <button
                  type="button"
                  onClick={tambahPrintilan}
                  disabled={!printilanBaru.trim()}
                  className={BTN_SEKUNDER}
                >
                  Tambah
                </button>
              </div>
            </Field>

            <div className="mt-4">
              <Field label="Tampilan Printilan di Invoice">
                <Seg
                  value={f.printilan_invoice_mode}
                  onChange={(v) => setNilai("printilan_invoice_mode", v)}
                  options={[
                    { value: "dicentang", label: "Hanya Dicentang" },
                    { value: "semua", label: "Semua + Tanda" },
                  ]}
                />
                <p className="mt-1.5 text-xs leading-relaxed text-gray-500">
                  {f.printilan_invoice_mode === "semua"
                    ? "Invoice menampilkan semua daftar printilan, tandai mana yang dicentang (✓/✗)."
                    : "Invoice hanya menampilkan printilan yang dicentang admin saat booking."}
                </p>
              </Field>
            </div>
          </div>

          <BarisSimpan
            dirty={dirtyTab(KEYS_TAB.operasional)}
            saving={saving}
            onSimpan={simpanSeksi}
          />
        </KartuSeksi>
      )}

      {/* ===== Tab: Tampilan ===== */}
      {tab === "tampilan" && (
        <KartuSeksi
          ikon={Ikon.mata}
          judul="Tampilan & Personalisasi"
          deskripsi="Preferensi tampilan board, kalender, dan pencarian."
        >
          <Field
            label="Tampilan Board Status Sewa"
          >
            <Seg
              value={f.board_mode}
              onChange={(v) => setNilai("board_mode", v)}
              options={[
                { value: "scroll", label: "Geser" },
                { value: "stack", label: "Tumpuk" },
              ]}
            />
          </Field>

          <Field
            label="Sembunyikan Riwayat di Pencarian"
            hint="Saat aktif, hasil pencarian penyewa tidak menampilkan transaksi yang sudah Selesai atau Dibatalkan."
          >
            <Seg
              value={f.cari_sembunyikan_riwayat}
              onChange={(v) => setNilai("cari_sembunyikan_riwayat", v)}
              options={[
                { value: "0", label: "Tampilkan Riwayat" },
                { value: "1", label: "Sembunyikan Riwayat" },
              ]}
            />
          </Field>

          <Field
            label="Transaksi Selesai di Kalender"
            hint="Sembunyikan untuk merapikan kalender jadwal agar hanya menampilkan transaksi aktif."
          >
            <Seg
              value={f.kalender_selesai}
              onChange={(v) => setNilai("kalender_selesai", v)}
              options={[
                { value: "tampil", label: "Tampil" },
                { value: "sembunyi", label: "Sembunyi" },
              ]}
            />
          </Field>

          <BarisSimpan
            dirty={dirtyTab(KEYS_TAB.tampilan)}
            saving={saving}
            onSimpan={simpanSeksi}
          />
        </KartuSeksi>
      )}

      {/* ===== Tab: Integrasi & Notifikasi ===== */}
      {tab === "integrasi" && (
        <div className="space-y-6">
          {userRole === ROLE_SUPERADMIN && (
            <KartuSeksi
              ikon={Ikon.plug}
              judul="Notifikasi Telegram (Super Admin)"
              deskripsi="Kirim notifikasi login ke Telegram untuk memantau semua aktivitas login di aplikasi."
            >
              <Field label="Status Notifikasi">
                <Seg
                  value={f.tg_aktif ? "1" : "0"}
                  onChange={(v) => setNilai("tg_aktif", v === "1")}
                  options={[
                    { value: "1", label: "Aktif" },
                    { value: "0", label: "Mati" },
                  ]}
                />
                <p className="mt-1.5 text-xs leading-relaxed text-gray-500">
                  Superadmin menerima notifikasi untuk semua login di aplikasi
                  (sukses & gagal), lintas tenant.
                </p>
              </Field>

              <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                <Field
                  label="Bot Token"
                  hint="Dari @BotFather di Telegram. Disimpan di pengaturan akun Anda."
                >
                  <PasswordInput
                    value={f.tg_botToken}
                    onChange={ubah("tg_botToken")}
                    placeholder="123456:ABC-DEF..."
                  />
                </Field>
                <Field
                  label="Chat ID"
                  hint="ID chat Telegram Anda. Cara dapat: kirim pesan ke bot, lalu buka https://api.telegram.org/bot&lt;TOKEN&gt;/getUpdates"
                >
                  <input
                    value={f.tg_chatId}
                    onChange={ubah("tg_chatId")}
                    className={INPUT_CLS}
                    placeholder="mis. 123456789"
                  />
                </Field>
              </div>

              <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
                <Field label="Notifikasi Login Sukses">
                  <Seg
                    value={f.tg_kirimSukses ? "1" : "0"}
                    onChange={(v) => setNilai("tg_kirimSukses", v === "1")}
                    options={[
                      { value: "1", label: "Kirim" },
                      { value: "0", label: "Jangan" },
                    ]}
                  />
                </Field>
                <Field label="Notifikasi Login Gagal">
                  <Seg
                    value={f.tg_kirimGagal ? "1" : "0"}
                    onChange={(v) => setNilai("tg_kirimGagal", v === "1")}
                    options={[
                      { value: "1", label: "Kirim" },
                      { value: "0", label: "Jangan" },
                    ]}
                  />
                </Field>
                <Field
                  label="Topic ID (Log Login)"
                  hint="Khusus grup dengan topik. Kosongkan jika tidak memakai topik."
                >
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={f.tg_topicLogin}
                    onChange={ubahAngka("tg_topicLogin")}
                    className={INPUT_CLS}
                    placeholder="mis. 4"
                  />
                </Field>
              </div>

              <div className="flex flex-wrap items-center justify-end gap-3 pt-1">
                {dirtyTab([
                  "tg_aktif",
                  "tg_botToken",
                  "tg_chatId",
                  "tg_kirimSukses",
                  "tg_kirimGagal",
                  "tg_topicLogin",
                ]) && !saving && (
                  <span className="text-xs font-medium text-amber-600">
                    Ada perubahan belum disimpan
                  </span>
                )}
                <button
                  type="button"
                  onClick={tesTelegram}
                  disabled={saving}
                  className={BTN_SEKUNDER}
                >
                  Kirim Pesan Uji
                </button>
                <button
                  type="button"
                  onClick={simpanSeksi}
                  disabled={saving || !dirtyTab(KEYS_TAB.integrasi)}
                  className={BTN_UTAMA}
                >
                  Simpan Perubahan
                </button>
              </div>
            </KartuSeksi>
          )}
        </div>
      )}

      {/* ===== Tab: Diskon & Promo ===== */}
      {tab === "diskon" && (
        <KartuSeksi
          ikon={Ikon.tag}
          judul="Diskon & Promo"
          deskripsi="Aturan diskon member dan syarat promo saat membuat booking."
        >
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            <Field
              label="Batas Maksimal Diskon (%)"
            >
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={f.diskon_maks_persen}
                onChange={ubahAngka("diskon_maks_persen", 100)}
                className={INPUT_CLS}
                placeholder="50"
              />
            </Field>
            <Field
              label="Minimal Transaksi Promo (Rp)"
            >
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={f.promo_min_transaksi}
                onChange={ubahAngka("promo_min_transaksi")}
                className={INPUT_CLS}
                placeholder="0"
              />
            </Field>
          </div>

          <Field
            label="Cara Diskon Berpadu dengan Promo"
            hint="Ketika member punya diskon dan ada kode promo sekaligus."
          >
            <select
              value={f.diskon_stack}
              onChange={ubah("diskon_stack")}
              className={INPUT_CLS}
            >
              <option value="terbesar">Pilih diskon terbesar</option>
              <option value="gabung">Boleh digabung</option>
              <option value="satu">Hanya satu jenis</option>
            </select>
          </Field>

          <BarisSimpan
            dirty={dirtyTab(KEYS_TAB.diskon)}
            saving={saving}
            onSimpan={simpanSeksi}
          />
        </KartuSeksi>
      )}
        </div>
      </div>
    </div>
  );
}
