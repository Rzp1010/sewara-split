import { ROLE_CS } from "./role";

export function formatRupiah(angka) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 0,
  }).format(angka);
}

// Format angka untuk input nominal: "200000" -> "200.000" (titik ribuan id-ID).
// State tetap simpan digit mentah; fungsi ini hanya untuk tampilan.
export function formatAngkaInput(str) {
  const digits = String(str || "").replace(/\D/g, "");
  if (!digits) return "";
  return new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 }).format(
    parseInt(digits, 10),
  );
}

export function formatTanggal(iso) {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function hitungDurasi(ambil, kembali) {
  if (!ambil || !kembali) return { error: "Pilih tanggal!" };
  const diff = new Date(kembali) - new Date(ambil);
  if (diff <= 0) return { error: "Waktu tidak valid!" };
  const totalJam = Math.ceil(diff / 3600000);
  const hari = Math.floor(totalJam / 24);
  const sisaJam = totalJam % 24;
  return {
    hari,
    sisaJam,
    durasi_teks:
      (hari > 0 ? `${hari} Hari ` : "") + (sisaJam > 0 ? `${sisaJam} Jam` : ""),
    error: null,
    totalJam,
  };
}

export function hitungDurasiDenganAturan(
  ambilRencana,
  ambilAktual,
  kembaliRencana,
  kembaliAktual,
  aturanCepat,
  aturanTelat,
) {
  const ambilR = ambilRencana ? new Date(ambilRencana) : null;
  const ambilA = ambilAktual ? new Date(ambilAktual) : null;
  let ambilEfektif = ambilR;
  if (ambilR && ambilA) {
    if (ambilA < ambilR && aturanCepat === "aktual") ambilEfektif = ambilA;
    else if (ambilA > ambilR && aturanTelat === "aktual") ambilEfektif = ambilA;
  } else if (ambilA) {
    ambilEfektif = ambilA;
  }
  const kembaliEfektif = kembaliAktual || kembaliRencana;
  const dur = hitungDurasi(
    ambilEfektif?.toISOString(),
    kembaliEfektif ? new Date(kembaliEfektif).toISOString() : null,
  );
  return { ...dur, ambilEfektif: ambilEfektif?.toISOString() || "" };
}

export function hitungPembayaran(trx) {
  const riwayat = trx?.pembayaran?.riwayatBayar || [];
  const dibayar = riwayat.reduce((s, b) => s + (b.jumlah || 0), 0);
  const total = trx?.total_akhir || 0;
  let status = "Belum Bayar";
  if (dibayar >= total && total > 0) status = "Lunas";
  else if (dibayar > 0) status = "DP";
  return {
    dibayar,
    total,
    sisa: Math.max(0, total - dibayar),
    kembalian: dibayar > total ? dibayar - total : 0,
    status,
  };
}

export function unduhCSV(dataCsv, namaFile) {
  const csvAman = dataCsv.replace(
    /(^|,)("?)([=+\-@\t\r])/gm,
    (_, pemisah, kutip, awal) => `${pemisah}${kutip}'${awal}`,
  );
  const blob = new Blob([csvAman], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = namaFile;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function snsItemDalamTrx(item, idBarang) {
  if (item.ref?.jenis === "satuan") {
    if (item.idBarang != idBarang) return [];
    return item.sn ? item.sn.split(", ") : [];
  }
  if (item.ref?.jenis === "bundling") {
    const a = (item.assignedSNs || []).find((x) => x.idKomp == idBarang);
    return a ? [...a.sns] : [];
  }
  return [];
}

// Opsi dropdown kondisi sesuai role. CS hanya Baik/Bermasalah;
// gudang/owner/superadmin boleh Maintenance. Server tetap otoritatif.
export function opsiKondisi(role) {
  const opsi = [
    { value: "baik", label: "Baik" },
    { value: "bermasalah", label: "Bermasalah" },
  ];
  if (role && role !== ROLE_CS) opsi.push({ value: "maintenance", label: "Maintenance" });
  return opsi;
}

// Kondisi per-unit S/N dari map item.kondisi_sn. SN tak ada di map = "baik".
export function kondisiUnit(item, sn) {
  return item?.kondisi_sn?.[sn]?.kondisi || "baik";
}

export function catatanUnit(item, sn) {
  return item?.kondisi_sn?.[sn]?.catatan || null;
}

export function periodeOverlap(mulaiA, selesaiA, mulaiB, selesaiB) {
  const ma = mulaiA ? new Date(mulaiA).getTime() : -Infinity;
  const sa = selesaiA ? new Date(selesaiA).getTime() : Infinity;
  const mb = mulaiB ? new Date(mulaiB).getTime() : -Infinity;
  const sb = selesaiB ? new Date(selesaiB).getTime() : Infinity;
  return ma < sb && mb < sa;
}

function trxAktif(trxAll) {
  return (trxAll || []).filter(
    (t) => t.status === "Booking" || t.status === "Disewa",
  );
}

export function snsDimiliki(invData, trxAll, idBarang) {
  const invItem = (invData || []).find((i) => i.id == idBarang);
  const set = new Set(invItem?.sns || []);
  trxAktif(trxAll).forEach((t) => {
    (t.items || []).forEach((item) =>
      snsItemDalamTrx(item, idBarang).forEach((s) => set.add(s)),
    );
  });
  return [...set];
}

export function snsTerpakaiPerPeriode(
  trxAll,
  idBarang,
  mulaiISO,
  selesaiISO,
  kecualiId,
) {
  const set = new Set();
  trxAktif(trxAll).forEach((t) => {
    if (t.id === kecualiId) return;
    if (
      !periodeOverlap(
        mulaiISO,
        selesaiISO,
        t.waktu_ambil_rencana,
        t.waktu_kembali_rencana,
      )
    )
      return;
    (t.items || []).forEach((item) =>
      snsItemDalamTrx(item, idBarang).forEach((s) => set.add(s)),
    );
  });
  return [...set];
}

export function snsDirujukLainnya(trxAll, kecualiId, idBarang) {
  const set = new Set();
  trxAktif(trxAll).forEach((t) => {
    if (t.id === kecualiId) return;
    (t.items || []).forEach((item) =>
      snsItemDalamTrx(item, idBarang).forEach((s) => set.add(s)),
    );
  });
  return set;
}

export function snsBebasPerPeriode(
  invData,
  trxAll,
  idBarang,
  mulaiISO,
  selesaiISO,
  kecualiId,
) {
  const invItem = (invData || []).find((i) => i.id == idBarang);
  const owned = new Set(invItem?.sns || []);
  trxAktif(trxAll).forEach((t) => {
    (t.items || []).forEach((item) =>
      snsItemDalamTrx(item, idBarang).forEach((s) => owned.add(s)),
    );
  });
  trxAktif(trxAll).forEach((t) => {
    if (t.id === kecualiId) return;
    if (
      !periodeOverlap(
        mulaiISO,
        selesaiISO,
        t.waktu_ambil_rencana,
        t.waktu_kembali_rencana,
      )
    )
      return;
    (t.items || []).forEach((item) =>
      snsItemDalamTrx(item, idBarang).forEach((s) => owned.delete(s)),
    );
  });
  return [...owned];
}

export function stokBebasPerPeriode(
  invData,
  trxAll,
  item,
  mulaiISO,
  selesaiISO,
  kecualiId,
) {
  if (item.jenis === "satuan")
    return snsBebasPerPeriode(
      invData,
      trxAll,
      item.id,
      mulaiISO,
      selesaiISO,
      kecualiId,
    ).length;
  if (item.jenis === "bundling") {
    if (!item.komponen || item.komponen.length === 0) return 0;
    return Math.min(
      ...item.komponen.map((k) => {
        const bebas = snsBebasPerPeriode(
          invData,
          trxAll,
          k.idBarang,
          mulaiISO,
          selesaiISO,
          kecualiId,
        );
        return Math.floor(bebas.length / k.qty);
      }),
    );
  }
  return 0;
}
