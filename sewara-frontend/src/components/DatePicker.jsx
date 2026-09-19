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

/**
 * DatePicker - Flowbite style calendar (date only)
 * @param {Date|null} value - Selected date
 * @param {Function} onChange - Callback with Date object
 * @param {string} placeholder - Input placeholder
 * @param {Date} minDate - Minimum selectable date
 * @param {string} className - Additional CSS classes
 */
export default function DatePicker({
  value,
  onChange,
  placeholder = "Pilih tanggal",
  minDate,
  className = "",
}) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState(() => {
    const d = value || new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [posisi, setPosisi] = useState({ arah: "bawah" });
  const ref = useRef(null);

  useEffect(() => {
    function onDown(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
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
  }, []);

  function buka() {
    if (ref.current) {
      const rect = ref.current.getBoundingClientRect();
      const ruangBawah = window.innerHeight - rect.bottom;
      const ruangAtas = rect.top;
      setPosisi({ arah: ruangBawah > ruangAtas ? "bawah" : "atas" });
    }
    const d = value || new Date();
    setView(new Date(d.getFullYear(), d.getMonth(), 1));
    setOpen(true);
  }

  function pilihTanggal(tgl) {
    if (minDate && tgl.getTime() < awalHari(minDate).getTime()) return;

    // Preserve time if value exists
    if (value) {
      tgl = new Date(
        tgl.getFullYear(),
        tgl.getMonth(),
        tgl.getDate(),
        value.getHours(),
        value.getMinutes(),
        0,
        0,
      );
    }

    onChange(tgl);
    setOpen(false);
  }

  const teks = value
    ? `${p2(value.getDate())}/${p2(value.getMonth() + 1)}/${value.getFullYear()}`
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

  return (
    <div ref={ref} className={`relative ${className}`}>
      <input
        readOnly
        value={teks}
        placeholder={placeholder}
        onClick={buka}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
        }}
        className="w-full cursor-pointer rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-[#7181E0] focus:ring-2 focus:ring-[#7181E0]/20"
      />
      {open && (
        <div
          className={`absolute z-50 w-80 max-w-[calc(100vw-2rem)] rounded-xl border-2 border-solid border-slate-200 bg-white shadow-lg ${
            posisi.arah === "atas" ? "bottom-full mb-2" : "top-full mt-2"
          }`}
        >
          <div className="flex items-center justify-between border-b border-solid border-slate-200 p-3">
            <button
              type="button"
              onClick={() => nav(-1)}
              aria-label="Bulan sebelumnya"
              className="rounded-lg border-0 bg-transparent px-3 py-1.5 text-slate-600 hover:bg-slate-100"
            >
              ‹
            </button>
            <div className="text-sm font-semibold text-slate-900">
              {BULAN[bulan]} {tahun}
            </div>
            <button
              type="button"
              onClick={() => nav(1)}
              aria-label="Bulan berikutnya"
              className="rounded-lg border-0 bg-transparent px-3 py-1.5 text-slate-600 hover:bg-slate-100"
            >
              ›
            </button>
          </div>

          <div className="p-3">
            <div className="mb-2 grid grid-cols-7 gap-1">
              {HARI.map((h) => (
                <div
                  key={h}
                  className="flex h-8 w-8 items-center justify-center text-xs font-semibold text-slate-600"
                >
                  {h}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-7 gap-1">
              {sel.map(({ tgl, luar }, i) => {
                const disabled = Boolean(
                  minDate && tgl.getTime() < awalHari(minDate).getTime(),
                );
                const hariIni = samaTanggal(tgl, new Date());
                const dipilih = samaTanggal(tgl, value);

                return (
                  <button
                    key={i}
                    type="button"
                    disabled={disabled}
                    onClick={() => pilihTanggal(tgl)}
                    className={`flex h-8 w-8 items-center justify-center rounded-lg border-0 bg-transparent text-sm transition-colors
                      ${luar ? "text-gray-400" : "text-slate-900"}
                      ${hariIni && !dipilih ? "ring-1 ring-[#7181E0] text-[#7181E0] font-semibold" : ""}
                      ${dipilih ? "date-picker-day-selected font-semibold" : "hover:bg-slate-100"}
                      ${disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"}
                    `}
                  >
                    {tgl.getDate()}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
