"use client";

import { useState, useEffect, useCallback, memo, useRef, useMemo } from "react";
import { getSetting, getInventory, updateInventory, getTransactions, getTransactionsSelesai, getTransactionsBelumSelesai, getTransactionById, getTransactionItemsBulk, updateTransactions, tambahLogs, getNamaInvoice, uploadBuktiBayar, getUrlBuktiBayar } from "@/lib/db";
import { createPortal } from "react-dom";
import { api } from "@/lib/api-client";
import {
  formatAngkaInput,
  formatRupiah,
  formatTanggal,
  hitungDurasiDenganAturan,
  hitungPembayaran,
  kondisiUnit,
  catatanUnit,
  opsiKondisi,
  snsDirujukLainnya,
} from "@/lib/utils";
import { useNotify } from "@/components/NotificationProvider";
import { useTransactionsAktif } from "@/hooks/useTransactions";
import { getFITUR } from "@/lib/features";
import { ROLE_OWNER, ROLE_SUPERADMIN } from "@/lib/role";
import DateTimePicker from "@/components/DateTimePicker";

// Inisial avatar dari S/N: potongan paling kiri (max 4 char), fallback karakter pertama.
function inisialSN(sn) {
  const s = String(sn || "");
  return (s.split("-")[0] || s).slice(0, 4) || "?";
}

// Hitung jumlah kondisi live dari daftar entries.
function ringkasKondisi(list) {
  const r = { baik: 0, bermasalah: 0, maintenance: 0 };
  for (const d of list) {
    const k = d?.kondisi || "baik";
    if (r[k] !== undefined) r[k]++;
    else r.baik++;
  }
  return r;
}

// Emoji per value; label teks tetap dari opsiKondisi().
const labelKondisi = (o) => o.label;

const STATUS_CONFIG = {
  Booking: {
    badge: "bg-amber-500 text-white",
    column: "bg-amber-50",
    border: "border-amber-200",
    text: "text-amber-800",
    headerBg: "#f59e0b",
    headerText: "#fff",
  },
  Disewa: {
    badge: "bg-blue-500 text-white",
    column: "bg-blue-50",
    border: "border-blue-200",
    text: "text-blue-800",
    headerBg: "#3b82f6",
    headerText: "#fff",
  },
  Mendekati: {
    badge: "bg-yellow-500 text-white",
    column: "bg-yellow-50",
    border: "border-yellow-200",
    text: "text-yellow-800",
    headerBg: "#eab308",
    headerText: "#fff",
  },
  Telat: {
    badge: "bg-[#F04438] text-white",
    column: "bg-red-50",
    border: "border-red-200",
    text: "text-red-800",
    headerBg: "#F04438",
    headerText: "#fff",
  },
  "Belum Selesai": {
    badge: "bg-indigo-500 text-white",
    column: "bg-indigo-50",
    border: "border-indigo-200",
    text: "text-indigo-800",
    headerBg: "#6366f1",
    headerText: "#fff",
  },
  Selesai: {
    badge: "bg-[#579171] text-white",
    column: "bg-green-50",
    border: "border-green-200",
    text: "text-green-800",
    headerBg: "#579171",
    headerText: "#fff",
  },
};
const BTN_PRIMARY =
  "inline-flex items-center justify-center rounded-lg bg-[#7181E0] hover:bg-[#5d6fcc] px-4 py-2 text-sm font-medium text-white transition-colors border-0 focus:outline-none focus:ring-2 focus:ring-[#7181E0]/40";
const BTN_SUCCESS =
  "inline-flex items-center justify-center rounded-lg bg-[#579171] hover:bg-[#447057] px-4 py-2 text-sm font-medium text-white transition-colors border-0 focus:outline-none focus:ring-2 focus:ring-[#579171]/40";
const BTN_DANGER =
  "inline-flex items-center justify-center rounded-lg bg-[#F04438] hover:bg-[#d03a2f] px-4 py-2 text-sm font-medium text-white transition-colors border-0 focus:outline-none focus:ring-2 focus:ring-[#F04438]/40";
const BTN_SECONDARY =
  "inline-flex items-center justify-center rounded-lg bg-gray-200 hover:bg-gray-300 px-4 py-2 text-sm font-medium text-slate-700 transition-colors border-0 focus:outline-none";
const BTN_GHOST =
  "inline-flex items-center justify-center rounded-lg bg-transparent hover:bg-gray-100 px-4 py-2 text-sm font-medium text-slate-600 transition-colors border-0 focus:outline-none";

const fmtYMD = (d) =>
  d
    ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
    : "";

function buatLog(aktivitas, detail, catatan, waktu, pelayan, trxInfo) {
  return {
    id: Date.now(),
    waktu,
    aktivitas,
    detail,
    catatan,
    pelayan,
    trx_info: trxInfo,
  };
}

