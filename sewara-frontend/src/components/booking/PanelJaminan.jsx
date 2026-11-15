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
      <div className="flex flex-wrap items-center gap-2">
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
              className={`h-8 rounded-lg border px-3 text-[12.5px] font-medium transition-colors ${aktif ? "border-[#4f6fe0] bg-[#e8edfb] text-[#4f6fe0]" : "border-[var(--border-color)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:border-[#c7d2fe] hover:text-[var(--text-primary)]"} ${nonaktif ? "cursor-not-allowed opacity-40" : ""}`}
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
