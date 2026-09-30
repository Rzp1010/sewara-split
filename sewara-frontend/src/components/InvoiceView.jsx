"use client";

import { useSyncExternalStore } from "react";
import { getSetting } from "@/lib/db";
import { createPortal } from "react-dom";
import { hitungPembayaran } from "@/lib/utils";
import InvoiceBody from "@/components/InvoiceBody";
import { FOOTER_DEFAULT } from "@/components/invoiceFields";

const subscribeHydrated = () => () => {};
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

export default function InvoiceView({ data, onClose }) {
  const footer = getSetting("invoice_footer", "") || FOOTER_DEFAULT;
  const ganda = getSetting("invoice_ganda", false) === true;
  const layout = getSetting("invoice_layout", null) || {};
  const pay = hitungPembayaran(data);
  const namaAksi = (aksi) =>
    data.riwayatDilayani?.find((r) => r.aksi === aksi)?.nama || "";
  const mounted = useSyncExternalStore(
    subscribeHydrated,
    getClientSnapshot,
    getServerSnapshot,
  );

  async function unduhPDF() {
    const isi = document.getElementById("invoice_isi");
    if (!isi) return;
    const tombol = document
      .getElementById("invoice_kartu")
      ?.querySelector(".no-print");
    const styleLama = tombol?.style.display;
    const padLama = isi.style.padding;
    if (tombol) tombol.style.display = "none";
    isi.style.padding = "24px";
    try {
      const html2pdf = (await import("html2pdf.js")).default;
      await html2pdf()
        .set({
          margin: [6, 6, 6, 6],
          filename: `Invoice-${data.no_invoice || "Rental"}.pdf`,
          image: { type: "jpeg", quality: 0.98 },
          html2canvas: {
            scale: 2,
            useCORS: true,
            backgroundColor: "#ffffff",
            windowWidth: isi.scrollWidth,
          },
          jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
        })
        .from(isi)
        .save();
    } catch (err) {
      console.error("Gagal download PDF:", err);
      alert(`Gagal download PDF: ${err?.message || err}`);
    } finally {
      isi.style.padding = padLama;
      if (tombol) tombol.style.display = styleLama;
    }
  }

  // Cetak: mode ganda per-tenant pasang @page landscape sesaat + tandai #cetak_invoice.
  function cetak() {
    const gandaAktif = getSetting("invoice_ganda", false) === true;
    let st;
    if (gandaAktif) {
      st = document.createElement("style");
      st.textContent = "@page { size: A4 landscape; margin: 0; }";
      document.head.appendChild(st);
      document.getElementById("cetak_invoice")?.classList.add("cetak-ganda");
    }
    window.print();
    if (st) {
      st.remove();
      document.getElementById("cetak_invoice")?.classList.remove("cetak-ganda");
    }
  }

  const salinan = (
    <InvoiceBody
      data={data}
      layout={layout}
      footer={footer}
      namaAksi={namaAksi}
      pay={pay}
    />
  );

  const konten = (
    <div
      id="cetak_invoice"
      onClick={() => onClose?.()}
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
    >
      <div
        id="invoice_kartu"
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg bg-white p-6 shadow-xl animate-scaleIn"
      >
        <div
          id="invoice_isi"
          className="min-h-0 flex-1 overflow-y-auto p-10 md:p-14"
        >
          {ganda ? (
            <>
              <div className="cetak-dupanya hidden">
                <div className="cetak-belah overflow-hidden">
                  <div className="w-[161%] origin-top-left scale-[0.62]">
                    {salinan}
                  </div>
                </div>
                <div className="cetak-belah overflow-hidden">
                  <div className="w-[161%] origin-top-left scale-[0.62]">
                    {salinan}
                  </div>
                </div>
              </div>
              <div className="cetak-solo">{salinan}</div>
            </>
          ) : (
            salinan
          )}
        </div>

        <div className="no-print flex shrink-0 items-center justify-center gap-2 border-t border-solid border-gray-200 p-4">
          <button
            onClick={cetak}
            className="rounded-lg border-0 bg-gray-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-gray-300"
          >
            Cetak
          </button>
          <button
            onClick={unduhPDF}
            className="rounded-lg border-0 bg-[#7181E0] px-4 py-2 text-sm font-semibold text-white hover:bg-[#5d6fcc]"
          >
            Download PDF
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className="rounded-lg border-0 bg-[#F04438] px-4 py-2 text-sm font-semibold text-white hover:bg-[#d03a2f]"
            >
              Tutup
            </button>
          )}
        </div>
      </div>
    </div>
  );

  if (!mounted) return null;
  return createPortal(konten, document.body);
}