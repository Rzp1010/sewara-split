"use client";

import { useEffect, useRef, useState } from "react";

export default function PencarianAdaptif({ value, onChange, placeholder = "Cari nama atau HP" }) {
  const [terbuka, setTerbuka] = useState(false);
  const bungkus = useRef(null);
  const input = useRef(null);

  useEffect(() => {
    if (terbuka) input.current?.focus();
  }, [terbuka]);

  useEffect(() => {
    const klikLuar = (event) => {
      if (!bungkus.current?.contains(event.target) && !value.trim()) setTerbuka(false);
    };
    const tombol = (event) => {
      if (event.key === "Escape") setTerbuka(false);
    };
    document.addEventListener("click", klikLuar);
    document.addEventListener("keydown", tombol);
    return () => {
      document.removeEventListener("click", klikLuar);
      document.removeEventListener("keydown", tombol);
    };
  }, [value]);

  return (
    <div ref={bungkus} className={`relative flex h-[34px] items-center overflow-hidden rounded-lg transition-all duration-300 ${terbuka ? "w-[240px] border border-solid border-[var(--border-color)] bg-[var(--bg-subtle)]" : "w-[34px]"}`}>
      <button type="button" aria-label="Buka pencarian" onClick={() => setTerbuka(true)} className={`absolute left-0 top-0 z-10 flex h-[34px] w-[34px] items-center justify-center border-0 rounded-lg text-[var(--text-secondary)] ${terbuka ? "pointer-events-none" : "hover:bg-[var(--bg-subtle)]"}`}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
      </button>
      <input ref={input} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} aria-label={placeholder} className={`h-full w-full border-0 bg-transparent pl-9 pr-8 text-[13px] text-[var(--text-primary)] outline-none transition-opacity placeholder:text-[var(--text-muted)] ${terbuka ? "opacity-100" : "pointer-events-none opacity-0"}`} />
      {value && terbuka ? <button type="button" aria-label="Hapus pencarian" onClick={() => { onChange(""); input.current?.focus(); }} className="absolute right-1.5 flex h-5 w-5 items-center justify-center rounded-full border-0 bg-[var(--text-muted)] text-xs text-white">×</button> : null}
    </div>
  );
}
