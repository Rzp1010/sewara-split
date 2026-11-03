// Helper murni halaman Booking: konstanta jaminan, indeks S/N per periode,
// dan perhitungan tampilan. Tidak mengimpor apa pun supaya bisa diuji tanpa
// browser (`node .uji/cek-booking-helpers.mjs`).

export const DEFAULT_JAMINAN = ["E-KTP", "SIM", "Tanpa Jaminan"];
export const TANPA_JAMINAN = "Tanpa Jaminan";

/* Aturan eksklusif "Tanpa Jaminan": pilih ini -> kosongkan & disable lain;
   pilih lain -> lepas "Tanpa Jaminan". */
export function toggleJaminan(terpilih, opsi) {
  const arr = Array.isArray(terpilih) ? terpilih : [];
  if (opsi === TANPA_JAMINAN) {
    return arr.includes(TANPA_JAMINAN) ? [] : [TANPA_JAMINAN];
  }
  const tanpa = arr.filter((x) => x !== TANPA_JAMINAN);
  return tanpa.includes(opsi)
    ? tanpa.filter((x) => x !== opsi)
    : [...tanpa, opsi];
}

export function bangunIndeks(trx, inv) {
  const rujuk = new Map();
  const terpakaiSemua = new Map();
  (trx || []).forEach((t) => {
    (t.items || []).forEach((item) => {
      const tambah = (idBarang, sns) => {
        const kunci = String(idBarang);
        if (!rujuk.has(kunci)) rujuk.set(kunci, new Map());
        const m = rujuk.get(kunci);
        sns.forEach((s) => {
          if (!m.has(s)) m.set(s, []);
          m.get(s).push({
            ambil: t.waktu_ambil_rencana,
            kembali: t.waktu_kembali_rencana,
            trxId: t.id,
          });
        });
        const set = terpakaiSemua.get(kunci) || new Set();
        sns.forEach((s) => set.add(s));
        terpakaiSemua.set(kunci, set);
      };
      if (item.ref?.jenis === "satuan") {
        tambah(item.idBarang, item.sn ? item.sn.split(", ") : []);
      } else if (item.ref?.jenis === "bundling") {
        (item.assignedSNs || []).forEach((a) => tambah(a.idKomp, a.sns || []));
      }
    });
  });
  const invMap = new Map();
  (inv || []).forEach((i) => invMap.set(String(i.id), i));
  return { rujuk, terpakaiSemua, invMap };
}

export function snsTerpakaiIdx(indeks, idBarang, mulaiISO, selesaiISO, kecualiId) {
  const mulaiMs = mulaiISO ? new Date(mulaiISO).getTime() : -Infinity;
  const selesaiMs = selesaiISO ? new Date(selesaiISO).getTime() : Infinity;
  const m = indeks.rujuk.get(String(idBarang));
  if (!m) return [];
  const hasil = [];
  m.forEach((periodeArr, s) => {
    const bentrok = periodeArr.some((p) => {
      if (p.trxId === kecualiId) return false;
      const pa = p.ambil ? new Date(p.ambil).getTime() : -Infinity;
      const sa = p.kembali ? new Date(p.kembali).getTime() : Infinity;
      return pa < selesaiMs && mulaiMs < sa;
    });
    if (bentrok) hasil.push(s);
  });
  return hasil;
}

export function snsBebasIdx(indeks, idBarang, mulaiISO, selesaiISO, kecualiId) {
  const invItem = indeks.invMap.get(String(idBarang));
  const owned = new Set(invItem?.sns || []);
  const set = indeks.terpakaiSemua.get(String(idBarang));
  if (set) set.forEach((s) => owned.add(s));
  snsTerpakaiIdx(indeks, idBarang, mulaiISO, selesaiISO, kecualiId).forEach(
    (s) => owned.delete(s),
  );
  return [...owned];
}

export function hitungStokIdx(indeks, item, mulaiISO, selesaiISO, kecualiId) {
  if (item.jenis === "satuan")
    return snsBebasIdx(indeks, item.id, mulaiISO, selesaiISO, kecualiId).length;
  if (item.jenis === "bundling") {
    if (!item.komponen || item.komponen.length === 0) return 0;
    return Math.min(
      ...item.komponen.map((k) =>
        Math.floor(
          snsBebasIdx(indeks, k.idBarang, mulaiISO, selesaiISO, kecualiId)
            .length / k.qty,
        ),
      ),
    );
  }
  return 0;
}

export function snsRujukLainIdx(indeks, kecualiId, idBarang) {
  const set = new Set();
  const m = indeks.rujuk.get(String(idBarang));
  if (m) {
    m.forEach((periodeArr, s) => {
      if (periodeArr.some((p) => p.trxId !== kecualiId)) set.add(s);
    });
  }
  return set;
}

export const getStatusClass = (status) =>
  ({
    Booking: "bg-amber-500 text-white",
    Disewa: "bg-blue-500 text-white",
    Mendekati: "bg-yellow-500 text-white",
    Telat: "bg-[#F04438] text-white",
    "Belum Selesai": "bg-indigo-500 text-white",
    Selesai: "bg-[#579171] text-white",
  })[status] || "bg-[var(--bg-subtle)] text-[var(--text-primary)]";

// Persentase member efektif: tier durasi (jika ada & durasi diketahui) menang;
// fallback ke diskon_persen fixed. Non-member / 0 → { persen: 0, sumber: null }.
export function persentaseMemberEfektif(memberObj, totalJam) {
  const aturan = Array.isArray(memberObj?.diskon_durasi_aturan)
    ? memberObj.diskon_durasi_aturan
    : [];
  if (aturan.length && Number(totalJam) > 0) {
    const cocok = aturan
      .filter(
        (r) =>
          Number(r?.min_hari) >= 1 &&
          Number(r?.persentase) > 0 &&
          totalJam >= Number(r.min_hari) * 24,
      )
      .sort((a, b) => Number(b.min_hari) - Number(a.min_hari))[0];
    if (cocok)
      return {
        persen: Math.min(100, Number(cocok.persentase)),
        sumber: `durasi ≥${cocok.min_hari} hari`,
      };
  }
  const fixed = Number(memberObj?.diskon_persen) || 0;
  return fixed > 0 ? { persen: fixed, sumber: "member" } : { persen: 0, sumber: null };
}
