"use client";

import { useState, useRef, useEffect } from "react";

// Lebar panel (px) = w-80. Dipakai untuk clamp posisi fixed.
// ponytail: hardcoded biar clamp sinkron dengan Tailwind w-80;
// upgrade path = ukur offsetWidth panel setelah render.
const PANEL_W = 320;
const PANEL_H = 300;

function p2(n) {
  return String(n).padStart(2, "0");
}

export default function JamPicker({
  value,
  onChange,
  label = "Jam",
  className = "",
}) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState({ top: 0, left: 0, w: PANEL_W });
  const ref = useRef(null);
  const panelRef = useRef(null);

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

  // Buka: hitung posisi fixed + lebar clamp (hanya saat klik, bukan first paint).
  function buka() {
    if (ref.current) {
      const r = ref.current.getBoundingClientRect();
      const w = Math.min(PANEL_W, window.innerWidth - 16);
      const arah = window.innerHeight - r.bottom > PANEL_H ? "bawah" : "atas";
      const top = arah === "bawah" ? r.bottom + 4 : Math.max(4, r.top - PANEL_H - 4);
      const left = Math.max(4, Math.min(r.left, window.innerWidth - w - 8));
      setAnchor({ top, left, w });
    }
    setOpen(true);
  }

  function pilih(h) {
    onChange(h);
    setOpen(false);
  }

  const aktif = value != null && value !== "" ? Number(value) : null;
  const teks = aktif != null ? `${p2(aktif)}:00` : "";

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => (open ? setOpen(false) : buka())}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="flex w-full cursor-pointer items-center justify-between rounded-lg border border-gray-200 bg-white px-3 py-2 text-left text-sm text-slate-700 outline-none transition focus:border-[#7181E0] focus:ring-2 focus:ring-[#7181E0]/20"
      >
        <span className={teks ? "" : "text-gray-400"}>{teks || "—"}</span>
        <span className="text-gray-400" aria-hidden="true">
          ▾
        </span>
      </button>

      {open && (
        <div
          ref={panelRef}
          style={{
            position: "fixed",
            top: anchor.top,
            left: anchor.left,
            width: anchor.w,
            zIndex: 50,
          }}
          className="rounded-xl border border-gray-200 bg-white p-3 shadow-xl"
        >
          <div className="mb-2 text-sm font-medium text-gray-900">
            Pilih Jam
          </div>
          <div className="grid grid-cols-4 gap-2">
            {Array.from({ length: 24 }, (_, h) => {
              const dipilih = h === aktif;
              return (
                <button
                  key={h}
                  type="button"
                  onClick={() => pilih(h)}
                  aria-pressed={dipilih}
                  className={[
                    "rounded border px-2 py-1.5 text-center text-xs font-medium transition",
                    dipilih
                      ? "bg-[#7181E0] border-[#7181E0] text-white"
                      : "bg-white border-gray-200 text-[#1e40af] hover:bg-[#7181E0] hover:text-white hover:border-[#7181E0]",
                  ].join(" ")}
                >
                  {p2(h)}:00
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}