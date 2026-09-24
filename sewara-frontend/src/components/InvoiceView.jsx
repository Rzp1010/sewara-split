"use client";

import { useSyncExternalStore, useEffect, useState } from "react";
import { getSetting, getUrlBuktiBayar } from "@/lib/db";
import { createPortal } from "react-dom";
import { formatRupiah, formatTanggal, hitungPembayaran } from "@/lib/utils";

const FOOTER_DEFAULT =
  "Terima kasih. Harap kembalikan barang lengkap sesuai Nomor Seri tertera untuk mengambil jaminan.";

const subscribeHydrated = () => () => {};
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

// Baris "label : value" blok info — col1 35%, colon 5%, sisanya value.
function BarisInfo({ label, value, strong = false }) {
  return (
    <tr>
      <td className="w-[35%] py-0.5 align-top">{label}</td>
      <td className="w-[5%] py-0.5 align-top">:</td>
      <td className={`py-0.5 align-top ${strong ? "font-bold" : ""}`}>
        {value}
      </td>
    </tr>
  );
}

// Baris ringkasan biaya — label rata kanan + 20px gap, angka rata kanan, bold.
function BarisTotal({ label, value }) {
  return (
    <tr>
      <td className="py-1 pr-5 text-right">{label}</td>
      <td className="py-1 text-right">{value}</td>
    </tr>
  );
}

// Thumbnail bukti bayar 40px (ambil signed URL saat mount).
function ThumbBukti({ path, onOpen }) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    let aktif = true;
    getUrlBuktiBayar(path).then((u) => {
      if (aktif) setUrl(u);
    });
    return () => {
      aktif = false;
    };
  }, [path]);
  if (!url) return null;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onOpen(url);
      }}
      title="Lihat bukti"
      className="border-solid border-slate-300 overflow-hidden rounded border bg-white p-0"
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

