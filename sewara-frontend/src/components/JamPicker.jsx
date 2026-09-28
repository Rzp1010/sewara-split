"use client";

import { useState, useRef, useEffect, useLayoutEffect } from "react";

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
  const [arah, setArah] = useState("bawah");
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
    function onResize() {
      setOpen(false);
    }
    function onScroll() {
      setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  // Ukur tinggi panel aktual setelah render → tentukan arah, hindari tumpang tindih.
  useLayoutEffect(() => {
    if (!open) return;
    const el = panelRef.current;
    const tr = ref.current;
    if (!el || !tr) return;
    const r = tr.getBoundingClientRect();
    const ph = el.offsetHeight;
    const ruangBawah = window.innerHeight - r.bottom;
    const ruangAtas = r.top;
    setArah(ruangBawah < ph + 8 && ruangAtas > ruangBawah ? "atas" : "bawah");
  }, [open]);

  const aktif = value != null && value !== "" ? Number(value) : null;
  const teks = aktif != null ? `${p2(aktif)}:00` : "";

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
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
          className={`absolute left-0 z-50 w-full min-w-[13rem] max-w-[calc(100vw-2rem)] rounded-xl border border-gray-200 bg-white p-3 shadow-xl ${
            arah === "bawah" ? "top-full mt-1" : "bottom-full mb-1"
          }`}
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
                  onClick={() => {
                    onChange(h);
                    setOpen(false);
                  }}
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