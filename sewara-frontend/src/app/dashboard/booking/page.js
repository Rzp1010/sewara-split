"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { getSetting, getSettingTenant, getStok, promoSudahKadaluarsa, getInventory, getInventoryByIds, updateInventory, getTransactionsAktif, getTransactionsCari, getTransactionById, updateTransactions, tambahTransactions, getLastDbError, getPromoCodes, validasiPromo, pakaiPromo, tambahLogs, getNamaInvoice, buatIDUnik, getPelangganSuggestions, uploadBuktiBayar } from "@/lib/db";
import { useDebounce } from "use-debounce";
import { createPortal } from "react-dom";
import dynamic from "next/dynamic";

import { api } from "@/lib/api-client";
import {
  formatAngkaInput,
  formatRupiah,
  formatTanggal,
  hitungDurasi,
  hitungPembayaran,
  kondisiUnit,
  catatanUnit,
} from "@/lib/utils";
import { getFITUR } from "@/lib/features";
import { useNotify } from "@/components/NotificationProvider";
import BuktiDropzone from "@/components/BuktiDropzone";
import SearchableSelect from "@/components/SearchableSelect";
const InvoiceView = dynamic(() => import("@/components/InvoiceView"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center p-8">
      <div className="animate-spin"></div>
      <span className="text-gray-500">Memuat invoice...</span>
    </div>
  ),
});
import DateTimePicker from "@/components/DateTimePicker";
import LoadingOverlay from "@/components/LoadingOverlay";
import BatalBookingModal from "@/components/BatalBookingModal";

const OPSI_JAMINAN = [
  { value: "E-KTP", label: "E-KTP" },
  { value: "SIM", label: "SIM" },
  { value: "Tanpa Jaminan", label: "Tanpa Jaminan" },
];

