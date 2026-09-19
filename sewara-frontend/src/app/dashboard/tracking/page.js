"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { getSetting, getInventory, getTransactionsRange } from "@/lib/db";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useTransactionsAktif } from "@/hooks/useTransactions";
import { formatRupiah } from "@/lib/utils";
import DateTimePicker from "@/components/DateTimePicker";
import { Button } from "@/components/ui";

const hariNama = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];
const DAY_MS = 86400000;
const RENTANG_HARI = 4;
const MAKS_LANE = 3;
const SIDEBAR_W = 240;
const ROW_H = 44;
const GANTT_MIN_W = 800;

function getStatusInfo(t) {
  if (t.status === "Booking")
    return {
      label: "Booking",
      bar: "#d97706",
      badge: "rounded-md bg-warning px-2 py-1 text-xs",
    };
  if (t.status === "Selesai")
    return {
      label: "Selesai",
      bar: "#8b98a5",
      badge:
        "rounded-md px-2 py-1 text-xs bg-surface-secondary text-text-secondary",
    };
  if (t.status === "Belum Selesai")
    return {
      label: "Belum Selesai",
      bar: "var(--color-primary)",
      badge: "rounded-md px-2 py-1 text-xs bg-brand-light text-brand-strong",
    };
  if (t.status === "Disewa") {
    const k = t.waktu_kembali_rencana
      ? new Date(t.waktu_kembali_rencana)
      : null;
    if (k && k < new Date())
      return {
        label: "Telat",
        bar: "#dc2626",
        badge: "rounded-md px-2 py-1 text-xs bg-danger text-white",
      };
    return {
      label: "Disewa",
      bar: "#3b82f6",
      badge: "rounded-md px-2 py-1 text-xs bg-info text-white",
    };
  }
  return {
    label: t.status || "-",
    bar: "#8b98a5",
    badge:
      "rounded-md px-2 py-1 text-xs bg-surface-secondary text-text-secondary",
  };
}

