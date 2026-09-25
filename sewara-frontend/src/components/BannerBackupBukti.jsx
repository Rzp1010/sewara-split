"use client";

import { useState, useEffect } from "react";
import { api } from "@/lib/api-client";
import { useNotify } from "@/components/NotificationProvider";

const BULAN_ID = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];

// "YYYY-MM" -> "September 2026"
function labelBulan(value) {
  const [y, m] = String(value || "").split("-");
  const idx = parseInt(m, 10) - 1;
  if (!y || idx < 0 || idx > 11) return value;
  return `${BULAN_ID[idx]} ${y}`;
}

// "YYYY-MM-15" -> "15 September 2026"
function labelTanggal(value) {
  const [y, m, d] = String(value || "").split("-");
  const idx = parseInt(m, 10) - 1;
  if (!y || idx < 0 || idx > 11) return value;
  return `${parseInt(d, 10)} ${BULAN_ID[idx]} ${y}`;
}

/**
 * Banner pengingat backup bukti bayar. Tampil HANYA saat backend bilang show.
 * Error fetch = diam (render null), tidak throw.
 */
export default function BannerBackupBukti() {
  const { notify } = useNotify();
  const [reminder, setReminder] = useState(null);
  const [sembunyi, setSembunyi] = useState(false);
  const [memproses, setMemproses] = useState(false);

  useEffect(() => {
    let aktif = true;
    // ?ujiBanner=1 di URL halaman = abaikan window tgl 8-15 (testing lokal).
    // ponytail: hapus override saat fitur stabil bila mau.
    const uji =
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("ujiBanner") === "1";
    api.pembayaran
      .reminder(uji ? { uji: 1 } : undefined)
      .then((data) => {
        if (aktif && data?.show) setReminder(data);
      })
      .catch(() => {
        /* endpoint belum siap / tidak ada window -> diam */
      });
    return () => {
      aktif = false;
    };
  }, []);

  if (!reminder || sembunyi) return null;

  async function tandaiSudah() {
    if (memproses) return;
    setMemproses(true);
    try {
      await api.pembayaran.reminderAck(reminder.bulan);
      setSembunyi(true);
    } catch (e) {
      notify(e.message || "Gagal menyimpan pengingat.", "error");
    } finally {
      setMemproses(false);
    }
  }

  return (
    <div className="rounded-xl border-2 border-solid border-amber-300 bg-amber-50 p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-amber-900 mb-1">
            Sudah backup bukti pembayaran?
          </p>
          <p className="text-sm text-amber-900 mb-0">
            Foto bukti pembayaran bulan {labelBulan(reminder.bulan)} akan
            terhapus otomatis pada {labelTanggal(reminder.purgeTanggal)}. Unduh
            dulu sebelum hilang.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={tandaiSudah}
            disabled={memproses}
            className="rounded-lg border-0 bg-gray-200 px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-gray-300 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Sudah Diunduh
          </button>
          <a
            href={`/dashboard/riwayat?ekspor=${encodeURIComponent(reminder.bulan)}`}
            className="rounded-lg bg-[#7181E0] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#5d6fcc]"
            style={{ textDecoration: "none" }}
          >
            Unduh Sekarang
          </a>
        </div>
      </div>
    </div>
  );
}
