"use client";

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useDebounce } from "use-debounce";
import { getSetting, getSettingTenant, getStok, promoSudahKadaluarsa, getInventory, getInventoryByIds, updateInventory, getTransactionsAktif, updateTransactions, tambahTransactions, getLastDbError, getPromoCodes, validasiPromo, pakaiPromo, tambahLogs, getNamaInvoice, buatIDUnik, getPelangganSuggestions, uploadBuktiBayar, cekBlacklist, getBlacklist } from "@/lib/db";

import {
  formatAngkaInput,
  formatRupiah,
  hitungDurasi,
  hitungSubtotal,
  kondisiUnit,
  catatanUnit,
  parseJaminan,
  terBlacklist,
  bebasJumlahPerPeriode,
} from "@/lib/utils";
import { getFITUR } from "@/lib/features";
import BuktiDropzone from "@/components/BuktiDropzone";
import SearchableSelect from "@/components/SearchableSelect";
import DateTimePicker from "@/components/DateTimePicker";
import LoadingOverlay from "@/components/LoadingOverlay";
import PilihSN from "@/components/PilihSN";
import PanelJaminan from "@/components/booking/PanelJaminan";
import PanelAksesoris from "@/components/booking/PanelAksesoris";
import InputHP from "@/components/ui/InputHP";

import {
  DEFAULT_JAMINAN,
  TANPA_JAMINAN,
  toggleJaminan,
  bangunIndeks,
  snsTerpakaiIdx,
  snsBebasIdx,
  hitungStokIdx,
  batasAmbilMundur,
} from "@/lib/booking/helpers";
import { hitungDiskonMurni } from "@/lib/booking/diskon";
import { filterTime, lewatJamTutup } from "@/lib/booking/jam";