function formatJam(iso) {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("id-ID", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function statusBadge(status) {
  return STATUS_CONFIG[status]?.badge || "bg-gray-500 text-white";
}

const LABEL_AKSI = {
  booking: "Booking dibuat",
  edit: "Jadwal diubah",
  serahkan: "Barang diserahkan",
  terima: "Barang dikembalikan",
  bayar: "Pembayaran dicatat",
  edit_bayar: "Pembayaran diubah",
  hapus_bayar: "Pembayaran dihapus",
  batalkan: "Booking dibatalkan",
};

const KartuTrx = memo(function KartuTrx({
  t,
  onAmbil,
  onKembali,
  onBayar,
  onDetail,
  onDragStart,
  onDragEnd,
}) {
  return (
    <div
      draggable={t.status !== "Selesai" && t.status !== "Belum Selesai"}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className="bg-white border-2 border-solid border-slate-200 rounded-xl shadow-sm p-4 mb-2 hover:border-slate-300 transition-colors"
      style={{ cursor: "grab" }}
    >
      <div
        className="flex items-center justify-between mb-2 gap-2"
        style={{ alignItems: "flex-start" }}
      >
        <div>
          <p className="font-mono text-[10px] text-gray-500 mb-0">
            {t.no_invoice}
          </p>
          <p className="font-bold mb-0">{t.penyewa}</p>
          <p className="text-xs text-gray-500 mb-0">{t.hp_penyewa || "-"}</p>
        </div>
        <span
          className={`inline-flex items-center rounded-md px-2 py-1 text-xs font-medium ${statusBadge(t.status)}`}
        >
          {t.status}
        </span>
      </div>
      <div className="flex flex-col gap-1 text-xs text-gray-600 mb-2">
        {(t.items || []).map((i, idx) => (
          <div key={idx} className="truncate">
            • {i.qty}x {i.ref.nama}{" "}
            {i.ref.jenis === "satuan" ? `[${i.sn}]` : ""}
          </div>
        ))}
      </div>
      <div className="text-xs text-gray-500 mb-3">
        <div className="flex flex-col gap-0.5 mb-1">
          <span style={{ color: "#7181E0" }}>
            Ambil: {formatJam(t.waktu_ambil_rencana)}
          </span>
          <span className="text-[#F04438]">
            Kembali: {formatJam(t.waktu_kembali_rencana)}
          </span>
        </div>
        <span className="inline-block rounded-md bg-slate-50 px-1">
          {t.durasi_teks}
        </span>
      </div>
      {(() => {
        const pay = hitungPembayaran(t);
        return (
          <span
            className={`inline-flex items-center rounded-md px-2 py-1 text-xs font-medium mb-2 ${pay.status === "Lunas" ? "bg-[#579171] text-white" : pay.status === "DP" ? "bg-blue-500 text-white" : "bg-[#F04438] text-white"}`}
          >
            {pay.status}
            {pay.status === "Belum Bayar" && t.status === "Booking"
              ? " / Belum DP"
              : ""}
          </span>
        );
      })()}
      {t.dilayani_oleh && (
        <div className="text-xs text-gray-500 mb-2">
          Dilayani oleh: {t.dilayani_oleh}
        </div>
      )}
      <div className="flex items-center gap-2 mt-3">
        {t.status === "Booking" && (
          <button
            onClick={() => onAmbil(t.id)}
            className="inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-brand focus:ring-offset-2 bg-[#7181E0] text-white shadow-sm hover:bg-[#5d6fcc] flex-1 min-w-0 text-xs border-0"
          >
            Serahkan
          </button>
        )}
        {t.status === "Disewa" && (
          <button
            onClick={() => onKembali(t.id)}
            className="inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-brand focus:ring-offset-2 bg-[#579171] text-white shadow-sm hover:bg-[#447057] flex-1 min-w-0 text-xs border-0"
          >
            Terima
          </button>
        )}
        <button
          onClick={() => onBayar(t)}
          className="inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-brand focus:ring-offset-2 bg-[#579171] text-white shadow-sm hover:bg-[#447057] text-xs border-0"
          style={{ fontSize: 11 }}
        >
          Bayar
        </button>
        <button
          onClick={() => onDetail(t)}
          className="inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-brand focus:ring-offset-2 bg-gray-200 text-gray-700 hover:bg-gray-300 text-xs border-0"
          style={{ fontSize: 11 }}
        >
          Detail
        </button>
      </div>
    </div>
  );
});

export default function StatusPage() {
  const { notify, confirm: konfirm, confirmChoice } = useNotify();
  const [trx, setTrx] = useState([]);
  const [selesai, setSelesai] = useState([]);
  const [belumSelesai, setBelumSelesai] = useState([]);
  const [refresh, setRefresh] = useState(0);
  const [loadingAktif, setLoadingAktif] = useState(false);
  const { data: cachedTransactions, refetch: refetchTransactions } =
    useTransactionsAktif();
  const [dragId, setDragId] = useState(null);
  const [detailTrx, setDetailTrx] = useState(null);
  const [bayarTrx, setBayarTrx] = useState(null);
  const [bayarJumlah, setBayarJumlah] = useState("");
  const [bayarMetode, setBayarMetode] = useState("Tunai");
  const [bayarCatatan, setBayarCatatan] = useState("");
  const [bayarBukti, setBayarBukti] = useState(null);
  const bayarBuktiRef = useRef(null);
  const [rentangKunci, setRentangKunci] = useState("7_hari");
  const [kustomMulai, setKustomMulai] = useState("");
  const [kustomAkhir, setKustomAkhir] = useState("");
  const [cariQ, setCariQ] = useState("");
  const [filterWaktuAmbil, setFilterWaktuAmbil] = useState("semua");
  const [urutkan, setUrutkan] = useState("ambil_terdekat");
  const [sembunyikanRiwayat, setSembunyikanRiwayat] = useState(false);
  const [filterPanelTerbuka, setFilterPanelTerbuka] = useState(false);
  const filterSettingsLoaded = useRef(false);
  const filterSettingsKey = "status-filter-settings";

  useEffect(() => {
    try {
      const tersimpan = JSON.parse(
        window.localStorage.getItem(filterSettingsKey) || "null",
      );
      if (tersimpan && typeof tersimpan === "object") {
        if (
          ["hari_ini", "7_hari", "30_hari", "semua", "kustom"].includes(
            tersimpan.rentangKunci,
          )
        )
          setRentangKunci(tersimpan.rentangKunci);
        if (typeof tersimpan.kustomMulai === "string")
          setKustomMulai(tersimpan.kustomMulai);
        if (typeof tersimpan.kustomAkhir === "string")
          setKustomAkhir(tersimpan.kustomAkhir);
        if (["semua", "sudah", "belum"].includes(tersimpan.filterWaktuAmbil))
          setFilterWaktuAmbil(tersimpan.filterWaktuAmbil);
        if (
          ["ambil_terdekat", "ambil_terjauh", "nama_az", "nama_za"].includes(
            tersimpan.sortKunci,
          )
        )
          setUrutkan(tersimpan.sortKunci);
        if (typeof tersimpan.sembunyikanRiwayat === "boolean")
          setSembunyikanRiwayat(tersimpan.sembunyikanRiwayat);
        if (typeof tersimpan.cariQ === "string") setCariQ(tersimpan.cariQ);
      }
    } catch (error) {
      console.warn("Gagal memuat filter status sewa", error);
    }
    filterSettingsLoaded.current = true;
  }, []);

  useEffect(() => {
    if (!filterSettingsLoaded.current) return;
    window.localStorage.setItem(
      filterSettingsKey,
      JSON.stringify({
        rentangKunci,
        kustomMulai,
        kustomAkhir,
        filterWaktuAmbil,
        sortKunci: urutkan,
        sembunyikanRiwayat,
        cariQ,
      }),
    );
  }, [
    rentangKunci,
    kustomMulai,
    kustomAkhir,
    filterWaktuAmbil,
    urutkan,
    sembunyikanRiwayat,
    cariQ,
  ]);

  function resetFilter() {
    setRentangKunci("semua");
    setKustomMulai("");
    setKustomAkhir("");
    setFilterWaktuAmbil("semua");
    setUrutkan("ambil_terdekat");
    setSembunyikanRiwayat(false);
    setCariQ("");
    window.localStorage.removeItem(filterSettingsKey);
  }
  const [userRole, setUserRole] = useState("");
  const [kondisiModal, setKondisiModal] = useState(null);
  const [editBayarIdx, setEditBayarIdx] = useState(null);
  const [editBayarJumlah, setEditBayarJumlah] = useState("");
  const [editBayarMetode, setEditBayarMetode] = useState("Tunai");
  const [editBayarCatatan, setEditBayarCatatan] = useState("");
  const [editBayarBuktiBaru, setEditBayarBuktiBaru] = useState(null);
  const [editBayarBuktiLama, setEditBayarBuktiLama] = useState(null);
  const [editBayarHapusBukti, setEditBayarHapusBukti] = useState(false);
  const editBayarBuktiRef = useRef(null);
  const [boardScrollState, setBoardScrollState] = useState({
    left: true,
    right: false,
  });
  const [submenuOpen, setSubmenuOpen] = useState(false);
  const boardRef = useRef(null);

  useEffect(() => {
    const updateSubmenuState = () => {
      const main = document.querySelector(".dashboard-main");
      setSubmenuOpen(
        Boolean(main?.classList.contains("dashboard-main-with-submenu")),
      );
    };
    updateSubmenuState();

    const observer = new MutationObserver(updateSubmenuState);
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, []);

  const rentangTanggal = (kunci) => {
    const kini = new Date();
    const mulai = new Date(
      kini.getFullYear(),
      kini.getMonth(),
      kini.getDate(),
      0,
      0,
      0,
      0,
    );
    if (kunci === "hari_ini")
      return {
        mulai: mulai,
        akhir: new Date(
          kini.getFullYear(),
          kini.getMonth(),
          kini.getDate(),
          23,
          59,
          59,
          999,
        ),
      };
    if (kunci === "7_hari") {
      const akhir7 = new Date(mulai);
      akhir7.setDate(akhir7.getDate() + 6);
      akhir7.setHours(23, 59, 59, 999);
      return { mulai, akhir: akhir7 };
    }
    if (kunci === "30_hari") {
      const akhir30 = new Date(mulai);
      akhir30.setDate(akhir30.getDate() + 29);
      akhir30.setHours(23, 59, 59, 999);
      return { mulai, akhir: akhir30 };
    }
    if (kunci === "kustom") {
      return {
        mulai: kustomMulai ? new Date(`${kustomMulai}T00:00:00`) : null,
        akhir: kustomAkhir ? new Date(`${kustomAkhir}T23:59:59`) : null,
      };
    }
    return null;
  };

  const muatAktif = useCallback(async () => {
    setLoadingAktif(true);
    try {
      const t = cachedTransactions || (await refetchTransactions());
      const transactions = t ? t.map((tx) => ({ ...tx })) : [];
      if (transactions.length > 0) {
        const itemsMap = await getTransactionItemsBulk(
          transactions.map((tx) => tx.id),
        );
        transactions.forEach((tx) => {
          const items = itemsMap[tx.id] || [];
          if (items.length > 0) {
            // Normalized rows need legacy shape expected by KartuTrx and detail views.
            tx.items = items.map((item) => ({
              qty: item.qty,
              nama: item.item_name,
              harga: item.unit_price,
              subtotal: item.subtotal,
              inventory_id: item.inventory_id,
              sn: item.serial_number || "",
              ref: {
                nama: item.item_name,
                jenis: item.item_type || "satuan",
                id: item.inventory_id,
              },
            }));
          }
        });
      }
      setTrx(transactions);
    } catch (err) {
      console.error("[Status] muatAktif error:", err);
    } finally {
      setLoadingAktif(false);
    }
  }, [cachedTransactions, refetchTransactions]);

  const muatSelesai = useCallback(async () => {
    const r = rentangTanggal(rentangKunci);
    const mulaiISO = r?.mulai?.toISOString();
    const akhirISO = r?.akhir?.toISOString();
    const [t, b] = await Promise.all([
      r
        ? getTransactionsSelesai(mulaiISO, akhirISO)
        : getTransactionsSelesai(null, null),
      r
        ? getTransactionsBelumSelesai(mulaiISO, akhirISO)
        : getTransactionsBelumSelesai(null, null),
    ]);
    setSelesai(t);
    setBelumSelesai(b);
  }, [rentangKunci, kustomMulai, kustomAkhir]);

  useEffect(() => {
    (async () => {
      // Fetch active and history in parallel (2x faster than serial)
      await Promise.all([muatAktif(), muatSelesai()]);
    })();
  }, [refresh, muatAktif, muatSelesai]);

  // ponytail: interval hanya refresh board aktif (cache hook handle TTL);
  // riwayat dimuat ulang saat mount, rentang, atau settingChanged saja.
  // Kalau butuh near-realtime penuh, upgrade ke Supabase Realtime postgres_changes.
  useEffect(() => {
    const interval = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      muatAktif();
    }, 60000);
    return () => window.clearInterval(interval);
  }, [muatAktif]);

  function toggleSembunyikanRiwayat() {
    setSembunyikanRiwayat((val) => !val);
  }

  useEffect(() => {
    const handler = () => setRefresh((r) => r + 1);
    window.addEventListener("settingChanged", handler);
    // dataChanged now handled by useTransactions hook
    return () => {
      window.removeEventListener("settingChanged", handler);
    };
  }, []);

  useEffect(() => {
    let aktif = true;
    (async () => {
      let role = "";
      try {
        const me = await api.auth.me();
        role = me?.user?.role || "";
      } catch {}
      if (aktif) setUserRole(role);
    })();
    return () => {
      aktif = false;
    };
  }, []);

  const batasJam = parseInt(getSetting("notif_jam", "2"));
  const boardMode = getSetting("board_mode", "scroll");
  // now ikut siklus data (trx) — klasifikasi mendekati/telat segar tiap muatAktif.
  const now = useMemo(
    () => new Date(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [trx],
  );
  const updateBoardScrollState = useCallback(() => {
    const board = boardRef.current;
    if (!board) return;
    const maxScroll = board.scrollWidth - board.clientWidth;
    setBoardScrollState((prev) => {
      const next = {
        left: board.scrollLeft <= 1,
        right: maxScroll <= 1 || board.scrollLeft >= maxScroll - 1,
      };
      return prev.left === next.left && prev.right === next.right ? prev : next;
    });
  }, []);
  const scrollBoard = (amount) => {
    boardRef.current?.scrollBy({ left: amount, behavior: "smooth" });
  };
  useEffect(() => {
    if (boardMode !== "scroll") return;
    const board = boardRef.current;
    if (!board) return;
    updateBoardScrollState();
    board.addEventListener("scroll", updateBoardScrollState, { passive: true });
    window.addEventListener("resize", updateBoardScrollState);
    return () => {
      board.removeEventListener("scroll", updateBoardScrollState);
      window.removeEventListener("resize", updateBoardScrollState);
    };
  }, [
    boardMode,
    updateBoardScrollState,
    refresh,
    cariQ,
    rentangKunci,
    kustomMulai,
    kustomAkhir,
    sembunyikanRiwayat,
  ]);

  const queryKanban = cariQ.trim().toLowerCase();
  const rentangKanban = useMemo(
    () => rentangTanggal(rentangKunci),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rentangKunci, kustomMulai, kustomAkhir],
  );
  const cocokDenganRentang = (t) => {
    if (!rentangKanban) return true;
    if (!t.waktu_ambil_rencana) return false;
    const waktuAmbil = new Date(t.waktu_ambil_rencana).getTime();
    const mulai = rentangKanban.mulai?.getTime();
    const akhir = rentangKanban.akhir?.getTime();
    return (!mulai || waktuAmbil >= mulai) && (!akhir || waktuAmbil <= akhir);
  };
  const cocokDenganCari = (t) => {
    if (!queryKanban) return true;
    return [t.penyewa, t.no_invoice, t.hp_penyewa, t.alamat_penyewa].some(
      (nilai) =>
        String(nilai || "")
          .toLowerCase()
          .includes(queryKanban),
    );
  };

  const isMendekati = useCallback(
    (t) =>
      t.status === "Disewa" &&
      t.waktu_kembali_rencana &&
      new Date(t.waktu_kembali_rencana) - now > 0 &&
      new Date(t.waktu_kembali_rencana) - now <= batasJam * 3600000,
    [now, batasJam],
  );
  const isTelat = useCallback(
    (t) =>
      t.status === "Disewa" &&
      t.waktu_kembali_rencana &&
      new Date(t.waktu_kembali_rencana) < now,
    [now],
  );

  const trxAktifFilter = useMemo(
    () =>
      trx.filter((t) => {
        if (t.status !== "Booking" && t.status !== "Disewa") return false;
        if (!cocokDenganRentang(t) || !cocokDenganCari(t)) return false;
        if (filterWaktuAmbil === "semua") return true;
        const waktuAmbil = t.waktu_ambil_rencana
          ? new Date(t.waktu_ambil_rencana).getTime()
          : null;
        if (waktuAmbil == null || Number.isNaN(waktuAmbil))
          return filterWaktuAmbil === "belum";
        const sudahWaktunya = waktuAmbil <= now.getTime();
        if (!cocokDenganCari(t)) return false;
        return filterWaktuAmbil === "sudah" ? sudahWaktunya : !sudahWaktunya;
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [trx, queryKanban, rentangKanban, filterWaktuAmbil, now],
  );

  const selesaiFilter = useMemo(
    () => selesai.filter(cocokDenganCari),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selesai, queryKanban],
  );
  const belumSelesaiFilter = useMemo(
    () => belumSelesai.filter(cocokDenganCari),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [belumSelesai, queryKanban],
  );

  const trxAktifTerurut = useMemo(
    () =>
      [...trxAktifFilter].sort((a, b) => {
        if (queryKanban) {
          const namaA = String(a.penyewa || "")
            .trim()
            .toLowerCase();
          const namaB = String(b.penyewa || "")
            .trim()
            .toLowerCase();
          const mulaiA = namaA.startsWith(queryKanban) ? 0 : 1;
          const mulaiB = namaB.startsWith(queryKanban) ? 0 : 1;
          if (mulaiA !== mulaiB) return mulaiA - mulaiB;
        }
        if (urutkan === "nama_az" || urutkan === "nama_za") {
          const hasil = String(a.penyewa || "").localeCompare(
            String(b.penyewa || ""),
            "id",
            { sensitivity: "base" },
          );
          return urutkan === "nama_az" ? hasil : -hasil;
        }
        const waktuA = a.waktu_ambil_rencana
          ? new Date(a.waktu_ambil_rencana).getTime()
          : Number.MAX_SAFE_INTEGER;
        const waktuB = b.waktu_ambil_rencana
          ? new Date(b.waktu_ambil_rencana).getTime()
          : Number.MAX_SAFE_INTEGER;
        return urutkan === "ambil_terjauh" ? waktuB - waktuA : waktuA - waktuB;
      }),
    [trxAktifFilter, queryKanban, urutkan],
  );

  const boardBaru = getFITUR().boardBelumSelesai;

  const kolomSumber = useMemo(
    () => ({
      Selesai: selesaiFilter,
      "Belum Selesai": belumSelesaiFilter,
      aktif: trxAktifTerurut,
    }),
    [selesaiFilter, belumSelesaiFilter, trxAktifTerurut],
  );

  const columns = useMemo(
    () => [
      {
        status: "Booking",
        label: "Booking",
        ...STATUS_CONFIG.Booking,
        count: trxAktifFilter.filter((t) => t.status === "Booking").length,
      },
      {
        status: "Disewa",
        label: "Disewa",
        ...STATUS_CONFIG.Disewa,
        count: trxAktifFilter.filter(
          (t) => t.status === "Disewa" && !isMendekati(t) && !isTelat(t),
        ).length,
        filter: (t) => t.status === "Disewa" && !isMendekati(t) && !isTelat(t),
      },
      {
        status: "Mendekati",
        label: "Mendekati",
        ...STATUS_CONFIG.Mendekati,
        count: trxAktifFilter.filter(isMendekati).length,
        filter: isMendekati,
      },
      {
        status: "Telat",
        label: "Telat",
        ...STATUS_CONFIG.Telat,
        count: trxAktifFilter.filter(isTelat).length,
        filter: isTelat,
      },
      ...(boardBaru
        ? [
            {
              status: "Belum Selesai",
              label: "Belum Selesai",
              ...STATUS_CONFIG["Belum Selesai"],
              count: belumSelesaiFilter.length,
              filter: (t) => t.status === "Belum Selesai",
            },
          ]
        : []),
      {
        status: "Selesai",
        label: "Selesai",
        ...STATUS_CONFIG.Selesai,
        count: selesai.length,
        filter: (t) => t.status === "Selesai",
      },
    ],
    [
      trxAktifFilter,
      isMendekati,
      isTelat,
      boardBaru,
      belumSelesaiFilter,
      selesai,
    ],
  );

  async function prosesAmbil(trxId) {
    const trx = await getTransactionById(trxId);
    if (!trx) return;
    if (!(await konfirm(`Serahkan barang ke ${trx.penyewa}?`))) return;

    trx.waktu_ambil_aktual = new Date().toISOString();
    trx.status = "Disewa";
    let detailSnOut = [];
    (trx.items || []).forEach((c) => {
      if (c.ref.jenis === "satuan") detailSnOut.push(`[${c.sn}]`);
      else
        (c.assignedSNs || []).forEach((a) =>
          detailSnOut.push(`[Paket -> ${a.sns.join(",")}]`),
        );
    });

    const aturanCepat = getSetting("aturan_ambil_cepat", "rencana");
    const aturanTelat = getSetting("aturan_ambil_telat", "aktual");
    const dur = hitungDurasiDenganAturan(
      trx.waktu_ambil_rencana,
      trx.waktu_ambil_aktual,
      trx.waktu_kembali_rencana,
      null,
      aturanCepat,
      aturanTelat,
    );
    if (!dur.error) {
      trx.durasi_teks = dur.durasi_teks;
      let biayaBrutoBaru = 0;
      (trx.items || []).forEach((item) => {
        let sub = 0;
        if (item.ref.tipeSewa === "harian") {
          let hp = dur.hari + (dur.sisaJam > 0 ? 1 : 0);
          if (hp === 0 && dur.totalJam > 0) hp = 1;
          sub = hp * item.ref.h24;
        } else {
          sub = dur.hari * item.ref.h24;
          if (dur.sisaJam > 0 && dur.sisaJam <= 6) sub += item.ref.h6;
          else if (dur.sisaJam > 6 && dur.sisaJam <= 12) sub += item.ref.h12;
          else if (dur.sisaJam > 12) sub += item.ref.h24;
        }
        item.hargaSatuan = sub;
        item.subtotal = sub * item.qty;
        biayaBrutoBaru += item.subtotal;
      });
      const totalDiskonTersimpan = trx.diskon?.totalDiskon || 0;
      const biayaFinal = Math.max(0, biayaBrutoBaru - totalDiskonTersimpan);
      trx.biaya = biayaFinal;
      trx.total_akhir = biayaFinal + (trx.denda || 0);
    }

    const namaPelayan = (await getNamaInvoice()) || "-";
    trx.riwayatDilayani = [
      ...(trx.riwayatDilayani || []),
      { aksi: "serahkan", nama: namaPelayan, tgl: new Date().toISOString() },
    ];
    trx.dilayani_oleh = namaPelayan;
    if (!(await updateTransactions([trx])))
      return notify(
        "Gagal menyimpan status Disewa. Silakan coba lagi.",
        "error",
      );
    if (
      !(await tambahLogs([
        buatLog(
          "Keluar (Disewa)",
          detailSnOut.join(", "),
          "-",
          trx.waktu_ambil_aktual,
          namaPelayan,
          `${trx.penyewa} • ${trx.no_invoice}`,
        ),
      ]))
    )
      return notify(
        "Status Disewa tersimpan, tapi gagal mencatat log.",
        "error",
      );
    setRefresh((r) => r + 1);
    if (hitungPembayaran(trx).status !== "Lunas") bukaBayar(trx);
  }

  async function prosesKembali(trxId) {
    const trx = await getTransactionById(trxId);
    if (!trx) return;
    const aktual = new Date();
    let denda = 0;
    const telatMenit = (aktual - new Date(trx.waktu_kembali_rencana)) / 60000;
    const dendaAktif = getSetting("denda_aktif", "1") !== "0";
    const dispensasiMenit =
      parseInt(getSetting("denda_dispensasi_menit", "15"), 10) || 0;
    const telatEfektif = Math.max(0, telatMenit - dispensasiMenit);
    const telatJam = Math.ceil(telatEfektif / 60);
    const kenaDenda =
      dendaAktif && telatMenit > dispensasiMenit && telatJam > 0;

    if (getFITUR().dendaFleksibel) {
      if (kenaDenda) {
        (trx.items || []).forEach(
          (c) => (denda += (c.ref.denda || 0) * c.qty * telatJam),
        );
        if (denda > 0) {
          const pilih = await confirmChoice(
            `KETERLAMBATAN!\nBarang dari ${trx.penyewa} telat ${telatJam} Jam.\nDenda otomatis: ${formatRupiah(denda)}.\nBagaimana diproses?`,
            [
              {
                label: `Kenakan Denda ${formatRupiah(denda)}`,
                value: "denda",
                bg: "bg-red-500 text-white shadow-sm hover:bg-red-600",
              },
              {
                label: "Tanpa Denda",
                value: "tanpa",
                bg: "bg-transparent text-gray-600 hover:bg-surface-secondary",
              },
            ],
          );
          if (pilih === null) return;
          if (pilih === "tanpa") denda = 0;
        } else {
          if (!(await konfirm(`Terima kembali dari ${trx.penyewa}?`))) return;
        }
      } else {
        if (!(await konfirm(`Terima kembali dari ${trx.penyewa}?`))) return;
      }
    } else if (kenaDenda) {
      (trx.items || []).forEach(
        (c) => (denda += (c.ref.denda || 0) * c.qty * telatJam),
      );
      if (
        !(await konfirm(
          `KETERLAMBATAN!\nTelat ${telatJam} Jam.\nDenda tambahan: ${formatRupiah(denda)}.\nProses?`,
        ))
      )
        return;
    } else {
      if (!(await konfirm(`Terima kembali dari ${trx.penyewa}?`))) return;
    }

    // Daftar transaksi penuh (dengan items) untuk cek S/N yang masih dipinjam
    // booking lain — getTransactionById di atas tidak cukup untuk ini.
    const t = await getTransactions();
    const inv = await getInventory();
    const invDiubah = new Set();
    (trx.items || []).forEach((c) => {
      if (c.ref.jenis === "satuan") {
        let db = inv.find((i) => i.id == c.idBarang);
        if (db) {
          const rujuk = snsDirujukLainnya(t, trx.id, c.idBarang);
          let snList = c.sn.split(", ");
          snList.forEach((s) => {
            if (!rujuk.has(s) && !db.sns.includes(s)) db.sns.push(s);
          });
          invDiubah.add(db.id);
        }
      } else {
        (c.assignedSNs || []).forEach((a) => {
          let db = inv.find((i) => i.id == a.idKomp);
          if (db) {
            const rujuk = snsDirujukLainnya(t, trx.id, a.idKomp);
            a.sns.forEach((s) => {
              if (!rujuk.has(s) && !db.sns.includes(s)) db.sns.push(s);
            });
            invDiubah.add(db.id);
          }
        });
      }
    });

    // Modal kondisi barang kembali — catat kondisi tiap unit S/N sebelum simpan.
    // Batal = tidak menyimpan apa-apa; transaksi tetap Disewa (alur lama tak jalan).
    const logKondisi = [];
    {
      const entries = [];
      (trx.items || []).forEach((c) => {
        const daftar = [];
        if (c.ref.jenis === "satuan") {
          daftar.push({
            idBarang: c.idBarang,
            sns: (c.sn || "").split(", ").filter(Boolean),
          });
        } else {
          (c.assignedSNs || []).forEach((a) =>
            daftar.push({ idBarang: a.idKomp, sns: a.sns || [] }),
          );
        }
        daftar.forEach(({ idBarang, sns }) => {
          const db = inv.find((i) => i.id == idBarang);
          sns.forEach((sn) =>
            entries.push({
              idBarang,
              sn,
              nama: db?.nama || "",
              kondisi: kondisiUnit(db, sn),
              catatan: catatanUnit(db, sn) || "",
            }),
          );
        });
      });
      if (entries.length > 0) {
        const hasil = await new Promise((resolve) => {
          setKondisiModal({
            judul: `Kondisi Barang Kembali - ${trx.penyewa}`,
            entries,
            resolve,
          });
        });
        if (!hasil) return; // batal: tidak simpan apa-apa
        hasil.forEach((e) => {
          const db = inv.find((i) => i.id == e.idBarang);
          if (!db) return;
          db.kondisi_sn = { ...(db.kondisi_sn || {}) };
          if (e.kondisi === "baik") delete db.kondisi_sn[e.sn];
          else
            db.kondisi_sn[e.sn] = {
              kondisi: e.kondisi,
              catatan: e.catatan?.trim() || null,
            };
          invDiubah.add(db.id);
          logKondisi.push(
            `ubah kondisi: ${e.sn} → ${e.kondisi}${e.catatan?.trim() ? ` (${e.catatan.trim()})` : ""}`,
          );
        });
      }
    }

    trx.waktu_kembali_aktual = aktual.toISOString();
    trx.denda = denda;
    trx.total_akhir = (trx.biaya || 0) + denda;
    const statusBaru =
      getFITUR().boardBelumSelesai && hitungPembayaran(trx).status !== "Lunas"
        ? "Belum Selesai"
        : "Selesai";
    trx.status = statusBaru;
    const namaPelayan = (await getNamaInvoice()) || "-";
    trx.riwayatDilayani = [
      ...(trx.riwayatDilayani || []),
      { aksi: "terima", nama: namaPelayan, tgl: new Date().toISOString() },
    ];
    trx.dilayani_oleh = namaPelayan;
    if (!(await updateTransactions([trx])))
      return notify("Gagal menyimpan status. Silakan coba lagi.", "error");
    if (!(await updateInventory(inv.filter((i) => invDiubah.has(i.id)))))
      return notify(
        "Status tersimpan, tapi gagal mengembalikan stok. Cek inventaris!",
        "error",
      );

    if (
      !(await tambahLogs([
        buatLog(
          statusBaru === "Selesai"
            ? "Masuk (Selesai)"
            : "Masuk (Belum Selesai)",
          "-",
          `Denda: ${formatRupiah(denda)}`,
          aktual.toISOString(),
          namaPelayan,
          `${trx.penyewa} • ${trx.no_invoice}`,
        ),
        // Log entri kondisi terpisah (bukan prioritas, tapi data kondisi tetap tersimpan).
        ...(logKondisi.length > 0
          ? [
              buatLog(
                "Ubah Kondisi",
                logKondisi.join(", "),
                "-",
                aktual.toISOString(),
                namaPelayan,
                `${trx.penyewa} • ${trx.no_invoice}`,
              ),
            ]
          : []),
      ]))
    )
      return notify("Barang diterima, tapi gagal mencatat log.", "error");
    setRefresh((r) => r + 1);
    notify(`Barang sudah diterima.\nTotal: ${formatRupiah(trx.total_akhir)}`);
    if (hitungPembayaran(trx).status !== "Lunas") bukaBayar(trx);
  }

  function submitKondisiModal() {
    if (!kondisiModal) return;
    for (const e of kondisiModal.entries) {
      if (e.kondisi === "bermasalah" && !String(e.catatan || "").trim())
        return notify(
          `Catatan wajib untuk S/N ${e.sn} yang bermasalah!`,
          "error",
        );
    }
    kondisiModal.resolve(kondisiModal.entries);
    setKondisiModal(null);
  }

  async function catatBayar() {
    const jumlah = parseFloat(bayarJumlah) || 0;
    if (jumlah <= 0) return notify("Isi jumlah pembayaran!", "error");
    const trx = await getTransactionById(bayarTrx.id);
    if (!trx) return;
    const pay = hitungPembayaran(trx);
    if (pay.sisa === 0)
      return notify(
        "Transaksi ini sudah lunas. Tidak perlu pembayaran lagi.",
        "error",
      );
    if (jumlah > pay.sisa) {
      if (
        !(await konfirm(
          `Jumlah bayar ${formatRupiah(jumlah)} melebihi sisa ${formatRupiah(pay.sisa)}.\nKembalian ${formatRupiah(jumlah - pay.sisa)}.\nTetap catat?`,
        ))
      )
        return;
    }
    // pembayaran bisa {} (default RPC) — guard cek riwayatBayar, bukan object-nya.
    if (!Array.isArray(trx.pembayaran?.riwayatBayar))
      trx.pembayaran = {
        dp: 0,
        metodeDp: "",
        tglDp: "",
        ...trx.pembayaran,
        riwayatBayar: [],
      };
    const entriBaru = {
      id: crypto.randomUUID(),
      jumlah,
      metode: bayarMetode,
      tgl: new Date().toISOString(),
      catatan: bayarCatatan,
    };
    trx.pembayaran.riwayatBayar.push(entriBaru);
    if (trx.pembayaran.dp === 0) {
      trx.pembayaran.dp = jumlah;
      trx.pembayaran.metodeDp = bayarMetode;
      trx.pembayaran.tglDp = new Date().toISOString();
    }
    const namaPelayan = (await getNamaInvoice()) || "-";
    trx.riwayatDilayani = [
      ...(trx.riwayatDilayani || []),
      { aksi: "bayar", nama: namaPelayan, tgl: new Date().toISOString() },
    ];
    trx.dilayani_oleh = namaPelayan;
    if (!(await updateTransactions([trx])))
      return notify("Gagal mencatat pembayaran. Silakan coba lagi.", "error");
    if (bayarBukti) {
      const path = await uploadBuktiBayar(bayarBukti, trx.id);
      if (!path) {
        notify("Pembayaran tercatat, tapi foto bukti gagal diupload.", "warning");
      } else {
        entriBaru.bukti = path;
        await updateTransactions([trx]);
      }
    }
    if (
      !(await tambahLogs([
        buatLog(
          "Pembayaran",
          "-",
          `${formatRupiah(jumlah)} via ${bayarMetode}`,
          new Date().toISOString(),
          namaPelayan,
          `${trx.penyewa} • ${trx.no_invoice}`,
        ),
      ]))
    )
      return notify("Pembayaran tercatat, tapi gagal menyimpan log.", "error");
    if (
      getFITUR().boardBelumSelesai &&
      trx.status === "Belum Selesai" &&
      hitungPembayaran(trx).status === "Lunas"
    ) {
      trx.status = "Selesai";
      if (!(await updateTransactions([trx])))
        return notify(
          "Pembayaran tercatat, tapi gagal menutup status Selesai.",
          "error",
        );
      if (
        !(await tambahLogs([
          buatLog(
            "Masuk (Selesai)",
            "-",
            "Lunas setelah pembayaran",
            new Date().toISOString(),
            namaPelayan,
            `${trx.penyewa} • ${trx.no_invoice}`,
          ),
        ]))
      )
        return notify("Pembayaran tercatat, tapi gagal mencatat log.", "error");
      notify("Lunas! Transaksi dipindah ke Selesai.");
    }
    setBayarTrx(null);
    setBayarJumlah("");
    setBayarCatatan("");
    setBayarBukti(null);
    setRefresh((r) => r + 1);
    notify(`Pembayaran ${formatRupiah(jumlah)} dicatat.`);
  }

  const bukaBayar = useCallback((trx) => {
    setBayarTrx(trx);
    setBayarJumlah("");
    setBayarCatatan("");
    setBayarBukti(null);
    setEditBayarIdx(null);
  }, []);

  const bukaDetail = useCallback(async (t) => {
    const lengkap = await getTransactionById(t.id);
    setDetailTrx(lengkap || t);
    setEditBayarIdx(null);
  }, []);

  const bukaEditBayar = (bi) => {
    const b = (detailTrx.pembayaran?.riwayatBayar || [])[bi];
    if (!b) return;
    setEditBayarIdx(bi);
    setEditBayarJumlah(String(b.jumlah || ""));
    setEditBayarMetode(b.metode || "Tunai");
    setEditBayarCatatan(b.catatan || "");
    setEditBayarBuktiBaru(null);
    setEditBayarBuktiLama(null);
    setEditBayarHapusBukti(false);
    if (b.bukti) getUrlBuktiBayar(b.bukti).then(setEditBayarBuktiLama);
  };

  async function sinkronSetelahUbahBayar(trx, aksi, detailLog) {
    // (a) Snapshot DP dari entri pertama yang tersisa
    const riwayat = trx.pembayaran?.riwayatBayar || [];
    const first = riwayat[0];
    trx.pembayaran = {
      ...(trx.pembayaran || {}),
      dp: first ? first.jumlah : 0,
      metodeDp: first ? first.metode : "",
      tglDp: first ? first.tgl : "",
      riwayatBayar: riwayat,
    };
    // (b) Sinkron status transaksi (replikasi logika L301 & L338)
    const pay = hitungPembayaran(trx);
    if (trx.status === "Selesai" || trx.status === "Belum Selesai") {
      trx.status =
        getFITUR().boardBelumSelesai && pay.status !== "Lunas"
          ? "Belum Selesai"
          : "Selesai";
    }
    // (c) Riwayat pelayan + log
    const namaPelayan = (await getNamaInvoice()) || "-";
    trx.riwayatDilayani = [
      ...(trx.riwayatDilayani || []),
      {
        aksi: aksi === "Pembayaran diubah" ? "edit_bayar" : "hapus_bayar",
        nama: namaPelayan,
        tgl: new Date().toISOString(),
      },
    ];
    trx.dilayani_oleh = namaPelayan;
    if (!(await updateTransactions([trx])))
      return notify("Gagal menyimpan pembayaran. Silakan coba lagi.", "error");
    if (
      !(await tambahLogs([
        buatLog(
          aksi,
          "-",
          detailLog,
          new Date().toISOString(),
          namaPelayan,
          `${trx.penyewa} • ${trx.no_invoice}`,
        ),
      ]))
    )
      return notify("Pembayaran tersimpan, tapi gagal mencatat log.", "error");
    setRefresh((r) => r + 1);
  }

  async function simpanEditBayar() {
    const jumlah = parseFloat(editBayarJumlah) || 0;
    if (jumlah <= 0) return notify("Isi jumlah pembayaran!", "error");
    const trx = await getTransactionById(detailTrx.id);
    if (!trx) return;
    const riwayat = [...(trx.pembayaran?.riwayatBayar || [])];
    if (editBayarIdx < 0 || editBayarIdx >= riwayat.length) return;
    riwayat[editBayarIdx] = {
      ...riwayat[editBayarIdx],
      jumlah,
      metode: editBayarMetode,
      catatan: editBayarCatatan,
    };
    if (editBayarHapusBukti) delete riwayat[editBayarIdx].bukti;
    trx.pembayaran = { ...(trx.pembayaran || {}), riwayatBayar: riwayat };
    await sinkronSetelahUbahBayar(
      trx,
      "Pembayaran diubah",
      `${formatRupiah(jumlah)} via ${editBayarMetode}`,
    );
    if (editBayarBuktiBaru) {
      const path = await uploadBuktiBayar(editBayarBuktiBaru, trx.id);
      if (!path) {
        notify("Pembayaran tersimpan, tapi foto bukti gagal diupload.", "warning");
      } else {
        riwayat[editBayarIdx] = { ...riwayat[editBayarIdx], bukti: path };
        trx.pembayaran = { ...(trx.pembayaran || {}), riwayatBayar: riwayat };
        await updateTransactions([trx]);
      }
    }
    setEditBayarIdx(null);
    setEditBayarJumlah("");
    setEditBayarCatatan("");
    setEditBayarBuktiBaru(null);
    setEditBayarBuktiLama(null);
    setEditBayarHapusBukti(false);
    notify("Pembayaran diubah.");
  }

  async function hapusBayar(bi) {
    const riwayat = detailTrx.pembayaran?.riwayatBayar || [];
    const b = riwayat[bi];
    if (!b) return;
    if (
      !(await konfirm(
        `Hapus pembayaran ${formatRupiah(b.jumlah)} (${b.metode})?`,
      ))
    )
      return;
    const trx = await getTransactionById(detailTrx.id);
    if (!trx) return;
    const rBaru = [...(trx.pembayaran?.riwayatBayar || [])];
    if (bi >= rBaru.length) return;
    rBaru.splice(bi, 1);
    trx.pembayaran = { ...(trx.pembayaran || {}), riwayatBayar: rBaru };
    await sinkronSetelahUbahBayar(
      trx,
      "Pembayaran dihapus",
      `${formatRupiah(b.jumlah)} via ${b.metode}`,
    );
    notify("Pembayaran dihapus.");
  }

  const handleDragStart = useCallback((e, id) => {
    setDragId(id);
    e.dataTransfer.setData("text/plain", id);
    e.currentTarget.style.opacity = "0.5";
  }, []);

  const handleDragEnd = useCallback((e) => {
    e.currentTarget.style.opacity = "";
    setDragId(null);
  }, []);

  function handleDragOver(e) {
    e.preventDefault();
    e.currentTarget.style.boxShadow = "0 0 0 3px rgba(113, 129, 224, 0.3)";
  }

  function handleDragLeave(e) {
    e.currentTarget.style.boxShadow = "";
  }

  async function handleDrop(e, targetStatus) {
    e.preventDefault();
    e.currentTarget.style.boxShadow = "";
    const id = parseInt(e.dataTransfer.getData("text/plain"));
    if (!id) return;

    const trx = await getTransactionById(id);
    if (!trx) return;

    const realStatus = trx.status;

    if (targetStatus === "Mendekati" || targetStatus === "Telat") {
      return notify(
        "Gunakan tombol aksi atau drag ke kolom Disewa/Belum Selesai/Selesai.",
        "info",
      );
    }

    if (realStatus === targetStatus) return;

    if (realStatus === "Booking" && targetStatus === "Disewa")
      return prosesAmbil(id);
    if (
      realStatus === "Disewa" &&
      (targetStatus === "Selesai" || targetStatus === "Belum Selesai")
    )
      return prosesKembali(id);
    if (realStatus === "Booking" && targetStatus === "Selesai")
      return notify("Tidak bisa langsung Selesai. Serahkan dulu.", "error");
    if (realStatus === "Booking" && targetStatus === "Belum Selesai")
      return notify(
        "Tidak bisa langsung Belum Selesai. Serahkan dulu.",
        "error",
      );
    if (realStatus === "Disewa" && targetStatus === "Booking")
      return notify("Tidak bisa kembali ke Booking.", "error");
    if (realStatus === "Belum Selesai")
      return notify("Transaksi belum lunas. Terima pembayaran dulu.", "error");
    if (realStatus === "Selesai")
      return notify("Transaksi sudah selesai.", "error");
  }

  return (
    <>
      <div className="min-h-full bg-gray-100 status-page-wide">
        <h2 className="mb-6 text-2xl font-bold">Status Sewa</h2>

        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-lg mb-4">
          {/* Single row: Date range + Search + Toggle */}
          <div className="flex flex-wrap items-center gap-3">
            {/* Date range buttons */}
            <div className="flex flex-wrap gap-2">
              {[
                { k: "hari_ini", label: "Hari Ini" },
                { k: "7_hari", label: "7 Hari" },
                { k: "30_hari", label: "30 Hari" },
                { k: "semua", label: "Semua" },
                { k: "kustom", label: "Kustom" },
              ].map((o) => (
                <button
                  key={o.k}
                  type="button"
                  onClick={() => setRentangKunci(o.k)}
                  className={`rounded-full px-4 py-2 text-sm font-medium transition-colors outline-none focus:outline-none ${rentangKunci === o.k ? "bg-[#7181E0] hover:bg-[#5d6fcc] text-white border-0" : "bg-gray-200 hover:bg-gray-300 text-slate-700 border-0"}`}
                >
                  {o.label}
                </button>
              ))}
              {rentangKunci === "kustom" && (
                <>
                  <div className="w-[150px] max-w-full">
                    <DateTimePicker
                      value={
                        kustomMulai ? new Date(`${kustomMulai}T00:00:00`) : null
                      }
                      onChange={(d) => setKustomMulai(fmtYMD(d))}
                      showTime={false}
                      placeholder="dd/mm/yyyy"
                    />
                  </div>
                  <span className="text-xs text-slate-500 self-center">
                    s.d.
                  </span>
                  <div className="w-[150px] max-w-full">
                    <DateTimePicker
                      value={
                        kustomAkhir ? new Date(`${kustomAkhir}T00:00:00`) : null
                      }
                      onChange={(d) => setKustomAkhir(fmtYMD(d))}
                      showTime={false}
                      placeholder="dd/mm/yyyy"
                    />
                  </div>
                </>
              )}
            </div>

            {/* Search + Toggle on the right */}
            <div className="flex items-center gap-2 ml-auto">
              <div style={{ minWidth: 240, maxWidth: 320 }}>
                <input
                  value={cariQ}
                  onChange={(e) => setCariQ(e.target.value)}
                  placeholder="Cari penyewa..."
                  className="w-full rounded-md border border-solid border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none transition-colors focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20"
                />
              </div>
              <button
                type="button"
                onClick={() => setFilterPanelTerbuka((terbuka) => !terbuka)}
                className="rounded-lg px-3 py-2 text-lg text-slate-600 transition-colors border-0 focus:outline-none"
                aria-label={
                  filterPanelTerbuka ? "Sembunyikan filter" : "Tampilkan filter"
                }
                aria-expanded={filterPanelTerbuka}
                aria-controls="status-filter-panel"
                title={
                  filterPanelTerbuka ? "Sembunyikan filter" : "Tampilkan filter"
                }
              >
                {filterPanelTerbuka ? "⌃" : "⌄"}
              </button>
            </div>
          </div>
          {filterPanelTerbuka && (
            <div
              id="status-filter-panel"
              className="flex flex-wrap items-center gap-3 pt-3 mt-3 border-t border-slate-200"
            >
              {/* Filter dropdown */}
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-gray-600">
                  Filter
                </label>
                <select
                  value={filterWaktuAmbil}
                  onChange={(e) => setFilterWaktuAmbil(e.target.value)}
                  className="w-full rounded-md border border-solid border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition-colors focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20"
                  style={{ width: 190, maxWidth: "100%" }}
                  aria-label="Filter waktu ambil"
                >
                  <option value="semua">Semua waktu ambil</option>
                  <option value="sudah">Sudah waktunya ambil</option>
                  <option value="belum">Belum waktunya ambil</option>
                </select>
              </div>
              {/* Sort by dropdown */}
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-gray-600">
                  Sort by
                </label>
                <select
                  value={urutkan}
                  onChange={(e) => setUrutkan(e.target.value)}
                  className="w-full rounded-md border border-solid border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition-colors focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20"
                  style={{ width: 190, maxWidth: "100%" }}
                  aria-label="Urutkan transaksi"
                >
                  <option value="ambil_terdekat">Ambil terdekat</option>
                  <option value="ambil_terjauh">Ambil terjauh</option>
                  <option value="nama_az">Nama A-Z</option>
                  <option value="nama_za">Nama Z-A</option>
                </select>
              </div>
              {/* Reset button */}
              <button
                type="button"
                onClick={resetFilter}
                className="rounded-lg bg-gray-200 hover:bg-gray-300 px-4 py-2 text-sm font-medium text-slate-700 transition-colors border-0 focus:outline-none self-end"
              >
                Reset Filter
              </button>
              {/* Checkbox */}
              <label
                className="flex items-center gap-2 text-sm font-medium text-gray-700 self-center"
                style={{ cursor: "pointer", userSelect: "none" }}
              >
                <input
                  type="checkbox"
                  checked={sembunyikanRiwayat}
                  onChange={toggleSembunyikanRiwayat}
                  style={{ width: 16, height: 16, accentColor: "#7181E0" }}
                />
                Sembunyikan Selesai &amp; Dibatalkan
              </label>
            </div>
          )}
        </div>

        <div className="status-kanban-shell">
          <div
            ref={boardRef}
            className="flex items-center gap-2 status-kanban-board"
            style={{
              alignItems: "stretch",
              width: "100%",
              minWidth: 0,
              overflowX: boardMode === "scroll" ? "auto" : "hidden",
              overflowY: "hidden",
              overscrollBehaviorX: "contain",
              overscrollBehaviorY: "auto",
              touchAction: "pan-x pan-y",
              paddingBottom: "2rem",
            }}
          >
            <div
              style={
                boardMode === "scroll"
                  ? {
                      display: "flex",
                      minWidth: "max-content",
                      gap: "1rem",
                      paddingBottom: "1rem",
                    }
                  : {
                      display: "flex",
                      flexDirection: "column",
                      gap: "1.5rem",
                      width: "100%",
                    }
              }
            >
              {columns.map((col) => (
                <div
                  key={col.status}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => handleDrop(e, col.status)}
                  className=""
                  style={{
                    background: col.bg,
                    borderColor:
                      col.status === "Booking"
                        ? "#eab308"
                        : col.status === "Disewa"
                          ? "#3b82f6"
                          : col.status === "Mendekati"
                            ? "#f97316"
                            : col.status === "Telat"
                              ? "#F04438"
                              : col.status === "Belum Selesai"
                                ? "#9333ea"
                                : "#579171",
                    borderWidth: 2,
                    borderStyle: "dashed",
                    borderRadius: "0.75rem",
                    padding: "1rem",
                    minHeight: 300,
                    transition: "box-shadow 100ms ease-in-out",
                    ...(boardMode === "scroll"
                      ? { minWidth: 320, width: 320, flexShrink: 0 }
                      : { width: "100%", flex: "none" }),
                  }}
                >
                  <div
                    href="#"
                    onClick={(e) => {
                      e.preventDefault();
                    }}
                    className="text-13 font-bold"
                    onMouseDown={(e) => e.preventDefault()}
                    style={{
                      background: col.headerBg,
                      borderRadius: "0.375rem",
                      padding: "8px 16px",
                      color: col.headerText || "#fff",
                      boxShadow: "0 1px 2px 0 rgb(0 0 0 / 0.05)",
                      marginBottom: "1rem",
                    }}
                  >
                    {col.label}
                    <span
                      style={{
                        marginLeft: 8,
                        borderRadius: "9999px",
                        background: "rgba(255, 255, 255, 0.3)",
                        padding: "2px 8px",
                        fontSize: 12,
                      }}
                    >
                      {col.count}
                    </span>
                  </div>
                  <div className="flex flex-col gap-3">
                    {(() => {
                      const sumber =
                        col.status === "Selesai"
                          ? kolomSumber.Selesai
                          : col.status === "Belum Selesai"
                            ? kolomSumber["Belum Selesai"]
                            : kolomSumber.aktif;
                      const daftar = sumber.filter(
                        col.filter || ((t) => t.status === col.status),
                      );
                      if (daftar.length === 0)
                        return (
                          <p
                            className="text-center text-xs text-gray-500"
                            style={{ padding: "32px 0", fontStyle: "italic" }}
                          >
                            Tidak ada transaksi
                          </p>
                        );
                      return daftar.map((t) => (
                        <KartuTrx
                          key={t.id}
                          t={t}
                          onAmbil={prosesAmbil}
                          onKembali={prosesKembali}
                          onBayar={bukaBayar}
                          onDetail={bukaDetail}
                          onDragStart={(e) => handleDragStart(e, t.id)}
                          onDragEnd={handleDragEnd}
                        />
                      ));
                    })()}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {typeof document !== "undefined" &&
        boardMode === "scroll" &&
        typeof window !== "undefined" &&
        window.innerWidth > 1024 &&
        createPortal(
          <>
            <button
              type="button"
              onClick={() => scrollBoard(-360)}
              aria-label="Geser kanban ke kiri"
              title="Geser kanban ke kiri"
              disabled={boardScrollState.left}
              className="inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-brand focus:ring-offset-2 bg-transparent text-gray-600 hover:bg-surface-secondary status-kanban-nav status-kanban-nav-left"
              style={{
                left: submenuOpen
                  ? "calc(16rem + 16rem + 8px)"
                  : "calc(16rem + 8px)",
              }}
            >
              <span aria-hidden="true">‹</span>
            </button>
            <button
              type="button"
              onClick={() => scrollBoard(360)}
              className="inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-brand focus:ring-offset-2 bg-transparent text-gray-600 hover:bg-surface-secondary status-kanban-nav status-kanban-nav-right"
              aria-label="Geser kanban ke kanan"
              title="Geser kanban ke kanan"
              disabled={boardScrollState.right}
            >
              <span aria-hidden="true">›</span>
            </button>
          </>,
          document.body,
        )}

      {typeof document !== "undefined" &&
        detailTrx &&
        createPortal(
          (() => {
            const t = detailTrx;
            return (
              <div
                onClick={() => setDetailTrx(null)}
                className="fixed inset-0 z-[9999] flex items-center justify-center overflow-y-auto bg-black/50 p-4 backdrop-blur-sm"
              >
                <div
                  className="flex items-center justify-center"
                  style={{ minHeight: "100%", padding: "1rem" }}
                >
                  <div
                    onClick={(e) => e.stopPropagation()}
                    className="relative flex max-h-[90vh] w-full max-w-4xl flex-col rounded-xl border-2 border-solid border-slate-200 bg-white shadow-2xl"
                  >
                    <div className="mb-4 flex items-center justify-between px-6 pt-6">
                      <h3 className="text-lg font-semibold">
                        Detail Transaksi
                      </h3>
                      <button
                        onClick={() => setDetailTrx(null)}
                        aria-label="Tutup"
                        className={`${BTN_GHOST} text-xl`}
                      >
                        &times;
                      </button>
                    </div>
                    <div className="flex-1 overflow-y-auto px-6">
                      <div className="flex items-center gap-4 mb-3 bg-slate-50 rounded-lg p-3">
                        <span className="font-semibold">{t.no_invoice}</span>
                        <span
                          className={`inline-flex items-center rounded-md px-2 py-1 text-xs font-medium ${statusBadge(t.status)}`}
                        >
                          {t.status}
                        </span>
                      </div>
                      <div
                        className="grid grid-cols-2"
                        style={{ flexShrink: 0, minWidth: 0, gap: "0.75rem" }}
                      >
                        <div className="bg-slate-50 rounded-lg p-3">
                          <p className="font-semibold mb-2">
                            Identitas Penyewa
                          </p>
                          <p
                            className="text-13 text-gray-600 mb-0"
                            style={{ wordBreak: "break-word" }}
                          >
                            Nama: <strong>{t.penyewa}</strong>
                          </p>
                          <p className="text-13 text-gray-600 mb-0">
                            HP: {t.hp_penyewa || "-"}
                          </p>
                          <p
                            className="text-13 text-gray-600 mb-0"
                            style={{ wordBreak: "break-word" }}
                          >
                            Alamat: {t.alamat_penyewa || "-"}
                          </p>
                          <p className="text-13 text-gray-600 mb-0">
                            Jaminan: {t.jaminan_sewa || "-"}
                          </p>
                        </div>
                        <div className="bg-slate-50 rounded-lg p-3">
                          <p className="font-semibold mb-2">Jadwal</p>
                          <p className="text-13 text-gray-600 mb-0">
                            Ambil (rencana):{" "}
                            {formatTanggal(t.waktu_ambil_rencana)}
                          </p>
                          <p className="text-13 text-gray-600 mb-0">
                            Kembali (rencana):{" "}
                            {formatTanggal(t.waktu_kembali_rencana)}
                          </p>
                          <p className="text-13 text-gray-600 mb-0">
                            Ambil (aktual):{" "}
                            {formatTanggal(t.waktu_ambil_aktual)}
                          </p>
                          <p className="text-13 text-gray-600 mb-0">
                            Kembali (aktual):{" "}
                            {formatTanggal(t.waktu_kembali_aktual)}
                          </p>
                          <p className="text-13 text-gray-600 mb-0">
                            Durasi: {t.durasi_teks || "-"}
                          </p>
                        </div>
                      </div>
                      <div className="mt-3 rounded-xl border-2 border-solid border-slate-200 overflow-hidden">
                        <p className="font-semibold mb-2 px-3 pt-3">Barang</p>
                        <table className="table-fixed w-full border-collapse text-sm">
                          <thead className="bg-slate-100 text-xs font-bold uppercase tracking-wide text-slate-600">
                            <tr>
                              <th className="px-4 py-3 text-left">
                                Nama Barang
                              </th>
                              <th className="px-4 py-3 text-center">Qty</th>
                              <th className="px-4 py-3 text-left">
                                S/N / Komponen
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {(t.items || []).map((i, idx) => (
                              <tr
                                key={idx}
                                className="bg-white even:bg-slate-50"
                              >
                                <td className="px-4 py-3 align-middle font-semibold">
                                  {i.ref.nama}
                                </td>
                                <td className="px-4 py-3 align-middle text-center text-gray-600">
                                  {i.qty}x
                                </td>
                                <td className="px-4 py-3 align-middle text-gray-600">
                                  {i.ref.jenis === "satuan" ? (
                                    <span
                                      className="text-xs"
                                      style={{
                                        fontFamily: "ui-monospace, monospace",
                                      }}
                                    >
                                      {i.sn}
                                    </span>
                                  ) : (
                                    <div className="flex flex-col gap-1">
                                      {(i.assignedSNs || []).map((a, ai) => (
                                        <div key={ai}>
                                          <span className="font-semibold">
                                            {a.nama}:
                                          </span>{" "}
                                          <span
                                            className="text-xs"
                                            style={{
                                              fontFamily:
                                                "ui-monospace, monospace",
                                            }}
                                          >
                                            {a.sns.join(", ")}
                                          </span>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <div className="grid grid-cols-3 mt-3 gap-3 bg-slate-50 rounded-lg p-3">
                        <p
                          className="text-13 text-gray-600 mb-0"
                          style={{ wordBreak: "break-word" }}
                        >
                          Biaya Dasar:{" "}
                          <strong>{formatRupiah(t.biaya || 0)}</strong>
                        </p>
                        <p
                          className="text-13 text-gray-600 mb-0"
                          style={{ wordBreak: "break-word" }}
                        >
                          Denda: <strong>{formatRupiah(t.denda || 0)}</strong>
                        </p>
                        <p
                          className="text-13 font-bold mb-0"
                          style={{ wordBreak: "break-word" }}
                        >
                          Total: {formatRupiah(t.total_akhir || 0)}
                        </p>
                      </div>
                      {(() => {
                        const pay = hitungPembayaran(t);
                        const cls =
                          pay.status === "Lunas"
                            ? "bg-[#579171] text-white"
                            : pay.status === "DP"
                              ? "bg-blue-100 text-blue-800"
                              : "bg-[#F04438] text-white";
                        return (
                          <div className="mt-3 bg-slate-50 rounded-lg p-3">
                            <div className="flex items-center justify-between mb-2">
                              <p className="font-semibold mb-0">Pembayaran</p>
                              <span
                                className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}
                              >
                                {pay.status}
                              </span>
                            </div>
                            <div
                              className="flex-wrap gap-2 text-13 mb-2"
                              style={{ minWidth: 0 }}
                            >
                              <p
                                className="text-gray-600 mb-0"
                                style={{ wordBreak: "break-word" }}
                              >
                                Dibayar:{" "}
                                <strong style={{ color: "#579171" }}>
                                  {formatRupiah(pay.dibayar)}
                                </strong>
                              </p>
                              <p
                                className="text-gray-600 mb-0"
                                style={{ wordBreak: "break-word" }}
                              >
                                Sisa:{" "}
                                <strong className="text-red-600">
                                  {formatRupiah(pay.sisa)}
                                </strong>
                              </p>
                              {pay.kembalian > 0 && (
                                <p
                                  className="text-gray-600 mb-0"
                                  style={{ wordBreak: "break-word" }}
                                >
                                  Kembalian:{" "}
                                  <strong style={{ color: "#579171" }}>
                                    {formatRupiah(pay.kembalian)}
                                  </strong>
                                </p>
                              )}
                            </div>
                            <div className="flex flex-col gap-1">
                              {(t.pembayaran?.riwayatBayar || []).length ===
                                0 && (
                                <p
                                  className="text-xs text-gray-500 mb-0"
                                  style={{ fontStyle: "italic" }}
                                >
                                  Belum ada pembayaran dicatat.
                                </p>
                              )}
                              {(t.pembayaran?.riwayatBayar || []).map(
                                (b, bi) => (
                                  <div
                                    key={bi}
                                    className="flex items-center justify-between gap-2 rounded-lg border border-solid border-slate-200 bg-white px-3 py-2 text-xs"
                                  >
                                    <span style={{ wordBreak: "break-word" }}>
                                      <strong>{formatRupiah(b.jumlah)}</strong>{" "}
                                      • {b.metode}
                                    </span>
                                    <span
                                      className="text-gray-500"
                                      style={{ wordBreak: "break-word" }}
                                    >
                                      {formatTanggal(b.tgl)}
                                      {b.catatan ? ` — ${b.catatan}` : ""}
                                    </span>
                                    {(userRole === ROLE_OWNER ||
                                      userRole === ROLE_SUPERADMIN) && (
                                      <span className="flex items-center gap-1">
                                        <button
                                          type="button"
                                          onClick={() => bukaEditBayar(bi)}
                                          aria-label={`Edit pembayaran ${formatRupiah(b.jumlah)}`}
                                          style={{
                                            border: 0,
                                            background: "transparent",
                                            cursor: "pointer",
                                            fontSize: 11,
                                            color: "#5A6CD6",
                                          }}
                                        >
                                          Edit
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => hapusBayar(bi)}
                                          aria-label={`Hapus pembayaran ${formatRupiah(b.jumlah)}`}
                                          style={{
                                            border: 0,
                                            background: "transparent",
                                            cursor: "pointer",
                                            fontSize: 11,
                                            color: "#F04438",
                                          }}
                                        >
                                          Hapus
                                        </button>
                                      </span>
                                    )}
                                  </div>
                                ),
                              )}
                            </div>
                          </div>
                        );
                      })()}
                      <div className="mt-3 bg-slate-50 rounded-lg p-3">
                        <p className="font-semibold mb-2">Riwayat Pelayan</p>
                        {(t.riwayatDilayani || []).length === 0 && (
                          <p
                            className="text-xs text-gray-500 mb-0"
                            style={{ fontStyle: "italic" }}
                          >
                            Belum ada riwayat.
                          </p>
                        )}
                        <div className="flex flex-col gap-1">
                          {(t.riwayatDilayani || []).map((r, ri) => (
                            <div
                              key={ri}
                              className="flex items-center justify-between gap-2 rounded-lg border border-solid border-slate-200 bg-white px-3 py-2 text-xs"
                            >
                              <span style={{ wordBreak: "break-word" }}>
                                <strong>{LABEL_AKSI[r.aksi] || r.aksi}</strong>{" "}
                                • {r.nama}
                              </span>
                              <span
                                className="text-gray-500"
                                style={{ wordBreak: "break-word" }}
                              >
                                {formatTanggal(r.tgl)}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                    <div className="flex justify-stretch gap-2 border-t border-slate-200 px-6 pb-6 pt-4">
                      <button
                        onClick={() => {
                          setDetailTrx(null);
                          setEditBayarIdx(null);
                        }}
                        className={`${BTN_SECONDARY} w-full`}
                      >
                        Tutup
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })(),
          document.body,
        )}

      {typeof document !== "undefined" &&
        bayarTrx &&
        createPortal(
          (() => {
            const pay = hitungPembayaran(bayarTrx);
            const over = (parseFloat(bayarJumlah) || 0) > pay.sisa;
            return (
              <div
                onClick={() => setBayarTrx(null)}
                className="fixed inset-0 z-[9999] flex items-center justify-center overflow-y-auto bg-black/50 p-4 backdrop-blur-sm"
              >
                <div
                  onClick={(e) => e.stopPropagation()}
                  className="relative flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-border bg-surface-card p-6 shadow-xl"
                >
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold">Catat Pembayaran</h3>
                    <button
                      onClick={() => setBayarTrx(null)}
                      aria-label="Tutup"
                      className="text-xl"
                    >
                      &times;
                    </button>
                  </div>
                  <div className="p-6">
                    <p className="text-13 text-gray-600 mb-3">
                      Invoice:{" "}
                      <strong style={{ fontFamily: "ui-monospace, monospace" }}>
                        {bayarTrx.no_invoice}
                      </strong>{" "}
                      — {bayarTrx.penyewa}
                    </p>
                    <div
                      className="mb-4"
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                        gap: 8,
                        background: "#f8fafc",
                        borderRadius: "0.375rem",
                        padding: "0.75rem",
                        textAlign: "center",
                      }}
                    >
                      <div>
                        <p
                          className="text-gray-500 mb-0"
                          style={{ fontSize: 10 }}
                        >
                          Tagihan
                        </p>
                        <p className="text-13 font-bold mb-0">
                          {formatRupiah(pay.total)}
                        </p>
                      </div>
                      <div>
                        <p
                          className="text-gray-500 mb-0"
                          style={{ fontSize: 10 }}
                        >
                          Dibayar
                        </p>
                        <p
                          className="text-13 font-bold mb-0"
                          style={{ color: "#579171" }}
                        >
                          {formatRupiah(pay.dibayar)}
                        </p>
                      </div>
                      <div>
                        <p
                          className="text-gray-500 mb-0"
                          style={{ fontSize: 10 }}
                        >
                          Sisa
                        </p>
                        <p className="text-13 font-bold text-red-600 mb-0">
                          {formatRupiah(pay.sisa)}
                        </p>
                      </div>
                    </div>
                    <label className="block text-sm font-medium">
                      Jumlah Bayar
                    </label>
                    <input
                      type="text"
                      inputMode="numeric"
                      autoComplete="off"
                      value={formatAngkaInput(bayarJumlah)}
                      onChange={(e) =>
                        setBayarJumlah(e.target.value.replace(/\D/g, ""))
                      }
                      autoFocus
                      placeholder="0"
                      className="w-full rounded border border-border bg-surface-card px-3 py-2 text-lg font-bold mt-2"
                    />
                    <div
                      className="grid grid-cols-2 mt-3"
                      style={{ gap: "0.75rem" }}
                    >
                      <div>
                        <label className="block text-sm font-medium">
                          Metode
                        </label>
                        <select
                          value={bayarMetode}
                          onChange={(e) => setBayarMetode(e.target.value)}
                          className="w-full rounded-[0.375rem] border-2 border-border bg-surface-card px-3.5 py-2.5 text-sm text-text-primary outline-none transition focus:border-brand focus:ring-2 focus:ring-brand-light disabled:cursor-not-allowed disabled:bg-surface-subtle disabled:opacity-60 mt-2"
                        >
                          <option>Tunai</option>
                          <option>Transfer</option>
                          <option>QRIS</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium">
                          Catatan
                        </label>
                        <input
                          value={bayarCatatan}
                          onChange={(e) => setBayarCatatan(e.target.value)}
                          placeholder="opsional"
                          className="w-full rounded-[0.375rem] border-2 border-border bg-surface-card px-3.5 py-2.5 text-sm text-text-primary outline-none transition focus:border-brand focus:ring-2 focus:ring-brand-light disabled:cursor-not-allowed disabled:bg-surface-subtle disabled:opacity-60 mt-2"
                        />
                      </div>
                    </div>
                    {over && (
                      <div
                        className="text-13 mt-3"
                        style={{
                          background: "#ecfdf5",
                          borderRadius: "0.375rem",
                          padding: "0.75rem",
                        }}
                      >
                        <p
                          className="font-bold mb-0"
                          style={{ color: "#579171" }}
                        >
                          Kelebihan bayar:{" "}
                          {formatRupiah(
                            (parseFloat(bayarJumlah) || 0) - pay.sisa,
                          )}
                        </p>
                        <p
                          className="text-xs mb-0"
                          style={{ color: "#579171" }}
                        >
                          Kembalian diberikan ke penyewa.
                        </p>
                      </div>
                    )}
                    <div className="mt-3">
                      <label className="block text-sm font-medium">
                        Bukti Bayar (opsional)
                      </label>
                      <input
                        ref={bayarBuktiRef}
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0] || null;
                          if (f && f.size > 5 * 1024 * 1024) {
                            notify("Ukuran file maksimal 5MB.", "error");
                            e.target.value = "";
                            return;
                          }
                          setBayarBukti(f);
                        }}
                      />
                      <div className="flex items-center gap-3 mt-2 flex-wrap">
                        <button
                          type="button"
                          onClick={() => bayarBuktiRef.current?.click()}
                          className="rounded-lg px-4 py-2 text-sm font-medium bg-gray-200 hover:bg-gray-300 text-slate-700 border-0"
                        >
                          Pilih Berkas
                        </button>
                        {bayarBukti ? (
                          <>
                            <span className="text-sm text-gray-700" style={{ wordBreak: "break-word" }}>
                              {bayarBukti.name}
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                setBayarBukti(null);
                                if (bayarBuktiRef.current) bayarBuktiRef.current.value = "";
                              }}
                              className="text-xs font-medium text-red-600 bg-transparent border-0"
                            >
                              Hapus
                            </button>
                          </>
                        ) : (
                          <span className="text-xs text-gray-500">
                            JPG, PNG, atau WEBP. Maksimal 5MB.
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 mt-4">
                      <button
                        onClick={() => setBayarTrx(null)}
                        className="inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-brand focus:ring-offset-2 bg-transparent text-gray-600 hover:bg-surface-secondary flex-1 min-w-0 text-13"
                      >
                        Batal
                      </button>
                      <button
                        onClick={catatBayar}
                        className="inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-brand focus:ring-offset-2 bg-[#579171] text-white shadow-sm hover:bg-[#447057] flex-1 min-w-0 text-13"
                      >
                        Simpan Bayar
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })(),
          document.body,
        )}

      {typeof document !== "undefined" &&
        kondisiModal &&
        createPortal(
          <div
            className="fixed inset-0 z-[9999] flex items-center justify-center overflow-y-auto bg-black/50 p-4 backdrop-blur-sm"
          >
            <div className="relative flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg bg-white shadow-2xl">
              <div className="flex items-center justify-between border-b border-gray-100 p-6">
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">
                    Kondisi Unit
                  </h2>
                  <p className="mt-1 text-sm text-gray-500">
                    {kondisiModal.judul}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    kondisiModal.resolve(null);
                    setKondisiModal(null);
                  }}
                  className="border-0 bg-transparent text-gray-400 transition-colors hover:text-gray-600"
                  aria-label="Tutup"
                >
                  <svg
                    className="h-6 w-6"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </button>
              </div>
              <div className="max-h-[60vh] flex-1 overflow-y-auto p-6">
                <p className="mb-6 text-sm text-gray-600">
                  Catat kondisi tiap unit saat barang kembali.
                </p>
                <div className="space-y-4">
                  {kondisiModal.entries.map((e, i) => (
                    <div
                      key={`${e.idBarang}-${e.sn}`}
                      className="rounded-lg border border-gray-200 p-4 transition hover:bg-gray-50"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex flex-1 items-center gap-3">
                          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-100">
                            <span className="text-sm font-semibold text-indigo-600">
                              {inisialSN(e.sn)}
                            </span>
                          </div>
                          <div>
                            <p className="text-sm font-medium text-gray-900">
                              {e.nama}
                            </p>
                            <p className="text-xs text-gray-500">
                              Serial: {e.sn}
                            </p>
                          </div>
                        </div>
                        <div className="w-32">
                          <select
                            value={e.kondisi}
                            onChange={(ev) => {
                              const entries = [...kondisiModal.entries];
                              entries[i] = { ...e, kondisi: ev.target.value };
                              setKondisiModal({ ...kondisiModal, entries });
                            }}
                            className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                          >
                            {opsiKondisi(userRole).map((o) => (
                              <option key={o.value} value={o.value}>
                                {labelKondisi(o)}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                      {e.kondisi === "bermasalah" && (
                        <input
                          value={e.catatan}
                          onChange={(ev) => {
                            const entries = [...kondisiModal.entries];
                            entries[i] = { ...e, catatan: ev.target.value };
                            setKondisiModal({ ...kondisiModal, entries });
                          }}
                          placeholder="Catatan masalah (wajib)..."
                          className="mt-2 w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        />
                      )}
                    </div>
                  ))}
                </div>
                {(() => {
                  const r = ringkasKondisi(kondisiModal.entries);
                  return (
                    <div className="mt-6 rounded-lg border border-indigo-100 bg-indigo-50 p-4">
                      <p className="mb-3 text-xs font-semibold text-indigo-900">
                        Ringkasan Kondisi
                      </p>
                      <div className="grid grid-cols-3 gap-3">
                        <div className="text-center">
                          <p className="mb-1 text-xs text-indigo-700">Baik</p>
                          <p className="text-lg font-bold text-green-600">
                            {r.baik}
                          </p>
                        </div>
                        <div className="text-center">
                          <p className="mb-1 text-xs text-indigo-700">
                            Bermasalah
                          </p>
                          <p className="text-lg font-bold text-yellow-600">
                            {r.bermasalah}
                          </p>
                        </div>
                        <div className="text-center">
                          <p className="mb-1 text-xs text-indigo-700">
                            Maintenance
                          </p>
                          <p className="text-lg font-bold text-orange-600">
                            {r.maintenance}
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </div>
              <div className="flex gap-3 border-t border-gray-100 bg-gray-50 px-6 py-4">
                <button
                  type="button"
                  onClick={() => {
                    kondisiModal.resolve(null);
                    setKondisiModal(null);
                  }}
                  className="flex-1 rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 transition hover:bg-gray-100"
                >
                  Batal
                </button>
                <button
                  type="button"
                  onClick={submitKondisiModal}
                  className="flex-1 rounded-lg border-0 bg-[#579171] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#447057]"
                >
                  Lanjut Simpan
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}

      {typeof document !== "undefined" &&
        editBayarIdx !== null &&
        detailTrx &&
        createPortal(
          (() => {
            const entri = (detailTrx.pembayaran?.riwayatBayar || [])[
              editBayarIdx
            ];
            if (!entri) return null;
            return (
              <div
                onClick={() => setEditBayarIdx(null)}
                className="fixed inset-0 z-[9999] flex items-center justify-center overflow-y-auto bg-black/50 p-4 backdrop-blur-sm"
              >
                <div
                  onClick={(e) => e.stopPropagation()}
                  className="relative flex max-h-[90vh] w-full max-w-sm flex-col overflow-hidden rounded-lg border border-border bg-surface-card p-6 shadow-xl"
                >
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold">Edit Pembayaran</h3>
                    <button
                      onClick={() => setEditBayarIdx(null)}
                      aria-label="Tutup"
                      className="text-xl"
                    >
                      &times;
                    </button>
                  </div>
                  <div className="p-6">
                    <p className="text-13 text-gray-600 mb-3">
                      Invoice:{" "}
                      <strong style={{ fontFamily: "ui-monospace, monospace" }}>
                        {detailTrx.no_invoice}
                      </strong>{" "}
                      — {detailTrx.penyewa} • dicatat {formatTanggal(entri.tgl)}
                    </p>
                    <label className="block text-sm font-medium">Jumlah</label>
                    <input
                      type="text"
                      inputMode="numeric"
                      autoComplete="off"
                      value={formatAngkaInput(editBayarJumlah)}
                      onChange={(e) =>
                        setEditBayarJumlah(e.target.value.replace(/\D/g, ""))
                      }
                      className="w-full rounded border border-border bg-surface-card px-3 py-2 text-lg font-bold"
                      autoFocus
                    />
                    <label className="block text-sm font-medium mt-3">
                      Metode
                    </label>
                    <select
                      value={editBayarMetode}
                      onChange={(e) => setEditBayarMetode(e.target.value)}
                      className="w-full rounded-[0.375rem] border-2 border-border bg-surface-card px-3.5 py-2.5 text-sm text-text-primary outline-none transition focus:border-brand focus:ring-2 focus:ring-brand-light disabled:cursor-not-allowed disabled:bg-surface-subtle disabled:opacity-60"
                    >
                      <option>Tunai</option>
                      <option>Transfer</option>
                      <option>QRIS</option>
                    </select>
                    <label className="block text-sm font-medium mt-3">
                      Catatan
                    </label>
                    <input
                      value={editBayarCatatan}
                      onChange={(e) => setEditBayarCatatan(e.target.value)}
                      placeholder="opsional"
                      className="w-full rounded-[0.375rem] border-2 border-border bg-surface-card px-3.5 py-2.5 text-sm text-text-primary outline-none transition focus:border-brand focus:ring-2 focus:ring-brand-light disabled:cursor-not-allowed disabled:bg-surface-subtle disabled:opacity-60"
                    />
                    <label className="block text-sm font-medium mt-3">
                      Bukti Bayar
                    </label>
                    <input
                      ref={editBayarBuktiRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0] || null;
                        if (f && f.size > 5 * 1024 * 1024) {
                          notify("Ukuran file maksimal 5MB.", "error");
                          e.target.value = "";
                          return;
                        }
                        setEditBayarBuktiBaru(f);
                        setEditBayarHapusBukti(false);
                      }}
                    />
                    <div className="mt-2">
                      {!editBayarHapusBukti && editBayarBuktiLama && (
                        <img
                          src={editBayarBuktiLama}
                          alt="Bukti pembayaran"
                          className="mb-2 h-24 w-24 rounded-md border border-border object-cover"
                        />
                      )}
                      {!editBayarHapusBukti && !editBayarBuktiLama && entri.bukti && (
                        <p className="text-xs text-gray-500 mb-2">Memuat pratinjau...</p>
                      )}
                      {editBayarHapusBukti && (
                        <p className="text-xs text-gray-500 mb-2">Bukti akan dihapus.</p>
                      )}
                      {editBayarBuktiBaru && (
                        <p className="text-xs text-gray-700 mb-2" style={{ wordBreak: "break-word" }}>
                          Ganti ke: {editBayarBuktiBaru.name}
                        </p>
                      )}
                      <div className="flex items-center gap-2 flex-wrap">
                        <button
                          type="button"
                          onClick={() => editBayarBuktiRef.current?.click()}
                          className="rounded-lg px-3 py-1.5 text-xs font-medium bg-gray-200 hover:bg-gray-300 text-slate-700 border-0"
                        >
                          Ganti
                        </button>
                        {(editBayarBuktiLama || entri.bukti) && !editBayarHapusBukti && (
                          <button
                            type="button"
                            onClick={() => {
                              setEditBayarHapusBukti(true);
                              setEditBayarBuktiBaru(null);
                              if (editBayarBuktiRef.current) editBayarBuktiRef.current.value = "";
                            }}
                            className="rounded-lg px-3 py-1.5 text-xs font-medium bg-transparent text-red-600 border-0"
                          >
                            Hapus
                          </button>
                        )}
                        {editBayarHapusBukti && (
                          <button
                            type="button"
                            onClick={() => setEditBayarHapusBukti(false)}
                            className="rounded-lg px-3 py-1.5 text-xs font-medium bg-transparent text-gray-600 border-0"
                          >
                            Batal Hapus
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 mt-4">
                      <button
                        onClick={() => setEditBayarIdx(null)}
                        className="inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-brand focus:ring-offset-2 bg-transparent text-gray-600 hover:bg-surface-secondary flex-1 min-w-0 text-13"
                      >
                        Batal
                      </button>
                      <button
                        onClick={simpanEditBayar}
                        className="inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-brand focus:ring-offset-2 bg-[#7181E0] text-white shadow-sm hover:bg-[#5d6fcc] flex-1 min-w-0 text-13"
                      >
                        Simpan
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })(),
          document.body,
        )}
    </>
  );
}
