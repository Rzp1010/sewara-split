"use client";

import { createPortal } from "react-dom";

/**
 * Pemilih S/N untuk satu baris keranjang/edit booking.
 * Markup, class, dan aturan `disabled` (berhenti saat jumlah terpilih sudah
 * mencapai `butuh`) sama seperti versi inline sebelumnya.
 */
export default function ModalKunciSN({
  judul = "Kunci S/N",
  daftarSN,
  terpilih,
  butuh,
  onToggle,
  onBatal,
  onSimpan,
}) {
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-xl bg-[var(--bg-surface)] p-6">
        <h3 className="mb-4 text-lg font-semibold">{judul}</h3>
        <div className="max-h-72 space-y-2 overflow-y-auto">
          {(daftarSN || []).map((sn) => (
            <label key={sn} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={terpilih.includes(sn)}
                disabled={!terpilih.includes(sn) && terpilih.length >= (butuh || 0)}
                onChange={(e) => onToggle(sn, e.target.checked)}
              />
              {sn}
            </label>
          ))}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onBatal}>
            Batal
          </button>
          <button type="button" onClick={onSimpan}>
            Simpan
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
