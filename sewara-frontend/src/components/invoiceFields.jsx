import { formatRupiah, formatTanggal } from "@/lib/utils";

export const FOOTER_DEFAULT =
  "Terima kasih. Harap kembalikan barang lengkap sesuai Nomor Seri tertera untuk mengambil jaminan.";

/* Registry field yang boleh direlokasi antar zona. Label = tampilan. */
export const FIELD_DEFS = [
  { key: "no_invoice", label: "No. Invoice" },
  { key: "tanggal_buat", label: "Tanggal Buat" },
  { key: "status", label: "Status" },
  { key: "dibuat_oleh", label: "Dibuat Oleh" },
  { key: "waktu_ambil", label: "Waktu Ambil" },
  { key: "waktu_kembali", label: "Waktu Kembali" },
  { key: "durasi", label: "Durasi" },
  { key: "diserahkan_oleh", label: "Diserahkan Oleh" },
  { key: "penyewa", label: "Penyewa" },
  { key: "hp", label: "No. HP" },
  { key: "alamat", label: "Alamat" },
  { key: "jaminan", label: "Jaminan" },
  { key: "status_bayar", label: "Status Bayar" },
  { key: "footer_catatan", label: "Catatan Footer" },
  { key: "aksesoris", label: "Aksesoris" },
  { key: "ttd", label: "Tanda Tangan" },
];

export const FIELD_LABELS = Object.fromEntries(
  FIELD_DEFS.map((f) => [f.key, f.label]),
);

/* Zona default saat tenant pertama kali mengaktifkan layout custom. */
export const DEFAULT_LAYOUT = {
  mode: "custom",
  atas: [],
  kiri: [
    "no_invoice",
    "tanggal_buat",
    "status",
    "dibuat_oleh",
    "waktu_ambil",
    "waktu_kembali",
    "durasi",
    "diserahkan_oleh",
  ],
  kanan: ["penyewa", "hp", "alamat", "jaminan", "status_bayar"],
  tengah: ["aksesoris", "footer_catatan"],
  bawah: ["ttd"],
};

/* ===== Helper baris (dipindah dari InvoiceView agar dipakai bersama) ===== */

// Baris "label : value" blok info — col1 35%, colon 5%, sisanya value.
export function BarisInfo({ label, value, strong = false }) {
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
export function BarisTotal({ label, value }) {
  return (
    <tr>
      <td className="py-1 pr-5 text-right">{label}</td>
      <td className="py-1 text-right">{value}</td>
    </tr>
  );
}

function BadgeStatus({ status }) {
  const cls =
    status === "Lunas"
      ? "bg-[#579171] text-white"
      : status === "DP"
        ? "bg-blue-500 text-white"
        : "bg-[#F04438] text-white";
  return (
    <span
      className={`inline-block rounded-md px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide ${cls}`}
    >
      {status}
    </span>
  );
}

/* ===== Blok terkunci (dipakai legacy & custom) ===== */

export function TabelItem({ data }) {
  return (
    <table className="mt-4 mb-1 w-full border-collapse">
      <thead>
        <tr>
          <th className="bg-[#e6ecf5] p-2 text-left text-[#333]">Item Sewa</th>
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
                    .map((a) => `${a.nama} (${(a.sns || []).join(",")})`)
                    .join(", ")}
                </span>
              )}
            </td>
            <td className="px-2.5 py-2 text-center align-top">{item.qty}</td>
            <td className="px-2.5 py-2 text-right align-top">
              {formatRupiah(item.subtotal || 0)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function TabelTotal({ data, pay, className = "w-[45%]" }) {
  return (
    <table className={`${className} border-collapse font-bold`}>
      <tbody>
        <BarisTotal
          label="Subtotal:"
          value={formatRupiah(data.diskon?.biayaAsli ?? (data.total_akhir || 0))}
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
        <BarisTotal label="Dibayar:" value={formatRupiah(pay.dibayar)} />
        <BarisTotal label="Sisa Pembayaran:" value={formatRupiah(pay.sisa)} />
        {pay.kembalian > 0 && (
          <BarisTotal
            label="Kembalian:"
            value={formatRupiah(pay.kembalian)}
          />
        )}
      </tbody>
    </table>
  );
}

export function BlokAksesoris({ data }) {
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
        Aksesoris
      </p>
      <ul className="list-none pl-0 text-sm leading-[1.6] text-[#333]">
        {items.map((item, i) => (
          <li key={i}>
            {mode === "semua" ? (item.checked ? "✓" : "✗") : "•"} {item.nama}
          </li>
        ))}
        {customList.map((c, i) => (
          <li key={`c${i}`}>• {c}</li>
        ))}
      </ul>
    </div>
  );
}