export default function FormBookingBaru({ mode = "page", daftarAktif = [], katalog = null, notify = () => {}, confirmChoice = async () => null, onSukses, onTutup }) {
  const [invFetched, setInvFetched] = useState([]);
  const inv = useMemo(() => katalog !== null ? (katalog || []) : invFetched, [katalog, invFetched]);
  const trx = daftarAktif;
  const [cart, setCart] = useState([]);
  const [kalkulasi, setKalkulasi] = useState({
    error: "Pilih waktu",
    biaya: 0,
    durasi_teks: "-",
  });
  const [ambilWaktu, setAmbilWaktu] = useState(null);
  const [kembaliWaktu, setKembaliWaktu] = useState(null);
  const [showCustom, setShowCustom] = useState(false);
  const [selectedDurasi, setSelectedDurasi] = useState(null);
  const [selectedProductId, setSelectedProductId] = useState("");
  const [dpJumlah, setDpJumlah] = useState("");
  const [dpMetode, setDpMetode] = useState("Tunai");
  const [buktiFile, setBuktiFile] = useState(null);
  const [printilanTerpilih, setPrintilanTerpilih] = useState([]);
  const [printilanCustom, setPrintilanCustom] = useState("");
  const [printilanDaftar, setPrintilanDaftar] = useState([]);
  const [printilanMode, setPrintilanMode] = useState("dicentang");
  const [loading, setLoading] = useState("");
  // true selama simpan booking: muat() dan listener dataChanged menahan diri,
  // jadi satu indikator loading menutup simpan + muat ulang data.
  const sedangSimpan = useRef(false);
  const [jaminanTerpilih, setJaminanTerpilih] = useState(["E-KTP"]);
  const [daftarJaminan, setDaftarJaminan] = useState(DEFAULT_JAMINAN);
  const [snOptions, setSnOptions] = useState([]);
  const [snDipilih, setSnDipilih] = useState("");
  const [snKeranjang, setSnKeranjang] = useState(null);
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
  const [blacklistHit, setBlacklistHit] = useState(null);

  // Cek blacklist saat nama/HP penyewa berubah (debounce 500ms).
  const [identitasCek] = useDebounce(`${namaPenyewa}|${hp_penyewa}`, 500);
  useEffect(() => {
    const [nama, hp] = String(identitasCek || "").split("|");
    if (!nama.trim() || !hp.trim()) {
      setBlacklistHit(null);
      return;
    }
    let aktif = true;
    cekBlacklist(nama.trim(), hp.trim()).then((h) => {
      if (aktif) setBlacklistHit(h?.hit ? h : null);
    });
    return () => {
      aktif = false;
    };
  }, [identitasCek]);

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

  // Handoff gantt → booking: item dari Tracking Alat dititipkan lewat sessionStorage.
  // Ref item sudah membawa objek inventory utuh, jadi tidak perlu tunggu katalog.
  useEffect(() => {
    if (typeof window === "undefined" || prefillTerpakai.current) return;
    prefillTerpakai.current = true;
    (async () => {
      try {
        const raw = sessionStorage.getItem("rentalpro_booking_prefill");
        if (!raw) return;
        sessionStorage.removeItem("rentalpro_booking_prefill");
        const data = JSON.parse(raw);
        const ambilISO = typeof data?.ambilISO === "string" ? data.ambilISO : "";
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
        setCart(items);
      } catch (e) {
        notify("Prefill booking gagal dibaca: " + e.message, "error");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        const [daftar, mode, daftarJaminanTenant] = await Promise.all([
          getSettingTenant("printilan_daftar", []),
          getSettingTenant("printilan_invoice_mode", "dicentang"),
          getSettingTenant("daftar_jaminan", DEFAULT_JAMINAN),
        ]);
        if (!aktif) return;
        setPrintilanDaftar(Array.isArray(daftar) ? daftar : []);
        setPrintilanMode(mode || "dicentang");
        const dasar =
          Array.isArray(daftarJaminanTenant) && daftarJaminanTenant.length
            ? daftarJaminanTenant
            : DEFAULT_JAMINAN;
        // "Tanpa Jaminan" selalu tersedia, walau tenant menyesuaikan daftar.
        const dj = dasar.includes(TANPA_JAMINAN)
          ? dasar
          : [...dasar, TANPA_JAMINAN];
        setDaftarJaminan(dj);
        setJaminanTerpilih([
          dj.includes("E-KTP") ? "E-KTP" : dj[0],
        ]);
      } catch { /* ignore - printilan optional */ }
    })();
    return () => { aktif = false; };
  }, []);

  useEffect(() => {
    if (katalog === null) getInventory().then((data) => setInvFetched(data || [])).catch(() => notify("Gagal memuat data booking", "error"));
  }, [katalog, notify]);

  const indeks = useMemo(() => bangunIndeks(daftarAktif, inv), [daftarAktif, inv]);

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



  // Daftar blacklist untuk badge di saran penyewa. Refresh ikut `refresh`
  // (yang sudah naik saat event dataChanged) — tanpa listener dobel.
  const [blacklistArr, setBlacklistArr] = useState([]);
  useEffect(() => {
    let aktif = true;
    getBlacklist().then((list) => {
      if (aktif) setBlacklistArr(Array.isArray(list) ? list : []);
    });
    return () => {
      aktif = false;
    };
  }, []);

  function parseISO(iso) {
    if (!iso) return "";
    return new Date(iso).toISOString().slice(0, 16);
  }

  // Pembungkus: inti perhitungan ada di lib/booking/diskon.js (murni, bisa
  // dipakai ulang modal edit yang dipanggil halaman lain).
  function hitungDiskon(biaya, memberOverride, promoOverride, nowOverride, durasiOverride) {
    return hitungDiskonMurni(biaya, {
      member: memberOverride !== undefined ? memberOverride : memberDipilih,
      promo: promoOverride !== undefined ? promoOverride : promoDipilih,
      totalJam:
        durasiOverride !== undefined ? durasiOverride : kalkulasi.totalJam,
      aturanDiskon,
      pilihSatu,
      diskonCustomInput,
      diskonCustomTipe,
      now: nowOverride !== undefined ? nowOverride : kini,
      fiturMemberPromo: getFITUR().memberPromo,
      promoKadaluarsa: promoSudahKadaluarsa,
    });
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
      const sub = hitungSubtotal(item, dur);
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
    const exist = c.find((item) => item.idBarang == idBarang);
    const stok = pakaiPeriode
      ? bebasJumlahPerPeriode(inv, trx, refBarang, mulaiISO, selesaiISO)
      : getStok(refBarang, inv);
    const qtyBaru = exist ? exist.qty + 1 : 1;
    if (qtyBaru > stok)
      return notify(`Unit bebas tidak cukup (sisa ${stok}).`, "error");

    if (exist) {
      if (exist.sn) notify("S/N yang dikunci dilepas karena jumlah unit berubah.", "warning");
      exist.qty = qtyBaru;
      if (refBarang.jenis === "satuan") exist.sn = "";
    } else {
      c.push({
        idBarang,
        ref: refBarang,
        qty: 1,
        sn: refBarang.jenis === "satuan" ? "" : undefined,
        subtotal: 0,
      });
    }
    hitungTotal(c);
    setSelectedProductId("");
    setSnDipilih("");
    setSnOptions([]);
  }

  function hapusDariKeranjang(idx) {
    const c = [...cartRef.current];
    c.splice(idx, 1);
    hitungTotal(c);
  }

  function ubahQtyKeranjang(idx, nilai) {
    const c = [...cartRef.current];
    // Qty minimal 1: kolom tidak lagi bisa 0, jadi item tidak pernah terhapus
    // otomatis dari sini (hapus hanya lewat tombol Hapus).
    const qty = Math.max(1, parseInt(nilai, 10) || 1);
    const item = c[idx];
    const stok = pakaiPeriode
      ? bebasJumlahPerPeriode(inv, trx, item.ref, mulaiISO, selesaiISO)
      : getStok(item.ref, inv);
    if (qty > stok)
      return notify(`Unit bebas tidak cukup (sisa ${stok}).`, "error");
    const sns = (item.sn || "").split(", ").filter(Boolean);
    if (sns.length && sns.length !== qty)
      return notify("Jumlah S/N terkunci harus sama dengan jumlah unit.", "error");
    item.qty = qty;
    hitungTotal(c);
  }

  // Satu modal untuk seluruh keranjang: barang satuan yang belum dikunci S/N
  // ikut tampil sekaligus, bukan satu baris per modal.
  function kunciSNKeranjang() {
    const entries = cartRef.current
      .map((item, idx) => ({ item, idx }))
      .filter(({ item }) => item.ref?.jenis === "satuan")
      .map(({ item, idx }) => ({
        key: String(idx),
        nama: item.ref?.nama ?? "(barang tidak ditemukan)",
        butuh: item.qty || 1,
        bebas: snsBebasCepat(item.idBarang, mulaiISO, selesaiISO),
        pilihan: (item.sn || "").split(", ").filter(Boolean),
      }));
    if (entries.length === 0) return;
    setSnKeranjang(entries);
  }

  function simpanKunciSNKeranjang(entries) {
    const c = [...cartRef.current];
    for (const e of entries) {
      const item = c[Number(e.key)];
      if (!item) continue;
      item.sn = (e.pilihan || []).join(", ");
    }
    hitungTotal(c);
    setSnKeranjang(null);
  }

  function revalidasiKeranjang(mulaiISO, selesaiISO) {
    if (!mulaiISO || !selesaiISO) return;
    const c = [...cartRef.current];
    const hasil = [];
    let berubah = false;
    c.forEach((item) => {
      if (item.ref.jenis === "satuan") {
        if (!item.sn) {
          hasil.push(item);
          return;
        }
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

  function buildPrintilanSnapshot(
    terpilih = printilanTerpilih,
    custom = printilanCustom,
  ) {
    return {
      mode: printilanMode,
      daftar: printilanDaftar,
      terpilih,
      custom: custom.trim(),
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
  }

  async function buatBooking() {
    const pyw = namaPenyewa;
    const hp = hp_penyewa;
    const alamat = alamat_penyewa;
    const jaminan = jaminanTerpilih;
    if (!pyw || !hp) return notify("Lengkapi Identitas!", "error");
    if (!jaminan.length) return notify("Pilih minimal 1 jaminan.", "error");
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
            if ((t.jaminan_sewa || "") !== jaminan) {
              const a = parseJaminan(t.jaminan_sewa).slice().sort().join("|");
              const b = parseJaminan(jaminan).slice().sort().join("|");
              if (a !== b) return false;
            }
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
        const refInventaris = rawInv.find((i) => i.id == item.idBarang) || item.ref;
        const bebas = bebasJumlahPerPeriode(inv, trxAllSebelum, refInventaris, ambilISO, kembaliISO, excludeId);
        if (item.qty > bebas)
          return notify(`Unit bebas tidak cukup untuk ${item.ref.nama} (sisa ${bebas}).`, "error");
        if (item.ref.jenis === "satuan") {
          const snsTerkunci = (item.sn || "").split(", ").filter(Boolean);
          if (snsTerkunci.length && snsTerkunci.length !== item.qty)
            return notify("Jumlah S/N terkunci harus sama dengan jumlah unit.", "error");
          const terpakai = snsTerpakaiIdx(
            idx,
            item.idBarang,
            ambilISO,
            kembaliISO,
            excludeId,
          );
          for (let s of (item.sn || "").split(", ").filter(Boolean)) {
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
      for (let item of c) {
        if (item.ref.jenis === "satuan") {
          let dbItem = tempInv.find((i) => i.id == item.idBarang);
          if (!dbItem)
            return notify(
              `Barang ${item.ref.nama} tidak ditemukan di inventaris!`,
              "error",
            );
          let snList = (item.sn || "").split(", ").filter(Boolean);
          for (let s of snList) {
            let snIdx = (dbItem.sns || []).indexOf(s);
            if (snIdx !== -1) dbItem.sns.splice(snIdx, 1);
          }
          if (snList.length) invDiubah.add(dbItem.id);
        }
        // Paket: S/N komponen dipilih saat Serahkan (status/page.js), jadi tidak
        // ada yang dicadangkan di sini; biarkan assignedSNs apa adanya.
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
        onSukses?.(target);
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

      if (
        ambilWaktu &&
        new Date(ambilWaktu).getTime() < batasAmbilMundur().getTime()
      ) {
        return notify(
          "Waktu ambil terlalu mundur (maksimal 1/2 jam ke belakang).",
          "error",
        );
      }
      const okSimpan = await tambahTransactions([trxBaru]);
      if (!okSimpan) {
        const pesan = getLastDbError();
        return notify(
          pesan || "Gagal menyimpan booking. Silakan coba lagi.",
          "error",
        );
      }
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
      onSukses?.(trxBaru);
      notify(`Booking berhasil! Invoice: ${trxBaru.no_invoice}`);
    } catch (err) {
      // Rejection API tidak boleh hilang diam-diam: sebelumnya hanya `finally`
      // yang me-reset loading, tanpa pesan yang bisa dipulihkan pengguna.
      console.error("[Booking] Simpan error:", err);
      notify(
        err?.message || "Gagal menyimpan booking. Silakan coba lagi.",
        "error",
      );
    } finally {
      setLoading("");
    }
  }


  return (
    <div className={mode === "modal" ? "p-4" : ""}>
      {mode === "page" && <h2 className="text-2xl font-bold mb-6">Buat Booking Baru</h2>}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <div className="lg:col-span-5">
          <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-surface)] p-4 md:p-6">
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-[var(--color-primary-soft-text)]">
              Identitas Penyewa
            </h3>
            {blacklistHit && (
              <div className="mb-4 flex items-start gap-2 rounded-lg border border-solid border-[var(--color-danger-text,#dc2626)] bg-[var(--color-danger-soft,#fef2f2)] px-4 py-3 text-sm text-[var(--color-danger-text,#dc2626)]">
                <svg
                  className="mt-0.5 h-5 w-5 shrink-0"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                  <line x1="9" y1="9" x2="15" y2="15" />
                  <line x1="15" y1="9" x2="9" y2="15" />
                </svg>
                <span>
                  <strong>Penyewa ter-blacklist.</strong>{" "}
                  {blacklistHit.alasan
                    ? `Alasan: ${blacklistHit.alasan}.`
                    : "Penyewa ini pernah bermasalah."}{" "}
                  Booking tetap bisa dilanjutkan, hati-hati.
                </span>
              </div>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="mb-2 block text-[12.5px] font-bold tracking-[0.02em] text-[var(--text-primary)]">
                  Penyewa
                </label>
                <div className="relative">
                  <input
                    id="nama_penyewa"
                    className="appearance-none border-solid rounded-md block w-full px-3 py-2.5 text-[14px] outline-none transition-colors duration-200 border border-[var(--border-color)] bg-[var(--bg-surface)] text-[var(--text-primary)] focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20 disabled:cursor-not-allowed disabled:bg-[var(--bg-subtle)] disabled:opacity-60"
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
                        className="bg-[var(--bg-surface)] border rounded-xl shadow-lg border-[var(--border-color)] p-6"
                        style={{
                          position: "absolute",
                          top: "calc(100% + 4px)",
                          left: 0,
                          right: 0,
                          zIndex: 60,
                          maxHeight: 220,
                          overflowY: "auto",
                          boxShadow: "0 8px 24px rgba(0, 0, 0, 0.16)",
                        }}
                      >
                        {saranMember.map((m) => (
                          <button
                            key={m.id}
                            type="button"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => pilihMemberSaran(m)}
                            className="px-4 py-2 rounded bg-[var(--bg-surface)] text-[var(--text-primary)] hover:bg-[var(--bg-subtle)] px-3 py-2 text-sm"
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              alignItems: "center",
                              width: "100%",
                              borderRadius: 0,
                              padding: "8px 12px",
                              borderBottom: "1px solid var(--border-color)",
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
                              <span className="flex flex-wrap gap-1">
                                {m.sumber === "member" && (
                                  <span className="inline-block rounded text-[10px] px-1.5 py-0.5 bg-[#579171] text-white">
                                    Member
                                  </span>
                                )}
                                {terBlacklist(blacklistArr, { nama: m.nama, hp: m.hp }) && (
                                  <span className="inline-block rounded text-[10px] px-1.5 py-0.5 bg-red-600 text-white">
                                    Blacklist
                                  </span>
                                )}
                              </span>
                            </span>
                            <span className="text-xs text-[var(--text-secondary)]">
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
                <label className="mb-2 block text-[12.5px] font-bold tracking-[0.02em] text-[var(--text-primary)]">
                  No. HP
                </label>
                <InputHP name="hp_penyewa" ariaLabel="No. HP penyewa" value={hp_penyewa} onChange={setHpPenyewa} />
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <PanelJaminan
                daftar={daftarJaminan}
                terpilih={jaminanTerpilih}
                onToggle={(o) => setJaminanTerpilih((p) => toggleJaminan(p, o))}
              />
              <div>
                <label className="mb-2 block text-[12.5px] font-bold tracking-[0.02em] text-[var(--text-secondary)]">
                  Alamat
                </label>
                <textarea
                  id="alamat_penyewa"
                  rows={2}
                  value={alamat_penyewa}
                  onChange={(e) => setAlamatPenyewa(e.target.value)}
                  className="appearance-none border-solid rounded-md block w-full px-3 py-2.5 text-[14px] outline-none transition-colors duration-200 border border-[var(--border-color)] bg-[var(--bg-surface)] text-[var(--text-secondary)] focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20 disabled:cursor-not-allowed disabled:bg-[var(--bg-subtle)] disabled:opacity-60 resize-y"
                />
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="mb-2 block text-[12.5px] font-bold tracking-[0.02em] text-[var(--text-secondary)]">
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
                      // snap 30 menit: 00-14 -> :00, 15-44 -> :30, 45-59 -> jam berikutnya
                      const rounded = Math.round(m / 30) * 30;
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
                <label className="mb-2 block text-[12.5px] font-bold tracking-[0.02em] text-[var(--text-secondary)]">
                  Durasi Sewa
                </label>
                <div className="flex flex-wrap gap-2">
                  {durasiCepat.map((d) => (
                    <button
                      key={d.jam}
                      type="button"
                      onClick={() => isiDurasi(d.jam)}
                      className={`rounded-full border px-3 py-1.5 text-sm ${selectedDurasi === d.jam ? "border-[var(--color-primary-soft-text)] bg-[#7181E0] text-white" : "border-[var(--border-color)] bg-[var(--bg-subtle)] text-[var(--text-primary)]"}`}
                    >
                      {d.label}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={pilihCustom}
                    className={`rounded-full border px-3 py-1.5 text-sm ${showCustom ? "border-[var(--color-primary-soft-text)] bg-[#7181E0] text-white" : "border-[var(--border-color)] bg-[var(--bg-subtle)] text-[var(--text-primary)]"}`}
                  >
                    Custom
                  </button>
                </div>
              </div>
            </div>
            {showCustom && (
              <div className="grid grid-cols-1 sm:grid-cols-2 mt-4">
                <div className="col-span-full">
                  <label className="mb-2 block text-[12.5px] font-bold tracking-[0.02em] text-[var(--text-secondary)]">
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
            {kembaliWaktu && lewatJamTutup(kembaliWaktu) && (
              <div className="mt-3 flex items-start gap-2 rounded-lg border border-[var(--color-warning-text,#b45309)] bg-[var(--color-warning-soft,#fffbeb)] px-3 py-2 text-sm text-[var(--color-warning-text,#b45309)]">
                <svg
                  className="mt-0.5 h-4 w-4 shrink-0"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path
                    fillRule="evenodd"
                    d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495ZM10 5a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 10 5Zm0 9a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"
                    clipRule="evenodd"
                  />
                </svg>
                <span>
                  Waktu kembali melewati jam operasional (tutup{" "}
                  {parseInt(getSetting("jam_tutup", "22"), 10) || 22}.00).
                  Booking tetap bisa disimpan.
                </span>
              </div>
            )}
          </div>

          <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-surface)] p-4 md:p-6 mt-4">
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-[var(--color-primary-soft-text)]">
              Barang
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] items-end gap-3 mb-3">
              <div className="flex-[3] min-w-0">
                <label className="mb-2 block text-[12.5px] font-bold tracking-[0.02em] text-[var(--text-secondary)]">
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
              <button
                type="button"
                onClick={tambahKeKeranjang}
                className="flex min-h-12 items-center justify-center whitespace-nowrap rounded-md border border-transparent bg-[#579171] px-4 py-2.5 text-base font-medium leading-[1.6] text-white transition-colors hover:bg-[#447057]"
              >
                Masukkan
              </button>
            </div>

            <div className="overflow-x-auto rounded-lg border border-[var(--border-color)]">
              <table className="w-full min-w-[560px] border-collapse text-sm">
                <colgroup>
                  <col style={{ width: "30%" }} />
                  <col style={{ width: "20%" }} />
                  <col style={{ width: "10%" }} />
                  <col style={{ width: "15%" }} />
                  <col style={{ width: "15%" }} />
                  <col style={{ width: "10%" }} />
                </colgroup>
                <thead className="bg-[var(--bg-subtle)]">
                  <tr className="border-b-2 border-[var(--border-color)]">
                    <th className="text-left py-2.5 px-3 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-secondary)] border-r border-[var(--border-color)]">
                      Produk
                    </th>
                    <th className="text-left py-2.5 px-3 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-secondary)] border-r border-[var(--border-color)]">
                      S/N
                    </th>
                    <th className="text-center py-2.5 px-3 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-secondary)] border-r border-[var(--border-color)]">
                      Qty
                    </th>
                    <th className="text-right py-2.5 px-3 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-secondary)] border-r border-[var(--border-color)]">
                      Harga
                    </th>
                    <th className="text-right py-2.5 px-3 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-secondary)] border-r border-[var(--border-color)]">
                      Total
                    </th>
                    <th className="py-2.5 px-3 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]"></th>
                  </tr>
                </thead>
                <tbody>
                  {cart.length === 0 && (
                    <tr>
                      <td
                        colSpan={6}
                        className="text-center text-[var(--text-secondary)] py-4 italic"
                      >
                        Keranjang kosong.
                      </td>
                    </tr>
                  )}
                  {cart.map((c, idx) => (
                    <tr
                      key={idx}
                      className="border-b border-[var(--border-color)] hover:bg-[var(--bg-subtle)]"
                    >
                      <td className="font-semibold py-3 px-2 border-r border-[var(--border-color)] truncate">
                        {c.ref.nama}
                      </td>
                      <td className="text-xs py-3 px-2 border-r border-[var(--border-color)] text-[#7181E0] max-w-[16rem] break-words whitespace-normal">
                        {c.ref.jenis === "satuan" ? (
                          <>
                            <button
                              type="button"
                              onClick={() => kunciSNKeranjang()}
                              className="inline-block max-w-full truncate align-bottom text-xs text-[#7181E0] underline decoration-dotted"
                              title="Klik untuk memilih S/N"
                            >
                              {c.sn ? c.sn : "Pilih S/N"}
                            </button>
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
                        ) : (c.assignedSNs || []).length > 0 ? (
                          <div className="flex flex-col gap-0.5">
                            {c.assignedSNs.map((a, ai) => (
                              <div key={ai} className="text-[11px] leading-tight">
                                <span className="font-semibold">{a.nama}:</span>{" "}
                                <span
                                  style={{
                                    fontFamily: "ui-monospace, monospace",
                                  }}
                                >
                                  {(a.sns || []).join(", ")}
                                </span>
                              </div>
                            ))}
                          </div>
                        ) : (c.ref.komponen || []).length > 0 ? (
                          <div className="flex flex-col gap-0.5">
                            {(c.ref.komponen || []).map((k, ki) => (
                              <div
                                key={ki}
                                className="text-[11px] leading-tight text-[var(--text-secondary)]"
                              >
                                {k.qty}x {k.nama}
                              </div>
                            ))}
                          </div>
                        ) : (
                          "Paket Bundling"
                        )}
                      </td>
                      <td className="text-center py-3 px-2 border-r border-[var(--border-color)]">
                        <input type="text" inputMode="numeric" value={c.qty} onChange={(e) => ubahQtyKeranjang(idx, e.target.value.replace(/\D/g, ""))} className="w-16 rounded border border-[var(--border-color)] bg-[var(--bg-surface)] px-2 py-1 text-center" aria-label={`Jumlah ${c.ref.nama}`} />
                      </td>
                      <td className="text-right text-[var(--text-primary)] py-3 px-2 border-r border-[var(--border-color)]">
                        {formatRupiah(c.hargaSatuan || 0)}
                      </td>
                      <td className="text-right font-semibold py-3 px-2 border-r border-[var(--border-color)]">
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

            <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-subtle)] p-4 md:p-6 flex items-center justify-between mt-6 shadow-sm">
              <div>
                <p className="text-13 text-[var(--text-secondary)] mb-0">Durasi:</p>
                <p className="text-lg font-bold mb-0">
                  {kalkulasi.durasi_teks}
                </p>
              </div>
              <div className="text-right">
                <p className="text-13 text-[var(--text-secondary)] mb-0">Total Biaya</p>
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
                          <span className="flex items-center gap-2 text-[var(--text-secondary)]">
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
                          <span className="text-[var(--text-secondary)]">Diskon Promo</span>
                          <span className="text-danger">
                            -{formatRupiah(d.diskonPromo)}
                          </span>
                        </div>
                      )}
                      {d.diskonCustom > 0 && (
                        <div className="flex items-center justify-between">
                          <span className="text-[var(--text-secondary)]">Discount Custom</span>
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
                  className="px-4 py-2 rounded-lg bg-[var(--bg-subtle)] hover:bg-[var(--bg-elevated)] text-[var(--text-secondary)] w-full text-sm font-medium transition-colors outline-none focus:outline-none border-0"
                >
                  {showPromoDiskon ? "− Promo & Diskon" : "+ Promo & Diskon"}
                </button>
                {showPromoDiskon && (
                  <>
                    <div className="flex items-center gap-2 mt-3">
                      <div className="flex-1 min-w-0">
                        <label className="mb-2 block text-[12.5px] font-bold tracking-[0.02em] text-[var(--text-secondary)]">
                          Kode Promo
                        </label>
                        <input
                          type="text"
                          value={kodePromoInput}
                          onChange={(e) =>
                            setKodePromoInput(e.target.value.toUpperCase())
                          }
                          placeholder="Masukkan kode promo"
                          className="appearance-none border-solid rounded-md block w-full px-3 py-2.5 text-[14px] outline-none transition-colors duration-200 border border-[var(--border-color)] bg-[var(--bg-surface)] text-[var(--text-primary)] focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20 disabled:cursor-not-allowed disabled:bg-[var(--bg-subtle)] disabled:opacity-60"
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
                    <div className="flex items-end gap-2 mt-3 flex-wrap">
                      <div className="flex-1 min-w-0">
                        <label className="mb-2 block text-[12.5px] font-bold tracking-[0.02em] text-[var(--text-secondary)]">
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
                          className="appearance-none border-solid rounded-md block w-full px-3 py-2.5 text-[14px] outline-none transition-colors duration-200 border border-[var(--border-color)] bg-[var(--bg-surface)] text-[var(--text-primary)] focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20 disabled:cursor-not-allowed disabled:bg-[var(--bg-subtle)] disabled:opacity-60"
                        />
                      </div>
                      <div className="shrink-0">
                        <label className="mb-2 block text-[12.5px] font-bold tracking-[0.02em] text-[var(--text-secondary)]">
                          Tipe
                        </label>
                        <select
                          value={diskonCustomTipe}
                          onChange={(e) => setDiskonCustomTipe(e.target.value)}
                          className="appearance-none border-solid rounded-md block w-[90px] px-3 py-2.5 text-[14px] outline-none transition-colors duration-200 border border-[var(--border-color)] bg-[var(--bg-surface)] text-[var(--text-secondary)] focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20 disabled:cursor-not-allowed disabled:bg-[var(--bg-subtle)] disabled:opacity-60"
                        >
                          <option value="%">%</option>
                          <option value="Rp">Rp</option>
                        </select>
                      </div>
                    </div>
                    {promoDipilih && (
                      <p className="text-xs text-[var(--text-secondary)] mt-2 mb-0">
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
                            className={`${pilihSatu !== "promo" ? "rounded-lg px-4 py-2 text-sm font-medium transition-colors outline-none focus:outline-none bg-[#7181E0] hover:bg-[#5d6fcc] text-white border-0" : "rounded-lg px-4 py-2 text-sm font-medium transition-colors outline-none focus:outline-none bg-[var(--bg-subtle)] hover:bg-[var(--bg-elevated)] text-[var(--text-secondary)] border-0"}`}
                          >
                            Diskon Member
                          </button>
                          <button
                            type="button"
                            onClick={() => setPilihSatu("promo")}
                            className={`${pilihSatu === "promo" ? "rounded-lg px-4 py-2 text-sm font-medium transition-colors outline-none focus:outline-none bg-[#7181E0] hover:bg-[#5d6fcc] text-white border-0" : "rounded-lg px-4 py-2 text-sm font-medium transition-colors outline-none focus:outline-none bg-[var(--bg-subtle)] hover:bg-[var(--bg-elevated)] text-[var(--text-secondary)] border-0"}`}
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

          <PanelAksesoris
            daftar={printilanDaftar}
            terpilih={printilanTerpilih}
            custom={printilanCustom}
            onToggle={(item, dicentang) =>
              setPrintilanTerpilih(
                dicentang
                  ? [...printilanTerpilih, item]
                  : printilanTerpilih.filter((x) => x !== item),
              )
            }
            onChangeCustom={setPrintilanCustom}
          />

          <div
            className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-surface)] p-4 md:p-6 mt-4"
            style={{
              background: "var(--bg-surface)",
              borderColor: "var(--border-color)",
            }}
          >
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-[var(--color-primary-soft-text)]">
              Uang Muka / DP (Opsional)
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-2">
              <div>
                <label className="mb-2 block text-[12.5px] font-bold tracking-[0.02em] text-[var(--text-secondary)]">
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
                  className="appearance-none border-solid rounded-md block w-full px-3 py-2.5 text-[14px] outline-none transition-colors duration-200 border border-[var(--border-color)] bg-[var(--bg-surface)] text-[var(--text-primary)] focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20 disabled:cursor-not-allowed disabled:bg-[var(--bg-subtle)] disabled:opacity-60"
                />
              </div>
              <div>
                <label className="mb-2 block text-[12.5px] font-bold tracking-[0.02em] text-[var(--text-secondary)]">
                  Metode Bayar
                </label>
                <div className="flex gap-2 flex-wrap">
                  {["Tunai", "Transfer", "QRIS"].map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setDpMetode(m)}
                      className={`rounded-full border px-3 py-1.5 text-sm ${dpMetode === m ? "border-[var(--color-primary-soft-text)] bg-[#7181E0] text-white" : "border-[var(--border-color)] bg-[var(--bg-subtle)] text-[var(--text-primary)]"}`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            {parseFloat(dpJumlah) > 0 && (
              <div className="mt-3">
                <label className="mb-2 block text-[12.5px] font-bold tracking-[0.02em] text-[var(--text-secondary)]">
                  Bukti Pembayaran (Opsional)
                </label>
                <BuktiDropzone value={buktiFile} onChange={setBuktiFile} />
              </div>
            )}
            <p className="mt-3 rounded-lg bg-[var(--bg-subtle)] px-3 py-2 text-xs text-[var(--text-secondary)]">
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

</div>

            {snKeranjang && (
        <PilihSN
          subjudul="Pilih unit yang akan dimasukkan ke keranjang."
          labelUtama="Masukkan"
          entries={snKeranjang}
          onBatal={() => setSnKeranjang(null)}
          onSimpan={simpanKunciSNKeranjang}
        />
      )}
      {onTutup && mode === "modal" && <button type="button" onClick={onTutup}>Tutup</button>}
      {loading && (
        <LoadingOverlay
          teks={loading}
          subteks="Mohon tunggu, jangan tutup halaman ini..."
        />
      )}
    </div>
  );
}
