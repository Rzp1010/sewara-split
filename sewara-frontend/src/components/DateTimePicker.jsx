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
const LEBAR_PANEL = 320;

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
  // Tanggal kerja sementara (mode showTime): tanggal dipilih dulu, jam/menit menyusul.
  const [draft, setDraft] = useState(null);
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
    setDraft((prev) => {
      const t = new Date(tgl.getFullYear(), tgl.getMonth(), tgl.getDate());
      const src = prev || new Date();
      t.setHours(src.getHours(), src.getMinutes(), 0, 0);
      return t;
    });
    setView(new Date(tgl.getFullYear(), tgl.getMonth(), 1));
  }

  function ubahJam(jam) {
    setDraft((prev) => {
      if (!prev) return prev;
      const t = new Date(prev);
      t.setHours(jam, t.getMinutes(), 0, 0);
      return t;
    });
  }

  function ubahMenit(menit) {
    setDraft((prev) => {
      if (!prev) return prev;
      const t = new Date(prev);
      t.setHours(t.getHours(), menit, 0, 0);
      return t;
    });
  }

  function konfirmasi() {
    if (!draft) return;
    onChange(draft);
    setOpen(false);
  }

  function jamDisabled(h) {
    if (!filterTime || !draft) return false;
    const t = new Date(draft);
    t.setHours(h, 0, 0, 0);
    return !filterTime(t);
  }

  const teks = value
    ? `${p2(value.getDate())}/${p2(value.getMonth() + 1)}/${value.getFullYear()}${showTime ? ` ${p2(value.getHours())}:${p2(value.getMinutes())}` : ""}`
    : "";

  const tahun = view.getFullYear();
  const bulan = view.getMonth();
  const selAwal = new Date(tahun, bulan, 1);
  const offset = selAwal.getDay(); // 0 = Minggu
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
          className={`absolute left-0 z-50 w-80 max-w-[calc(100vw-2rem)] rounded-xl border border-gray-200 bg-white shadow-xl ${posisi.arah === "atas" ? "bottom-full mb-2" : "top-full mt-2"}`}
        >
          <div className="flex items-center justify-between p-3">
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
          <div className="grid grid-cols-7 gap-1 p-2">
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
          {showTime && draft && (
            <div className="flex items-center gap-2 p-3 border-t">
              <select
                value={draft.getHours()}
                onChange={(e) => ubahJam(parseInt(e.target.value, 10))}
                className="border rounded px-2 py-1"
                aria-label="Jam"
              >
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={h} disabled={jamDisabled(h)}>
                    {p2(h)}
                  </option>
                ))}
              </select>
              <span>:</span>
              <select
                value={draft.getMinutes()}
                onChange={(e) => ubahMenit(parseInt(e.target.value, 10))}
                className="border rounded px-2 py-1"
                aria-label="Menit"
              >
                {Array.from({ length: 12 }, (_, i) => i * 5).map((m) => (
                  <option key={m} value={m}>
                    {p2(m)}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={konfirmasi}
                className="rounded-lg border-0 bg-[#7181E0] px-4 py-2 text-sm font-semibold text-white hover:bg-[#5d6fcc]"
              >
                OK
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
