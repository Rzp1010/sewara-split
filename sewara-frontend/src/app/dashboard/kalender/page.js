"use client";

import { useState, useEffect, useMemo, useCallback, memo } from "react";
import { getSetting, setSetting, getTransactionsRangeRingkas } from "@/lib/db";
import { createPortal } from "react-dom";
import { formatRupiah, hitungPembayaran } from "@/lib/utils";

const bulanNama = [
  "Januari",
  "Februari",
  "Maret",
  "April",
  "Mei",
  "Juni",
  "Juli",
  "Agustus",
  "September",
  "Oktober",
  "November",
  "Desember",
];
const hariNama = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];

function getStatusInfo(t, batasJam) {
  if (t.status === "Booking")
    return {
      label: "Booking",
      bar: "#f59e0b",
      badge: "rounded-md px-2 py-1 text-xs bg-yellow-100 px-2 py-1 text-xs",
    };
  if (t.status === "Selesai")
    return {
      label: "Selesai",
      bar: "#579171",
      badge: "rounded-md px-2 py-1 text-xs bg-gray-100 px-2 py-1 text-xs",
    };
  if (t.status === "Belum Selesai")
    return {
      label: "Belum Selesai",
      bar: "#7181E0",
      badge: "rounded-md px-2 py-1 text-xs bg-indigo-100 px-2 py-1 text-xs",
    };
  if (t.status === "Disewa") {
    const k = t.waktu_kembali_rencana
      ? new Date(t.waktu_kembali_rencana)
      : null;
    const batas =
      batasJam ?? parseInt(getSetting("notif_jam", "2") || "2", 10) * 3600000;
    if (k && k < new Date())
      return {
        label: "Telat",
        bar: "#F04438",
        badge: "rounded-md px-2 py-1 text-xs bg-red-100 px-2 py-1 text-xs",
      };
    if (k && k - new Date() <= batas)
      return {
        label: "Segera Kembali",
        bar: "#eab308",
        badge: "rounded-md px-2 py-1 text-xs bg-yellow-100 px-2 py-1 text-xs",
      };
    return {
      label: "Disewa",
      bar: "#3b82f6",
      badge: "rounded-md px-2 py-1 text-xs bg-blue-100 px-2 py-1 text-xs",
    };
  }
  return {
    label: t.status || "-",
    bar: "#8b98a5",
    badge: "rounded-md px-2 py-1 text-xs bg-gray-100 px-2 py-1 text-xs",
  };
}

