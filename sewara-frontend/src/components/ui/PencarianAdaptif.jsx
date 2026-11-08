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
    <div ref={bungkus} className={`relative flex h-8 items-center gap-1.5 overflow-hidden rounded-lg border border-solid bg-[var(--bg-surface)] px-1.5 text-[var(--text-secondary)] shadow-sm transition-all duration-300 ${terbuka ? "w-[220px] border-[var(--color-primary)] shadow-[0_0_0_3px_var(--color-primary-soft)]" : "w-8 border-[var(--border-color)]"}`}>
      <button type="button" aria-label="Buka pencarian" onClick={() => setTerbuka(true)} className={`flex h-[18px] w-[18px] flex-none items-center justify-center rounded border-0 bg-transparent text-inherit ${terbuka ? "pointer-events-none" : "hover:text-[var(--text-primary)]"}`}>
        <svg className="flex-none" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
      </button>
      <input ref={input} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} aria-label={placeholder} className={`h-full min-w-0 flex-1 border-0 bg-transparent p-0 text-[13px] text-[var(--text-primary)] outline-none transition-opacity placeholder:text-[var(--text-muted)] ${terbuka ? "opacity-100" : "pointer-events-none opacity-0"}`} />
      {value && terbuka ? <button type="button" aria-label="Hapus pencarian" onClick={() => { onChange(""); input.current?.focus(); }} className="flex h-5 w-5 flex-none items-center justify-center rounded-full border-0 bg-[var(--text-muted)] text-xs text-white">×</button> : null}
    </div>
  );
}
