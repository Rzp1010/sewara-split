"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { urlBuktiBayar } from "@/lib/db";
import { formatTanggal } from "@/lib/utils";

// Thumbnail 40px: url proxy langsung dari path.
function ThumbBukti({ path, onOpen }) {
  const url = urlBuktiBayar(path);
  if (!url) return null;
  return (
    <button
      type="button"
      onClick={() => onOpen(url)}
      title="Lihat bukti"
      className="overflow-hidden rounded border border-solid border-slate-300 bg-white p-0"
      style={{ width: 40, height: 40, lineHeight: 0 }}
    >
      <img
        src={url}
        alt="Bukti bayar"
        style={{ objectFit: "cover", width: 40, height: 40 }}
      />
    </button>
  );
}

/**
 * Modal lihat bukti pembayaran satu transaksi.
 * Props: { transaksi, onClose } — transaksi wajib sudah punya pembayaran.riwayatBayar.
 */
export default function ModalBuktiBayar({ transaksi, onClose }) {
  const [viewer, setViewer] = useState(null);
  const [gagal, setGagal] = useState(false);

  if (typeof document === "undefined" || !transaksi) return null;

  const riwayat = transaksi.pembayaran?.riwayatBayar || [];
  const adaBukti = riwayat.some((b) => b?.bukti);

  return createPortal(
    <div
      onClick={onClose}
      className="fixed inset-0 z-[9999] flex items-center justify-center overflow-y-auto bg-black/50 p-4 backdrop-blur-sm"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-solid border-slate-200 bg-white shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-solid border-gray-100 p-5">
          <h3 className="text-base font-semibold text-gray-900">
            Bukti Pembayaran
            <span className="ml-2 text-sm font-normal text-gray-500">
              {transaksi.no_invoice} · {transaksi.penyewa}
            </span>
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup"
            className="border-0 bg-transparent text-xl leading-none text-gray-400 hover:text-gray-600"
          >
            &times;
          </button>
        </div>

        <div className="max-h-[70vh] flex-1 overflow-y-auto p-5">
          {!adaBukti ? (
            <p className="py-6 text-center text-sm text-gray-500">
              Belum ada bukti pembayaran untuk transaksi ini.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {riwayat
                .filter((b) => b?.bukti)
                .map((b, i) => (
                  <div
                    key={b.id || i}
                    className="flex items-center gap-3 rounded-lg border border-solid border-slate-200 bg-white px-3 py-2"
                  >
                    <ThumbBukti
                      path={b.bukti}
                      onOpen={(url) => {
                        setGagal(false);
                        setViewer(url);
                      }}
                    />
                    <span className="text-xs text-gray-600">
                      {formatTanggal(b.tgl)}
                    </span>
                  </div>
                ))}
            </div>
          )}
        </div>

        <div className="flex justify-end border-t border-solid border-gray-100 p-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border-0 bg-[#7181E0] px-4 py-2 text-sm font-semibold text-white hover:bg-[#5d6fcc]"
          >
            Tutup
          </button>
        </div>
      </div>

      {viewer &&
        createPortal(
          <div
            onClick={() => setViewer(null)}
            className="fixed inset-0 z-[10000] flex flex-col items-center justify-center bg-black/85 p-4"
          >
            {gagal ? (
              <p className="mb-4 text-center text-sm font-semibold text-white">
                Bukti terhapus otomatis (retensi 3 bulan)
              </p>
            ) : (
              <img
                src={viewer}
                alt="Bukti pembayaran"
                onClick={(e) => e.stopPropagation()}
                onError={() => setGagal(true)}
                className="max-h-[80vh] max-w-full rounded-md object-contain"
              />
            )}
            <button
              type="button"
              onClick={() => setViewer(null)}
              className="mt-4 rounded-lg border-0 bg-gray-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-gray-300"
            >
              Tutup
            </button>
          </div>,
          document.body,
        )}
    </div>,
    document.body,
  );
}