function fmtWaktu(iso) {
  if (!iso) return "-";
  return new Date(iso).toLocaleDateString("id-ID", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const DetailCard = memo(function DetailCard({ t }) {
  const info = getStatusInfo(t);
  const pay = hitungPembayaran(t);
  const payCls =
    pay.status === "Lunas"
      ? "rounded-md bg-green-100 px-2 py-1 text-xs"
      : pay.status === "DP"
        ? "rounded-md bg-blue-100 px-2 py-1 text-xs"
        : "rounded-md bg-red-100 px-2 py-1 text-xs";
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 text-[13px] shadow-lg">
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="font-bold">{t.penyewa}</span>
        <span className={`rounded-md px-2 py-1 text-xs ${info.badge}`}>
          {info.label}
        </span>
      </div>
      <div className="text-xs text-gray-500">Hp : {t.hp_penyewa || "-"}</div>
      <div className="text-xs text-gray-600 mt-2">
        <span className="text-[#579171]">Ambil:</span>{" "}
        {fmtWaktu(t.waktu_ambil_rencana)}
        <br />
        <span className="text-red-600">Kembali:</span>{" "}
        {fmtWaktu(t.waktu_kembali_rencana)}
      </div>
      <div className="flex items-center flex-wrap gap-1 mt-2">
        {(t.items || []).slice(0, 3).map((i, idx) => (
          <span
            key={idx}
            className="rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-xs text-slate-600"
          >
            {i.qty}x {i.ref.nama}
          </span>
        ))}
        {(t.items || []).length > 3 && (
          <span className="text-xs text-gray-500">+{t.items.length - 3}</span>
        )}
      </div>
      <div className="flex items-center justify-between gap-2 mt-2">
        <span className="font-bold">
          {formatRupiah(t.total_akhir || t.biaya)}
        </span>
        <span className={`rounded-md px-2 py-1 text-xs ${payCls}`}>
          {pay.status === "Belum Bayar" ? "Belum Bayar" : pay.status}
        </span>
      </div>
    </div>
  );
});

export default function KalenderPage() {
  const [trx, setTrx] = useState([]);
  const [today] = useState(new Date());
  const [modeView, setModeView] = useState("bulan");
  const [bulan, setBulan] = useState(today.getMonth());
  const [tahun, setTahun] = useState(today.getFullYear());
  const [tglFokus, setTglFokus] = useState(new Date(today));
  const [selectedDate, setSelectedDate] = useState(null);
  const [isiDetail, setIsiDetail] = useState([]);
  const [showSelesai, setShowSelesai] = useState(true);
  const [modalDetail, setModalDetail] = useState(null);

  useEffect(() => {
    (async () => {
      setShowSelesai(getSetting("kalender_selesai", "tampil") !== "sembunyi");
    })();
  }, []);

  const batasJam = parseInt(getSetting("notif_jam", "2") || "2", 10) * 3600000;

  const mulaiISO = useMemo(() => {
    if (modeView === "bulan") {
      const mulai = new Date(tahun, bulan, 1);
      mulai.setDate(mulai.getDate() - 10);
      return mulai.toISOString();
    }
    const tgl = new Date(
      tglFokus.getFullYear(),
      tglFokus.getMonth(),
      tglFokus.getDate(),
    );
    if (modeView === "minggu") {
      tgl.setDate(tgl.getDate() - tgl.getDay() - 4);
      return tgl.toISOString();
    }
    tgl.setDate(tgl.getDate() - 2);
    return tgl.toISOString();
  }, [modeView, bulan, tahun, tglFokus]);

  const akhirISO = useMemo(() => {
    if (modeView === "bulan") {
      const akhir = new Date(tahun, bulan + 1, 0);
      akhir.setDate(akhir.getDate() + 10);
      return akhir.toISOString();
    }
    const tgl = new Date(
      tglFokus.getFullYear(),
      tglFokus.getMonth(),
      tglFokus.getDate(),
    );
    if (modeView === "minggu") {
      tgl.setDate(tgl.getDate() + (6 - tgl.getDay()) + 4);
      return tgl.toISOString();
    }
    tgl.setDate(tgl.getDate() + 2);
    return tgl.toISOString();
  }, [modeView, bulan, tahun, tglFokus]);

  const muatData = useCallback(async () => {
    const t = await getTransactionsRangeRingkas(mulaiISO, akhirISO);
    setTrx(t.filter((x) => x.status !== "Dibatalkan"));
  }, [mulaiISO, akhirISO]);

  useEffect(() => {
    (async () => {
      await muatData();
    })();
  }, [muatData]);

  useEffect(() => {
    const handler = () => {
      (async () => {
        await muatData();
      })();
    };
    window.addEventListener("dataChanged", handler);
    return () => window.removeEventListener("dataChanged", handler);
  }, [muatData]);

  const visible = useMemo(
    () => trx.filter((t) => showSelesai || t.status !== "Selesai"),
    [trx, showSelesai],
  );

  const legend = [
    { label: "Booking", cls: "#d97706" },
    { label: "Disewa", cls: "#3b82f6" },
    { label: "Segera Kembali", cls: "#f97316" },
    { label: "Telat", cls: "#dc2626" },
    { label: "Selesai", cls: "#8b98a5" },
  ];

  function fmt(y, m, d) {
    return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }

  function fmtDate(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function parseDate(str) {
    return str ? str.slice(0, 10) : "";
  }

  function isSameDate(a, b) {
    return fmtDate(a) === fmtDate(b);
  }

  const eventsByTgl = useMemo(() => {
    const map = new Map();
    visible.forEach((t) => {
      const s = parseDate(t.waktu_ambil_rencana);
      const e = parseDate(t.waktu_kembali_rencana);
      if (!s || !e) return;
      const cur = new Date(s + "T00:00:00Z");
      const last = new Date(e + "T00:00:00Z");
      while (cur <= last) {
        const key = cur.toISOString().slice(0, 10);
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(t);
        cur.setUTCDate(cur.getUTCDate() + 1);
      }
    });
    return map;
  }, [visible]);

  const eventsUntukTanggal = useCallback(
    (tgl) => eventsByTgl.get(tgl) || [],
    [eventsByTgl],
  );

  const switchMode = (v) => {
    setModeView(v);
    if (v !== "bulan" && !isSameDate(tglFokus, today))
      setTglFokus(new Date(today));
  };

  const pindahKeHari = (d) => {
    setTglFokus(d);
    setModeView("hari");
  };

  const keHariIni = () => {
    if (modeView === "bulan") {
      setBulan(today.getMonth());
      setTahun(today.getFullYear());
      setSelectedDate(today.getDate());
      setIsiDetail(
        eventsUntukTanggal(
          fmt(today.getFullYear(), today.getMonth(), today.getDate()),
        ),
      );
    } else {
      setTglFokus(new Date(today));
    }
  };

  const gantiSelesai = (v) => {
    setShowSelesai(v);
    setSetting("kalender_selesai", v ? "tampil" : "sembunyi");
  };

  const hariDalamBulan = new Date(tahun, bulan + 1, 0).getDate();
  const hariPertama = new Date(tahun, bulan, 1).getDay();

  function buildWeeks() {
    const weeks = [];
    let row = [];
    for (let i = 0; i < hariPertama; i++) row.push(null);
    for (let d = 1; d <= hariDalamBulan; d++) {
      row.push(d);
      if (row.length === 7) {
        weeks.push(row);
        row = [];
      }
    }
    if (row.length > 0) {
      while (row.length < 7) row.push(null);
      weeks.push(row);
    }
    return weeks;
  }

  const prev = () => {
    if (modeView === "bulan") {
      if (bulan === 0) {
        setBulan(11);
        setTahun(tahun - 1);
      } else setBulan(bulan - 1);
      setSelectedDate(null);
      setIsiDetail([]);
    } else {
      const d = new Date(tglFokus);
      d.setDate(d.getDate() - (modeView === "minggu" ? 7 : 1));
      setTglFokus(d);
    }
  };

  const next = () => {
    if (modeView === "bulan") {
      if (bulan === 11) {
        setBulan(0);
        setTahun(tahun + 1);
      } else setBulan(bulan + 1);
      setSelectedDate(null);
      setIsiDetail([]);
    } else {
      const d = new Date(tglFokus);
      d.setDate(d.getDate() + (modeView === "minggu" ? 7 : 1));
      setTglFokus(d);
    }
  };

  const labelNavigasi = (() => {
    if (modeView === "bulan") return `${bulanNama[bulan]} ${tahun}`;
    if (modeView === "minggu") {
      const start = new Date(tglFokus.getTime() - tglFokus.getDay() * 86400000);
      const end = new Date(
        tglFokus.getTime() + (6 - tglFokus.getDay()) * 86400000,
      );
      if (start.getFullYear() === end.getFullYear()) {
        return start.getMonth() === end.getMonth()
          ? `${bulanNama[start.getMonth()]} ${start.getFullYear()}`
          : `${bulanNama[start.getMonth()]} - ${bulanNama[end.getMonth()]} ${end.getFullYear()}`;
      }
      return `${bulanNama[start.getMonth()]} ${start.getFullYear()} - ${bulanNama[end.getMonth()]} ${end.getFullYear()}`;
    }
    return `${tglFokus.getDate()} ${bulanNama[tglFokus.getMonth()]} ${tglFokus.getFullYear()}`;
  })();

  function clickDay(d) {
    if (selectedDate === d) {
      setSelectedDate(null);
      setIsiDetail([]);
      return;
    }
    setSelectedDate(d);
    setIsiDetail(eventsUntukTanggal(fmt(tahun, bulan, d)));
  }

  const weeks = buildWeeks();

  const mingguStart = new Date(
    tglFokus.getTime() - tglFokus.getDay() * 86400000,
  );
  const mingguKey = fmtDate(mingguStart);
  const mingguDays = useMemo(() => {
    const [y, m, d] = mingguKey.split("-").map(Number);
    return Array.from({ length: 7 }, (_, i) => new Date(y, m - 1, d + i));
  }, [mingguKey]);

  const {
    mingguSegments,
    jamMin,
    jamMax,
    jamList,
    tinggiMinggu,
    pxPerJam,
    nowJamSekarang,
  } = useMemo(() => {
    const mingguEvents = visible.filter((t) => {
      if (!t.waktu_ambil_rencana || !t.waktu_kembali_rencana) return false;
      const sDate = new Date(t.waktu_ambil_rencana);
      const eDate = new Date(t.waktu_kembali_rencana);
      const s = fmtDate(sDate);
      const e = fmtDate(eDate);
      return s <= fmtDate(mingguDays[6]) && e >= fmtDate(mingguDays[0]);
    });

    let jamMin = 6;
    let jamMax = 22;
    mingguEvents.forEach((t) => {
      if (!t.waktu_ambil_rencana || !t.waktu_kembali_rencana) return;
      const s = new Date(t.waktu_ambil_rencana);
      const e = new Date(t.waktu_kembali_rencana);
      const sJam = s.getHours() + s.getMinutes() / 60;
      const eJam = e.getHours() + e.getMinutes() / 60;
      if (sJam < jamMin) jamMin = sJam;
      if (eJam > jamMax) jamMax = eJam;
    });
    // Rentang padat: persis range event (tanpa padding) — area kosong minimal
    jamMin = Math.max(0, Math.floor(jamMin));
    jamMax = Math.min(24, Math.ceil(jamMax));
    const pxPerJam = 36;
    const tinggiMinggu = (jamMax - jamMin) * pxPerJam;
    const jamList = Array.from(
      { length: jamMax - jamMin },
      (_, i) => jamMin + i,
    );

    const mingguSegments = mingguDays.map((d) => {
      const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate());
      const dayEnd = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
      const segs = [];
      mingguEvents.forEach((t) => {
        if (!t.waktu_ambil_rencana || !t.waktu_kembali_rencana) return;
        const s = new Date(t.waktu_ambil_rencana);
        const e = new Date(t.waktu_kembali_rencana);
        if (e <= dayStart || s >= dayEnd) return;
        const segStart = s < dayStart ? dayStart : s;
        const segEnd = e > dayEnd ? dayEnd : e;
        const startJam = segStart.getHours() + segStart.getMinutes() / 60;
        const endJam =
          segEnd.getTime() === dayEnd.getTime()
            ? 24
            : segEnd.getHours() + segEnd.getMinutes() / 60;
        const top = Math.max(0, (startJam - jamMin) * pxPerJam);
        const height = Math.max(
          14,
          (Math.min(endJam, jamMax) - Math.max(startJam, jamMin)) * pxPerJam,
        );
        segs.push({ t, top, height, startJam });
      });
      segs.sort((a, b) => a.startJam - b.startJam);
      const lanes = [];
      segs.forEach((seg) => {
        let placed = -1;
        for (let li = 0; li < lanes.length; li++) {
          const last = lanes[li][lanes[li].length - 1];
          if (seg.top >= last.top + last.height) {
            placed = li;
            break;
          }
        }
        if (placed === -1) {
          lanes.push([seg]);
          placed = lanes.length - 1;
        } else lanes[placed].push(seg);
        seg.lane = placed;
      });
      segs.forEach((seg) => {
        seg.laneCount = lanes.length;
      });
      return segs;
    });

    const nowJamSekarang = new Date().getHours() + new Date().getMinutes() / 60;

    return {
      mingguSegments,
      jamMin,
      jamMax,
      jamList,
      tinggiMinggu,
      pxPerJam,
      nowJamSekarang,
    };
  }, [visible, mingguDays]);

  return (
    <div className="w-full max-w-7xl mx-auto">
      <h2 className="text-xl font-bold mb-6">Kalender Jadwal</h2>

      <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
        <div className="flex gap-2 rounded-xl bg-gray-100 p-1">
          {[
            ["hari", "Hari"],
            ["minggu", "Minggu"],
            ["bulan", "Bulan"],
          ].map(([v, lbl]) => (
            <button
              type="button"
              key={v}
              onClick={() => switchMode(v)}
              className={`rounded-full border-0 px-4 py-2 text-sm font-semibold transition-colors ${modeView === v ? "bg-[#7181E0] text-white shadow-sm" : "bg-gray-200 text-slate-700 hover:bg-gray-300"}`}
            >
              {lbl}
            </button>
          ))}
        </div>
        <div className="flex items-center flex-wrap gap-3">
          <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-gray-600">
            <input
              type="checkbox"
              checked={showSelesai}
              onChange={(e) => gantiSelesai(e.target.checked)}
              className="h-4 w-4 accent-[#7181E0]"
            />
            Tampilkan Selesai
          </label>
          <button
            type="button"
            onClick={keHariIni}
            className="rounded-lg border-0 bg-[#7181E0] px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#5d6fcc] focus:outline-none focus:ring-2 focus:ring-[#7181E0]/40"
          >
            Hari Ini
          </button>
        </div>
      </div>

      <div
        className={
          modeView === "bulan" && selectedDate
            ? "grid gap-5 grid-cols-2"
            : "grid gap-5"
        }
      >
        <div className="rounded-xl border-2 border-solid border-slate-200 border-t-4 border-t-[#7181E0] bg-white p-4 shadow-lg transition-all duration-300">
          <div className="flex items-center justify-between mb-4">
            <button
              type="button"
              onClick={prev}
              className="rounded-lg border-0 bg-gray-200 px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-gray-300 focus:outline-none"
            >
              &larr; Sebelum
            </button>
            <div className="text-center">
              <h3 className="text-lg font-bold">{labelNavigasi}</h3>
            </div>
            <button
              type="button"
              onClick={next}
              className="rounded-lg border-0 bg-gray-200 px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-gray-300 focus:outline-none"
            >
              Berikut &rarr;
            </button>
          </div>

          {modeView === "bulan" && (
            <>
              <div className="grid grid-cols-7 gap-px text-center text-xs font-bold text-slate-500">
                {hariNama.map((h) => (
                  <div key={h} className="bg-[#7181E0]/10 px-1.5 py-1.5">
                    {h}
                  </div>
                ))}
              </div>

              <div key={`${bulan}-${tahun}`} className="page-enter">
                {weeks.map((week, wi) => {
                  const weekDates = week.map((d) =>
                    d ? fmt(tahun, bulan, d) : null,
                  );
                  const tglMin = weekDates.find((x) => x);
                  const tglMax = weekDates
                    .slice()
                    .reverse()
                    .find((x) => x);
                  const events = visible.filter((t) => {
                    const s = parseDate(t.waktu_ambil_rencana);
                    const e = parseDate(t.waktu_kembali_rencana);
                    if (!s || !e) return false;
                    if (tglMin && tglMax) return s <= tglMax && e >= tglMin;
                    return false;
                  });

                  function getCol(tgl) {
                    return weekDates.indexOf(tgl);
                  }

                  const bars = events.map((t) => {
                    const s = parseDate(t.waktu_ambil_rencana);
                    const e = parseDate(t.waktu_kembali_rencana);
                    const startCol = Math.max(0, getCol(s));
                    let endCol = getCol(e);
                    if (endCol === -1) endCol = 6;
                    const visibleStart = Math.max(0, startCol);
                    const visibleEnd = Math.min(6, endCol === -1 ? 6 : endCol);
                    const leftDate = weekDates[visibleStart];
                    const rightDate = weekDates[visibleEnd];
                    const isStart = !leftDate || s >= leftDate;
                    const isEnd = !rightDate || e <= rightDate;
                    return {
                      ...t,
                      startCol: visibleStart,
                      endCol: visibleEnd,
                      isStart,
                      isEnd,
                    };
                  });

                  bars.sort((a, b) => {
                    const sA = parseDate(a.waktu_ambil_rencana);
                    const sB = parseDate(b.waktu_ambil_rencana);
                    return sA.localeCompare(sB);
                  });

                  const rows = [];
                  bars.forEach((bar) => {
                    let placed = false;
                    for (let ri = 0; ri < rows.length; ri++) {
                      const row = rows[ri];
                      const last = row[row.length - 1];
                      if (bar.startCol > last.endCol) {
                        row.push(bar);
                        placed = true;
                        break;
                      }
                    }
                    if (!placed) rows.push([bar]);
                  });

                  return (
                    <div key={wi} className="grid grid-cols-7 gap-px">
                      {week.map((d, ci) => {
                        const tgl = weekDates[ci];
                        const isToday =
                          d &&
                          d === today.getDate() &&
                          bulan === today.getMonth() &&
                          tahun === today.getFullYear();
                        const isSelected = d && d === selectedDate;
                        const eventsCount = tgl
                          ? eventsUntukTanggal(tgl).length
                          : 0;
                        const barInThisCell = [];
                        rows.forEach((row, ri) => {
                          const b = row.find(
                            (x) => ci >= x.startCol && ci <= x.endCol,
                          );
                          if (b) barInThisCell.push({ bar: b, row: ri });
                        });
                        const isWeekend = ci === 0 || ci === 6;

                        return (
                          <div
                            key={ci}
                            className={`relative min-h-20 ${isWeekend ? "bg-slate-50" : "bg-white"}`}
                          >
                            <button
                              type="button"
                              onClick={() => d && clickDay(d)}
                              className={`absolute inset-0 z-10 flex cursor-pointer items-center justify-center border-0 bg-transparent p-1 ${isSelected ? "ring-2 ring-[#7181E0]" : ""}`}
                            >
                              {d && (
                                <span
                                  className={
                                    isToday
                                      ? "flex h-5 w-5 items-center justify-center rounded-full bg-[#7181E0] text-xs font-bold text-white"
                                      : "text-xs text-gray-600"
                                  }
                                >
                                  {d}
                                </span>
                              )}
                              {d && eventsCount > 0 && (
                                <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#7181E0]/10 px-1 text-[9px] font-bold text-[#7181E0]">
                                  {eventsCount}
                                </span>
                              )}
                            </button>
                            <div className="relative z-0 pointer-events-none pt-7">
                              {barInThisCell.slice(0, 3).map(({ bar, row }) => {
                                const isStart = ci === bar.startCol;
                                const isEnd = ci === bar.endCol;
                                const topOffset = 4 + row * 18;
                                const color = getStatusInfo(bar).bar;
                                return (
                                  <div
                                    key={bar.id}
                                    className="font-bold"
                                    style={{
                                      position: "absolute",
                                      left: 0,
                                      right: 0,
                                      margin: "0 1px",
                                      background: color,
                                      color: "#fff",
                                      padding: "0 4px",
                                      fontSize: 8,
                                      lineHeight: "16px",
                                      top: topOffset,
                                      height: 16,
                                      borderTopLeftRadius: isStart ? "6px" : 0,
                                      borderBottomLeftRadius: isStart
                                        ? "6px"
                                        : 0,
                                      borderTopRightRadius: isEnd ? "6px" : 0,
                                      borderBottomRightRadius: isEnd
                                        ? "6px"
                                        : 0,
                                    }}
                                  >
                                    {(bar.isStart || isStart) &&
                                      bar.penyewa.slice(0, 8)}
                                  </div>
                                );
                              })}
                              {barInThisCell.length > 3 && (
                                <div
                                  style={{
                                    position: "absolute",
                                    left: 0,
                                    right: 0,
                                    top: 4 + 3 * 18,
                                    padding: "0 4px",
                                    fontSize: 8,
                                    fontWeight: 700,
                                    color: "#7181E0",
                                  }}
                                >
                                  +{barInThisCell.length - 3}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {modeView === "minggu" && (
            <div className="overflow-x-auto">
              <div className="min-w-[700px]">
                <div className="grid grid-cols-[3.5rem_repeat(7,minmax(0,1fr))] gap-px">
                  <div />
                  {mingguDays.map((d) => {
                    const isToday = isSameDate(d, today);
                    return (
                      <button
                        type="button"
                        key={d.getTime()}
                        onClick={() => pindahKeHari(d)}
                        className={`border-0 border-b border-slate-200 bg-transparent px-2 py-1.5 text-center text-xs font-bold ${isToday ? "text-[#7181E0]" : "text-slate-600"}`}
                      >
                        <span className="block text-[10px] text-slate-500">
                          {hariNama[d.getDay()]}
                        </span>
                        <span
                          className={
                            isToday
                              ? "flex h-5 w-5 items-center justify-center rounded-full bg-[#7181E0] font-bold text-white"
                              : "flex items-center justify-center font-bold"
                          }
                        >
                          {d.getDate()}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <div className="grid grid-cols-[3.5rem_repeat(7,minmax(0,1fr))] gap-px">
                  <div
                    className="relative border-r border-slate-200"
                    style={{ height: tinggiMinggu }}
                  >
                    {jamList.map((h) => (
                      <div
                        key={h}
                        style={{
                          position: "absolute",
                          right: 4,
                          transform: "translateY(-50%)",
                          fontSize: 9,
                          color: "#64748b",
                          top: (h - jamMin) * pxPerJam,
                        }}
                      >
                        {String(h).padStart(2, "0")}:00
                      </div>
                    ))}
                  </div>
                  {mingguSegments.map((segs, di) => {
                    const isToday = isSameDate(mingguDays[di], today);
                    return (
                      <div
                        key={di}
                        className="relative border-r border-slate-200"
                        style={{ height: tinggiMinggu }}
                      >
                        {jamList.map((h) => (
                          <div
                            key={h}
                            style={{
                              position: "absolute",
                              left: 0,
                              right: 0,
                              borderTop:
                                "1px solid " +
                                (h === 12 ? "#cbd5e1" : "#e2e8f0"),
                              top: (h - jamMin) * pxPerJam,
                            }}
                          />
                        ))}
                        {isToday &&
                          nowJamSekarang >= jamMin &&
                          nowJamSekarang <= jamMax && (
                            <div
                              style={{
                                pointerEvents: "none",
                                position: "absolute",
                                left: 0,
                                right: 0,
                                zIndex: 10,
                                borderTop: "2px solid #F04438",
                                top: (nowJamSekarang - jamMin) * pxPerJam,
                              }}
                            >
                              <span
                                style={{
                                  position: "absolute",
                                  left: -4,
                                  top: -4,
                                  width: 8,
                                  height: 8,
                                  borderRadius: "50%",
                                  background: "#F04438",
                                }}
                              />
                            </div>
                          )}
                        {(() => {
                          // Ambil segmen TERATAS tiap lane — maks 3 strip, dijamin tidak tindih
                          const perLane = [];
                          segs.forEach((seg) => {
                            if (perLane[seg.lane] === undefined)
                              perLane[seg.lane] = seg;
                          });
                          const vis = perLane.filter(Boolean).slice(0, 3);
                          return (
                            <>
                              {vis.map((seg, si) => {
                                const info = getStatusInfo(seg.t, batasJam);
                                const laneW = 100 / (seg.laneCount || 1);
                                const left = seg.lane * laneW;
                                return (
                                  <button
                                    type="button"
                                    key={si}
                                    onClick={() => setModalDetail(seg.t)}
                                    className="font-bold"
                                    style={{
                                      position: "absolute",
                                      overflow: "hidden",
                                      borderRadius: "6px",
                                      padding: "0 4px",
                                      textAlign: "left",
                                      fontSize: 9,
                                      lineHeight: 1.25,
                                      color: "#fff",
                                      background: info.bar,
                                      top: seg.top,
                                      height: seg.height,
                                      left: `calc(${left}% + 1px)`,
                                      width: `calc(${laneW}% - 2px)`,
                                    }}
                                  >
                                    <span
                                      style={{
                                        display: "block",
                                        overflow: "hidden",
                                        textOverflow: "ellipsis",
                                        whiteSpace: "nowrap",
                                      }}
                                    >
                                      {seg.t.penyewa}
                                    </span>
                                  </button>
                                );
                              })}
                              {segs.length - vis.length > 0 && (
                                <div
                                  style={{
                                    position: "absolute",
                                    bottom: 2,
                                    right: 4,
                                    fontSize: 8,
                                    fontWeight: 700,
                                    color: "#7181E0",
                                    background: "#fff",
                                    borderRadius: "9999px",
                                    padding: "0 5px",
                                  }}
                                >
                                  +{segs.length - vis.length}
                                </div>
                              )}
                            </>
                          );
                        })()}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {modeView === "hari" && (
            <div className="flex-col gap-3">
              <p className="text-13 font-bold text-gray-600">
                {fmtDate(tglFokus)}
              </p>
              {eventsUntukTanggal(fmtDate(tglFokus)).length === 0 ? (
                <p className="p-8 text-center text-13 italic text-gray-500">
                  Tidak ada jadwal di hari ini.
                </p>
              ) : (
                eventsUntukTanggal(fmtDate(tglFokus)).map((t) => (
                  <DetailCard key={t.id} t={t} />
                ))
              )}
            </div>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-slate-200 pt-3">
            {legend.map((l) => (
              <span
                key={l.label}
                className="flex items-center gap-2 text-xs text-gray-600"
              >
                <span
                  className="inline-block h-3 w-3 rounded-md"
                  style={{ background: l.cls }}
                />{" "}
                {l.label}
              </span>
            ))}
          </div>
        </div>

        {modeView === "bulan" && selectedDate && (
          <div className="page-enter">
            <div className="rounded-xl border-2 border-solid border-slate-200 border-t-4 border-t-[#7181E0] bg-white p-4 shadow-lg">
              <h3 className="mb-3 text-base font-bold text-[#7181E0]">
                📅 {fmt(tahun, bulan, selectedDate)}
              </h3>
              {isiDetail.length === 0 ? (
                <p className="p-6 text-center text-13 italic text-gray-500">
                  Tidak ada jadwal
                </p>
              ) : (
                <div className="flex-col gap-3">
                  {isiDetail.map((t) => (
                    <DetailCard key={t.id} t={t} />
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {typeof document !== "undefined" &&
        modalDetail &&
        createPortal(
          <div
            onClick={() => setModalDetail(null)}
            className="fixed inset-0 z-[9999] flex items-center justify-center overflow-y-auto bg-black/55 p-4 backdrop-blur-sm"
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-4xl rounded-xl border border-slate-200 bg-white shadow-lg animate-scaleIn"
            >
              <div className="flex items-center justify-between border-b border-slate-200 p-4">
                <h3 className="text-lg font-bold">Detail Jadwal</h3>
              </div>
              <div className="overflow-y-auto p-6">
                <DetailCard t={modalDetail} />
                <div className="mt-4 flex items-center justify-end">
                  <button
                    type="button"
                    onClick={() => setModalDetail(null)}
                    className="rounded-lg border-0 bg-gray-200 px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-gray-300"
                  >
                    Tutup
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