export function BlokTTD({ data, ctx }) {
  return (
    <div className="blok-ttd mt-8 flex justify-between gap-12">
      <div className="w-[45%]">
        <p className="m-0">Penyewa,</p>
        <div className="h-[18mm] border-b border-[#333]" />
        <p className="m-0 mt-1 break-words">{data.penyewa || "-"}</p>
      </div>
      <div className="w-[45%]">
        <p className="m-0">Yang Melayani,</p>
        <div className="h-[18mm] border-b border-[#333]" />
        <p className="m-0 mt-1 break-words">
          {ctx.namaAksi("serahkan") ||
            ctx.namaAksi("booking") ||
            data.dilayani_oleh ||
            "-"}
        </p>
      </div>
    </div>
  );
}

/* ===== Field bebas ===== */

function nilaiInfo(fkey, data, ctx) {
  switch (fkey) {
    case "no_invoice":
      return { label: "No. Invoice", value: data.no_invoice || "-", strong: true };
    case "tanggal_buat":
      return {
        label: "Tanggal Buat",
        value: formatTanggal(data.created_at || data.waktu_ambil_rencana),
      };
    case "status":
      return { label: "Status", value: data.status || "-" };
    case "dibuat_oleh":
      return {
        label: "Dibuat Oleh",
        value: ctx.namaAksi("booking") || data.dilayani_oleh || "-",
      };
    case "waktu_ambil":
      return {
        label: "Waktu Ambil",
        value: formatTanggal(data.waktu_ambil_rencana),
      };
    case "waktu_kembali":
      return {
        label: "Waktu Kembali",
        value: formatTanggal(data.waktu_kembali_rencana),
      };
    case "durasi":
      return { label: "Durasi", value: data.durasi_teks || "-" };
    case "diserahkan_oleh":
      return {
        label: "Diserahkan Oleh",
        value: ctx.namaAksi("serahkan") || "-",
      };
    case "penyewa":
      return { label: "Penyewa", value: data.penyewa || "-" };
    case "hp":
      return { label: "No. HP", value: data.hp_penyewa || "-" };
    case "alamat":
      return { label: "Alamat", value: data.alamat_penyewa || "-" };
    case "jaminan":
      return { label: "Jaminan", value: data.jaminan_sewa || "-" };
    default:
      return null;
  }
}

/**
 * Satu field untuk renderer zona.
 * Field info → tabel baris label:value. Field khusus → blok tersendiri.
 */
export function FieldBaris({ fkey, data, ctx }) {
  if (fkey === "ttd") return <BlokTTD data={data} ctx={ctx} />;
  if (fkey === "aksesoris") return <BlokAksesoris data={data} />;
  if (fkey === "footer_catatan")
    return (
      <p className="m-0 text-sm leading-[1.5] text-[#666]">{ctx.footer}</p>
    );
  if (fkey === "status_bayar")
    return (
      <table className="w-full border-collapse">
        <tbody>
          <tr>
            <td className="w-[35%] py-0.5 align-top">Status Bayar</td>
            <td className="w-[5%] py-0.5 align-top">:</td>
            <td className="py-0.5 align-top">
              <BadgeStatus status={ctx.pay.status} />
            </td>
          </tr>
        </tbody>
      </table>
    );
  const n = nilaiInfo(fkey, data, ctx);
  if (!n) return null;
  return (
    <table className="w-full border-collapse">
      <tbody>
        <BarisInfo label={n.label} value={n.value} strong={n.strong} />
      </tbody>
    </table>
  );
}