function fmtWaktu(iso) {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
function fmtTglPendek(d) {
  return d.toLocaleDateString("id-ID", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}
function fmtTglPanjang(d) {
  return d.toLocaleDateString("id-ID", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
function fmtJamDuaDigit(d) {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
function fmtTooltip(d) {
  const bln = d.toLocaleDateString("id-ID", { month: "short" });
  return `${hariNama[d.getDay()]} ${String(d.getDate()).padStart(2, "0")} ${bln} ${fmtJamDuaDigit(d)}`;
}
function isSameDate(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}
function awalHari(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function snsItem(item) {
  if (item.ref?.jenis === "satuan") return item.sn || "";
  return (item.assignedSNs || []).flatMap((a) => a.sns || []).join(", ");
}
function normSn(s) {
  return String(s || "")
    .trim()
    .toLowerCase();
}
function fmtDatetimeLocal(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
function parseDatetimeLocal(str) {
  return str ? new Date(str) : null;
}

export default function TrackingPage() {
  const [inv, setInv] = useState([]);
  const [trx, setTrx] = useState([]);
  const [trxRange, setTrxRange] = useState([]);
  const [search, setSearch] = useState("");
  const [tgl, setTgl] = useState(new Date());
  const [mode, setMode] = useState("tabel");
  const [tglFokus, setTglFokus] = useState(new Date());
  const [modalDetail, setModalDetail] = useState(null);
  const [modalOverflow, setModalOverflow] = useState(null);
  const [trackedIds, setTrackedIds] = useState([]);
  const [cariAlat, setCariAlat] = useState("");
  const [prefillAmbil, setPrefillAmbil] = useState("");
  const [prefillKembali, setPrefillKembali] = useState("");
  const [prefillItems, setPrefillItems] = useState([]);
  const [prefillQty, setPrefillQty] = useState({});
  const [errHandoff, setErrHandoff] = useState("");
  const router = useRouter();
  const { data: cachedTransactions, refetch: refetchTransactions } =
    useTransactionsAktif();

  useEffect(() => {
    (async () => {
      setInv(await getInventory());
      setTrx(cachedTransactions || (await refetchTransactions()));
    })();
  }, [cachedTransactions, refetchTransactions]);

  const days = useMemo(() => {
    const start = awalHari(tglFokus);
    return Array.from({ length: RENTANG_HARI }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return d;
    });
  }, [tglFokus]);

  const mulaiISO = useMemo(() => awalHari(days[0]).toISOString(), [days]);
  const akhirISO = useMemo(() => {
    const d = awalHari(days[RENTANG_HARI - 1]);
    return new Date(d.getTime() + DAY_MS - 1).toISOString();
  }, [days]);

  const muatTimeline = useCallback(async () => {
    const t = await getTransactionsRange(mulaiISO, akhirISO);
    setTrxRange(t);
  }, [mulaiISO, akhirISO]);

  useEffect(() => {
    (async () => {
      await muatTimeline();
    })();
  }, [muatTimeline]);

  useEffect(() => {
    const handler = () => {
      (async () => {
        setInv(await getInventory());
        setTrx(await refetchTransactions());
        await muatTimeline();
      })();
    };
    window.addEventListener("dataChanged", handler);
    return () => window.removeEventListener("dataChanged", handler);
  }, [muatTimeline]);

  // ---------- Mode Tabel (existing) ----------
  function rentangHari(d) {
    const mulai = new Date(
      d.getFullYear(),
      d.getMonth(),
      d.getDate(),
      0,
      0,
      0,
      0,
    );
    const selesai = new Date(
      d.getFullYear(),
      d.getMonth(),
      d.getDate(),
      23,
      59,
      59,
      999,
    );
    return { mulai: mulai.toISOString(), selesai: selesai.toISOString() };
  }
  const rentang = rentangHari(tgl);

  const indeks = useMemo(() => {
    const dimiliki = new Map();
    const rujuk = new Map();
    trx.forEach((t) => {
      (t.items || []).forEach((item) => {
        const addRujuk = (idBarang, sns) => {
          const kunci = String(idBarang);
          if (!rujuk.has(kunci)) rujuk.set(kunci, new Map());
          const m = rujuk.get(kunci);
          sns.forEach((s) => {
            if (!m.has(s)) m.set(s, []);
            m.get(s).push({
              ambil: t.waktu_ambil_rencana,
              kembali: t.waktu_kembali_rencana,
            });
          });
          const setDim = dimiliki.get(kunci) || new Set();
          sns.forEach((s) => setDim.add(s));
          dimiliki.set(kunci, setDim);
        };
        if (item.ref?.jenis === "satuan") {
          addRujuk(item.idBarang, item.sn ? item.sn.split(", ") : []);
        } else if (item.ref?.jenis === "bundling") {
          (item.assignedSNs || []).forEach((a) =>
            addRujuk(a.idKomp, a.sns || []),
          );
        }
      });
    });
    return { dimiliki, rujuk };
  }, [trx]);

  const baris = useMemo(() => {
    const mulaiMs = new Date(rentang.mulai).getTime();
    const selesaiMs = new Date(rentang.selesai).getTime();
    const totalUnit = (item) => {
      const setDim = indeks.dimiliki.get(String(item.id));
      const totalOwned = new Set(item.sns || []);
      if (setDim) setDim.forEach((s) => totalOwned.add(s));
      if (item.jenis === "satuan") return totalOwned.size;
      if (item.jenis === "bundling") {
        if (!item.komponen || item.komponen.length === 0) return 0;
        return Math.min(
          ...item.komponen.map((k) =>
            Math.floor(
              (indeks.dimiliki.get(String(k.idBarang))?.size || 0) / k.qty,
            ),
          ),
        );
      }
      return 0;
    };
    const snsTerpakaiRentang = (idBarang) => {
      const m = indeks.rujuk.get(String(idBarang));
      if (!m) return [];
      const hasil = [];
      m.forEach((periodeArr, s) => {
        const bentrok = periodeArr.some((p) => {
          const pa = p.ambil ? new Date(p.ambil).getTime() : -Infinity;
          const sa = p.kembali ? new Date(p.kembali).getTime() : Infinity;
          return pa < selesaiMs && mulaiMs < sa;
        });
        if (bentrok) hasil.push(s);
      });
      return hasil;
    };
    const infoTerpakai = (item) => {
      if (item.jenis === "satuan") {
        const sns = snsTerpakaiRentang(item.id);
        return { qty: sns.length, sns };
      }
      if (item.jenis === "bundling") {
        const arr = item.komponen.map((k) =>
          Math.floor(snsTerpakaiRentang(k.idBarang).length / k.qty),
        );
        return { qty: arr.length ? Math.min(...arr) : 0, sns: [] };
      }
      return { qty: 0, sns: [] };
    };
    return inv.map((item) => {
      const total = totalUnit(item);
      const terpakai = infoTerpakai(item);
      return { item, total, terpakai, tersedia: total - terpakai.qty };
    });
  }, [inv, indeks, rentang.mulai, rentang.selesai]);

  const tersediaCount = baris.filter((b) => b.tersedia > 0).length;
  const habisCount = baris.filter((b) => b.tersedia < 1).length;
  const disewaCount = baris.reduce((acc, row) => acc + row.terpakai.qty, 0);
  const tglStr = `${tgl.getFullYear()}-${String(tgl.getMonth() + 1).padStart(2, "0")}-${String(tgl.getDate()).padStart(2, "0")}`;
  const labelTgl = tgl.toLocaleDateString("id-ID", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  // ---------- Mode Timeline (Gantt 4 hari) ----------
  const rangeStartMs = useMemo(() => awalHari(days[0]).getTime(), [days]);
  const rangeEndMs = useMemo(
    () => rangeStartMs + RENTANG_HARI * DAY_MS,
    [rangeStartMs],
  );

  const ganttRows = useMemo(() => {
    const daftar = inv.filter((i) => trackedIds.includes(String(i.id)));
    const rows = [];
    daftar.forEach((item) => {
      rows.push({
        key: `p-${item.id}`,
        type: "parent",
        item,
        label: item.nama,
        sn: null,
        kompId: null,
      });
      const pseudoSet = new Set();
      const tambahPseudo = (sn, kompId) => {
        const kunci = `${String(item.id)}|${kompId || ""}|${normSn(sn)}`;
        if (pseudoSet.has(kunci)) return;
        pseudoSet.add(kunci);
        rows.push({
          key: `c-${item.id}-pseudo-${kompId || ""}-${normSn(sn)}`,
          type: "child",
          item,
          label: sn,
          sn,
          kompId: kompId || null,
          pseudo: true,
        });
      };
      if (item.jenis === "satuan") {
        const sns = item.sns && item.sns.length ? item.sns : ["Unit 1"];
        const terdaftar = new Set((item.sns || []).map(normSn));
        sns.forEach((sn) =>
          rows.push({
            key: `c-${item.id}-${sn}`,
            type: "child",
            item,
            label: sn,
            sn,
            kompId: null,
          }),
        );
        trxRange.forEach((t) => {
          if (t.status === "Dibatalkan") return;
          (t.items || []).forEach((i) => {
            if (String(i.idBarang) !== String(item.id)) return;
            String(i.sn || "")
              .split(",")
              .forEach((s) => {
                const norm = normSn(s);
                if (norm && !terdaftar.has(norm)) tambahPseudo(s, null);
              });
          });
        });
      } else if (item.jenis === "bundling") {
        const kompMap = new Map();
        (item.komponen || []).forEach((k) => {
          const komp = inv.find((x) => String(x.id) === String(k.idBarang));
          kompMap.set(
            String(k.idBarang),
            new Set((komp && komp.sns ? komp.sns : []).map(normSn)),
          );
        });
        (item.komponen || []).forEach((k) => {
          const komp = inv.find((x) => String(x.id) === String(k.idBarang));
          const sns =
            komp && komp.sns && komp.sns.length ? komp.sns : ["Unit 1"];
          sns.forEach((sn) =>
            rows.push({
              key: `c-${item.id}-${k.idBarang}-${sn}`,
              type: "child",
              item,
              label: sn,
              sn,
              kompId: k.idBarang,
            }),
          );
        });
        trxRange.forEach((t) => {
          if (t.status === "Dibatalkan") return;
          (t.items || []).forEach((i) => {
            if (String(i.idBarang) !== String(item.id)) return;
            (i.assignedSNs || []).forEach((a) => {
              const setKomp = kompMap.get(String(a.idKomp));
              (a.sns || []).forEach((s) => {
                const norm = normSn(s);
                if (norm && (!setKomp || !setKomp.has(norm)))
                  tambahPseudo(s, a.idKomp);
              });
            });
          });
        });
      }
    });
    return rows;
  }, [inv, trackedIds, trxRange]);

  const ganttBars = useMemo(() => {
    const hasil = new Map();
    const spanMs = rangeEndMs - rangeStartMs;
    ganttRows.forEach((row) => {
      if (row.type !== "child") return;
      const bars = [];
      trxRange.forEach((t) => {
        if (
          t.status === "Dibatalkan" ||
          !t.waktu_ambil_rencana ||
          !t.waktu_kembali_rencana
        )
          return;
        const punya = (t.items || []).some((i) => {
          if (String(i.idBarang) !== String(row.item.id)) return false;
          if (row.item.jenis === "satuan") {
            return String(i.sn || "")
              .split(",")
              .map(normSn)
              .includes(normSn(row.sn));
          }
          return (i.assignedSNs || []).some(
            (a) =>
              String(a.idKomp) === String(row.kompId) &&
              (a.sns || []).map(normSn).includes(normSn(row.sn)),
          );
        });
        if (!punya) return;
        const s = new Date(t.waktu_ambil_rencana).getTime();
        const e = new Date(t.waktu_kembali_rencana).getTime();
        if (e <= rangeStartMs || s >= rangeEndMs) return;
        const cs = Math.max(s, rangeStartMs);
        const ce = Math.min(e, rangeEndMs);
        bars.push({
          t,
          cs,
          ce,
          mulaiSebelumWindow: s < rangeStartMs,
          mulaiAsliMs: s,
          selesaiSetelahWindow: e > rangeEndMs,
          selesaiAsliMs: e,
          left: ((cs - rangeStartMs) / spanMs) * 100,
          width: Math.max(((ce - cs) / spanMs) * 100, 0.6),
        });
      });
      bars.sort((a, b) => a.cs - b.cs || a.ce - b.ce);
      const lanes = [];
      const overflow = [];
      bars.forEach((b) => {
        let placed = -1;
        for (let li = 0; li < lanes.length; li++) {
          if (b.cs >= lanes[li][lanes[li].length - 1].ce) {
            placed = li;
            break;
          }
        }
        if (placed === -1) {
          if (lanes.length < MAKS_LANE) {
            lanes.push([b]);
            placed = lanes.length - 1;
          } else {
            overflow.push(b);
            return;
          }
        } else {
          lanes[placed].push(b);
        }
        b.lane = placed;
      });
      hasil.set(row.key, {
        bars: lanes.flat(),
        overflow,
        laneCount: Math.max(1, lanes.length),
      });
    });
    return hasil;
  }, [ganttRows, trxRange, rangeStartMs, rangeEndMs]);

  const today = new Date();
  const idxHariIni = Math.floor(
    (awalHari(today).getTime() - rangeStartMs) / DAY_MS,
  );
  const nowLeft =
    idxHariIni >= 0 && idxHariIni < RENTANG_HARI
      ? ((today.getTime() - rangeStartMs) / (rangeEndMs - rangeStartMs)) * 100
      : null;
  const prefillMulai = prefillAmbil ? new Date(prefillAmbil) : null;
  const prefillAkhir = prefillKembali ? new Date(prefillKembali) : null;
  const prefillBand = (() => {
    if (!prefillMulai || !prefillAkhir) return null;
    const a = prefillMulai.getTime();
    const k = prefillAkhir.getTime();
    if (Number.isNaN(a) || Number.isNaN(k) || k <= a) return null;
    const spanMs = rangeEndMs - rangeStartMs;
    const cs = Math.max(a, rangeStartMs);
    const ce = Math.min(k, rangeEndMs);
    if (cs >= rangeEndMs || ce <= rangeStartMs || ce <= cs) return null;
    return {
      left: ((cs - rangeStartMs) / spanMs) * 100,
      width: ((ce - cs) / spanMs) * 100,
    };
  })();
  const isHariPrefill = (d) => {
    if (!prefillMulai || !prefillAkhir) return false;
    const dayStart = awalHari(d).getTime();
    const dayEnd = dayStart + DAY_MS - 1;
    return (
      prefillMulai.getTime() <= dayEnd && dayStart <= prefillAkhir.getTime()
    );
  };
  const labelRentang = `${fmtTglPendek(days[0])} — ${fmtTglPanjang(days[RENTANG_HARI - 1])}`;
  const geserHari = (n) =>
    setTglFokus((d) => {
      const x = new Date(d);
      x.setDate(x.getDate() + n);
      return x;
    });
  const keHariIni = () => setTglFokus(new Date());
  const tooltipBar = (b) =>
    `${b.t.penyewa} · ${b.t.no_invoice || "-"} · ${fmtTooltip(new Date(b.t.waktu_ambil_rencana))} → ${fmtTooltip(new Date(b.t.waktu_kembali_rencana))}`;
  const simpanTracked = (ids) => {
    setTrackedIds(ids);
  };
  const hapusAlat = (id) =>
    simpanTracked(trackedIds.filter((x) => x !== String(id)));
  const tambahAlat = (id) => {
    const sid = String(id);
    if (!trackedIds.includes(sid)) simpanTracked([...trackedIds, sid]);
    setCariAlat("");
  };
  const hasilCari = useMemo(() => {
    const q = cariAlat.trim().toLowerCase();
    return inv.filter(
      (i) =>
        !trackedIds.includes(String(i.id)) &&
        (!q || (i.nama || "").toLowerCase().includes(q)),
    );
  }, [inv, trackedIds, cariAlat]);
  const isPrefillChecked = (item, sn) =>
    prefillItems.some(
      (p) =>
        String(p.idBarang) === String(item.id) &&
        String(p.sn || "") === String(sn || ""),
    );
  const togglePrefill = (item, sn, isBundling) => {
    if (isBundling) {
      const ada = prefillItems.some(
        (p) => String(p.idBarang) === String(item.id) && p.sn === null,
      );
      if (ada) {
        setPrefillItems(
          prefillItems.filter(
            (p) => !(String(p.idBarang) === String(item.id) && p.sn === null),
          ),
        );
      } else {
        setPrefillItems([
          ...prefillItems,
          {
            idBarang: item.id,
            ref: item,
            qty: prefillQty[String(item.id)] || 1,
            sn: null,
          },
        ]);
      }
    } else {
      const ada = prefillItems.some(
        (p) =>
          String(p.idBarang) === String(item.id) && String(p.sn) === String(sn),
      );
      if (ada) {
        setPrefillItems(
          prefillItems.filter(
            (p) =>
              !(
                String(p.idBarang) === String(item.id) &&
                String(p.sn) === String(sn)
              ),
          ),
        );
      } else {
        setPrefillItems([
          ...prefillItems,
          { idBarang: item.id, ref: item, qty: 1, sn },
        ]);
      }
    }
    setErrHandoff("");
  };
  const ubahQtyPrefill = (item, v) => {
    const qty = Math.max(1, parseInt(v, 10) || 1);
    setPrefillQty((q) => ({ ...q, [String(item.id)]: qty }));
    setPrefillItems((prev) =>
      prev.map((p) =>
        String(p.idBarang) === String(item.id) && p.sn === null
          ? { ...p, qty }
          : p,
      ),
    );
    setErrHandoff("");
  };
  const bersihkanPrefill = () => {
    setPrefillItems([]);
    setPrefillAmbil("");
    setPrefillKembali("");
    setPrefillQty({});
    setErrHandoff("");
  };
  const filterTime = (time) => {
    const h = time.getHours();
    const mode = getSetting("jam_mode", "buka_tutup");
    if (mode !== "buka_tutup") return true;
    const buka = parseInt(getSetting("jam_buka", "6"), 10) || 6;
    const tutup = parseInt(getSetting("jam_tutup", "22"), 10) || 22;
    return h >= buka && h <= tutup;
  };
  const isiSekarangAmbil = () => {
    const now = new Date();
    now.setMinutes(Math.ceil(now.getMinutes() / 5) * 5, 0, 0);
    if (getSetting("jam_mode", "buka_tutup") === "buka_tutup") {
      const buka = parseInt(getSetting("jam_buka", "6"), 10) || 6;
      const tutup = parseInt(getSetting("jam_tutup", "22"), 10) || 22;
      if (now.getHours() < buka) now.setHours(buka, 0, 0, 0);
      if (now.getHours() > tutup) now.setHours(tutup, 0, 0, 0);
    }
    setPrefillAmbil(fmtDatetimeLocal(now));
    setErrHandoff("");
  };
  const lanjutBooking = () => {
    if (!prefillAmbil || !prefillKembali) {
      setErrHandoff("Isi tanggal ambil & kembali dulu!");
      return;
    }
    if (prefillItems.length === 0) {
      setErrHandoff("Pilih minimal 1 item dulu!");
      return;
    }
    const a = new Date(prefillAmbil);
    const k = new Date(prefillKembali);
    if (Number.isNaN(a.getTime()) || Number.isNaN(k.getTime())) {
      setErrHandoff("Tanggal yang dipilih tidak valid.");
      return;
    }
    if (k.getTime() <= a.getTime()) {
      setErrHandoff("Waktu kembali harus setelah waktu ambil.");
      return;
    }
    try {
      sessionStorage.setItem(
        "rentalpro_booking_prefill",
        JSON.stringify({
          ambilISO: a.toISOString(),
          kembaliISO: k.toISOString(),
          items: prefillItems,
        }),
      );
    } catch (e) {
      setErrHandoff(`Gagal menyimpan pilihan: ${e.message}`);
      return;
    }
    router.push("/dashboard/booking");
  };
  const legend = [
    { label: "Booking", cls: "#d97706" },
    { label: "Disewa", cls: "#3b82f6" },
    { label: "Telat", cls: "#dc2626" },
    { label: "Belum Selesai", cls: "var(--color-primary)" },
    { label: "Selesai", cls: "#8b98a5" },
  ];

  return (
    <div className="p-6">
      <h2 className="text-xl font-bold mb-6">Tracking Alat</h2>

      <div className="mb-4 flex items-center justify-between flex-wrap gap-2">
        <div className="flex gap-2 rounded-lg bg-slate-100 p-1">
          {[
            ["tabel", "Tabel"],
            ["timeline", "Timeline"],
          ].map(([v, lbl]) => (
            <button
              key={v}
              type="button"
              onClick={() => setMode(v)}
              className={`rounded-lg border-0 px-4 py-2 text-sm font-semibold transition-all ${
                mode === v
                  ? "bg-[#7181E0] text-white shadow-sm hover:bg-[#5d6fcc]"
                  : "bg-transparent text-slate-700 hover:bg-slate-200"
              }`}
            >
              {lbl}
            </button>
          ))}
        </div>
      </div>

      {mode === "tabel" && (
        <>
          <div className="mb-6 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border-2 border-slate-200 bg-white p-6 shadow-lg">
              <p className="text-sm text-gray-500 mb-2">Total Alat</p>
              <p className="text-4xl font-bold text-gray-900">{inv.length}</p>
            </div>
            <div className="rounded-xl border-2 border-slate-200 bg-white p-6 shadow-lg">
              <p className="text-sm text-gray-500 mb-2">
                Tersedia · {labelTgl}
              </p>
              <p className="text-4xl font-bold text-[#579171]">
                {tersediaCount}
              </p>
            </div>
            <div className="rounded-xl border-2 border-slate-200 bg-white p-6 shadow-lg">
              <p className="text-sm text-gray-500 mb-2">Disewa · {labelTgl}</p>
              <p className="text-4xl font-bold text-blue-500">{disewaCount}</p>
            </div>
            <div className="rounded-xl border-2 border-slate-200 bg-white p-6 shadow-lg">
              <p className="text-sm text-gray-500 mb-2">Habis · {labelTgl}</p>
              <p className="text-4xl font-bold text-[#F04438]">{habisCount}</p>
            </div>
          </div>
          <div className="flex items-center flex-wrap gap-3 mb-4">
            <div className="flex items-center gap-2">
              <div className="w-[150px] max-w-full">
                <DateTimePicker
                  value={tgl}
                  onChange={(d) => d && setTgl(d)}
                  showTime={false}
                  placeholder="Pilih tanggal"
                />
              </div>
              <Button
                onClick={() => setTgl(new Date())}
                className="rounded-lg border-0 bg-[#7181E0] px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#5d6fcc]"
              >
                Hari Ini
              </Button>
            </div>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cari nama alat..."
              className="min-w-0 flex-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-[#7181E0] focus:ring-2 focus:ring-[#7181E0]/20"
            />
          </div>
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-lg">
            <table className="min-w-full border-collapse">
              <thead className="bg-slate-100">
                <tr>
                  {["Nama Alat", "Jenis"].map((h) => (
                    <th
                      key={h}
                      className="px-4 py-3 text-left text-sm font-semibold text-slate-700"
                    >
                      {h}
                    </th>
                  ))}
                  <th className="px-4 py-3 text-center text-sm font-semibold text-slate-700">
                    Total Unit
                  </th>
                  <th className="px-4 py-3 text-center text-sm font-semibold text-slate-700">
                    Terpakai {tglStr}
                  </th>
                  <th className="px-4 py-3 text-center text-sm font-semibold text-slate-700">
                    S/N Terpakai
                  </th>
                  <th className="px-4 py-3 text-center text-sm font-semibold text-slate-700">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {baris.length === 0 && (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-4 py-12 text-center italic text-gray-500"
                    >
                      Belum ada alat.
                    </td>
                  </tr>
                )}
                {baris
                  .filter((b) =>
                    b.item.nama.toLowerCase().includes(search.toLowerCase()),
                  )
                  .map(({ item, total, terpakai, tersedia }) => (
                    <tr key={item.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 font-semibold text-slate-900">
                        {item.nama}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500">
                        {item.jenis === "satuan" ? "Satuan" : "Bundling"}
                      </td>
                      <td className="px-4 py-3 text-center font-bold">
                        {total}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {terpakai.qty > 0 ? (
                          <span className="font-bold text-[#7181E0]">
                            {terpakai.qty}
                          </span>
                        ) : (
                          <span className="text-gray-400">-</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center text-sm text-gray-500">
                        {terpakai.sns.length > 0 && (
                          <div>{terpakai.sns.join(", ")}</div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {tersedia > 0 ? (
                          <span className="inline-flex items-center rounded-md px-2 py-1 text-xs font-medium bg-[#579171] text-white">
                            Tersedia {tersedia}
                          </span>
                        ) : (
                          <span className="inline-flex items-center rounded-md px-2 py-1 text-xs font-medium bg-[#F04438] text-white">
                            Habis
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {mode === "timeline" && (
        <div
          className="rounded-lg border border-border bg-surface-card"
          style={{ borderTop: "4px solid var(--color-primary)" }}
        >
          <style>{`
            .cursor-pointer { cursor: pointer; transition: filter 0.15s, box-shadow 0.15s; box-shadow: 0 1px 3px rgba(0,0,0,0.25); }
            .cursor-pointer:hover { filter: brightness(0.88); }
            .flex items-center justify-center { display: flex; align-items: center; justify-content: center; transition: background 0.15s, color 0.15s; }
            .flex items-center justify-center:hover { background: var(--color-danger-soft); color: var(--color-danger-text); }
            .transition-colors { transition: background 0.12s; }
            .transition-colors:hover { background: var(--bg-subtle); }
            .transition-colors:last-child { border-bottom: 0 !important; }
          `}</style>
          <div
            className="p-4 flex items-center flex-wrap gap-3"
            style={{
              justifyContent: "space-between",
              rowGap: "var(--space-3)",
            }}
          >
            <div style={{ position: "relative", width: 300, maxWidth: "100%" }}>
              <input
                value={cariAlat}
                onChange={(e) => setCariAlat(e.target.value)}
                onBlur={() => setTimeout(() => setCariAlat(""), 150)}
                placeholder="Cari alat untuk ditambahkan ke tracking..."
                className="w-full rounded-md border border-solid border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none transition-colors focus:border-[#7181E0] focus:ring-2 focus:ring-[#7181E0]/20"
              />
              {cariAlat.trim() !== "" && (
                <div
                  onMouseDown={(e) => e.preventDefault()}
                  style={{
                    position: "absolute",
                    left: 0,
                    right: 0,
                    top: "calc(100% + 4px)",
                    zIndex: 30,
                    background: "var(--bg-surface)",
                    border: "1px solid var(--border-color)",
                    borderRadius: "var(--radius-md)",
                    boxShadow: "0 4px 12px rgba(0,0,0,0.12)",
                    maxHeight: 320,
                    overflowY: "auto",
                  }}
                >
                  {hasilCari.length === 0 ? (
                    <div
                      className="text-xs text-text-muted"
                      style={{ padding: "10px 12px", fontStyle: "italic" }}
                    >
                      Tidak ada alat yang cocok.
                    </div>
                  ) : (
                    hasilCari.map((i) => (
                      <button
                        type="button"
                        key={i.id}
                        onClick={() => tambahAlat(i.id)}
                        className="transition-colors"
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          width: "100%",
                          padding: "9px 12px",
                          border: 0,
                          borderBottom: "1px solid var(--border-color)",
                          background: "transparent",
                          cursor: "pointer",
                          textAlign: "left",
                          fontSize: 13,
                          fontFamily: "inherit",
                        }}
                      >
                        <span
                          style={{
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {i.nama}
                        </span>
                        <span
                          className={`rounded-md px-2 py-1 text-xs ${i.jenis === "satuan" ? "bg-surface-secondary text-text-secondary" : "bg-warning"}`}
                          style={{ flexShrink: 0, marginLeft: 8 }}
                        >
                          {i.jenis === "satuan" ? "Satuan" : "Bundling"}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
            <div className="flex items-center flex-wrap gap-2">
              <button
                type="button"
                onClick={() => geserHari(-RENTANG_HARI)}
                className="rounded-lg border-0 bg-gray-200 px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-gray-300"
              >
                &larr; Sebelum
              </button>
              <div className="flex items-center justify-center px-2">
                <span className="text-sm font-bold whitespace-nowrap">
                  {labelRentang}
                </span>
              </div>
              <button
                type="button"
                onClick={() => geserHari(RENTANG_HARI)}
                className="rounded-lg border-0 bg-gray-200 px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-gray-300"
              >
                Berikut &rarr;
              </button>
              <button
                type="button"
                onClick={keHariIni}
                className="rounded-lg border-0 bg-[#7181E0] px-4 py-2 text-sm font-semibold text-white shadow-sm transition-all hover:bg-[#5d6fcc]"
              >
                Hari Ini
              </button>
            </div>
          </div>

          <div
            className="p-4 flex items-center flex-wrap gap-3"
            style={{
              borderTop: "1px solid var(--border-color)",
              alignItems: "flex-end",
              rowGap: "var(--space-3)",
            }}
          >
            <div>
              <label
                className="text-xs"
                style={{ fontSize: 11, marginBottom: 4 }}
              >
                Ambil
              </label>
              <div
                className="flex items-center gap-2"
                style={{ alignItems: "center" }}
              >
                <div className="w-[200px] max-w-full">
                  <DateTimePicker
                    value={
                      prefillAmbil ? parseDatetimeLocal(prefillAmbil) : null
                    }
                    onChange={(d) => {
                      setPrefillAmbil(d ? fmtDatetimeLocal(d) : "");
                      setErrHandoff("");
                    }}
                    minDate={new Date()}
                    filterTime={filterTime}
                    showTime
                    placeholder="Pilih tgl & jam ambil"
                  />
                </div>
                <button
                  type="button"
                  onClick={isiSekarangAmbil}
                  className="rounded-lg border-0 bg-[#7181E0] px-4 py-2 text-sm font-semibold text-white shadow-sm transition-all hover:bg-[#5d6fcc]"
                >
                  Sekarang
                </button>
              </div>
            </div>
            <div>
              <label
                className="text-xs"
                style={{ fontSize: 11, marginBottom: 4 }}
              >
                Kembali
              </label>
              <div style={{ width: 200, maxWidth: "100%" }}>
                <DateTimePicker
                  value={
                    prefillKembali ? parseDatetimeLocal(prefillKembali) : null
                  }
                  onChange={(d) => {
                    setPrefillKembali(d ? fmtDatetimeLocal(d) : "");
                    setErrHandoff("");
                  }}
                  minDate={
                    prefillAmbil ? parseDatetimeLocal(prefillAmbil) : new Date()
                  }
                  filterTime={filterTime}
                  showTime
                  placeholder="Pilih tgl & jam kembali"
                />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold">
                {prefillItems.length} item dipilih
              </span>
              <button
                type="button"
                onClick={lanjutBooking}
                className="rounded-lg border-0 bg-[#7181E0] px-4 py-2 text-sm font-semibold text-white shadow-sm transition-all hover:bg-[#5d6fcc]"
              >
                Lanjut ke Booking
              </button>
              <button
                type="button"
                onClick={bersihkanPrefill}
                className="rounded-lg border-0 bg-gray-200 px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-gray-300"
              >
                Bersihkan
              </button>
            </div>
            {errHandoff && (
              <div style={{ width: "100%" }}>
                <p className="text-xs text-danger mb-0">{errHandoff}</p>
              </div>
            )}
          </div>

          <div
            style={{
              overflowX: "auto",
              borderTop: "1px solid var(--border-color)",
            }}
          >
            <div style={{ minWidth: GANTT_MIN_W }}>
              <div
                style={{
                  display: "flex",
                  borderBottom: "1px solid var(--border-color)",
                  background: "var(--bg-subtle)",
                }}
              >
                <div
                  style={{
                    width: SIDEBAR_W,
                    flexShrink: 0,
                    position: "sticky",
                    left: 0,
                    zIndex: 20,
                    background: "var(--bg-subtle)",
                    borderRight: "1px solid var(--border-color)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    height: 50,
                    fontSize: 11,
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    color: "var(--text-muted)",
                  }}
                >
                  Inventaris / S/N
                </div>
                {days.map((d, di) => {
                  const isToday = isSameDate(d, today);
                  return (
                    <div
                      key={d.getTime()}
                      style={{
                        flex: 1,
                        minWidth: 120,
                        textAlign: "center",
                        display: "flex",
                        flexDirection: "column",
                        justifyContent: "center",
                        borderRight:
                          di < RENTANG_HARI - 1
                            ? "1px solid var(--border-color)"
                            : "none",
                        background: isToday
                          ? "#EEF2FF"
                          : isHariPrefill(d)
                            ? "rgba(79, 70, 229, 0.06)"
                            : "transparent",
                        borderBottom: isToday ? "3px solid #4F46E5" : "none",
                      }}
                    >
                      <span
                        style={{ fontSize: 11, color: "var(--text-secondary)" }}
                      >
                        {hariNama[d.getDay()]}
                      </span>
                      <span
                        style={{
                          fontSize: 13,
                          fontWeight: 700,
                          color: isToday
                            ? "var(--color-primary-strong)"
                            : "var(--text-primary)",
                        }}
                      >
                        {d.getDate()}
                      </span>
                    </div>
                  );
                })}
              </div>

              {ganttRows.length === 0 ? (
                <div
                  style={{
                    display: "flex",
                    height: ROW_H,
                    borderBottom: "1px solid var(--border-color)",
                  }}
                >
                  <div
                    style={{
                      width: SIDEBAR_W,
                      flexShrink: 0,
                      position: "sticky",
                      left: 0,
                      zIndex: 15,
                      background: "var(--bg-surface)",
                      borderRight: "1px solid var(--border-color)",
                      display: "flex",
                      alignItems: "center",
                      padding: "0 14px",
                      boxShadow: "2px 0 4px rgba(0,0,0,0.03)",
                    }}
                  >
                    <span
                      className="text-xs text-text-muted"
                      style={{ fontStyle: "italic", lineHeight: 1.4 }}
                    >
                      Belum ada alat di daftar tracking.
                    </span>
                  </div>
                  <div
                    style={{
                      flex: 1,
                      position: "relative",
                      background: "var(--bg-surface)",
                    }}
                  >
                    {days.map((d, di) => (
                      <div
                        key={d.getTime()}
                        style={{
                          position: "absolute",
                          top: 0,
                          bottom: 0,
                          left: `${(di / RENTANG_HARI) * 100}%`,
                          borderLeft:
                            di > 0 ? "1px dashed var(--border-color)" : "none",
                          pointerEvents: "none",
                        }}
                      />
                    ))}
                    {prefillBand && (
                      <div
                        style={{
                          pointerEvents: "none",
                          position: "absolute",
                          top: 0,
                          bottom: 0,
                          left: `calc(${prefillBand.left}% + 1px)`,
                          width: `calc(${prefillBand.width}% - 2px)`,
                          background: "rgba(79, 70, 229, 0.10)",
                          borderLeft: "1px dashed #4F46E5",
                          borderRight: "1px dashed #4F46E5",
                          zIndex: 11,
                          transition: "left 0.15s, width 0.15s",
                        }}
                      />
                    )}
                    {nowLeft !== null && (
                      <div
                        style={{
                          pointerEvents: "none",
                          position: "absolute",
                          top: 0,
                          bottom: 0,
                          left: `calc(${nowLeft}% - 0.5px)`,
                          width: 1,
                          background: "#EF4444",
                          zIndex: 12,
                        }}
                      />
                    )}
                  </div>
                </div>
              ) : (
                ganttRows.map((row) => {
                  const isParent = row.type === "parent";
                  const info = ganttBars.get(row.key) || {
                    bars: [],
                    overflow: [],
                    laneCount: 1,
                  };
                  const stripW = 100 / info.laneCount;
                  return (
                    <div
                      key={row.key}
                      style={{
                        display: "flex",
                        height: ROW_H,
                        borderBottom: "1px solid var(--border-color)",
                      }}
                    >
                      <div
                        style={{
                          width: SIDEBAR_W,
                          flexShrink: 0,
                          position: "sticky",
                          left: 0,
                          zIndex: 15,
                          background: isParent
                            ? "var(--bg-subtle)"
                            : "var(--bg-surface)",
                          borderRight: "1px solid var(--border-color)",
                          display: "flex",
                          alignItems: "center",
                          padding: isParent ? "0 6px 0 14px" : "0 14px 0 30px",
                          boxShadow: "2px 0 4px rgba(0,0,0,0.03)",
                        }}
                      >
                        {isParent ? (
                          <>
                            {row.item.jenis === "bundling" && (
                              <>
                                <input
                                  type="checkbox"
                                  checked={prefillItems.some(
                                    (p) =>
                                      String(p.idBarang) ===
                                        String(row.item.id) && p.sn === null,
                                  )}
                                  onChange={() =>
                                    togglePrefill(row.item, null, true)
                                  }
                                  aria-label={`Pilih paket ${row.label}`}
                                  style={{
                                    flexShrink: 0,
                                    width: 15,
                                    height: 15,
                                    marginRight: 8,
                                    accentColor: "var(--color-primary)",
                                    cursor: "pointer",
                                  }}
                                />
                                <input
                                  type="number"
                                  min={1}
                                  value={prefillQty[String(row.item.id)] || 1}
                                  onChange={(e) =>
                                    ubahQtyPrefill(row.item, e.target.value)
                                  }
                                  aria-label={`Jumlah paket ${row.label}`}
                                  style={{
                                    flexShrink: 0,
                                    width: 46,
                                    marginRight: 8,
                                    padding: "2px 4px",
                                    fontSize: 11,
                                    textAlign: "center",
                                    borderRadius: "var(--radius-sm)",
                                    border: "1px solid var(--border-color)",
                                    background: "var(--bg-surface)",
                                    color: "var(--text-primary)",
                                  }}
                                />
                              </>
                            )}
                            <span
                              style={{
                                flex: 1,
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                                fontSize: 13,
                                fontWeight: 700,
                                color: "var(--text-primary)",
                              }}
                            >
                              {row.label}
                            </span>
                            <button
                              type="button"
                              onClick={() => hapusAlat(row.item.id)}
                              aria-label={`Hapus ${row.label} dari tracking`}
                              title="Hapus dari tracking"
                              className="flex items-center justify-center"
                              style={{
                                flexShrink: 0,
                                width: 22,
                                height: 22,
                                marginLeft: 6,
                                borderRadius: "var(--radius-full)",
                                border: 0,
                                background: "transparent",
                                color: "var(--text-muted)",
                                fontSize: 16,
                                lineHeight: 1,
                                cursor: "pointer",
                              }}
                            >
                              ×
                            </button>
                          </>
                        ) : row.item.jenis === "satuan" ? (
                          <>
                            <input
                              type="checkbox"
                              checked={isPrefillChecked(row.item, row.sn)}
                              onChange={() =>
                                togglePrefill(row.item, row.sn, false)
                              }
                              aria-label={`Pilih S/N ${row.label}`}
                              style={{
                                flexShrink: 0,
                                width: 15,
                                height: 15,
                                marginRight: 8,
                                accentColor: "var(--color-primary)",
                                cursor: "pointer",
                              }}
                            />
                            <span
                              style={{
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                                fontSize: 13,
                                fontWeight: 500,
                                fontFamily:
                                  "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
                                ...(row.pseudo
                                  ? {
                                      fontStyle: "italic",
                                      color: "var(--text-muted)",
                                    }
                                  : { color: "var(--text-secondary)" }),
                              }}
                            >
                              {row.label}
                            </span>
                          </>
                        ) : (
                          <span
                            style={{
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                              fontSize: 13,
                              fontWeight: 500,
                              fontFamily:
                                "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
                              ...(row.pseudo
                                ? {
                                    fontStyle: "italic",
                                    color: "var(--text-muted)",
                                  }
                                : { color: "var(--text-secondary)" }),
                            }}
                          >
                            {row.label}
                          </span>
                        )}
                      </div>
                      <div
                        style={{
                          flex: 1,
                          position: "relative",
                          background: isParent
                            ? "var(--bg-subtle)"
                            : "var(--bg-surface)",
                        }}
                      >
                        {days.map((d, di) => (
                          <div
                            key={d.getTime()}
                            style={{
                              position: "absolute",
                              top: 0,
                              bottom: 0,
                              left: `${(di / RENTANG_HARI) * 100}%`,
                              borderLeft:
                                di > 0
                                  ? "1px dashed var(--border-color)"
                                  : "none",
                              pointerEvents: "none",
                            }}
                          />
                        ))}
                        {prefillBand && (
                          <div
                            style={{
                              pointerEvents: "none",
                              position: "absolute",
                              top: 0,
                              bottom: 0,
                              left: `calc(${prefillBand.left}% + 1px)`,
                              width: `calc(${prefillBand.width}% - 2px)`,
                              background: "rgba(79, 70, 229, 0.10)",
                              borderLeft: "1px dashed #4F46E5",
                              borderRight: "1px dashed #4F46E5",
                              zIndex: 11,
                              transition: "left 0.15s, width 0.15s",
                            }}
                          />
                        )}
                        {nowLeft !== null && (
                          <div
                            style={{
                              pointerEvents: "none",
                              position: "absolute",
                              top: 0,
                              bottom: 0,
                              left: `calc(${nowLeft}% - 0.5px)`,
                              width: 1,
                              background: "#EF4444",
                              zIndex: 12,
                            }}
                          >
                            <div
                              style={{
                                position: "absolute",
                                top: "50%",
                                left: -3,
                                width: 7,
                                height: 7,
                                borderRadius: "50%",
                                background: "#EF4444",
                                transform: "translateY(-50%)",
                              }}
                            />
                          </div>
                        )}
                        {info.bars.map((b) => {
                          const st = getStatusInfo(b.t);
                          const leftPct =
                            (b.left / 100) * stripW + b.lane * stripW;
                          const widthPct = Math.max(
                            (b.width / 100) * stripW,
                            0.4,
                          );
                          // Bar terpotong edge window: sisi rata + indikator « tanggal asli
                          const r = "var(--radius-sm)";
                          const radiusBar =
                            b.mulaiSebelumWindow && b.selesaiSetelahWindow
                              ? "0"
                              : b.mulaiSebelumWindow
                                ? `0 ${r} ${r} 0`
                                : b.selesaiSetelahWindow
                                  ? `${r} 0 0 ${r}`
                                  : r;
                          const fmtTglAsli = (ms) =>
                            new Date(ms).toLocaleDateString("id-ID", {
                              day: "numeric",
                              month: "short",
                            });
                          return (
                            <button
                              type="button"
                              key={b.t.id}
                              onClick={() => setModalDetail(b.t)}
                              title={tooltipBar(b)}
                              className="cursor-pointer"
                              style={{
                                position: "absolute",
                                top: 7,
                                bottom: 7,
                                borderRadius: radiusBar,
                                padding: "0 6px",
                                textAlign: "left",
                                fontSize: 11,
                                fontWeight: 600,
                                lineHeight: 1.3,
                                color: "#fff",
                                background: st.bar,
                                border: 0,
                                overflow: "hidden",
                                left: `calc(${leftPct}% + 1px)`,
                                width: `calc(${widthPct}% - 2px)`,
                              }}
                            >
                              {b.mulaiSebelumWindow && (
                                <span
                                  style={{
                                    display: "block",
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                    whiteSpace: "nowrap",
                                    fontSize: 10,
                                    fontWeight: 500,
                                    color: "rgba(255,255,255,0.8)",
                                  }}
                                  title={`Dimulai ${fmtWaktu(
                                    new Date(b.mulaiAsliMs),
                                  )}`}
                                >
                                  « mulai {fmtTglAsli(b.mulaiAsliMs)}
                                </span>
                              )}
                              <span
                                style={{
                                  display: "block",
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  whiteSpace: "nowrap",
                                }}
                              >
                                {b.t.penyewa} ({b.t.no_invoice || "-"})
                              </span>
                              {b.selesaiSetelahWindow && (
                                <span
                                  style={{
                                    position: "absolute",
                                    right: 4,
                                    bottom: 2,
                                    fontSize: 10,
                                    fontWeight: 500,
                                    color: "rgba(255,255,255,0.8)",
                                  }}
                                  title={`Selesai ${fmtWaktu(
                                    new Date(b.selesaiAsliMs),
                                  )}`}
                                >
                                  »
                                </span>
                              )}
                            </button>
                          );
                        })}
                        {info.overflow.length > 0 && (
                          <button
                            type="button"
                            onClick={() =>
                              setModalOverflow({
                                label: row.label,
                                bars: info.overflow,
                              })
                            }
                            style={{
                              position: "absolute",
                              right: 6,
                              top: 8,
                              zIndex: 13,
                              fontSize: 10,
                              fontWeight: 700,
                              color: "var(--color-primary-strong)",
                              background: "var(--bg-surface)",
                              border: "1px solid var(--border-color)",
                              borderRadius: "var(--radius-full)",
                              padding: "1px 7px",
                              cursor: "pointer",
                              boxShadow: "0 1px 2px rgba(0,0,0,0.12)",
                            }}
                          >
                            +{info.overflow.length}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
          <div
            className="flex items-center flex-wrap p-4"
            style={{
              borderTop: "1px solid var(--border-color)",
              columnGap: "var(--space-4)",
              rowGap: "var(--space-2)",
            }}
          >
            {legend.map((l) => (
              <span
                key={l.label}
                className="flex items-center gap-2 text-xs text-text-secondary"
              >
                <span
                  style={{
                    display: "inline-block",
                    width: 12,
                    height: 12,
                    borderRadius: "var(--radius-sm)",
                    background: l.cls,
                  }}
                />{" "}
                {l.label}
              </span>
            ))}
          </div>
        </div>
      )}

      {typeof document !== "undefined" &&
        modalDetail &&
        createPortal(
          <div
            onClick={() => setModalDetail(null)}
            className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm"
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="relative flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
            >
              <div className="bg-surface-card rounded-lg-header">
                <h3 className="bg-surface-card rounded-lg-title">
                  Detail Transaksi
                </h3>
                <button
                  type="button"
                  onClick={() => setModalDetail(null)}
                  aria-label="Tutup"
                  className="bg-surface-card rounded-lg-close"
                >
                  &times;
                </button>
              </div>
              <div className="flex-1 overflow-y-auto px-6 pb-6">
                <div className="flex items-center justify-between gap-2 mb-4">
                  <div>
                    <div className="font-bold text-sm">
                      {modalDetail.penyewa}
                    </div>
                    <div className="text-xs text-text-muted">
                      No. Invoice: {modalDetail.no_invoice || "-"}
                    </div>
                  </div>
                  <span className={getStatusInfo(modalDetail).badge}>
                    {getStatusInfo(modalDetail).label}
                  </span>
                </div>
                <div className="flex-col gap-3 text-13">
                  <div>
                    HP:{" "}
                    <span className="text-text-secondary">
                      {modalDetail.hp_penyewa || "-"}
                    </span>
                  </div>
                  <div>
                    Alamat:{" "}
                    <span className="text-text-secondary">
                      {modalDetail.alamat_penyewa || "-"}
                    </span>
                  </div>
                  <div>
                    <span style={{ color: "var(--color-success-text)" }}>
                      Ambil:
                    </span>{" "}
                    {fmtWaktu(modalDetail.waktu_ambil_rencana)}
                    <br />
                    <span className="text-danger">Kembali:</span>{" "}
                    {fmtWaktu(modalDetail.waktu_kembali_rencana)}
                  </div>
                  <div>
                    <div
                      className="text-xs font-bold text-text-secondary"
                      style={{ marginBottom: 4 }}
                    >
                      Item Sewa
                    </div>
                    {(modalDetail.items || []).length === 0 ? (
                      <div className="text-xs text-text-muted">-</div>
                    ) : (
                      <div
                        className="flex-col gap-3"
                        style={{ rowGap: "var(--space-1)" }}
                      >
                        {(modalDetail.items || []).map((i, idx) => {
                          const sn = snsItem(i);
                          return (
                            <div key={idx} className="text-xs">
                              <span className="font-semibold">
                                {i.qty}x {i.ref?.nama || "?"}
                              </span>
                              {sn && (
                                <span className="text-text-muted"> — {sn}</span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                  <div
                    className="flex items-center justify-between"
                    style={{
                      borderTop: "1px solid var(--border-color)",
                      paddingTop: "var(--space-3)",
                    }}
                  >
                    <span className="font-bold">Total Biaya</span>
                    <span
                      className="font-bold"
                      style={{ color: "var(--color-primary-strong)" }}
                    >
                      {formatRupiah(
                        modalDetail.total_akhir || modalDetail.biaya || 0,
                      )}
                    </span>
                  </div>
                </div>
                <div
                  className="flex items-center mt-4"
                  style={{ justifyContent: "flex-end" }}
                >
                  <button
                    type="button"
                    onClick={() => setModalDetail(null)}
                    className="inline-flex items-center border border-border"
                  >
                    Tutup
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )}

      {typeof document !== "undefined" &&
        modalOverflow &&
        createPortal(
          <div
            onClick={() => setModalOverflow(null)}
            className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm"
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="relative flex max-h-[90vh] w-full max-w-sm flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
            >
              <div className="bg-surface-card rounded-lg-header">
                <h3 className="bg-surface-card rounded-lg-title">
                  Transaksi Lainnya
                </h3>
                <button
                  type="button"
                  onClick={() => setModalOverflow(null)}
                  aria-label="Tutup"
                  className="bg-surface-card rounded-lg-close"
                >
                  &times;
                </button>
              </div>
              <div className="flex-1 overflow-y-auto px-6 pb-6">
                <p className="text-xs text-text-muted mb-4">
                  {modalOverflow.label} — {modalOverflow.bars.length} transaksi
                  tidak muat di baris ini.
                </p>
                <div className="flex-col gap-3">
                  {modalOverflow.bars.map((b) => (
                    <button
                      type="button"
                      key={b.t.id}
                      onClick={() => {
                        setModalOverflow(null);
                        setModalDetail(b.t);
                      }}
                      className="inline-flex items-center border border-border w-full text-13"
                      style={{
                        justifyContent: "space-between",
                        textAlign: "left",
                      }}
                    >
                      <span
                        style={{
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {b.t.penyewa} ({b.t.no_invoice || "-"})
                      </span>
                      <span
                        className="text-xs text-text-muted"
                        style={{ flexShrink: 0, marginLeft: 8 }}
                      >
                        {fmtWaktu(b.t.waktu_ambil_rencana)}
                      </span>
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