function bangunIndeks(trx, inv) {
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

function snsTerpakaiIdx(indeks, idBarang, mulaiISO, selesaiISO, kecualiId) {
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

function snsBebasIdx(indeks, idBarang, mulaiISO, selesaiISO, kecualiId) {
  const invItem = indeks.invMap.get(String(idBarang));
  const owned = new Set(invItem?.sns || []);
  const set = indeks.terpakaiSemua.get(String(idBarang));
  if (set) set.forEach((s) => owned.add(s));
  snsTerpakaiIdx(indeks, idBarang, mulaiISO, selesaiISO, kecualiId).forEach(
    (s) => owned.delete(s),
  );
  return [...owned];
}

function hitungStokIdx(indeks, item, mulaiISO, selesaiISO, kecualiId) {
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

function snsRujukLainIdx(indeks, kecualiId, idBarang) {
  const set = new Set();
  const m = indeks.rujuk.get(String(idBarang));
  if (m) {
    m.forEach((periodeArr, s) => {
      if (periodeArr.some((p) => p.trxId !== kecualiId)) set.add(s);
    });
  }
  return set;
}

const getStatusClass = (status) =>
  ({
    Booking: "bg-amber-500 text-white",
    Disewa: "bg-blue-500 text-white",
    Mendekati: "bg-yellow-500 text-white",
    Telat: "bg-[#F04438] text-white",
    "Belum Selesai": "bg-indigo-500 text-white",
    Selesai: "bg-[#579171] text-white",
  })[status] || "bg-gray-500 text-white";

// Persentase member efektif: tier durasi (jika ada & durasi diketahui) menang;
// fallback ke diskon_persen fixed. Non-member / 0 → { persen: 0, sumber: null }.
function persentaseMemberEfektif(memberObj, totalJam) {
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


export default function BookingPage() {
  const { notify, confirm, confirmChoice } = useNotify();
  const [inv, setInv] = useState([]);
  const [trx, setTrx] = useState([]);
  const [cart, setCart] = useState([]);
  const [kalkulasi, setKalkulasi] = useState({
    error: "Pilih waktu",
    biaya: 0,
    durasi_teks: "-",
  });
  const [refresh, setRefresh] = useState(0);
  const [ambilWaktu, setAmbilWaktu] = useState(null);
  const [kembaliWaktu, setKembaliWaktu] = useState(null);
  const [showCustom, setShowCustom] = useState(false);
  const [selectedDurasi, setSelectedDurasi] = useState(null);
  const [selectedProductId, setSelectedProductId] = useState("");
  const [editModal, setEditModal] = useState(null);
  const [batalModal, setBatalModal] = useState(null); // transaksi yang akan dibatalkan
  const [cetakData, setCetakData] = useState(null);
  const [editForm, setEditForm] = useState({
    penyewa: "",
    hp_penyewa: "",
    alamat_penyewa: "",
    jaminan_sewa: "",
    waktu_ambil_rencana: null,
    waktu_kembali_rencana: null,
  });
  const [editItems, setEditItems] = useState([]);
  const [editSelectedId, setEditSelectedId] = useState("");
  const [dpJumlah, setDpJumlah] = useState("");
  const [dpMetode, setDpMetode] = useState("Tunai");
  const [buktiFile, setBuktiFile] = useState(null);
  const [printilanTerpilih, setPrintilanTerpilih] = useState([]);
  const [printilanCustom, setPrintilanCustom] = useState("");
  const [printilanDaftar, setPrintilanDaftar] = useState([]);
  const [printilanMode, setPrintilanMode] = useState("dicentang");
  const [cariJadwal, setCariJadwal] = useState("");
  const [debouncedSearch] = useDebounce(cariJadwal, 300);
  const [hasilCariJadwal, setHasilCariJadwal] = useState([]);
  const [loading, setLoading] = useState("");
  const [isIndexing, setIsIndexing] = useState(false);
  const [jaminanDipilih, setJaminanDipilih] = useState("E-KTP");
  const [snOptions, setSnOptions] = useState([]);
  const [snDipilih, setSnDipilih] = useState("");
  const [editSnOptions, setEditSnOptions] = useState([]);
  const [editSnDipilih, setEditSnDipilih] = useState("");
  const [showEditSn, setShowEditSn] = useState(false);
  const cartRef = useRef(cart);
  const hitungTotalRef = useRef(null);
  const prefillTerpakai = useRef(false);

  const [daftarMember, setDaftarMember] = useState([]);
  const [memberDipilih, setMemberDipilih] = useState(null);
  const [daftarPromo, setDaftarPromo] = useState([]);
  const [kodePromoInput, setKodePromoInput] = useState("");
  const [diskonCustomInput, setDiskonCustomInput] = useState("");
  const [diskonCustomTipe, setDiskonCustomTipe] = useState("%");
  const [showPromoDiskon, setShowPromoDiskon] = useState(false);
  const [promoDipilih, setPromoDipilih] = useState(null);
  const [pilihSatu, setPilihSatu] = useState(null);
  const [aturanDiskon, setAturanDiskon] = useState({
    stack: "terbesar",
    maksPersen: 50,
    minTransaksi: 0,
  });
  const [kini, setKini] = useState(0);

  // Identitas penyewa (controlled) + autocomplete member
  const [namaPenyewa, setNamaPenyewa] = useState("");
  const [hp_penyewa, setHpPenyewa] = useState("");
  const [alamat_penyewa, setAlamatPenyewa] = useState("");
  const [saranMember, setSaranMember] = useState([]);
  const [showSaran, setShowSaran] = useState(false);

  useEffect(() => {
    const perbarui = () => {
      setKini(Date.now());
    };
    perbarui();
    const t = setInterval(perbarui, 60000);
    window.addEventListener("dataChanged", perbarui);
    window.addEventListener("settingChanged", perbarui);
    return () => {
      clearInterval(t);
      window.removeEventListener("dataChanged", perbarui);
      window.removeEventListener("settingChanged", perbarui);
    };
  }, []);

  useEffect(() => {
    cartRef.current = cart;
  }, [cart]);

  useEffect(() => {
    if (!getFITUR().memberPromo) return;
    (async () => {
      const [members, promos, stack, maks, min] = await Promise.all([
        getPelangganSuggestions(),
        getPromoCodes(),
        getSettingTenant("diskon_stack", "terbesar"),
        getSettingTenant("diskon_maks_persen", 50),
        getSettingTenant("promo_min_transaksi", 0),
      ]);
      setDaftarMember(members || []);
      setDaftarPromo(promos || []);
      setAturanDiskon({
        stack,
        maksPersen: Number(maks) || 0,
        minTransaksi: Number(min) || 0,
      });
    })();
  }, []);

  useEffect(() => {
    let aktif = true;
    (async () => {
      try {
        const [daftar, mode] = await Promise.all([
          getSettingTenant("printilan_daftar", []),
          getSettingTenant("printilan_invoice_mode", "dicentang"),
        ]);
        if (!aktif) return;
        setPrintilanDaftar(Array.isArray(daftar) ? daftar : []);
        setPrintilanMode(mode || "dicentang");
      } catch { /* ignore - printilan optional */ }
    })();
    return () => { aktif = false; };
  }, []);

  const muat = useCallback(async () => {
    setLoading("Memuat data...");
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
      setLoading("");
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

  const indeks = useMemo(() => bangunIndeks(trx, inv), [trx, inv]);

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

  function snsBebasCepat(idBarang, mulaiISO, selesaiISO, kecualiId) {
    return snsBebasIdx(indeks, idBarang, mulaiISO, selesaiISO, kecualiId);
  }

  function hitungStokBebas(item, mulaiISO, selesaiISO, kecualiId) {
    return hitungStokIdx(indeks, item, mulaiISO, selesaiISO, kecualiId);
  }

  const mulaiISO = ambilWaktu ? new Date(ambilWaktu).toISOString() : "";
  const selesaiISO = kembaliWaktu ? new Date(kembaliWaktu).toISOString() : "";
  const pakaiPeriode = Boolean(mulaiISO && selesaiISO);

  /**
   * Memoized stock calculation cache.
   * Computes stock once per item and recalculates when relevant data changes.
   */
  const stockCache = useMemo(() => {
    const cache = {};
    inv.forEach((item) => {
      cache[item.id] = pakaiPeriode
        ? hitungStokBebas(item, mulaiISO, selesaiISO)
        : getStok(item, inv);
    });
    return cache;
  }, [inv, trx, indeks, pakaiPeriode, mulaiISO, selesaiISO]);

  /**
   * Get cached stock or compute missing item on demand.
   * @param {Object} item Inventory item
   * @returns {number} Stock quantity
   */
  const getCachedStock = useCallback(
    (item) => {
      if (!item || !item.id) return 0;
      if (stockCache[item.id] !== undefined) return stockCache[item.id];
      return pakaiPeriode
        ? hitungStokBebas(item, mulaiISO, selesaiISO)
        : getStok(item, inv);
    },
    [stockCache, pakaiPeriode, mulaiISO, selesaiISO, inv, indeks],
  );

  const opsiKatalog = useMemo(() => {
    const options = [];
    ["satuan", "bundling"].forEach((jenis) => {
      const label = jenis === "satuan" ? "Alat Satuan" : "Paket Bundling";
      const items = inv.filter((i) => i.jenis === jenis);
      const tersedia = items.filter((i) => getCachedStock(i) > 0);
      const habis = items.filter((i) => getCachedStock(i) < 1);
      tersedia.forEach((item) => {
        options.push({
          value: String(item.id),
          label: item.nama,
          badge: `Stok ${getCachedStock(item)}`,
          tag: (item.tag || "").trim(),
          group: `${label} · ${(item.tag || "").trim() || "Tanpa Tag"}`,
        });
      });
      habis.forEach((item) => {
        options.push({
          value: String(item.id),
          label: item.nama,
          badge: "Habis",
          tag: (item.tag || "").trim(),
          group: `${label} · ${(item.tag || "").trim() || "Tanpa Tag"}`,
          disabled: true,
        });
      });
    });
    return options;
  }, [inv, getCachedStock]);

  const opsiEdit = useMemo(() => {
    const mulaiE = editForm.waktu_ambil_rencana
      ? new Date(editForm.waktu_ambil_rencana).toISOString()
      : "";
    const selesaiE = editForm.waktu_kembali_rencana
      ? new Date(editForm.waktu_kembali_rencana).toISOString()
      : "";
    const pakaiPeriodeE = Boolean(mulaiE && selesaiE);
    const opts = [];
    const stockCacheEdit = new Map(
      inv.map((item) => [
        item.id,
        pakaiPeriodeE
          ? hitungStokBebas(item, mulaiE, selesaiE, editModal?.id)
          : getStok(item, inv),
      ]),
    );
    const getEditStock = (item) => stockCacheEdit.get(item.id) ?? 0;
    ["satuan", "bundling"].forEach((jenis) => {
      const label = jenis === "satuan" ? "Alat Satuan" : "Paket Bundling";
      const items = inv.filter((i) => i.jenis === jenis);
      const tersedia = items.filter((i) => getEditStock(i) > 0);
      const habis = items.filter((i) => getEditStock(i) < 1);
      tersedia.forEach((item) => {
        opts.push({
          value: String(item.id),
          label: item.nama,
          badge: `Stok ${getEditStock(item)}`,
          tag: (item.tag || "").trim(),
          group: `${label} · ${(item.tag || "").trim() || "Tanpa Tag"}`,
        });
      });
      habis.forEach((item) => {
        opts.push({
          value: String(item.id),
          label: item.nama,
          badge: "Habis",
          tag: (item.tag || "").trim(),
          group: `${label} · ${(item.tag || "").trim() || "Tanpa Tag"}`,
          disabled: true,
        });
      });
    });
    return opts;
  }, [
    inv,
    indeks,
    editForm.waktu_ambil_rencana,
    editForm.waktu_kembali_rencana,
    editModal?.id,
  ]);

  function snsTerpakaiCepat(idBarang, mulaiISO, selesaiISO, kecualiId) {
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

  useEffect(() => {
    (async () => {
      await muat();
      // Prefill dari Tracking Alat (handoff gantt → booking). Ref items sudah
      // menyimpan objek inventory utuh, jadi tidak butuh tunggu inv dimuat.
      if (typeof window === "undefined" || prefillTerpakai.current) return;
      prefillTerpakai.current = true;
      try {
        const raw = sessionStorage.getItem("rentalpro_booking_prefill");
        if (!raw) return;
        sessionStorage.removeItem("rentalpro_booking_prefill");
        const data = JSON.parse(raw);
        const ambilISO =
          typeof data?.ambilISO === "string" ? data.ambilISO : "";
        const kembaliISO =
          typeof data?.kembaliISO === "string" ? data.kembaliISO : "";
        const items = Array.isArray(data?.items) ? data.items : [];
        const a = new Date(ambilISO);
        const k = new Date(kembaliISO);
        if (
          !ambilISO ||
          !kembaliISO ||
          items.length === 0 ||
          Number.isNaN(a.getTime()) ||
          Number.isNaN(k.getTime())
        )
          return;
        setAmbilWaktu(a);
        setKembaliWaktu(k);
        setShowCustom(true);
        cartRef.current = items;
        if (hitungTotalRef.current)
          hitungTotalRef.current(items, ambilISO, kembaliISO);
      } catch (e) {
        notify("Prefill booking gagal dibaca: " + e.message, "error");
      }
    })();
  }, [muat, refresh]);

  useEffect(() => {
    const handler = () => setRefresh((r) => r + 1);
    window.addEventListener("dataChanged", handler);
    return () => window.removeEventListener("dataChanged", handler);
  }, []);

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

  function parseISO(iso) {
    if (!iso) return "";
    return new Date(iso).toISOString().slice(0, 16);
  }

  function hitungDiskon(biaya, memberOverride, promoOverride, nowOverride, durasiOverride) {
    if (!getFITUR().memberPromo)
      return {
        diskonMember: 0,
        diskonPromo: 0,
        totalDiskon: 0,
        biayaAkhir: biaya,
        persenEfektif: 0,
        sumberDiskon: null,
      };
    const biayaNum = Number(biaya) || 0;
    const member =
      memberOverride !== undefined ? memberOverride : memberDipilih;
    const promo = promoOverride !== undefined ? promoOverride : promoDipilih;
    const { stack, maksPersen, minTransaksi } = aturanDiskon;
    const totalJam =
      durasiOverride !== undefined ? durasiOverride : kalkulasi.totalJam;

    const { persen: persenEfektif, sumber: sumberDiskon } =
      persentaseMemberEfektif(member, totalJam);
    const memberAktif =
      member && member.status === "aktif" && persenEfektif > 0;
    const diskonMember = memberAktif
      ? Math.round((biayaNum * persenEfektif) / 100)
      : 0;

    let diskonPromo = 0;
    if (
      promo &&
      promo.status === "aktif" &&
      !promoSudahKadaluarsa(
        promo,
        nowOverride !== undefined ? nowOverride : kini,
      ) &&
      Number(promo.diskon_persen) > 0
    ) {
      const now = nowOverride !== undefined ? nowOverride : kini;
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

  async function terapkanPromo() {
    const kode = kodePromoInput.trim().toUpperCase();
    if (!kode) return notify("Masukkan kode promo dulu!", "error");
    const promo = daftarPromo.find(
      (p) => String(p.kode || "").toUpperCase() === kode,
    );
    if (!promo)
      return notify(
        "Kode promo tidak valid atau sudah tidak berlaku.",
        "error",
      );
    const now = Date.now();
    const serverValidation = await validasiPromo(promo.id);
    if (!serverValidation.ok)
      return notify(
        "Kode promo tidak valid atau sudah tidak berlaku.",
        "error",
      );
    const dari = promo.berlaku_dari
      ? new Date(promo.berlaku_dari).getTime()
      : null;
    const sampai = promo.berlaku_sampai
      ? new Date(promo.berlaku_sampai).getTime()
      : null;
    const masaBerlaku = (!dari || now >= dari) && (!sampai || now <= sampai);
    const kuotaOk =
      promo.kuota == null || Number(promo.terpakai || 0) < Number(promo.kuota);
    const minOk =
      (kalkulasi.biaya || 0) >= (Number(aturanDiskon.minTransaksi) || 0);
    if (promo.status !== "aktif" || !masaBerlaku || !kuotaOk || !minOk) {
      return notify(
        "Kode promo tidak valid atau sudah tidak berlaku.",
        "error",
      );
    }
    setPromoDipilih(promo);
    setPilihSatu(null);
    notify(`Kode promo ${promo.kode} diterapkan!`);
  }

  function hitungTotal(daftar, ambilOverride, kembaliOverride) {
    const ambil =
      ambilOverride || (ambilWaktu ? new Date(ambilWaktu).toISOString() : "");
    const kembali =
      kembaliOverride ||
      (kembaliWaktu ? new Date(kembaliWaktu).toISOString() : "");
    const dur = hitungDurasi(ambil, kembali);
    let totalBiaya = 0;

    setCart(daftar);

    if (dur.error) {
      setKalkulasi({ error: dur.error, biaya: 0, durasi_teks: dur.error });
      return;
    }

    const updated = daftar.map((item) => {
      let sub = 0;
      if (item.ref.tipeSewa === "harian") {
        let hp = dur.hari + (dur.sisaJam > 0 ? 1 : 0);
        if (hp === 0 && dur.totalJam > 0) hp = 1;
        sub = hp * item.ref.h24;
      } else {
        sub = dur.hari * item.ref.h24;
        if (dur.hari >= 1 && dur.sisaJam > 0) {
          // Durasi >= 1 hari: apply 50% threshold
          if (dur.sisaJam <= 12) sub += item.ref.h24 * 0.5;
          else sub += item.ref.h24;
        } else if (dur.hari === 0 && dur.sisaJam > 0) {
          // Durasi < 1 hari: use standard rates
          if (dur.sisaJam <= 6) sub += item.ref.h6;
          else if (dur.sisaJam <= 12) sub += item.ref.h12;
          else sub += item.ref.h24;
        }
      }
      item.hargaSatuan = sub;
      item.subtotal = sub * item.qty;
      totalBiaya += item.subtotal;
      return item;
    });
    setCart(updated);
    setKalkulasi({
      error: null,
      biaya: totalBiaya,
      durasi_teks: dur.durasi_teks,
      totalJam: dur.totalJam,
    });
  }

  useEffect(() => {
    hitungTotalRef.current = hitungTotal;
  });

  useEffect(() => {
    if (!ambilWaktu || !kembaliWaktu) return;
    const ambilISO = new Date(ambilWaktu).toISOString();
    const kembaliISO = new Date(kembaliWaktu).toISOString();
    const dur = hitungDurasi(ambilISO, kembaliISO);
    if (!dur.error) {
      setKalkulasi((sebelumnya) => ({
        ...sebelumnya,
        durasi_teks: dur.durasi_teks,
        totalJam: dur.totalJam,
      }));
      if (cart.length > 0) hitungTotal(cart, ambilISO, kembaliISO);
    }
  }, [ambilWaktu, kembaliWaktu, cart.length]);

  const durasiCepat = [
    { label: "6 Jam", jam: 6 },
    { label: "12 Jam", jam: 12 },
    { label: "24 Jam", jam: 24 },
    { label: "3 Hari", jam: 72 },
    { label: "7 Hari", jam: 168 },
  ];

  function isiDurasi(jam) {
    if (!ambilWaktu) return notify("Isi waktu ambil dulu!", "error");
    setShowCustom(false);
    setSelectedDurasi(jam);
    const k = new Date(ambilWaktu.getTime() + jam * 3600000);
    setKembaliWaktu(k);
    const ambilISO = new Date(ambilWaktu).toISOString();
    const kembaliISO = k.toISOString();
    hitungTotal(cartRef.current, ambilISO, kembaliISO);
    revalidasiKeranjang(ambilISO, kembaliISO);
  }

  function pilihCustom() {
    if (!ambilWaktu) return notify("Isi waktu ambil dulu!", "error");
    setShowCustom(true);
    setSelectedDurasi(null);
    if (!kembaliWaktu) {
      const k = new Date(ambilWaktu.getTime() + 3600000);
      setKembaliWaktu(k);
      const ambilISO = new Date(ambilWaktu).toISOString();
      const kembaliISO = k.toISOString();
      hitungTotal(cartRef.current, ambilISO, kembaliISO);
      revalidasiKeranjang(ambilISO, kembaliISO);
    }
  }

  function gantiAmbil(waktu) {
    setAmbilWaktu(waktu);
    setSelectedDurasi(null);
    setShowCustom(false);
    setKembaliWaktu(null);
    const ambilISO = waktu ? new Date(waktu).toISOString() : "";
    setTimeout(() => hitungTotal(cartRef.current, ambilISO, ""), 0);
  }

  function gantiKembali(waktu) {
    setKembaliWaktu(waktu);
    setShowCustom(true);
    setSelectedDurasi(null);
    /* Override ISO eksplisit: state kembaliWaktu belum ke-update di closure ini.
       Tanpa override, hitungTotal pakai nilai lama → harga custom gak refresh. */
    const ambilISO = ambilWaktu ? new Date(ambilWaktu).toISOString() : "";
    const kembaliISO = waktu ? new Date(waktu).toISOString() : "";
    setTimeout(() => {
      hitungTotal(cartRef.current, ambilISO, kembaliISO);
      revalidasiKeranjang(ambilISO, kembaliISO);
    }, 0);
  }

  function pilihKatalog(id) {
    if (!id) return;
    const item = inv.find((i) => i.id == id);
    if (!item) return;
    if (item.jenis === "satuan") {
      const snDiCart = cartRef.current
        .filter((c) => c.idBarang == item.id)
        .flatMap((c) => (c.sn || "").split(", "));
      const mulaiISO = ambilWaktu ? new Date(ambilWaktu).toISOString() : "";
      const selesaiISO = kembaliWaktu
        ? new Date(kembaliWaktu).toISOString()
        : "";
      const snBebas =
        mulaiISO && selesaiISO
          ? snsBebasIdx(indeks, item.id, mulaiISO, selesaiISO)
          : [...(item.sns || [])];
      // Maintenance tak boleh disewa; sembunyikan dari opsi (server tetap otoritatif).
      const snTersedia = snBebas.filter(
        (s) => !snDiCart.includes(s) && kondisiUnit(item, s) !== "maintenance",
      );
      if (snTersedia.length === 0) {
        setSnOptions([]);
        setSnDipilih("");
      } else {
        const opts = [];
        snTersedia.forEach((s) => {
          const catatan = catatanUnit(item, s);
          const bermasalah = kondisiUnit(item, s) === "bermasalah";
          opts.push({
            value: s,
            label: `S/N: ${s}${bermasalah ? " ⚠ Bermasalah" : ""}`,
            title: catatan || undefined,
          });
        });
        if (!mulaiISO || !selesaiISO)
          opts.push({
            value: "",
            label: "Ketersediaan per tanggal: isi waktu ambil/kembali dulu",
            disabled: true,
          });
        setSnOptions(opts);
        setSnDipilih(snTersedia[0]); // auto-pilih S/N paling awal
      }
    } else {
      setSnDipilih("");
      setSnOptions([]);
    }
  }

  function tambahKeKeranjang() {
    const idBarang = selectedProductId;
    if (!idBarang) return;
    const refBarang = inv.find((i) => i.id == idBarang);
    if (!refBarang) return;
    const c = [...cartRef.current];
    const mulaiISO = ambilWaktu ? new Date(ambilWaktu).toISOString() : "";
    const selesaiISO = kembaliWaktu ? new Date(kembaliWaktu).toISOString() : "";

    if (refBarang.jenis === "satuan") {
      const sn = snDipilih;
      if (!sn) return notify("Pilih Nomor Seri!", "error");
      if (!mulaiISO || !selesaiISO)
        return notify("Isi waktu ambil & kembali dulu!", "error");
      const terpakai = snsTerpakaiIdx(indeks, idBarang, mulaiISO, selesaiISO);
      if (terpakai.includes(sn))
        return notify("S/N sudah di-booking pada periode tersebut!", "error");
      const exist = c.find((x) => x.idBarang == idBarang);
      if (exist) {
        if (exist.sn.split(", ").includes(sn))
          return notify("S/N sudah ada di keranjang!", "error");
        exist.sn += ", " + sn;
        exist.qty += 1;
      } else {
        c.push({ idBarang, ref: refBarang, qty: 1, sn, subtotal: 0 });
      }
    } else {
      const stok = getCachedStock(refBarang);
      const qty = 1;
      if (qty < 1 || qty > stok)
        return notify("Stok paket tidak mencukupi!", "error");
      const exist = c.find((ci) => ci.idBarang == idBarang);
      if (exist) {
        if (exist.qty + qty > stok)
          return notify("Melebihi batas stok!", "error");
        exist.qty += qty;
      } else {
        c.push({ idBarang, ref: refBarang, qty, subtotal: 0 });
      }
    }
    hitungTotal(c);
    // Refresh pilihan: produk & S/N kembali kosong utk input berikutnya
    setSelectedProductId("");
    setSnDipilih("");
    setSnOptions([]);
  }

  function hapusDariKeranjang(idx) {
    const c = [...cartRef.current];
    c.splice(idx, 1);
    hitungTotal(c);
  }

  function revalidasiKeranjang(mulaiISO, selesaiISO) {
    if (!mulaiISO || !selesaiISO) return;
    const c = [...cartRef.current];
    const hasil = [];
    let berubah = false;
    c.forEach((item) => {
      if (item.ref.jenis === "satuan") {
        const terpakai = snsTerpakaiCepat(item.idBarang, mulaiISO, selesaiISO);
        const snsBaru = item.sn
          .split(", ")
          .filter((s) => !terpakai.includes(s));
        if (snsBaru.length !== item.sn.split(", ").length) berubah = true;
        if (snsBaru.length > 0)
          hasil.push({ ...item, sn: snsBaru.join(", "), qty: snsBaru.length });
      } else {
        const stok = hitungStokBebas(item.ref, mulaiISO, selesaiISO);
        const qtyBaru = Math.min(item.qty, stok);
        if (qtyBaru !== item.qty) berubah = true;
        if (qtyBaru > 0) hasil.push({ ...item, qty: qtyBaru });
      }
    });
    if (berubah) {
      notify(
        "Waktu diganti: barang yang bertabrakan di periode baru dihapus/disesuaikan.",
        "error",
      );
      hitungTotal(hasil);
    } else {
      hitungTotal(c);
    }
  }

  // ---- Autocomplete member di kolom nama penyewa ----
  function gantiNamaPenyewa(v) {
    setNamaPenyewa(v);
    // Jika nama diubah dan tidak lagi cocok dengan member terpilih, lepas member.
    if (
      memberDipilih &&
      v.trim().toLowerCase() !== memberDipilih.nama.trim().toLowerCase()
    ) {
      setMemberDipilih(null);
      setPilihSatu(null);
    }
    if (!getFITUR().memberPromo) return;
    const q = v.trim().toLowerCase();
    if (!q) {
      setSaranMember([]);
      setShowSaran(false);
      return;
    }
    const cocok = daftarMember
      .filter(
        (m) =>
          (m.sumber === "history" || m.status === "aktif") &&
          m.nama &&
          m.nama.toLowerCase().includes(q),
      )
      .sort((a, b) => {
        const aName = a.nama.toLowerCase();
        const bName = b.nama.toLowerCase();
        const aStarts = aName.startsWith(q);
        const bStarts = bName.startsWith(q);
        if (aStarts && !bStarts) return -1;
        if (!aStarts && bStarts) return 1;
        return aName.localeCompare(bName);
      })
      .slice(0, 8);
    setSaranMember(cocok);
    setShowSaran(cocok.length > 0);
  }

  function pilihMemberSaran(m) {
    setNamaPenyewa(m.nama || "");
    setHpPenyewa(m.hp || "");
    setAlamatPenyewa(m.alamat || "");
    setMemberDipilih(m);
    setPilihSatu(null);
    setSaranMember([]);
    setShowSaran(false);
  }

  function buildPrintilanSnapshot() {
    return {
      mode: printilanMode,
      daftar: printilanDaftar,
      terpilih: printilanTerpilih,
      custom: printilanCustom.trim(),
    };
  }

  function resetFormBooking() {
    setNamaPenyewa("");
    setHpPenyewa("");
    setAlamatPenyewa("");
    setSaranMember([]);
    setShowSaran(false);
    setMemberDipilih(null);
    setAmbilWaktu(null);
    setKembaliWaktu(null);
    setSelectedProductId("");
    setSnDipilih("");
    setSnOptions([]);
    setDpJumlah("");
    setBuktiFile(null);
    setKodePromoInput("");
    setDiskonCustomInput("");
    setDiskonCustomTipe("%");
    setShowPromoDiskon(false);
    setCart([]);
    setPrintilanTerpilih([]);
    setPrintilanCustom("");
    setKalkulasi({ error: "Pilih waktu", biaya: 0, durasi_teks: "-" });
    setRefresh((r) => r + 1);
  }

  async function buatBooking() {
    const pyw = namaPenyewa;
    const hp = hp_penyewa;
    const alamat = alamat_penyewa;
    const jaminan = jaminanDipilih;
    if (!pyw || !hp) return notify("Lengkapi Identitas!", "error");
    if (kalkulasi.error) return notify(kalkulasi.error, "error");
    const c = JSON.parse(JSON.stringify(cartRef.current));
    if (c.length === 0) return notify("Keranjang kosong!", "error");

    const dpWajib = getSetting("aturan_dp", "bebas") === "wajib";
    const dp = parseFloat(dpJumlah) || 0;
    if (dpWajib && dp <= 0)
      return notify(
        "Aturan DP aktif: wajib mengisi uang muka (DP) sebelum booking disimpan!",
        "error",
      );
    if (dp > hitungDiskon(kalkulasi.biaya).biayaAkhir)
      return notify("DP tidak boleh melebihi total biaya.", "error");

    const ambilISO = ambilWaktu ? new Date(ambilWaktu).toISOString() : "";
    const kembaliISO = kembaliWaktu ? new Date(kembaliWaktu).toISOString() : "";
    if (!ambilISO || !kembaliISO)
      return notify("Isi waktu ambil & kembali!", "error");

    setLoading("Menyimpan booking...");
    try {
      const idsInv = new Set();
      c.forEach((item) => {
        idsInv.add(item.idBarang);
        (item.ref.komponen || []).forEach((k) => idsInv.add(k.idBarang));
      });
      const rawInv = await getInventoryByIds([...idsInv]);
      const trxAllSebelum = await getTransactionsAktif();
      let tempInv = JSON.parse(JSON.stringify(rawInv));
      const idx = bangunIndeks(trxAllSebelum, rawInv);

      const gabungStatus = getSetting("gabung_status", "booking");
      let mergeTarget = null;
      if (gabungStatus === "booking" || gabungStatus === "booking_disewa") {
        const kandidat = trxAllSebelum
          .filter((t) => {
            const aktif =
              gabungStatus === "booking_disewa"
                ? t.status === "Booking" || t.status === "Disewa"
                : t.status === "Booking";
            if (!aktif) return false;
            if (t.penyewa !== pyw) return false;
            if ((t.hp_penyewa || "") !== hp) return false;
            if ((t.alamat_penyewa || "") !== alamat) return false;
            if ((t.jaminan_sewa || "") !== jaminan) return false;
            if ((t.waktu_ambil_rencana || "") !== ambilISO) return false;
            if ((t.waktu_kembali_rencana || "") !== kembaliISO) return false;
            return true;
          })
          .sort((a, b) => b.id - a.id)[0];
        if (kandidat) {
          const pilihan = await confirmChoice(
            `Penyewa yang sama (${pyw}) sudah punya booking aktif ${kandidat.no_invoice} dengan periode sama persis. Gabungkan item baru ke booking tersebut?`,
            [
              {
                label: "Gabungkan ke Booking",
                value: "gabung",
                bg: "bg-[#579171] text-white",
              },
              {
                label: "Pisah (Buat Booking Baru)",
                value: "pisah",
                bg: "bg-[#7181E0] text-white",
              },
            ],
          );
          if (pilihan === null) return;
          if (pilihan === "gabung") mergeTarget = kandidat;
        }
      }

      const excludeId = mergeTarget ? mergeTarget.id : undefined;

      for (let item of c) {
        if (item.ref.jenis === "satuan") {
          const terpakai = snsTerpakaiIdx(
            idx,
            item.idBarang,
            ambilISO,
            kembaliISO,
            excludeId,
          );
          for (let s of item.sn.split(", ")) {
            if (terpakai.includes(s))
              return notify(
                `S/N ${s} pada ${item.ref.nama} sudah di-booking pada periode tersebut.`,
                "error",
              );
            if (mergeTarget) {
              const duplikat = (mergeTarget.items || []).some(
                (it) =>
                  it.idBarang == item.idBarang &&
                  (it.sn || "").split(", ").includes(s),
              );
              if (duplikat)
                return notify(
                  `S/N ${s} pada ${item.ref.nama} sudah ada di booking ${mergeTarget.no_invoice}.`,
                  "error",
                );
            }
          }
        } else {
          const stokBebas = hitungStokIdx(
            idx,
            item.ref,
            ambilISO,
            kembaliISO,
            excludeId,
          );
          if (item.qty > stokBebas)
            return notify(
              `Stok ${item.ref.nama} tidak cukup pada periode tersebut.`,
              "error",
            );
        }
      }

      const invDiubah = new Set();
      const reservasiSave = new Map();
      for (let item of c) {
        if (item.ref.jenis === "satuan") {
          let dbItem = tempInv.find((i) => i.id == item.idBarang);
          if (!dbItem)
            return notify(
              `Barang ${item.ref.nama} tidak ditemukan di inventaris!`,
              "error",
            );
          let snList = item.sn.split(", ");
          for (let s of snList) {
            let snIdx = (dbItem.sns || []).indexOf(s);
            if (snIdx !== -1) dbItem.sns.splice(snIdx, 1);
          }
          invDiubah.add(dbItem.id);
        } else {
          let assigned = [];
          for (let komp of item.ref.komponen || []) {
            let dbKomp = tempInv.find((i) => i.id == komp.idBarang);
            let butuh = komp.qty * item.qty;
            const bebas = snsBebasIdx(
              idx,
              komp.idBarang,
              ambilISO,
              kembaliISO,
              excludeId,
            );
            const reserved =
              reservasiSave.get(String(komp.idBarang)) || new Set();
            const tersedia = bebas.filter((s) => !reserved.has(s));
            if (tersedia.length < butuh)
              return notify(
                `Stok Komponen '${dbKomp?.nama || "?"}' kurang.`,
                "error",
              );
            const dipilih = tersedia.slice(0, butuh);
            if (dbKomp)
              dbKomp.sns = (dbKomp.sns || []).filter(
                (s) => !dipilih.includes(s),
              );
            if (dbKomp) invDiubah.add(dbKomp.id);
            dipilih.forEach((s) => reserved.add(s));
            reservasiSave.set(String(komp.idBarang), reserved);
            assigned.push({
              idKomp: komp.idBarang,
              nama: dbKomp?.nama || "?",
              sns: dipilih,
            });
          }
          item.assignedSNs = assigned;
        }
      }
      const invUpdate = tempInv.filter((i) => invDiubah.has(i.id));

      if (mergeTarget) {
        const target = mergeTarget;
        const d = hitungDiskon(
          kalkulasi.biaya,
          undefined,
          undefined,
          Date.now(),
        );
        const tambahBiaya = d.biayaAkhir;
        target.items = [
          ...(target.items || []),
          ...JSON.parse(JSON.stringify(c)),
        ];
        target.biaya = (target.biaya || 0) + tambahBiaya;
        target.total_akhir = (target.biaya || 0) + (target.denda || 0);
        if (d.totalDiskon > 0) {
          const dl = target.diskon || {
            memberId: null,
            memberNama: null,
            diskonMember: 0,
            kodePromo: null,
            diskonPromo: 0,
            totalDiskon: 0,
            biayaAsli: 0,
          };
          target.diskon = {
            memberId:
              memberDipilih?.sumber === "member"
                ? memberDipilih.id
                : dl.memberId || null,
            memberNama:
              memberDipilih?.sumber === "member"
                ? memberDipilih.nama
                : dl.memberNama || null,
            diskonMember: dl.diskonMember + d.diskonMember,
            kodePromo: promoDipilih?.kode ?? dl.kodePromo,
            diskonPromo: dl.diskonPromo + d.diskonPromo,
            totalDiskon: dl.totalDiskon + d.totalDiskon,
            biayaAsli: dl.biayaAsli + kalkulasi.biaya,
          };
        }
        if (dp > 0) {
          const riwayat = [...(target.pembayaran?.riwayatBayar || [])];
          riwayat.push({
            id: crypto.randomUUID(),
            jumlah: dp,
            metode: dpMetode,
            tgl: new Date().toISOString(),
            catatan: "DP Item Tambahan",
          });
          target.pembayaran = {
            dp: (target.pembayaran?.dp || 0) + dp,
            metodeDp: target.pembayaran?.metodeDp || dpMetode,
            tglDp: target.pembayaran?.tglDp || new Date().toISOString(),
            riwayatBayar: riwayat,
          };
        }

        if (!(await updateTransactions([target])))
          return notify(
            getLastDbError() ||
              "Gagal menggabungkan item ke booking. Silakan coba lagi.",
            "error",
          );
        if (dp > 0 && buktiFile) {
          const idxBaru = target.pembayaran.riwayatBayar.length - 1;
          const path = await uploadBuktiBayar(buktiFile, target.id);
          if (!path) {
            notify("Pembayaran tercatat, tapi foto bukti gagal diupload.", "warning");
          } else {
            target.pembayaran.riwayatBayar[idxBaru] = {
              ...target.pembayaran.riwayatBayar[idxBaru],
              bukti: path,
            };
            await updateTransactions([target]);
          }
        }
        if (promoDipilih) {
          const r = await pakaiPromo(promoDipilih.id);
          if (!r.ok) notify("Gagal menerapkan promo: " + r.error, "error");
        }
        if (!(await updateInventory(invUpdate)))
          return notify(
            "Booking digabung, tapi gagal memperbarui stok. Cek inventaris!",
            "error",
          );

        const namaPelayanMerge = (await getNamaInvoice()) || "-";
        const log = {
          id: Date.now(),
          waktu: new Date().toISOString(),
          aktivitas: "Item Ditambahkan",
          detail: "-",
          catatan: "Item tambahan digabung ke booking",
          pelayan: namaPelayanMerge,
          trx_info: `${target.penyewa} • ${target.no_invoice}`,
        };
        if (!(await tambahLogs([log])))
          return notify("Booking digabung, tapi gagal mencatat log.", "error");

        resetFormBooking();
        notify(`Item digabungkan ke booking ${target.no_invoice}!`);
        return;
      }

      const namaPelayan = (await getNamaInvoice()) || "-";
      const d = hitungDiskon(kalkulasi.biaya, undefined, undefined, Date.now());
      const trxBaru = {
        id: Date.now(),
        no_invoice: await buatIDUnik(),
        penyewa: pyw,
        hp_penyewa: hp,
        alamat_penyewa: alamat,
        jaminan_sewa: jaminan,
        waktu_ambil_rencana: ambilWaktu ? ambilWaktu.toISOString() : "",
        waktu_kembali_rencana: kembaliWaktu ? kembaliWaktu.toISOString() : "",
        durasi_teks: kalkulasi.durasi_teks,
        items: JSON.parse(JSON.stringify(c)),
        biaya: d.biayaAkhir,
        denda: 0,
        total_akhir: d.biayaAkhir,
        diskon:
          d.totalDiskon > 0
            ? {
                memberId:
                  memberDipilih?.sumber === "member" ? memberDipilih.id : null,
                memberNama:
                  memberDipilih?.sumber === "member"
                    ? memberDipilih.nama
                    : null,
                diskonMember: d.diskonMember,
                memberPersen: d.persenEfektif,
                memberSumber: d.sumberDiskon,
                kodePromo: promoDipilih?.kode || null,
                diskonPromo: d.diskonPromo,
                totalDiskon: d.totalDiskon,
                biayaAsli: kalkulasi.biaya,
              }
            : undefined,
        status: "Booking",
        riwayatDilayani: [
          { aksi: "booking", nama: namaPelayan, tgl: new Date().toISOString() },
        ],
        dilayani_oleh: namaPelayan,
        pembayaran:
          dp > 0
            ? {
                dp,
                metodeDp: dpMetode,
                tglDp: new Date().toISOString(),
                riwayatBayar: [
                  {
                    id: crypto.randomUUID(),
                    jumlah: dp,
                    metode: dpMetode,
                    tgl: new Date().toISOString(),
                    catatan: "DP Booking",
                  },
                ],
              }
            : undefined,
        printilan: buildPrintilanSnapshot(),
      };

      const okSimpan = await tambahTransactions([trxBaru]);
      if (!okSimpan)
        return notify(
          getLastDbError() || "Gagal menyimpan booking. Silakan coba lagi.",
          "error",
        );
      if (dp > 0 && buktiFile) {
        const path = await uploadBuktiBayar(buktiFile, trxBaru.id);
        if (!path) {
          notify("Pembayaran tercatat, tapi foto bukti gagal diupload.", "warning");
        } else {
          trxBaru.pembayaran.riwayatBayar[0].bukti = path;
          await updateTransactions([trxBaru]);
        }
      }
      if (promoDipilih) {
        const r = await pakaiPromo(promoDipilih.id);
        if (!r.ok) notify("Gagal menerapkan promo: " + r.error, "error");
      }

      const okInv = await updateInventory(invUpdate);
      if (!okInv)
        return notify(
          "Booking tersimpan, tapi gagal memperbarui stok. Cek inventaris!",
          "error",
        );

      resetFormBooking();
      notify(`Booking berhasil! Invoice: ${trxBaru.no_invoice}`);
    } finally {
      setLoading("");
    }
  }

  const filterTime = (time) => {
    const h = time.getHours();
    const mode = getSetting("jam_mode", "buka_tutup");
    if (mode !== "buka_tutup") return true;
    const buka = parseInt(getSetting("jam_buka", "6"), 10) || 6;
    const tutup = parseInt(getSetting("jam_tutup", "22"), 10) || 22;
    return h >= buka && h <= tutup;
  };

  function tambahEditItem() {
    if (!editSelectedId) return notify("Pilih barang dulu!", "error");
    const refBarang = inv.find((i) => i.id == editSelectedId);
    if (!refBarang) return notify("Barang tidak ditemukan!", "error");
    const mulaiISO = editForm.waktu_ambil_rencana
      ? new Date(editForm.waktu_ambil_rencana).toISOString()
      : "";
    const selesaiISO = editForm.waktu_kembali_rencana
      ? new Date(editForm.waktu_kembali_rencana).toISOString()
      : "";
    const stok =
      mulaiISO && selesaiISO
        ? hitungStokIdx(indeks, refBarang, mulaiISO, selesaiISO, editModal.id)
        : getStok(refBarang, inv);
    if (stok < 1) return notify("Stok habis!", "error");

    if (refBarang.jenis === "satuan") {
      const sn = editSnDipilih;
      if (!sn) return notify("Pilih S/N!", "error");
      if (!mulaiISO || !selesaiISO)
        return notify("Isi waktu ambil & kembali dulu!", "error");
      const terpakai = snsTerpakaiIdx(
        indeks,
        editSelectedId,
        mulaiISO,
        selesaiISO,
        editModal.id,
      );
      if (terpakai.includes(sn))
        return notify("S/N sudah di-booking pada periode tersebut!", "error");
      const exist = editItems.find((x) => x.idBarang == editSelectedId);
      if (exist) {
        if (exist.sn.split(", ").includes(sn))
          return notify("S/N sudah ada!", "error");
        exist.sn += ", " + sn;
        exist.qty += 1;
      } else {
        editItems.push({
          idBarang: editSelectedId,
          ref: refBarang,
          qty: 1,
          sn,
          subtotal: 0,
        });
      }
    } else {
      const qtyInput = document.getElementById("edit_qty_input");
      const qty = parseInt(qtyInput?.value || 1);
      if (qty < 1 || qty > stok)
        return notify("Stok paket tidak mencukupi!", "error");
      const exist = editItems.find((x) => x.idBarang == editSelectedId);
      if (exist) {
        if (exist.qty + qty > stok)
          return notify("Melebihi batas stok!", "error");
        exist.qty += qty;
      } else {
        editItems.push({
          idBarang: editSelectedId,
          ref: refBarang,
          qty,
          subtotal: 0,
        });
      }
    }
    setEditItems([...editItems]);
    // Refresh pilihan: produk & S/N kembali kosong utk input berikutnya
    setEditSelectedId("");
    setEditSnDipilih("");
    setEditSnOptions([]);
    setShowEditSn(false);
  }

  function hapusEditItem(idx) {
    editItems.splice(idx, 1);
    setEditItems([...editItems]);
  }

  function isiSnEdit(v) {
    const item = inv.find((i) => i.id == v);
    if (item?.jenis === "satuan") {
      setShowEditSn(true);
      setEditSnDipilih("");
      const snInEdit = editItems
        .filter((x) => x.idBarang == v)
        .flatMap((x) => x.sn.split(", "));
      const mulaiISO = editForm.waktu_ambil_rencana
        ? new Date(editForm.waktu_ambil_rencana).toISOString()
        : "";
      const selesaiISO = editForm.waktu_kembali_rencana
        ? new Date(editForm.waktu_kembali_rencana).toISOString()
        : "";
      const snBebas =
        mulaiISO && selesaiISO
          ? snsBebasIdx(indeks, item.id, mulaiISO, selesaiISO, editModal.id)
          : [...(item.sns || [])];
      const snAvail = snBebas.filter(
        (s) => !snInEdit.includes(s) && kondisiUnit(item, s) !== "maintenance",
      );
      if (snAvail.length === 0) {
        setEditSnOptions([]);
        setEditSnDipilih("");
      } else {
        const opts = [];
        snAvail.forEach((s) => {
          const catatan = catatanUnit(item, s);
          const bermasalah = kondisiUnit(item, s) === "bermasalah";
          opts.push({
            value: s,
            label: `S/N: ${s}${bermasalah ? " ⚠ Bermasalah" : ""}`,
            title: catatan || undefined,
          });
        });
        if (!mulaiISO || !selesaiISO)
          opts.push({
            value: "",
            label: "Ketersediaan per tanggal: isi waktu ambil/kembali dulu",
            disabled: true,
          });
        setEditSnOptions(opts);
        const masihAda = opts.some(
          (o) => o.value === editSnDipilih && !o.disabled,
        );
        setEditSnDipilih(masihAda ? editSnDipilih : snAvail[0]); // auto-pilih S/N paling awal
      }
    } else {
      setShowEditSn(false);
      setEditSnOptions([]);
      setEditSnDipilih("");
    }
  }

  async function ubahEditWaktu(patch) {
    const next = { ...editForm, ...patch };
    setEditForm(next);
    if (editSelectedId) await isiSnEdit(editSelectedId);
  }

  function bukaEditModal(t) {
    setEditForm({
      penyewa: t.penyewa,
      hp_penyewa: t.hp_penyewa,
      alamat_penyewa: t.alamat_penyewa || "",
      jaminan_sewa: t.jaminan_sewa || "E-KTP",
      waktu_ambil_rencana: t.waktu_ambil_rencana
        ? new Date(t.waktu_ambil_rencana)
        : null,
      waktu_kembali_rencana: t.waktu_kembali_rencana
        ? new Date(t.waktu_kembali_rencana)
        : null,
    });
    setEditItems(JSON.parse(JSON.stringify(t.items)));
    setEditSelectedId("");
    const p = t.printilan || {};
    setPrintilanTerpilih(p.terpilih || []);
    setPrintilanCustom(p.custom || "");
    setEditModal(t);
  }

  async function simpanEdit() {
    const t = editModal;
    if (!t) return;
    const ambil = editForm.waktu_ambil_rencana?.toISOString() || "";
    const kembali = editForm.waktu_kembali_rencana?.toISOString() || "";
    const dur = hitungDurasi(ambil, kembali);
    if (dur.error) return notify(dur.error, "error");

    setLoading("Menyimpan perubahan jadwal...");
    try {
      const idsInv = new Set();
      const kumpulIds = (daftar) =>
        daftar.forEach((item) => {
          idsInv.add(item.idBarang);
          (item.ref?.komponen || []).forEach((k) => idsInv.add(k.idBarang));
          (item.assignedSNs || []).forEach((a) => idsInv.add(a.idKomp));
        });
      kumpulIds(t.items || []);
      kumpulIds(editItems);
      const rawInv = await getInventoryByIds([...idsInv]);
      const trxAllSebelum = await getTransactionsAktif();
      let tempInv = JSON.parse(JSON.stringify(rawInv));
      const idx = bangunIndeks(trxAllSebelum, rawInv);
      const invDiubah = new Set();

      // Kembalikan stok barang lama (hanya bila tidak dipakai transaksi aktif lain)
      for (let item of t.items) {
        if (item.ref.jenis === "satuan") {
          let dbItem = tempInv.find((i) => i.id == item.idBarang);
          if (dbItem) {
            const rujuk = snsRujukLainIdx(idx, t.id, item.idBarang);
            let snList = item.sn.split(", ");
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

      // Validasi periode baru terhadap transaksi lain
      for (let item of editItems) {
        if (item.ref.jenis === "satuan") {
          const terpakai = snsTerpakaiIdx(
            idx,
            item.idBarang,
            ambil,
            kembali,
            t.id,
          );
          for (let s of item.sn.split(", ")) {
            if (terpakai.includes(s))
              return notify(
                `S/N ${s} pada ${item.ref.nama} sudah di-booking pada periode tersebut.`,
                "error",
              );
          }
        } else {
          const stokBebas = hitungStokIdx(idx, item.ref, ambil, kembali, t.id);
          if (item.qty > stokBebas)
            return notify(
              `Stok ${item.ref.nama} tidak cukup pada periode tersebut.`,
              "error",
            );
        }
      }

      // Kurangi stok untuk barang baru di editItems (pakai salinan agar tidak memutasi state)
      const editItemsBaru = editItems.map((item) => ({ ...item }));
      const reservasiSave = new Map();
      for (let item of editItemsBaru) {
        if (item.ref.jenis === "satuan") {
          let dbItem = tempInv.find((i) => i.id == item.idBarang);
          if (!dbItem)
            return notify(`Barang ${item.ref.nama} tidak ditemukan!`, "error");
          let snList = item.sn.split(", ");
          for (let s of snList) {
            let snIdx = (dbItem.sns || []).indexOf(s);
            if (snIdx !== -1) dbItem.sns.splice(snIdx, 1);
          }
          invDiubah.add(dbItem.id);
        } else {
          let assigned = [];
          for (let komp of item.ref.komponen || []) {
            let dbKomp = tempInv.find((i) => i.id == komp.idBarang);
            let butuh = komp.qty * item.qty;
            const bebas = snsBebasIdx(idx, komp.idBarang, ambil, kembali, t.id);
            const reserved =
              reservasiSave.get(String(komp.idBarang)) || new Set();
            const tersedia = bebas.filter((s) => !reserved.has(s));
            if (tersedia.length < butuh)
              return notify(
                `Stok komponen '${dbKomp?.nama || "?"}' tidak cukup!`,
                "error",
              );
            const dipilih = tersedia.slice(0, butuh);
            if (dbKomp)
              dbKomp.sns = (dbKomp.sns || []).filter(
                (s) => !dipilih.includes(s),
              );
            if (dbKomp) invDiubah.add(dbKomp.id);
            dipilih.forEach((s) => reserved.add(s));
            reservasiSave.set(String(komp.idBarang), reserved);
            assigned.push({
              idKomp: komp.idBarang,
              nama: dbKomp?.nama || "?",
              sns: dipilih,
            });
          }
          item.assignedSNs = assigned;
        }
      }

      let totalBiaya = 0;
      editItemsBaru.forEach((item) => {
        let sub = 0;
        if (item.ref.tipeSewa === "harian") {
          let hp = dur.hari + (dur.sisaJam > 0 ? 1 : 0);
          if (hp === 0 && dur.totalJam > 0) hp = 1;
          sub = hp * item.ref.h24;
        } else {
          sub = dur.hari * item.ref.h24;
          if (dur.hari >= 1 && dur.sisaJam > 0) {
            // Durasi >= 1 hari: apply 50% threshold
            if (dur.sisaJam <= 12) sub += item.ref.h24 * 0.5;
            else sub += item.ref.h24;
          } else if (dur.hari === 0 && dur.sisaJam > 0) {
            // Durasi < 1 hari: use standard rates
            if (dur.sisaJam <= 6) sub += item.ref.h6;
            else if (dur.sisaJam <= 12) sub += item.ref.h12;
            else sub += item.ref.h24;
          }
        }
        item.hargaSatuan = sub;
        item.subtotal = sub * item.qty;
        totalBiaya += item.subtotal;
      });

      const memberLama = t.diskon?.memberId
        ? daftarMember.find((m) => m.id === t.diskon.memberId)
        : null;
      const promoLama = t.diskon?.kodePromo
        ? daftarPromo.find((p) => p.kode === t.diskon.kodePromo)
        : null;
      const dEdit = hitungDiskon(
        totalBiaya,
        memberLama,
        promoLama,
        Date.now(),
        dur.totalJam,
      );

      const namaPelayan = (await getNamaInvoice()) || "-";
      const trxBaru = {
        ...t,
        items: editItemsBaru,
        penyewa: editForm.penyewa,
        hp_penyewa: editForm.hp_penyewa,
        alamat_penyewa: editForm.alamat_penyewa,
        jaminan_sewa: editForm.jaminan_sewa,
        waktu_ambil_rencana: ambil,
        waktu_kembali_rencana: kembali,
        durasi_teks: dur.durasi_teks,
        biaya: dEdit.biayaAkhir,
        total_akhir: dEdit.biayaAkhir + (t.denda || 0),
        diskon:
          dEdit.totalDiskon > 0
            ? {
                memberId: memberLama?.id || null,
                memberNama: memberLama?.nama || null,
                diskonMember: dEdit.diskonMember,
                memberPersen: dEdit.persenEfektif,
                memberSumber: dEdit.sumberDiskon,
                kodePromo: promoLama?.kode || null,
                diskonPromo: dEdit.diskonPromo,
                totalDiskon: dEdit.totalDiskon,
                biayaAsli: totalBiaya,
              }
            : undefined,
        riwayatDilayani: [
          ...(t.riwayatDilayani || []),
          { aksi: "edit", nama: namaPelayan, tgl: new Date().toISOString() },
        ],
        dilayani_oleh: namaPelayan,
        printilan: buildPrintilanSnapshot(),
      };
      const invUpdate = tempInv.filter((i) => invDiubah.has(i.id));
      if (!(await updateTransactions([trxBaru])))
        return notify(
          getLastDbError() || "Gagal memperbarui jadwal. Silakan coba lagi.",
          "error",
        );
      if (!(await updateInventory(invUpdate)))
        return notify(
          "Jadwal tersimpan, tapi gagal memperbarui stok. Cek inventaris!",
          "error",
        );
      setEditModal(null);
      setRefresh((r) => r + 1);
      notify("Jadwal berhasil diperbarui!");
    } finally {
      setLoading("");
    }
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
            let snList = item.sn.split(", ");
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
    <div className="p-6">
      <h2 className="text-2xl font-bold mb-6">Buat Booking Baru</h2>
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <div ref={refKolomKiri} className="lg:col-span-3">
          <div className="bg-white border rounded-xl shadow-lg border-slate-200 p-6 border-2 border-t-4 border-t-[#7181E0]">
            <h3 className="text-base font-semibold mb-4 text-[#7181E0]">
              Identitas Penyewa
            </h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-2 block text-[12.5px] font-bold tracking-[0.02em] text-gray-600">
                  Penyewa
                </label>
                <div className="relative">
                  <input
                    id="nama_penyewa"
                    className="appearance-none border-solid rounded-md block w-full px-3 py-2.5 text-[14px] outline-none transition-colors duration-200 border border-gray-300 bg-white text-gray-900 focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:opacity-60"
                    value={namaPenyewa}
                    onChange={(e) => gantiNamaPenyewa(e.target.value)}
                    onBlur={() => setTimeout(() => setShowSaran(false), 150)}
                    autoComplete="off"
                    placeholder="Ketik nama..."
                  />
                  {getFITUR().memberPromo &&
                    showSaran &&
                    saranMember.length > 0 && (
                      <div
                        className="bg-white border rounded-xl shadow-lg border-slate-200 p-6"
                        style={{
                          position: "absolute",
                          top: "calc(100% + 4px)",
                          left: 0,
                          right: 0,
                          zIndex: 60,
                          maxHeight: 220,
                          overflowY: "auto",
                          boxShadow: "0 8px 24px shadow-lg",
                        }}
                      >
                        {saranMember.map((m) => (
                          <button
                            key={m.id}
                            type="button"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => pilihMemberSaran(m)}
                            className="px-4 py-2 rounded bg-transparent px-3 py-2 text-sm"
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              alignItems: "center",
                              width: "100%",
                              borderRadius: 0,
                              padding: "8px 12px",
                              borderBottom: "1px solid #e2e8f0",
                            }}
                          >
                            <span
                              style={{
                                display: "flex",
                                flexDirection: "column",
                                alignItems: "flex-start",
                                gap: 2,
                              }}
                            >
                              <span className="font-bold">{m.nama}</span>
                              {m.sumber === "member" && (
                                <span className="inline-block px-2 py-1 rounded text-xs bg-[#579171] text-white text-[10px] px-1.5 py-0.5">
                                  Member
                                </span>
                              )}
                            </span>
                            <span className="text-xs text-gray-500">
                              {m.hp || "-"}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                </div>
                {getFITUR().memberPromo && memberDipilih && (
                  <div className="flex items-center gap-2 mt-2">
                    <span
                      className={`inline-block px-2 py-1 rounded text-xs ${memberDipilih.sumber === "history" ? "bg-[#7181E0] text-white" : "bg-[#579171] text-white"}`}
                    >
                      {memberDipilih.sumber === "member" && "Member: "}
                      {memberDipilih.nama}
                      {Number(memberDipilih.diskon_persen) > 0
                        ? ` • ${memberDipilih.diskon_persen}%`
                        : ""}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setMemberDipilih(null);
                        setPilihSatu(null);
                      }}
                      className="px-4 py-2 rounded px-3 py-2 text-sm bg-transparent p-0.5 px-2 text-xs"
                    >
                      ✕
                    </button>
                  </div>
                )}
              </div>
              <div>
                <label className="mb-2 block text-[12.5px] font-bold tracking-[0.02em] text-gray-600">
                  No. HP
                </label>
                <input
                  id="hp_penyewa"
                  type="text"
                  inputMode="numeric"
                  value={hp_penyewa}
                  onChange={(e) =>
                    setHpPenyewa(e.target.value.replace(/\D/g, ""))
                  }
                  className="appearance-none border-solid rounded-md block w-full px-3 py-2.5 text-[14px] outline-none transition-colors duration-200 border border-gray-300 bg-white text-gray-900 focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:opacity-60"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-2 block text-[12.5px] font-bold tracking-[0.02em] text-gray-600">
                  Jaminan
                </label>
                <div className="flex gap-2 flex-wrap">
                  {OPSI_JAMINAN.map((o) => (
                    <button
                      key={o.value}
                      type="button"
                      onClick={() => setJaminanDipilih(o.value)}
                      className={`${jaminanDipilih === o.value ? "rounded-lg px-4 py-2 text-sm font-medium transition-colors outline-none focus:outline-none bg-[#7181E0] hover:bg-[#5d6fcc] text-white border-0" : "rounded-lg px-4 py-2 text-sm font-medium transition-colors outline-none focus:outline-none bg-gray-200 hover:bg-gray-300 text-slate-700 border-0"}`}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="mb-2 block text-[12.5px] font-bold tracking-[0.02em] text-gray-600">
                  Alamat
                </label>
                <textarea
                  id="alamat_penyewa"
                  rows={2}
                  value={alamat_penyewa}
                  onChange={(e) => setAlamatPenyewa(e.target.value)}
                  className="appearance-none border-solid rounded-md block w-full px-3 py-2.5 text-[14px] outline-none transition-colors duration-200 border border-gray-300 bg-white text-gray-900 focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:opacity-60 resize-y"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-2 block text-[12.5px] font-bold tracking-[0.02em] text-gray-600">
                  Waktu Ambil
                </label>
                <div className="flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <DateTimePicker
                      value={ambilWaktu}
                      onChange={gantiAmbil}
                      minDate={new Date()}
                      filterTime={filterTime}
                      showTime
                      placeholder="Pilih tgl & jam ambil"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const now = new Date();
                      const m = now.getMinutes();
                      const rounded = Math.ceil(m / 5) * 5;
                      now.setMinutes(rounded, 0, 0);
                      if (
                        getSetting("jam_mode", "buka_tutup") === "buka_tutup"
                      ) {
                        const buka =
                          parseInt(getSetting("jam_buka", "6"), 10) || 6;
                        const tutup =
                          parseInt(getSetting("jam_tutup", "22"), 10) || 22;
                        if (now.getHours() < buka) now.setHours(buka, 0, 0, 0);
                        if (now.getHours() > tutup)
                          now.setHours(tutup, 0, 0, 0);
                      }
                      gantiAmbil(now);
                    }}
                    className="rounded-lg bg-[#7181E0] hover:bg-[#5d6fcc] px-4 py-2 text-sm font-medium text-white transition-colors border-0"
                  >
                    Sekarang
                  </button>
                </div>
              </div>
              <div>
                <label className="mb-2 block text-[12.5px] font-bold tracking-[0.02em] text-gray-600">
                  Durasi Sewa
                </label>
                <div className="flex flex-wrap gap-2">
                  {durasiCepat.map((d) => (
                    <button
                      key={d.jam}
                      type="button"
                      onClick={() => isiDurasi(d.jam)}
                      className={`${selectedDurasi === d.jam ? "rounded-lg px-4 py-2 text-sm font-medium transition-colors outline-none focus:outline-none bg-[#7181E0] hover:bg-[#5d6fcc] text-white border-0" : "rounded-lg px-4 py-2 text-sm font-medium transition-colors outline-none focus:outline-none bg-gray-200 hover:bg-gray-300 text-slate-700 border-0"}`}
                    >
                      {d.label}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={pilihCustom}
                    className={`${showCustom ? "rounded-lg px-4 py-2 text-sm font-medium transition-colors outline-none focus:outline-none bg-[#7181E0] hover:bg-[#5d6fcc] text-white border-0" : "rounded-lg px-4 py-2 text-sm font-medium transition-colors outline-none focus:outline-none bg-gray-200 hover:bg-gray-300 text-slate-700 border-0"}`}
                  >
                    Custom
                  </button>
                </div>
              </div>
            </div>
            {showCustom && (
              <div className="grid grid-cols-2 mt-4">
                <div className="col-span-full">
                  <label className="mb-2 block text-[12.5px] font-bold tracking-[0.02em] text-gray-600">
                    Waktu Kembali (Manual)
                  </label>
                  <DateTimePicker
                    value={kembaliWaktu}
                    onChange={gantiKembali}
                    minDate={ambilWaktu || new Date()}
                    showTime
                    placeholder="Pilih tgl & jam kembali"
                  />
                </div>
              </div>
            )}
          </div>

          <div className="bg-white border rounded-xl shadow-lg border-slate-200 p-6 border-2 mt-4 border-t-4 border-t-[#579171]">
            <h3 className="text-base font-semibold mb-4 text-[#579171]">
              Pilih Barang
            </h3>
            <div className="flex items-end gap-3 mb-3">
              <div className="flex-[3] min-w-0">
                <label className="mb-2 block text-[12.5px] font-bold tracking-[0.02em] text-gray-600">
                  Produk
                </label>
                <SearchableSelect
                  options={opsiKatalog}
                  value={selectedProductId}
                  onChange={(v) => {
                    setSelectedProductId(v);
                    pilihKatalog(v);
                  }}
                  placeholder="-- Pilih Katalog --"
                />
              </div>
              <div className="flex-1 min-w-0">
                <label className="mb-2 block text-[12.5px] font-bold tracking-[0.02em] text-gray-600">
                  Serial Number
                </label>
                <SearchableSelect
                  options={snOptions}
                  value={snDipilih}
                  onChange={(v) => setSnDipilih(v)}
                  placeholder="Pilih S/N..."
                  noSearch
                />
              </div>
              <button
                type="button"
                onClick={tambahKeKeranjang}
                className="flex min-h-12 items-center justify-center whitespace-nowrap rounded-md border border-transparent bg-[#579171] px-4 py-2.5 text-base font-medium leading-[1.6] text-white transition-colors hover:bg-[#447057]"
              >
                Masukkan
              </button>
            </div>

            <div className="overflow-x-auto border border-slate-200 rounded-lg">
              <table className="w-full border-collapse table-fixed">
                <colgroup>
                  <col style={{ width: "30%" }} />
                  <col style={{ width: "20%" }} />
                  <col style={{ width: "10%" }} />
                  <col style={{ width: "15%" }} />
                  <col style={{ width: "15%" }} />
                  <col style={{ width: "10%" }} />
                </colgroup>
                <thead className="bg-slate-100">
                  <tr className="border-b-2 border-slate-200">
                    <th className="text-left py-3 px-2 font-semibold text-gray-700 border-r border-slate-200">
                      Produk
                    </th>
                    <th className="text-left py-3 px-2 font-semibold text-gray-700 border-r border-slate-200">
                      S/N
                    </th>
                    <th className="text-center py-3 px-2 font-semibold text-gray-700 border-r border-slate-200">
                      Qty
                    </th>
                    <th className="text-right py-3 px-2 font-semibold text-gray-700 border-r border-slate-200">
                      Harga
                    </th>
                    <th className="text-right py-3 px-2 font-semibold text-gray-700 border-r border-slate-200">
                      Total
                    </th>
                    <th className="py-3 px-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {cart.length === 0 && (
                    <tr>
                      <td
                        colSpan={6}
                        className="text-center text-gray-500 py-4 italic"
                      >
                        Keranjang kosong.
                      </td>
                    </tr>
                  )}
                  {cart.map((c, idx) => (
                    <tr
                      key={idx}
                      className="border-b border-slate-100 hover:bg-slate-50"
                    >
                      <td className="font-semibold py-3 px-2 border-r border-slate-200 truncate">
                        {c.ref.nama}
                      </td>
                      <td className="text-xs py-3 px-2 border-r border-slate-200 truncate text-[#7181E0]">
                        {c.ref.jenis === "satuan" ? (
                          <>
                            <div className="truncate">{c.sn}</div>
                            {(c.sn || "")
                              .split(", ")
                              .filter(Boolean)
                              .map((s) => {
                                const cat = catatanUnit(c.ref, s);
                                if (kondisiUnit(c.ref, s) !== "bermasalah")
                                  return null;
                                return (
                                  <div
                                    key={s}
                                    className="text-[10px] text-orange-600"
                                    style={{ whiteSpace: "normal" }}
                                  >
                                    ⚠ Bermasalah{cat ? `: ${cat}` : ""}
                                  </div>
                                );
                              })}
                          </>
                        ) : (
                          "Paket Bundling"
                        )}
                      </td>
                      <td className="text-center py-3 px-2 border-r border-slate-200">
                        {c.qty}
                      </td>
                      <td className="text-right text-gray-600 py-3 px-2 border-r border-slate-200">
                        {formatRupiah(c.hargaSatuan || 0)}
                      </td>
                      <td className="text-right font-semibold py-3 px-2 border-r border-slate-200">
                        {formatRupiah(c.subtotal || 0)}
                      </td>
                      <td className="text-right py-3 px-2">
                        <button
                          type="button"
                          onClick={() => hapusDariKeranjang(idx)}
                          className="font-bold text-danger"
                          style={{
                            background: "none",
                            border: 0,
                            cursor: "pointer",
                          }}
                        >
                          Hapus
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="bg-slate-100 border rounded-xl border-slate-200 p-6 flex items-center justify-between mt-6">
              <div>
                <p className="text-13 text-gray-500 mb-0">Durasi:</p>
                <p className="text-lg font-bold mb-0">
                  {kalkulasi.durasi_teks}
                </p>
              </div>
              <div className="text-right">
                <p className="text-13 text-gray-500 mb-0">Total Biaya</p>
                <p className="text-2xl font-bold mb-0 text-[#579171]">
                  {formatRupiah(hitungDiskon(kalkulasi.biaya || 0).biayaAkhir)}
                </p>
              </div>
            </div>

            {getFITUR().memberPromo && (
              <div className="mt-4">
                {(() => {
                  const d = hitungDiskon(kalkulasi.biaya || 0);
                  if (d.totalDiskon <= 0) return null;
                  return (
                    <div className="mb-4 text-13">
                      {d.diskonMember > 0 && (
                        <div className="flex items-center justify-between">
                          <span className="flex items-center gap-2 text-gray-500">
                            <span>
                              Diskon Member
                              {d.sumberDiskon?.startsWith("durasi") &&
                                ` (${d.sumberDiskon})`}
                            </span>
                            {d.persenEfektif > 0 && (
                              <span className="rounded-full bg-[#7181E0]/10 px-2 py-0.5 text-xs font-semibold text-[#7181E0]">
                                {d.persenEfektif}%
                              </span>
                            )}
                          </span>
                          <span className="text-danger">
                            -{formatRupiah(d.diskonMember)}
                          </span>
                        </div>
                      )}
                      {d.diskonPromo > 0 && (
                        <div className="flex items-center justify-between">
                          <span className="text-gray-500">Diskon Promo</span>
                          <span className="text-danger">
                            -{formatRupiah(d.diskonPromo)}
                          </span>
                        </div>
                      )}
                      {d.diskonCustom > 0 && (
                        <div className="flex items-center justify-between">
                          <span className="text-gray-500">Discount Custom</span>
                          <span className="text-danger">
                            -{formatRupiah(d.diskonCustom)}
                          </span>
                        </div>
                      )}
                      <div
                        className="flex items-center justify-between mt-2"
                        style={{
                          borderTop: "1px dashed rgba(87, 145, 113, 0.3)",
                          paddingTop: 8,
                        }}
                      >
                        <span className="font-semibold text-base">
                          Total Setelah Diskon
                        </span>
                        <span className="font-bold text-xl text-[#579171]">
                          {formatRupiah(d.biayaAkhir)}
                        </span>
                      </div>
                    </div>
                  );
                })()}
                <button
                  type="button"
                  onClick={() => setShowPromoDiskon((v) => !v)}
                  className="px-4 py-2 rounded-lg bg-gray-200 hover:bg-gray-300 text-slate-700 w-full text-sm font-medium transition-colors outline-none focus:outline-none border-0"
                >
                  {showPromoDiskon ? "− Promo & Diskon" : "+ Promo & Diskon"}
                </button>
                {showPromoDiskon && (
                  <>
                    <div className="flex items-center gap-2 mt-3">
                      <div className="flex-1 min-w-0">
                        <label className="mb-2 block text-[12.5px] font-bold tracking-[0.02em] text-gray-600">
                          Kode Promo
                        </label>
                        <input
                          type="text"
                          value={kodePromoInput}
                          onChange={(e) =>
                            setKodePromoInput(e.target.value.toUpperCase())
                          }
                          placeholder="Masukkan kode promo"
                          className="appearance-none border-solid rounded-md block w-full px-3 py-2.5 text-[14px] outline-none transition-colors duration-200 border border-gray-300 bg-white text-gray-900 focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:opacity-60"
                          autoComplete="off"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={terapkanPromo}
                        className="px-4 py-2 rounded bg-[#7181E0] text-white text-13"
                      >
                        Terapkan
                      </button>
                      {promoDipilih && (
                        <button
                          type="button"
                          onClick={() => {
                            setPromoDipilih(null);
                            setPilihSatu(null);
                          }}
                          className="px-4 py-2 rounded border border-[#7181E0] text-[#7181E0] text-13"
                        >
                          Hapus
                        </button>
                      )}
                    </div>
                    <div className="flex items-end gap-2 mt-3">
                      <div className="flex-1 min-w-0">
                        <label className="mb-2 block text-[12.5px] font-bold tracking-[0.02em] text-gray-600">
                          Discount Custom
                        </label>
                        <input
                          type="text"
                          inputMode="numeric"
                          value={diskonCustomInput}
                          onChange={(e) =>
                            setDiskonCustomInput(
                              e.target.value.replace(/\D/g, ""),
                            )
                          }
                          placeholder="0"
                          className="appearance-none border-solid rounded-md block w-full px-3 py-2.5 text-[14px] outline-none transition-colors duration-200 border border-gray-300 bg-white text-gray-900 focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:opacity-60"
                        />
                      </div>
                      <div className="shrink-0">
                        <label className="mb-2 block text-[12.5px] font-bold tracking-[0.02em] text-gray-600">
                          Tipe
                        </label>
                        <select
                          value={diskonCustomTipe}
                          onChange={(e) => setDiskonCustomTipe(e.target.value)}
                          className="appearance-none border-solid rounded-md block w-[90px] px-3 py-2.5 text-[14px] outline-none transition-colors duration-200 border border-gray-300 bg-white text-gray-900 focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:opacity-60"
                        >
                          <option value="%">%</option>
                          <option value="Rp">Rp</option>
                        </select>
                      </div>
                    </div>
                    {promoDipilih && (
                      <p className="text-xs text-gray-500 mt-2 mb-0">
                        Promo{" "}
                        <span className="font-bold">{promoDipilih.kode}</span>{" "}
                        aktif: diskon {promoDipilih.diskon_persen}%.
                      </p>
                    )}
                    {aturanDiskon.stack === "satu" &&
                      memberDipilih &&
                      promoDipilih && (
                        <div className="flex gap-2 flex-wrap mt-3">
                          <button
                            type="button"
                            onClick={() => setPilihSatu("member")}
                            className={`${pilihSatu !== "promo" ? "rounded-lg px-4 py-2 text-sm font-medium transition-colors outline-none focus:outline-none bg-[#7181E0] hover:bg-[#5d6fcc] text-white border-0" : "rounded-lg px-4 py-2 text-sm font-medium transition-colors outline-none focus:outline-none bg-gray-200 hover:bg-gray-300 text-slate-700 border-0"}`}
                          >
                            Diskon Member
                          </button>
                          <button
                            type="button"
                            onClick={() => setPilihSatu("promo")}
                            className={`${pilihSatu === "promo" ? "rounded-lg px-4 py-2 text-sm font-medium transition-colors outline-none focus:outline-none bg-[#7181E0] hover:bg-[#5d6fcc] text-white border-0" : "rounded-lg px-4 py-2 text-sm font-medium transition-colors outline-none focus:outline-none bg-gray-200 hover:bg-gray-300 text-slate-700 border-0"}`}
                          >
                            Diskon Promo
                          </button>
                        </div>
                      )}
                  </>
                )}
              </div>
            )}
          </div>

          {printilanDaftar.length > 0 && (
            <div className="mt-6 mb-4 rounded-lg border border-gray-200 bg-white p-4 shadow-lg">
              <label className="mb-2 block text-[12.5px] font-bold tracking-[0.02em] text-gray-600">
                Printilan
              </label>
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                {printilanDaftar.map((item) => (
                  <label
                    key={item}
                    className="flex items-center gap-1.5 text-sm text-gray-700 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={printilanTerpilih.includes(item)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setPrintilanTerpilih([...printilanTerpilih, item]);
                        } else {
                          setPrintilanTerpilih(
                            printilanTerpilih.filter((x) => x !== item),
                          );
                        }
                      }}
                      className="h-4 w-4 rounded border-gray-300 accent-[#7181E0]"
                    />
                    {item}
                  </label>
                ))}
              </div>
              <div className="mt-3">
                <input
                  type="text"
                  value={printilanCustom}
                  onChange={(e) => setPrintilanCustom(e.target.value)}
                  placeholder="Printilan lain (pisahkan dengan koma)..."
                  className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition-colors focus:border-[#7181E0] focus:ring-2 focus:ring-[#7181E0]/20"
                />
              </div>
            </div>
          )}

          <div
            className="bg-white border rounded-xl shadow-lg border-slate-200 p-6 border-2 mt-4"
            style={{
              background: "#fffbeb",
              borderColor: "rgba(245, 158, 11, 0.3)",
            }}
          >
            <label className="mb-2 block text-[12.5px] font-bold tracking-[0.02em] text-gray-600">
              Uang Muka / DP (Opsional)
            </label>
            <div className="grid grid-cols-2 gap-4 mt-2">
              <div>
                <label className="mb-2 block text-[12.5px] font-bold tracking-[0.02em] text-gray-600">
                  Jumlah DP
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  value={formatAngkaInput(dpJumlah)}
                  onChange={(e) =>
                    setDpJumlah(e.target.value.replace(/\D/g, ""))
                  }
                  placeholder="0"
                  className="appearance-none border-solid rounded-md block w-full px-3 py-2.5 text-[14px] outline-none transition-colors duration-200 border border-gray-300 bg-white text-gray-900 focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:opacity-60"
                />
              </div>
              <div>
                <label className="mb-2 block text-[12.5px] font-bold tracking-[0.02em] text-gray-600">
                  Metode Bayar
                </label>
                <div className="flex gap-2 flex-wrap">
                  {["Tunai", "Transfer", "QRIS"].map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setDpMetode(m)}
                      className={`${dpMetode === m ? "rounded-lg px-4 py-2 text-sm font-medium transition-colors outline-none focus:outline-none bg-[#7181E0] hover:bg-[#5d6fcc] text-white border-0" : "rounded-lg px-4 py-2 text-sm font-medium transition-colors outline-none focus:outline-none bg-gray-200 hover:bg-gray-300 text-slate-700 border-0"}`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            {parseFloat(dpJumlah) > 0 && (
              <div className="mt-3">
                <label className="mb-2 block text-[12.5px] font-bold tracking-[0.02em] text-gray-600">
                  Bukti Pembayaran (Opsional)
                </label>
                <BuktiDropzone value={buktiFile} onChange={setBuktiFile} />
              </div>
            )}
            <p className="text-xs text-gray-500">
              {getSetting("aturan_dp", "bebas") === "wajib"
                ? "Aturan DP aktif: wajib diisi sebelum booking disimpan."
                : "Booking tanpa DP tidak terkunci — bisa diambil penyewa lain yang DP lebih cepat."}
            </p>
            <button
              type="button"
              onClick={buatBooking}
              disabled={Boolean(loading)}
              className="px-4 py-2 rounded bg-[#579171] text-white w-full mt-4 text-lg"
            >
              Buat Booking
            </button>
          </div>
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
            className="bg-white border rounded-xl shadow-lg border-slate-200 border-2 p-0"
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
                className="appearance-none border-solid rounded-md block w-full px-3 py-2.5 text-[14px] outline-none transition-colors duration-200 border border-gray-300 bg-white text-gray-900 focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:opacity-60"
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
                      className="text-center text-13 text-gray-500"
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
                        className="bg-white border-2 border-solid border-slate-200 rounded-xl shadow-sm p-4 mb-2 hover:border-slate-300 transition-colors"
                        style={{ cursor: "pointer" }}
                      >
                        <div
                          className="flex items-center justify-between mb-2 gap-2"
                          style={{ alignItems: "flex-start" }}
                        >
                          <div>
                            <p
                              className="text-gray-500 mb-0"
                              style={{
                                fontFamily: "ui-monospace, monospace",
                                fontSize: 10,
                              }}
                            >
                              {t.no_invoice}
                            </p>
                            <p className="font-bold mb-0">{t.penyewa}</p>
                            <p className="text-xs text-gray-500 mb-0">
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
                          className="flex flex-col gap-1 text-xs text-gray-600 mb-2"
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
                        <div className="text-xs text-gray-500 mb-3">
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
                        className="text-center text-xs font-semibold text-gray-500"
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

      {typeof document !== "undefined" &&
        editModal &&
        createPortal(
          <div
            onClick={() => setEditModal(null)}
            className="fixed inset-0 z-[9999] flex items-center justify-center overflow-y-auto bg-black/50 p-4 backdrop-blur-sm"
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="relative flex max-h-[90vh] w-full max-w-4xl flex-col rounded-xl border-2 border-solid border-slate-200 bg-white shadow-2xl"
            >
              <div className="mb-4 flex items-center justify-between px-6 pt-6">
                <h3 className="text-lg font-semibold">
                  Edit Booking
                  <span className="ml-2 text-sm font-normal text-gray-500">
                    {editForm.penyewa || editModal.no_invoice}
                  </span>
                </h3>
                <button
                  type="button"
                  onClick={() => setEditModal(null)}
                  aria-label="Tutup"
                  className="inline-flex items-center justify-center rounded-lg px-4 py-2 text-xl font-semibold text-gray-600 transition-colors hover:bg-surface-secondary focus:outline-none"
                >
                  &times;
                </button>
              </div>

              <div className="flex-1 overflow-y-auto px-6">
                <div className="flex items-center gap-3 mb-3 bg-slate-50 rounded-lg p-3">
                  <span className="font-semibold">{editModal.no_invoice}</span>
                  <span className="inline-flex items-center rounded-md px-2 py-1 text-xs font-medium bg-slate-200 text-slate-700">
                    {editModal.status}
                  </span>
                </div>

                {/* Identitas Penyewa */}
                <div className="bg-slate-50 rounded-lg p-3">
                  <p className="text-xs font-bold uppercase tracking-wide text-slate-600 mb-2">
                    Identitas Penyewa
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="col-span-full">
                      <label className="block text-xs font-semibold text-slate-600 mb-1">
                        Penyewa
                      </label>
                      <input
                        value={editForm.penyewa}
                        onChange={(e) =>
                          setEditForm({ ...editForm, penyewa: e.target.value })
                        }
                        className="w-full rounded-[0.375rem] border-2 border-border bg-surface-card px-3.5 py-2.5 text-sm text-text-primary outline-none transition focus:border-brand focus:ring-2 focus:ring-brand-light disabled:cursor-not-allowed disabled:bg-surface-subtle disabled:opacity-60"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">
                        No. HP
                      </label>
                      <input
                        value={editForm.hp_penyewa}
                        onChange={(e) =>
                          setEditForm({
                            ...editForm,
                            hp_penyewa: e.target.value,
                          })
                        }
                        inputMode="numeric"
                        className="w-full rounded-[0.375rem] border-2 border-border bg-surface-card px-3.5 py-2.5 text-sm text-text-primary outline-none transition focus:border-brand focus:ring-2 focus:ring-brand-light disabled:cursor-not-allowed disabled:bg-surface-subtle disabled:opacity-60"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">
                        Jaminan
                      </label>
                      <SearchableSelect
                        options={OPSI_JAMINAN}
                        value={editForm.jaminan_sewa}
                        onChange={(v) =>
                          setEditForm({ ...editForm, jaminan_sewa: v })
                        }
                        placeholder="Pilih jaminan..."
                        noSearch
                      />
                    </div>
                    <div className="col-span-full">
                      <label className="block text-xs font-semibold text-slate-600 mb-1">
                        Alamat
                      </label>
                      <textarea
                        value={editForm.alamat_penyewa}
                        onChange={(e) =>
                          setEditForm({
                            ...editForm,
                            alamat_penyewa: e.target.value,
                          })
                        }
                        rows={2}
                        className="w-full resize-y rounded-[0.375rem] border-2 border-border bg-surface-card px-3.5 py-2.5 text-sm text-text-primary outline-none transition focus:border-brand focus:ring-2 focus:ring-brand-light disabled:cursor-not-allowed disabled:bg-surface-subtle disabled:opacity-60"
                      />
                    </div>
                  </div>
                </div>

                {/* Jadwal */}
                <div className="mt-3 bg-slate-50 rounded-lg p-3">
                  <p className="text-xs font-bold uppercase tracking-wide text-slate-600 mb-2">
                    Jadwal
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-[#7181E0] mb-1">
                        Waktu Ambil
                      </label>
                      <DateTimePicker
                        value={editForm.waktu_ambil_rencana}
                        onChange={(v) =>
                          ubahEditWaktu({ waktu_ambil_rencana: v })
                        }
                        minDate={new Date()}
                        filterTime={filterTime}
                        showTime
                        placeholder="Pilih tgl & jam"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-[#F04438] mb-1">
                        Waktu Kembali
                      </label>
                      <DateTimePicker
                        value={editForm.waktu_kembali_rencana}
                        onChange={(v) =>
                          ubahEditWaktu({ waktu_kembali_rencana: v })
                        }
                        minDate={editForm.waktu_ambil_rencana || new Date()}
                        showTime
                        placeholder="Pilih tgl & jam"
                      />
                    </div>
                  </div>
                </div>

                {/* Printilan */}
                {printilanDaftar.length > 0 && (
                  <div className="mt-3 bg-slate-50 rounded-lg p-3">
                    <p className="text-xs font-bold uppercase tracking-wide text-slate-600 mb-2">
                      Printilan
                    </p>
                    <div className="flex flex-wrap gap-x-4 gap-y-2">
                      {printilanDaftar.map((item) => (
                        <label
                          key={item}
                          className="flex items-center gap-1.5 text-sm text-gray-700 cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={printilanTerpilih.includes(item)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setPrintilanTerpilih([
                                  ...printilanTerpilih,
                                  item,
                                ]);
                              } else {
                                setPrintilanTerpilih(
                                  printilanTerpilih.filter((x) => x !== item),
                                );
                              }
                            }}
                            className="h-4 w-4 rounded border-gray-300 accent-[#7181E0]"
                          />
                          {item}
                        </label>
                      ))}
                    </div>
                    <input
                      type="text"
                      value={printilanCustom}
                      onChange={(e) => setPrintilanCustom(e.target.value)}
                      placeholder="Printilan lain (pisahkan dengan koma)..."
                      className="mt-3 w-full rounded-[0.375rem] border-2 border-border bg-surface-card px-3.5 py-2.5 text-sm text-text-primary outline-none transition focus:border-brand focus:ring-2 focus:ring-brand-light"
                    />
                  </div>
                )}

                {/* Barang */}
                <div className="mt-3 rounded-xl border-2 border-solid border-slate-200 overflow-hidden">
                  <p className="font-semibold mb-2 px-3 pt-3">Barang</p>
                  <table className="table-fixed w-full border-collapse text-sm">
                    <thead className="bg-slate-100 text-xs font-bold uppercase tracking-wide text-slate-600">
                      <tr>
                        <th className="px-4 py-3 text-left">Nama Barang</th>
                        <th className="px-4 py-3 text-center">Qty</th>
                        <th className="px-4 py-3 text-left">S/N / Komponen</th>
                        <th className="px-4 py-3 text-right">Aksi</th>
                      </tr>
                    </thead>
                    <tbody>
                      {editItems.length === 0 && (
                        <tr>
                          <td
                            colSpan={4}
                            className="px-4 py-6 text-center text-gray-500 italic"
                          >
                            Belum ada barang.
                          </td>
                        </tr>
                      )}
                      {editItems.map((item, idx) => (
                        <tr key={idx} className="bg-white even:bg-slate-50">
                          <td className="px-4 py-3 align-middle font-semibold">
                            {item.ref.nama}
                          </td>
                          <td className="px-4 py-3 align-middle text-center text-gray-600">
                            {item.qty}x
                          </td>
                          <td className="px-4 py-3 align-middle text-gray-600">
                            {item.ref.jenis === "satuan" ? (
                              <span
                                className="text-xs"
                                style={{ fontFamily: "ui-monospace, monospace" }}
                              >
                                {item.sn}
                              </span>
                            ) : (
                              <div className="flex flex-col gap-1">
                                {(item.assignedSNs || []).length === 0 ? (
                                  <span className="text-xs">Paket Bundling</span>
                                ) : (
                                  (item.assignedSNs || []).map((a, ai) => (
                                    <div key={ai}>
                                      <span className="font-semibold">
                                        {a.nama}:
                                      </span>{" "}
                                      <span
                                        className="text-xs"
                                        style={{
                                          fontFamily: "ui-monospace, monospace",
                                        }}
                                      >
                                        {(a.sns || []).join(", ")}
                                      </span>
                                    </div>
                                  ))
                                )}
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-3 align-middle text-right">
                            <button
                              type="button"
                              onClick={() => hapusEditItem(idx)}
                              className="border-0 bg-transparent text-xs font-bold text-danger"
                              style={{ cursor: "pointer" }}
                            >
                              Hapus
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Tambah Barang */}
                <details className="mt-3 rounded-xl border-2 border-solid border-[#7181E0] bg-[#7181E0]/10 p-3">
                  <summary
                    className="text-xs font-bold"
                    style={{
                      color: "#7181E0",
                      cursor: "pointer",
                      userSelect: "none",
                    }}
                  >
                    + Tambah Barang
                  </summary>
                  <div className="flex flex-col gap-2 mt-2">
                    <SearchableSelect
                      options={opsiEdit}
                      value={editSelectedId}
                      onChange={async (v) => {
                        setEditSelectedId(v);
                        if (v) {
                          await isiSnEdit(v);
                          const qtyInp =
                            document.getElementById("edit_qty_input");
                          if (qtyInp) {
                            const item = inv.find((i) => i.id == v);
                            if (item?.jenis === "satuan")
                              qtyInp.style.display = "none";
                            else {
                              qtyInp.style.display = "";
                              qtyInp.value = 1;
                            }
                          }
                        }
                      }}
                      placeholder="-- Pilih Barang --"
                    />
                    <div
                      id="area_edit_sn"
                      style={{ display: showEditSn ? "" : "none" }}
                    >
                      <SearchableSelect
                        options={editSnOptions}
                        value={editSnDipilih}
                        onChange={(v) => setEditSnDipilih(v)}
                        placeholder="Pilih S/N..."
                        noSearch
                      />
                    </div>
                    <input
                      type="number"
                      id="edit_qty_input"
                      className="w-full rounded-[0.375rem] border-2 border-border bg-surface-card px-3.5 py-2.5 text-sm text-text-primary outline-none transition focus:border-brand focus:ring-2 focus:ring-brand-light"
                      style={{ display: "none" }}
                      defaultValue={1}
                      min={1}
                    />
                    <button
                      type="button"
                      onClick={tambahEditItem}
                      className="inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-brand focus:ring-offset-2 bg-[#579171] text-white shadow-sm hover:bg-[#447057] w-full"
                    >
                      Tambahkan
                    </button>
                  </div>
                </details>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-solid border-slate-200 px-6 pb-6 pt-4">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={batalkanBooking}
                    disabled={editModal.status === "Disewa" || Boolean(loading)}
                    title={
                      editModal.status === "Disewa"
                        ? "Barang sudah diambil. Gunakan Terima Kembali di board Status Sewa."
                        : ""
                    }
                    className={
                      editModal.status === "Disewa" || loading
                        ? "inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-brand focus:ring-offset-2 border-2 border-solid border-[#7181E0] text-[#7181E0] bg-transparent disabled:cursor-not-allowed disabled:opacity-60"
                        : "inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-brand focus:ring-offset-2 bg-[#F04438] text-white shadow-sm hover:bg-[#d03a2f]"
                    }
                  >
                    Batalkan
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditModal(null)}
                    className="inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-brand focus:ring-offset-2 bg-transparent text-gray-600 hover:bg-surface-secondary"
                  >
                    Tutup
                  </button>
                </div>
                <button
                  type="button"
                  onClick={simpanEdit}
                  disabled={Boolean(loading)}
                  className="inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-brand focus:ring-offset-2 bg-[#579171] text-white shadow-sm hover:bg-[#447057] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Simpan
                </button>
              </div>
            </div>
          </div>,
          document.body,
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
