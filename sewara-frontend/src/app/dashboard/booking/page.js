"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { getInventory, getInventoryByIds, updateInventory, getTransactionsAktif, getTransactionsCari, getTransactionById, updateTransactions, tambahLogs, getNamaInvoice } from "@/lib/db";
import { useDebounce } from "use-debounce";
import dynamic from "next/dynamic";

import {
  formatTanggal,
  hitungPembayaran,
} from "@/lib/utils";
import { useNotify } from "@/components/NotificationProvider";
const InvoiceView = dynamic(() => import("@/components/InvoiceView"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center p-8">
      <div className="animate-spin"></div>
      <span className="text-[var(--text-secondary)]">Memuat invoice...</span>
    </div>
  ),
});
import LoadingOverlay from "@/components/LoadingOverlay";
import BatalBookingModal from "@/components/BatalBookingModal";
import FormBookingBaru from "@/components/booking/FormBookingBaru";
import ModalEditTransaksi from "@/components/booking/ModalEditTransaksi";

import {
  bangunIndeks,
  snsRujukLainIdx,
  getStatusClass,
} from "@/lib/booking/helpers";

export default function BookingPage() {
  const { notify, confirm, confirmChoice } = useNotify();
  const [inv, setInv] = useState([]);
  const [trx, setTrx] = useState([]);
  const [editModal, setEditModal] = useState(null);
  const [batalModal, setBatalModal] = useState(null); // transaksi yang akan dibatalkan
  const [cetakData, setCetakData] = useState(null);
  const [cariJadwal, setCariJadwal] = useState("");
  const [debouncedSearch] = useDebounce(cariJadwal, 300);
  const [hasilCariJadwal, setHasilCariJadwal] = useState([]);

  // Pencarian jadwal aktif (sidebar) — hasil dari backend, di-debounce 300ms.
  useEffect(() => {
    const q = debouncedSearch.trim();
    if (!q) {
      setHasilCariJadwal([]);
      return;
    }
    let aktif = true;
    (async () => {
      try {
        const hasil = await getTransactionsCari(q, false);
        if (aktif) setHasilCariJadwal(hasil || []);
      } catch (err) {
        console.error("[Booking] Search error:", err);
        if (aktif) setHasilCariJadwal([]);
      }
    })();
    return () => {
      aktif = false;
    };
  }, [debouncedSearch]);
  const [loading, setLoading] = useState("");
  // true selama simpan booking: muat() dan listener dataChanged menahan diri,
  // jadi satu indikator loading menutup simpan + muat ulang data.
  const sedangSimpan = useRef(false);
  const [isIndexing, setIsIndexing] = useState(false);






  const muat = useCallback(async () => {
    // Saat booking/faktur sedang disimpan, indikator milik pemanggil yang dipakai
    // supaya tidak muncul "Memuat data..." kedua setelah "Menyimpan booking...".
    if (!sedangSimpan.current) setLoading("Memuat data...");
    setIsIndexing(true);
    try {
      const [inventoryData, transactionData] = await Promise.all([
        getInventory(),
        getTransactionsAktif(),
      ]);
      setInv(inventoryData || []);
      setTrx(transactionData || []);
    } catch (err) {
      console.error("[Booking] Load error:", err);
      notify("Gagal memuat data booking", "error");
    } finally {
      setIsIndexing(false);
      if (!sedangSimpan.current) setLoading("");
    }
  }, [notify]);

  const refKolomKiri = useRef(null);
  const [tinggiJadwal, setTinggiJadwal] = useState(null);

  useEffect(() => {
    const hitung = () => {
      // Di layar kecil (<900px) kolom jadwal turun ke bawah — biarkan tinggi alami (tidak dikunci)
      if (window.innerWidth < 900) {
        setTinggiJadwal(null);
        return;
      }
      // scrollHeight = tinggi isi natural kolom form (bukan tinggi baris grid yang ikut stretch)
      if (refKolomKiri.current)
        setTinggiJadwal(refKolomKiri.current.scrollHeight);
    };
    hitung();
    window.addEventListener("resize", hitung);
    const h = () => setTimeout(hitung, 0);
    window.addEventListener("dataChanged", h);
    window.addEventListener("settingChanged", h);
    return () => {
      window.removeEventListener("resize", hitung);
      window.removeEventListener("dataChanged", h);
      window.removeEventListener("settingChanged", h);
    };
  }, []);


  // Daftar jadwal aktif sidebar — filter+sort per render mahal saat trx besar.
  const jadwalAktif = useMemo(() => {
    const daftarAktif = trx
      .filter(
        (t) =>
          t.status !== "Selesai" &&
          t.status !== "Dibatalkan" &&
          t.status !== "Belum Selesai",
      )
      .sort((a, b) =>
        (a.penyewa || "")
          .toLowerCase()
          .localeCompare((b.penyewa || "").toLowerCase()),
      );
    const isCari = cariJadwal.trim().length > 0;
    const query = cariJadwal.trim().toLowerCase();
    const tampil = isCari
      ? hasilCariJadwal
          .filter(
            (t) =>
              t.status !== "Selesai" &&
              t.status !== "Dibatalkan" &&
              t.status !== "Belum Selesai",
          )
          .sort((a, b) => {
            const aName = (a.penyewa || "").toLowerCase();
            const bName = (b.penyewa || "").toLowerCase();
            const aStarts = aName.startsWith(query);
            const bStarts = bName.startsWith(query);
            if (aStarts && !bStarts) return -1;
            if (!aStarts && bStarts) return 1;
            return aName.localeCompare(bName);
          })
          .slice(0, 50)
      : daftarAktif.slice(0, 50);
    const total = isCari ? tampil.length : daftarAktif.length;
    return { isCari, tampil, total };
  }, [trx, cariJadwal, hasilCariJadwal]);

  function bukaEditModal(t) {
    setEditModal(t);
  }

  async function batalkanBooking() {
    const t = editModal;
    if (!t) return;
    if (t.status === "Disewa")
      return notify(
        "Barang sudah diambil, tidak bisa dibatalkan. Gunakan Terima Kembali di board Status Sewa.",
        "error",
      );
    // Buka modal DP Hangus (bukan confirm browser)
    setBatalModal(t);
  }

  async function prosesBatalBooking({ dp_hangus, dp_hangus_aturan }) {
    const t = batalModal;
    if (!t) return;
    setBatalModal(null);
    setLoading("Membatalkan booking...");
    try {
      const idsInv = new Set();
      (t.items || []).forEach((item) => {
        idsInv.add(item.idBarang);
        (item.ref?.komponen || []).forEach((k) => idsInv.add(k.idBarang));
        (item.assignedSNs || []).forEach((a) => idsInv.add(a.idKomp));
      });
      const rawInv = await getInventoryByIds([...idsInv]);
      const trxAllSebelum = await getTransactionsAktif();
      let tempInv = JSON.parse(JSON.stringify(rawInv));
      const idx = bangunIndeks(trxAllSebelum, rawInv);
      const invDiubah = new Set();

      for (let item of t.items) {
        if (item.ref.jenis === "satuan") {
          let dbItem = tempInv.find((i) => i.id == item.idBarang);
          if (dbItem) {
            const rujuk = snsRujukLainIdx(idx, t.id, item.idBarang);
            let snList = (item.sn || "").split(", ").filter(Boolean);
            snList.forEach((s) => {
              if (!rujuk.has(s) && !dbItem.sns.includes(s)) dbItem.sns.push(s);
            });
            invDiubah.add(dbItem.id);
          }
        } else {
          for (let asn of item.assignedSNs || []) {
            let dbKomp = tempInv.find((i) => i.id == asn.idKomp);
            if (dbKomp) {
              const rujuk = snsRujukLainIdx(idx, t.id, asn.idKomp);
              asn.sns.forEach((s) => {
                if (!rujuk.has(s) && !dbKomp.sns.includes(s))
                  dbKomp.sns.push(s);
              });
              invDiubah.add(dbKomp.id);
            }
          }
        }
      }

      const namaPelayan = (await getNamaInvoice()) || "-";
      const log = {
        id: Date.now(),
        waktu: new Date().toISOString(),
        aktivitas: "Dibatalkan",
        detail: "-",
        catatan: "-",
        pelayan: namaPelayan,
        trx_info: `${t.penyewa} • ${t.no_invoice}`,
      };
      const trxBaru = {
        ...t,
        status: "Dibatalkan",
        waktu_kembali_aktual: new Date().toISOString(),
        dp_hangus: dp_hangus || 0,
        dp_hangus_aturan: dp_hangus_aturan || null,
        riwayatDilayani: [
          ...(t.riwayatDilayani || []),
          {
            aksi: "batalkan",
            nama: namaPelayan,
            tgl: new Date().toISOString(),
          },
        ],
      };
      const invUpdate = tempInv.filter((i) => invDiubah.has(i.id));
      if (!(await updateTransactions([trxBaru])))
        return notify("Gagal membatalkan booking. Silakan coba lagi.", "error");
      if (!(await updateInventory(invUpdate)))
        return notify(
          "Booking dibatalkan, tapi gagal mengembalikan stok. Cek inventaris!",
          "error",
        );
      if (!(await tambahLogs([log])))
        return notify("Booking dibatalkan, tapi gagal mencatat log.", "error");
      setEditModal(null);
      setRefresh((r) => r + 1);
      notify(`Booking ${t.no_invoice} dibatalkan.`);
    } finally {
      setLoading("");
    }
  }

  return (
    <div>
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <div ref={refKolomKiri} className="lg:col-span-3">
          <FormBookingBaru
            mode="page"
            daftarAktif={trx}
            katalog={inv}
            notify={notify}
            confirmChoice={confirmChoice}
            onSukses={() => setRefresh((r) => r + 1)}
          />
        </div>

        <div
          className="flex flex-col lg:col-span-2"
          style={{
            minHeight: 0,
            height: tinggiJadwal ? tinggiJadwal : undefined,
            overflow: "hidden",
          }}
        >
          <div
            className="bg-[var(--bg-surface)] border rounded-xl shadow-lg border-[var(--border-color)] border-2 p-0"
            style={{
              flex: 1,
              minHeight: 0,
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div className="flex items-center justify-between gap-2 px-4 py-3">
              <h3
                className="text-base font-semibold mb-0"
                style={{ fontSize: 18 }}
              >
                Jadwal Aktif
              </h3>
              <input
                value={cariJadwal}
                onChange={(e) => setCariJadwal(e.target.value)}
                placeholder="Cari penyewa..."
                className="appearance-none border-solid rounded-md block w-full px-3 py-2.5 text-[14px] outline-none transition-colors duration-200 border border-[var(--border-color)] bg-[var(--bg-surface)] text-[var(--text-primary)] focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20 disabled:cursor-not-allowed disabled:bg-[var(--bg-subtle)] disabled:opacity-60"
                style={{ maxWidth: 190 }}
              />
            </div>
            <div
              style={{
                flex: 1,
                minHeight: 0,
                overflowY: "auto",
                padding: 12,
              }}
            >
              {(() => {
                const { isCari, tampil, total } = jadwalAktif;
                if (total === 0) {
                  return (
                    <div
                      className="text-center text-13 text-[var(--text-secondary)]"
                      style={{ padding: "24px 0", fontStyle: "italic" }}
                    >
                      Tidak ada jadwal aktif.
                    </div>
                  );
                }
                return (
                  <>
                    {tampil.map((t) => (
                      <div
                        key={t.id}
                        className="bg-[var(--bg-surface)] border-2 border-solid border-[var(--border-color)] rounded-xl shadow-sm p-4 mb-2 hover:border-[var(--border-color)] transition-colors"
                        style={{ cursor: "pointer" }}
                      >
                        <div
                          className="flex items-center justify-between mb-2 gap-2"
                          style={{ alignItems: "flex-start" }}
                        >
                          <div>
                            <p
                              className="text-[var(--text-secondary)] mb-0"
                              style={{
                                fontFamily: "ui-monospace, monospace",
                                fontSize: 10,
                              }}
                            >
                              {t.no_invoice}
                            </p>
                            <p className="font-bold mb-0">{t.penyewa}</p>
                            <p className="text-xs text-[var(--text-secondary)] mb-0">
                              Hp : {t.hp_penyewa || "-"}
                            </p>
                          </div>
                          <span
                            className={`inline-block px-2 py-1 rounded text-xs ${getStatusClass(t.status)}`}
                          >
                            {t.status}
                          </span>
                        </div>
                        <div
                          className="flex flex-col gap-1 text-xs text-[var(--text-secondary)] mb-2"
                          style={{ lineHeight: 1.6 }}
                        >
                          {(t.items || []).map((i, idx) => (
                            <div
                              key={idx}
                              style={{
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                              }}
                            >
                              • {i.qty}x {i.ref.nama}{" "}
                              {i.ref.jenis === "satuan" ? `[${i.sn}]` : ""}
                            </div>
                          ))}
                        </div>
                        <div className="text-xs text-[var(--text-secondary)] mb-3">
                          <span className="text-[#7181E0]">
                            Ambil: {formatTanggal(t.waktu_ambil_rencana)}
                          </span>
                          <span style={{ margin: "0 4px" }}>→</span>
                          <span className="text-danger">
                            Kembali: {formatTanggal(t.waktu_kembali_rencana)}
                          </span>
                          <br />
                          <span
                            style={{
                              background: "#f8fafc",
                              borderRadius: 6,
                              padding: "0 4px",
                            }}
                          >
                            {t.durasi_teks}
                          </span>
                        </div>
                        {(() => {
                          const pay = hitungPembayaran(t);
                          const cls =
                            pay.status === "Lunas"
                              ? "bg-[#579171] text-white"
                              : pay.status === "DP"
                                ? "bg-blue-500 text-white"
                                : "bg-[#F04438] text-white";
                          return (
                            <span
                              className={`inline-block px-2 py-1 rounded text-xs ${cls}`}
                            >
                              {pay.status}
                              {pay.status === "Belum Bayar"
                                ? " / Belum DP"
                                : ""}
                            </span>
                          );
                        })()}
                        <div className="flex items-center gap-2 mt-3">
                          <button
                            type="button"
                            onClick={() => bukaEditModal(t)}
                            className="flex-1 px-3 py-2 rounded-md text-sm font-medium bg-[#7181E0]/10 text-[#7181E0] hover:bg-[#7181E0]/20 transition-colors border-0"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              const penuh = await getTransactionById(t.id);
                              if (penuh) setCetakData(penuh);
                            }}
                            className="flex-1 px-3 py-2 rounded-md text-sm font-medium bg-[#7181E0]/10 text-[#7181E0] hover:bg-[#7181E0]/20 transition-colors border-0"
                          >
                            Invoice
                          </button>
                        </div>
                      </div>
                    ))}
                    {!isCari && total > 50 && (
                      <div
                        className="text-center text-xs font-semibold text-[var(--text-secondary)]"
                        style={{
                          background: "#f8fafc",
                          padding: 12,
                          borderRadius: 12,
                          marginTop: 8,
                        }}
                      >
                        +{total - 50} jadwal lainnya — gunakan pencarian di atas
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
          </div>
        </div>
      </div>

      {editModal && (
        <ModalEditTransaksi
          key={editModal.id}
          trx={editModal}
          invAwal={inv}
          trxAwal={trx}
          loading={loading}
          setLoading={setLoading}
          onClose={() => setEditModal(null)}
          onSaved={() => setRefresh((r) => r + 1)}
          onBatalkan={batalkanBooking}
        />
      )}

      {cetakData && (
        <InvoiceView data={cetakData} onClose={() => setCetakData(null)} />
      )}
      {batalModal && (
        <BatalBookingModal
          transaction={batalModal}
          onConfirm={prosesBatalBooking}
          onClose={() => setBatalModal(null)}
        />
      )}
      {loading && (
        <LoadingOverlay
          teks={loading}
          subteks="Mohon tunggu, jangan tutup halaman ini..."
        />
      )}
    </div>
  );
}
