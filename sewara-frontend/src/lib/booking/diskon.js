// Inti perhitungan diskon (murni — tanpa localStorage/browser).
// Dipakai halaman Booking (form & modal edit) dan bisa diuji lewat
// `node .uji/cek-diskon.mjs`.
import { persentaseMemberEfektif } from "./helpers.js";

/**
 * Hitung diskon member/promo/custom dari satu angka biaya.
 * Semua keadaan halaman dioper lewat `opsi` supaya tetap murni.
 * `promoKadaluarsa(promo, now)` dioper dari pemanggil (biasanya
 * `promoSudahKadaluarsa` di lib/db.js).
 */
export function hitungDiskonMurni(biaya, opsi = {}) {
  const {
    member = null,
    promo = null,
    totalJam = 0,
    aturanDiskon = {},
    pilihSatu = null,
    diskonCustomInput = "",
    diskonCustomTipe = "%",
    now = Date.now(),
    fiturMemberPromo = true,
    promoKadaluarsa = () => false,
  } = opsi;

  if (!fiturMemberPromo)
    return {
      diskonMember: 0,
      diskonPromo: 0,
      totalDiskon: 0,
      biayaAkhir: biaya,
      persenEfektif: 0,
      sumberDiskon: null,
    };

  const biayaNum = Number(biaya) || 0;
  const { stack, maksPersen, minTransaksi } = aturanDiskon;

  const { persen: persenEfektif, sumber: sumberDiskon } =
    persentaseMemberEfektif(member, totalJam);
  const memberAktif = member && member.status === "aktif" && persenEfektif > 0;
  const diskonMember = memberAktif
    ? Math.round((biayaNum * persenEfektif) / 100)
    : 0;

  let diskonPromo = 0;
  if (
    promo &&
    promo.status === "aktif" &&
    !promoKadaluarsa(promo, now) &&
    Number(promo.diskon_persen) > 0
  ) {
    const dari = promo.berlaku_dari
      ? new Date(promo.berlaku_dari).getTime()
      : null;
    const sampai = promo.berlaku_sampai
      ? new Date(promo.berlaku_sampai).getTime()
      : null;
    const masaBerlaku = (!dari || now >= dari) && (!sampai || now <= sampai);
    const kuotaOk =
      promo.kuota == null ||
      Number(promo.terpakai || 0) < Number(promo.kuota);
    const minOk = biayaNum >= (Number(minTransaksi) || 0);
    if (masaBerlaku && kuotaOk && minOk) {
      diskonPromo = Math.round(
        (biayaNum * Number(promo.diskon_persen)) / 100,
      );
    }
  }

  let totalDiskon;
  if (stack === "gabung") totalDiskon = diskonMember + diskonPromo;
  else if (stack === "satu") {
    // One discount mode: when no member exists, promo remains eligible.
    totalDiskon =
      memberAktif && pilihSatu !== "promo" ? diskonMember : diskonPromo;
  } else totalDiskon = Math.max(diskonMember, diskonPromo);

  const cap = Math.round((biayaNum * (Number(maksPersen) || 0)) / 100);
  totalDiskon = Math.min(totalDiskon, cap);
  const dasarDiskonCustom = Math.max(0, biayaNum - totalDiskon);
  const nilaiCustom =
    Number(String(diskonCustomInput).replace(/\D/g, "")) || 0;
  const diskonCustom =
    diskonCustomTipe === "%"
      ? Math.round((dasarDiskonCustom * Math.min(nilaiCustom, 100)) / 100)
      : Math.min(nilaiCustom, dasarDiskonCustom);
  totalDiskon += diskonCustom;
  const biayaAkhir = Math.max(0, biayaNum - totalDiskon);
  return {
    diskonMember,
    diskonPromo,
    diskonCustom,
    totalDiskon,
    biayaAkhir,
    persenEfektif,
    sumberDiskon,
  };
}
