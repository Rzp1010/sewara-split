"use client";

import { useState, useRef, useEffect } from "react";

const HARI = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];
const BULAN = [
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

function p2(n) {
  return String(n).padStart(2, "0");
}
function awalHari(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function samaTanggal(a, b) {
  return Boolean(
    a &&
    b &&
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate(),
  );
}

// Lebar & tinggi popover (px). Dipakai untuk clamp posisi.
// ponytail: hardcoded agar clamp sinkron dengan Tailwind class w-[560px]/max-h;
// kalau mau responsif penuh, upgrade path = ukur offsetWidth panel setelah render.
const PANEL_W = 560;
const PANEL_H = 440;
const PANEL_W_DATE_ONLY = 320;
const PANEL_H_DATE_ONLY = 360;

export default function DateTimePicker({
  value,
  onChange,
  placeholder,
  minDate,
  filterTime,
  showTime = true,
  className = "",
}) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState(() => {
    const d = value || new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [draft, setDraft] = useState(null);
  // Posisi panel fixed (viewport coords) + arah flip
  const [anchor, setAnchor] = useState({ top: 0, left: 0, arah: "bawah" });
  const ref = useRef(null);
  const panelRef = useRef(null);
  const waktuAktifRef = useRef(null);
  const waktuBoxRef = useRef(null);

  // Click-outside: cek trigger DAN panel (panel sekarang di luar wrapper DOM-nya)
  useEffect(() => {
    if (!open) return;
    function onDown(e) {
      if (ref.current && ref.current.contains(e.target)) return;
      if (panelRef.current && panelRef.current.contains(e.target)) return;
      setOpen(false);
    }
    function onKey(e) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Auto-scroll ke slot terpilih saat panel dibuka.
  // ponytail: rect-based (bukan offsetTop) — tidak bergantung pada position ancestor
  useEffect(() => {
    if (!open || !draft) return;
    const el = waktuAktifRef.current;
    const box = waktuBoxRef.current;
    if (el && box) {
      box.scrollTop = el.offsetTop - box.clientHeight / 2 + el.offsetHeight / 2;
    }
  }, [open]);

  function buka() {
    if (ref.current) {
      const rect = ref.current.getBoundingClientRect();
      const pw = showTime ? PANEL_W : PANEL_W_DATE_ONLY;
      const ph = showTime ? PANEL_H : PANEL_H_DATE_ONLY;
      const ruangBawah = window.innerHeight - rect.bottom;
      const arah = ruangBawah > ph ? "bawah" : "atas";
      const top =
        arah === "bawah" ? rect.bottom + 4 : Math.max(4, rect.top - ph - 4);
      const left = Math.min(
        Math.max(4, rect.left),
        window.innerWidth - pw - 8,
      );
      setAnchor({ top, left, arah });
    }
    const d = value || new Date();
    setView(new Date(d.getFullYear(), d.getMonth(), 1));
    setDraft(value ? new Date(value) : null);
    setOpen(true);
  }

  function pilihTanggal(tgl) {
    if (minDate && tgl.getTime() < awalHari(minDate).getTime()) return;
    if (!showTime) {
      if (value)
        tgl = new Date(
          tgl.getFullYear(),
          tgl.getMonth(),
          tgl.getDate(),
          value.getHours(),
          value.getMinutes(),
          0,
          0,
        );
      onChange(tgl);
      setOpen(false);
      return;
    }
    const t = new Date(tgl.getFullYear(), tgl.getMonth(), tgl.getDate());
    const src = draft || new Date();
    t.setHours(src.getHours(), src.getMinutes(), 0, 0);
    setDraft(t);
    onChange(t); // live update saat tanggal dipilih
    setView(new Date(tgl.getFullYear(), tgl.getMonth(), 1));
  }

  function pilihSlot(hour, minute) {
    if (!draft) return;
    const t = new Date(draft);
    t.setHours(hour, minute, 0, 0);
    setDraft(t);
    onChange(t);
  }

  function konfirmasi() {
    if (!draft) return;
    onChange(draft);
    setOpen(false);
  }

  function slotDisabled(hour, minute) {
    if (!filterTime || !draft) return false;
    const t = new Date(draft);
    t.setHours(hour, minute, 0, 0);
    return !filterTime(t);
  }

  const teks = value
    ? `${p2(value.getDate())}/${p2(value.getMonth() + 1)}/${value.getFullYear()}${showTime ? ` ${p2(value.getHours())}:${p2(value.getMinutes())}` : ""}`
    : "";

  const tahun = view.getFullYear();
  const bulan = view.getMonth();
  const selAwal = new Date(tahun, bulan, 1);
  const offset = selAwal.getDay();
  const jmlHari = new Date(tahun, bulan + 1, 0).getDate();
  const jmlHariPrev = new Date(tahun, bulan, 0).getDate();
  const sel = [];
  for (let i = 0; i < 42; i++) {
    const no = i - offset + 1;
    let tgl;
    let luar = false;
    if (no < 1) {
      tgl = new Date(tahun, bulan, jmlHariPrev + no);
      luar = true;
    } else if (no > jmlHari) {
      tgl = new Date(tahun, bulan + 1, no - jmlHari);
      luar = true;
    } else {
      tgl = new Date(tahun, bulan, no);
    }
    sel.push({ tgl, luar });
  }

  const nav = (n) => setView(new Date(tahun, bulan + n, 1));

  // Slot waktu 24 jam interval 5 menit (00:00-23:55) = 288 slot
  const slot = [];
  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m += 5) {
      const dis = !draft || slotDisabled(h, m);
      const aktif =
        Boolean(draft) && draft.getHours() === h && draft.getMinutes() === m;
      slot.push({ h, m, label: `${p2(h)}:${p2(m)}`, dis, aktif });
    }
  }

  return (
    <div ref={ref} className={`relative ${className}`}>
      <input
        readOnly
        value={teks}
        placeholder={placeholder}
        onClick={buka}
        className="w-full cursor-pointer rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-[#7181E0] focus:ring-2 focus:ring-[#7181E0]/20"
      />
      {open && (
        <div
          ref={panelRef}
          style={{
            position: "fixed",
            top: anchor.top,
            left: anchor.left,
            width: showTime ? PANEL_W : PANEL_W_DATE_ONLY,
            zIndex: 50,
          }}
          className="rounded-xl border border-gray-200 bg-white shadow-xl"
        >
          {/* Body */}
          <div
            className={`grid grid-cols-1 gap-4 p-3${showTime ? " md:grid-cols-2 md:gap-6" : ""}`}
          >
            {/* Kalender */}
            <div className="flex flex-col">
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => nav(-1)}
                  aria-label="Bulan sebelumnya"
                  className="border-0 bg-transparent px-2 py-1 rounded hover:bg-gray-100"
                >
                  ‹
                </button>
                <div className="font-medium">
                  {BULAN[bulan]} {tahun}
                </div>
                <button
                  type="button"
                  onClick={() => nav(1)}
                  aria-label="Bulan berikutnya"
                  className="border-0 bg-transparent px-2 py-1 rounded hover:bg-gray-100"
                >
                  ›
                </button>
              </div>
              <div className="grid grid-cols-7 gap-1 pt-2">
                {HARI.map((h) => (
                  <div
                    key={h}
                    className="w-8 h-8 flex items-center justify-center text-sm font-medium"
                  >
                    {h}
                  </div>
                ))}
                {sel.map(({ tgl, luar }, i) => {
                  const disabled = Boolean(
                    minDate && tgl.getTime() < awalHari(minDate).getTime(),
                  );
                  const hariIni = samaTanggal(tgl, new Date());
                  const dipilih =
                    samaTanggal(tgl, value) ||
                    (showTime && draft && samaTanggal(tgl, draft));
                  const cls = [
                    "w-8 h-8 flex items-center justify-center rounded border-0 bg-transparent cursor-pointer hover:bg-gray-100",
                    luar && "text-gray-400",
                    hariIni &&
                      !dipilih &&
                      "ring-1 ring-[#7181E0] text-[#7181E0] font-semibold",
                    dipilih && "date-time-picker-day-selected",
                    disabled && "opacity-50 cursor-not-allowed",
                  ]
                    .filter(Boolean)
                    .join(" ");
                  return (
                    <button
                      key={i}
                      type="button"
                      disabled={disabled}
                      onClick={() => pilihTanggal(tgl)}
                      className={cls}
                    >
                      {tgl.getDate()}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Panel waktu: grid slot 5 menit */}
            {showTime && (
              <div className="flex flex-col border-t border-gray-200 pt-3 md:border-t-0 md:border-l md:pt-0 md:pl-6">
                <div className="mb-2 text-sm font-medium text-gray-900">
                  Pilih Waktu
                </div>
                <div
                  ref={waktuBoxRef}
                  className="relative max-h-[280px] overflow-y-auto rounded-lg border border-gray-200 p-2"
                >
                  <div className="grid grid-cols-3 gap-2">
                    {slot.map((it) => (
                    <button
                      key={`${it.h}-${it.m}`}
                      type="button"
                      ref={it.aktif ? waktuAktifRef : null}
                      disabled={it.dis}
                      onClick={() => {
                        if (!it.dis) pilihSlot(it.h, it.m);
                      }}
                      className={[
                        "rounded border px-2 py-1.5 text-center text-xs font-medium transition",
                        it.aktif
                          ? "bg-[#7181E0] border-[#7181E0] text-white"
                          : "bg-white border-gray-200 text-[#1e40af] hover:bg-[#7181E0] hover:text-white hover:border-[#7181E0]",
                        it.dis && "opacity-40 cursor-not-allowed",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                    >
                      {it.label}
                    </button>
                  ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          {showTime && (
            <div className="grid grid-cols-2 gap-2 border-t border-gray-200 p-3">
              <button
                type="button"
                onClick={konfirmasi}
                disabled={!draft}
                className="rounded bg-[#7181E0] px-4 py-2 text-sm font-semibold text-white hover:bg-[#5d6fcc] disabled:bg-gray-200 disabled:text-gray-500 disabled:cursor-not-allowed"
              >
                Simpan
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded bg-gray-200 px-4 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-300"
              >
                Batal
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
