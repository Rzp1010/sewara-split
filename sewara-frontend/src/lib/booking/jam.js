// Aturan jam operasional untuk pemilih waktu (dipakai halaman Booking dan
// modal edit transaksi yang bisa dipanggil dari halaman lain).
import { getSetting } from "@/lib/db";
import { batasAmbilMundur } from "@/lib/booking/helpers";

export const filterTime = (time) => {
  if (time.getTime() < batasAmbilMundur().getTime()) return false;
  const h = time.getHours();
  const mode = getSetting("jam_mode", "buka_tutup");
  if (mode !== "buka_tutup") return true;
  const buka = parseInt(getSetting("jam_buka", "6"), 10) || 6;
  const tutup = parseInt(getSetting("jam_tutup", "22"), 10) || 22;
  return h >= buka && h <= tutup;
};

// ponytail: bandingkan jam-kasar; window lintas tengah malam (tutup<buka) belum didukung, sama seperti filterTime.
export function lewatJamTutup(date) {
  if (!date) return false;
  if (getSetting("jam_mode", "buka_tutup") !== "buka_tutup") return false;
  const tutup = parseInt(getSetting("jam_tutup", "22"), 10) || 22;
  return new Date(date).getHours() > tutup;
}
