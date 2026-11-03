"use client";

import { TANPA_JAMINAN } from "@/lib/booking/helpers";

/**
 * Pemilih jaminan (tombol). Markup/class sama seperti versi inline sebelumnya;
 * aturan eksklusif "Tanpa Jaminan" tetap dari `toggleJaminan` (pemanggil).
 */
export default function PanelJaminan({ daftar = [], terpilih = [], onToggle }) {
  return (
    <div>
      <label className="mb-2 block text-[12.5px] font-bold tracking-[0.02em] text-[var(--text-primary)]">
        Jaminan
      </label>
      <div className="flex gap-2 flex-wrap">
        {daftar.map((o) => {
          const aktif = terpilih.includes(o);
          const nonaktif =
            o !== TANPA_JAMINAN && terpilih.includes(TANPA_JAMINAN);
          return (
            <button
              key={o}
              type="button"
              disabled={nonaktif}
              onClick={() => onToggle(o)}
              className={`${aktif ? "rounded-lg px-4 py-2 text-sm font-medium transition-colors outline-none focus:outline-none bg-[#7181E0] hover:bg-[#5d6fcc] text-white border-0" : "rounded-lg px-4 py-2 text-sm font-medium transition-colors outline-none focus:outline-none bg-[var(--bg-subtle)] hover:bg-[var(--bg-subtle)] text-[var(--text-primary)] border-0"} ${nonaktif ? "opacity-40 cursor-not-allowed" : ""}`}
            >
              {aktif ? "✓ " : ""}
              {o}
            </button>
          );
        })}
      </div>
    </div>
  );
}