export default function InvoiceView({ data, onClose }) {
  const footer = getSetting("invoice_footer", "") || FOOTER_DEFAULT;
  const pay = hitungPembayaran(data);
  const [viewerBukti, setViewerBukti] = useState(null);
  const [gagalViewer, setGagalViewer] = useState(false);
  const buktiList = (data.pembayaran?.riwayatBayar || []).filter((b) => b?.bukti);
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
          {/* Blueprint: .invoice-box — font dasar 14px, warna #333 */}
          <div className="text-sm text-[#333]">
            {/* Blueprint: h1 — tengah, uppercase, letter-spacing 2px */}
            <h1 className="m-0 mb-6 text-center text-2xl font-bold uppercase tracking-[2px] text-[#333]">
              Invoice
            </h1>

            {/* Blueprint: .info-container — flex space-between, line-height 1.4 */}
            <div className="mb-5 flex justify-between leading-[1.4]">
              {/* Blueprint: .info-block kiri 48% */}
              <div className="w-[48%]">
                <table className="w-full border-collapse">
                  <tbody>
                    <BarisInfo
                      label="No. Invoice"
                      value={data.no_invoice || "-"}
                      strong
                    />
                    <BarisInfo
                      label="Tanggal Buat"
                      value={formatTanggal(
                        data.created_at || data.waktu_ambil_rencana,
                      )}
                    />
                    <BarisInfo label="Status" value={data.status || "-"} />
                    <BarisInfo
                      label="Dibuat Oleh"
                      value={namaAksi("booking") || data.dilayani_oleh || "-"}
                    />
                    <BarisInfo
                      label="Waktu Ambil"
                      value={formatTanggal(data.waktu_ambil_rencana)}
                    />
                    <BarisInfo
                      label="Waktu Kembali"
                      value={formatTanggal(data.waktu_kembali_rencana)}
                    />
                    <BarisInfo label="Durasi" value={data.durasi_teks || "-"} />
                    <BarisInfo
                      label="Diserahkan Oleh"
                      value={namaAksi("serahkan") || "-"}
                    />
                  </tbody>
                </table>
              </div>

              {/* Blueprint: .info-block kanan 48% */}
              <div className="w-[48%]">
                <table className="w-full border-collapse">
                  <tbody>
                    <BarisInfo label="Penyewa" value={data.penyewa || "-"} />
                    <BarisInfo label="No. HP" value={data.hp_penyewa || "-"} />
                    <BarisInfo
                      label="Alamat"
                      value={data.alamat_penyewa || "-"}
                    />
                    <tr>
                      <td className="w-[35%] py-0.5 align-top">{"\u00A0"}</td>
                      <td className="w-[5%] py-0.5 align-top">{"\u00A0"}</td>
                      <td className="py-0.5 align-top">{"\u00A0"}</td>
                    </tr>
                    <BarisInfo
                      label="Jaminan"
                      value={data.jaminan_sewa || "-"}
                    />
                    <tr>
                      <td className="w-[35%] py-0.5 align-top">{"\u00A0"}</td>
                      <td className="w-[5%] py-0.5 align-top">{"\u00A0"}</td>
                      <td className="py-0.5 align-top">
                        <span
                          className={`inline-block rounded-md px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide ${
                            pay.status === "Lunas"
                              ? "bg-[#579171] text-white"
                              : pay.status === "DP"
                                ? "bg-blue-500 text-white"
                                : "bg-[#F04438] text-white"
                          }`}
                        >
                          {pay.status}
                        </span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            {/* Blueprint: .item-table — header #e6ecf5 sebagai pembeda, tanpa garis */}
            <table className="my-4 w-full border-collapse">
              <thead>
                <tr>
                  <th className="bg-[#e6ecf5] p-2 text-left text-[#333]">
                    Item Sewa
                  </th>
                  <th className="w-[20%] bg-[#e6ecf5] p-2 text-center text-[#333]">
                    Jumlah Item
                  </th>
                  <th className="w-[25%] bg-[#e6ecf5] p-2 text-right text-[#333]">
                    Harga
                  </th>
                </tr>
              </thead>
              <tbody>
                {(data.items || []).map((item, idx) => (
                  <tr key={idx}>
                    <td className="px-2.5 py-2 align-top">
                      {item.ref.nama}
                      {item.ref.jenis === "satuan" ? (
                        <span> ({item.sn})</span>
                      ) : (
                        <span>
                          {" "}
                          Komp:{" "}
                          {(item.assignedSNs || [])
                            .map(
                              (a) => `${a.nama} (${(a.sns || []).join(",")})`,
                            )
                            .join(", ")}
                        </span>
                      )}
                    </td>
                    <td className="px-2.5 py-2 text-center align-top">
                      {item.qty}
                    </td>
                    <td className="px-2.5 py-2 text-right align-top">
                      {formatRupiah(item.subtotal || 0)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {(() => {
              const p = data?.printilan;
              if (!p || typeof p !== "object") return null;
              const daftar = p.daftar || [];
              const terpilih = new Set(p.terpilih || []);
              const custom = p.custom || "";
              const mode = p.mode || "dicentang";

              let items = [];
              if (mode === "semua" && daftar.length > 0) {
                items = daftar.map((d) => ({ nama: d, checked: terpilih.has(d) }));
              } else {
                items = (p.terpilih || []).map((d) => ({ nama: d, checked: true }));
              }

              const customList = custom
                ? custom
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean)
                : [];

              if (items.length === 0 && customList.length === 0) return null;

              return (
                <div className="mt-4 pt-3">
                  <p className="mb-1 text-xs font-bold uppercase tracking-wide text-[#666]">
                    Printilan
                  </p>
                  <ul className="list-none pl-0 text-sm leading-[1.6] text-[#333]">
                    {items.map((item, i) => (
                      <li key={i}>
                        {mode === "semua" ? (item.checked ? "✓" : "✗") : "•"}{" "}
                        {item.nama}
                      </li>
                    ))}
                    {customList.map((c, i) => (
                      <li key={`c${i}`}>• {c}</li>
                    ))}
                  </ul>
                </div>
              );
            })()}

            {/* Blueprint: .summary-container — flex space-between, atas 20px */}
            <div className="mt-5 flex items-start justify-between gap-6">
              {/* Blueprint: .note — 50%, 14px, #666, line-height 1.5 */}
              <div className="w-1/2 text-sm leading-[1.5] text-[#666]">
                {footer}
              </div>

              {/* Blueprint: .total-table — 45%, bold, label rata kanan + pr-20px */}
              <table className="w-[45%] border-collapse font-bold">
                <tbody>
                  <BarisTotal
                    label="Subtotal:"
                    value={formatRupiah(
                      data.diskon?.biayaAsli ?? (data.total_akhir || 0),
                    )}
                  />
                  {data.diskon?.diskonMember > 0 && (
                    <BarisTotal
                      label="Diskon Member:"
                      value={`-${formatRupiah(data.diskon.diskonMember)}`}
                    />
                  )}
                  {data.diskon?.diskonPromo > 0 && (
                    <BarisTotal
                      label={`Diskon Promo${data.diskon.kodePromo ? ` (${data.diskon.kodePromo})` : ""}:`}
                      value={`-${formatRupiah(data.diskon.diskonPromo)}`}
                    />
                  )}
                  <BarisTotal
                    label="Total Akhir:"
                    value={formatRupiah(data.total_akhir || 0)}
                  />
                  <BarisTotal
                    label="Dibayar:"
                    value={formatRupiah(pay.dibayar)}
                  />
                  <BarisTotal
                    label="Sisa Pembayaran:"
                    value={formatRupiah(pay.sisa)}
                  />
                  {pay.kembalian > 0 && (
                    <BarisTotal
                      label="Kembalian:"
                      value={formatRupiah(pay.kembalian)}
                    />
                  )}
                </tbody>
              </table>
            </div>

            {buktiList.length > 0 && (
              <div className="mt-5">
                <p className="mb-2 text-xs font-bold uppercase tracking-wide text-[#666]">
                  Bukti Pembayaran
                </p>
                <div className="flex flex-wrap gap-2">
                  {buktiList.map((b, i) => (
                    <ThumbBukti
                      key={b.id || i}
                      path={b.bukti}
                      onOpen={(url) => {
                        setGagalViewer(false);
                        setViewerBukti(url);
                      }}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="no-print flex shrink-0 items-center justify-center gap-2 border-t border-solid border-gray-200 p-4">
          <button
            onClick={() => window.print()}
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

      {viewerBukti &&
        createPortal(
          <div
            onClick={(e) => {
              e.stopPropagation();
              setViewerBukti(null);
            }}
            className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/85 p-4"
          >
            {gagalViewer ? (
              <p className="mb-4 text-center text-sm font-semibold text-white">
                Bukti terhapus otomatis (retensi 3 bulan)
              </p>
            ) : (
              <img
                src={viewerBukti}
                alt="Bukti pembayaran"
                onClick={(e) => e.stopPropagation()}
                onError={() => setGagalViewer(true)}
                className="max-h-[80vh] max-w-full rounded-md object-contain"
              />
            )}
            <button
              onClick={(e) => {
                e.stopPropagation();
                setViewerBukti(null);
              }}
              className="mt-4 rounded-lg border-0 bg-gray-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-gray-300"
            >
              Tutup
            </button>
          </div>,
          document.body,
        )}
    </div>
  );

  if (!mounted) return null;
  return createPortal(konten, document.body);
}
