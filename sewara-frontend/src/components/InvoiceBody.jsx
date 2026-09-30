"use client";

import { getSetting } from "@/lib/db";
import { formatTanggal } from "@/lib/utils";
import {
  BarisInfo,
  TabelItem,
  TabelTotal,
  BlokAksesoris,
  BlokTTD,
  FieldBaris,
  FOOTER_DEFAULT,
} from "@/components/invoiceFields";

/* ===== Markup LEGACY (mode default) — persis perilaku sebelum custom layout ===== */

function LegacyBody({ data, footer, namaAksi, pay }) {
  const ttd = getSetting("invoice_ttd", false) === true;
  return (
    <div className="text-sm text-[#333]">
      <h1 className="m-0 mb-6 text-center text-2xl font-bold uppercase tracking-[2px] text-[#333]">
        Invoice
      </h1>

      <div className="mb-5 flex justify-between leading-[1.4]">
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
                value={formatTanggal(data.created_at || data.waktu_ambil_rencana)}
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

        <div className="w-[48%]">
          <table className="w-full border-collapse">
            <tbody>
              <BarisInfo label="Penyewa" value={data.penyewa || "-"} />
              <BarisInfo label="No. HP" value={data.hp_penyewa || "-"} />
              <BarisInfo label="Alamat" value={data.alamat_penyewa || "-"} />
              <tr>
                <td className="w-[35%] py-0.5 align-top">{"\u00A0"}</td>
                <td className="w-[5%] py-0.5 align-top">{"\u00A0"}</td>
                <td className="py-0.5 align-top">{"\u00A0"}</td>
              </tr>
              <BarisInfo label="Jaminan" value={data.jaminan_sewa || "-"} />
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

      <TabelItem data={data} />
      <BlokAksesoris data={data} />

      <div className="blok-summary mt-5 flex items-start justify-between gap-6">
        <div className="w-1/2 text-sm leading-[1.5] text-[#666]">{footer}</div>
        <TabelTotal data={data} pay={pay} className="w-[45%]" />
      </div>

      {ttd && <BlokTTD data={data} ctx={{ namaAksi }} />}
    </div>
  );
}

/* ===== Renderer custom (berbasis zona) ===== */

function ZonaStack({ daftar, data, ctx }) {
  if (!daftar || daftar.length === 0) return null;
  return (
    <>
      {daftar.map((fkey) => (
        <FieldBaris key={fkey} fkey={fkey} data={data} ctx={ctx} />
      ))}
    </>
  );
}

function CustomBody({ data, layout, footer, namaAksi, pay }) {
  const ctx = { pay, namaAksi, footer };
  const atas = layout.atas || [];
  const kiri = layout.kiri || [];
  const kanan = layout.kanan || [];
  const bawah = layout.bawah || [];

  return (
    <div className="text-sm text-[#333]">
      <h1 className="m-0 mb-6 text-center text-2xl font-bold uppercase tracking-[2px] text-[#333]">
        Invoice
      </h1>

      {atas.length > 0 && (
        <div className="mb-5 leading-[1.4]">
          <ZonaStack daftar={atas} data={data} ctx={ctx} />
        </div>
      )}

      {(kiri.length > 0 || kanan.length > 0) && (
        <div className="mb-5 flex justify-between leading-[1.4]">
          {kiri.length > 0 && (
            <div className="w-[48%]">
              <ZonaStack daftar={kiri} data={data} ctx={ctx} />
            </div>
          )}
          {kanan.length > 0 && (
            <div className="w-[48%]">
              <ZonaStack daftar={kanan} data={data} ctx={ctx} />
            </div>
          )}
        </div>
      )}

      <TabelItem data={data} />

      <div className="blok-summary mt-5 flex justify-end">
        <TabelTotal data={data} pay={pay} className="w-[45%]" />
      </div>

      {bawah.length > 0 && (
        <div className="leading-[1.4]">
          <ZonaStack daftar={bawah} data={data} ctx={ctx} />
        </div>
      )}
    </div>
  );
}

export default function InvoiceBody({ data, layout, footer, namaAksi, pay }) {
  const cetak = layout && layout.mode === "custom";
  if (!cetak) {
    return (
      <LegacyBody
        data={data}
        footer={footer || FOOTER_DEFAULT}
        namaAksi={namaAksi}
        pay={pay}
      />
    );
  }
  return (
    <CustomBody
      data={data}
      layout={layout}
      footer={footer || FOOTER_DEFAULT}
      namaAksi={namaAksi}
      pay={pay}
    />
  );
}