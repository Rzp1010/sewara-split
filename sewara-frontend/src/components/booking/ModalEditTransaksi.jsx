"use client";

// Modal edit transaksi (dipakai halaman Booking; siap dipanggil halaman lain,
// mis. Status Sewa). State edit hidup di dalam komponen ini.
import { useState, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";

import {
  getSetting,
  getSettingTenant,
  getStok,
  getInventory,
  getInventoryByIds,
  updateInventory,
  getTransactionsAktif,
  updateTransactions,
  getLastDbError,
  getNamaInvoice,
  getPelangganSuggestions,
  getPromoCodes,
  promoSudahKadaluarsa,
} from "@/lib/db";
import {
  hitungDurasi,
  hitungSubtotal,
  kondisiUnit,
  catatanUnit,
  parseJaminan,
  bebasJumlahPerPeriode,
  hpNormal,
} from "@/lib/utils";
import { getFITUR } from "@/lib/features";
import InputHP from "@/components/ui/InputHP";
import {
  DEFAULT_JAMINAN,
  TANPA_JAMINAN,
  toggleJaminan,
  bangunIndeks,
  hitungStokIdx,
  snsRujukLainIdx,
  snsTerpakaiIdx,
  snsBebasIdx,
} from "@/lib/booking/helpers";
import { hitungDiskonMurni } from "@/lib/booking/diskon";
import { filterTime, lewatJamTutup } from "@/lib/booking/jam";
import { useNotify } from "@/components/NotificationProvider";
import SearchableSelect from "@/components/SearchableSelect";
import DateTimePicker from "@/components/DateTimePicker";
import PilihSN from "@/components/PilihSN";
import PanelAksesoris from "@/components/booking/PanelAksesoris";

export default function ModalEditTransaksi({
  trx,
  invAwal,
  trxAwal,
  loading = "",
  setLoading = () => {},
  onClose = () => {},
  onSaved = () => {},
  onBatalkan = null,
}) {
  const { notify } = useNotify();

  // Data pendukung: pakai kiriman halaman kalau ada, kalau tidak ambil sendiri.
  const [inv, setInv] = useState(invAwal || []);
  const [trxAll, setTrxAll] = useState(trxAwal || []);
  const [daftarMember, setDaftarMember] = useState([]);
  const [daftarPromo, setDaftarPromo] = useState([]);
  const [aturanDiskon, setAturanDiskon] = useState({
    stack: "terbesar",
    maksPersen: 50,
    minTransaksi: 0,
  });
  const [printilanDaftar, setPrintilanDaftar] = useState([]);
  const [printilanMode, setPrintilanMode] = useState("dicentang");
  const [daftarJaminan, setDaftarJaminan] = useState(DEFAULT_JAMINAN);

  // Nilai awal dibangun dari transaksi yang sedang dibuka.
  const [editForm, setEditForm] = useState(() => ({
    penyewa: trx.penyewa,
    hp_penyewa: trx.hp_penyewa,
    alamat_penyewa: trx.alamat_penyewa || "",
    jaminan_sewa: parseJaminan(trx.jaminan_sewa),
    waktu_ambil_rencana: trx.waktu_ambil_rencana
      ? new Date(trx.waktu_ambil_rencana)
      : null,
    waktu_kembali_rencana: trx.waktu_kembali_rencana
      ? new Date(trx.waktu_kembali_rencana)
      : null,
  }));
  const [editItems, setEditItems] = useState(() =>
    JSON.parse(JSON.stringify(trx.items || [])),
  );
  const [editSelectedId, setEditSelectedId] = useState("");
  const [editPrintilanTerpilih, setEditPrintilanTerpilih] = useState(
    () => trx.printilan?.terpilih || [],
  );
  const [editPrintilanCustom, setEditPrintilanCustom] = useState(
    () => trx.printilan?.custom || "",
  );
  const [editSnModal, setEditSnModal] = useState(null);
  const [editSnOptions, setEditSnOptions] = useState([]);
  const [editSnDipilih, setEditSnDipilih] = useState("");
  const [showEditSn, setShowEditSn] = useState(false);

  useEffect(() => {
    let aktif = true;
    (async () => {
      try {
        const [iv, tx, members, promos, stack, maks, min, pl, mode, dj] =
          await Promise.all([
            invAwal?.length ? invAwal : getInventory(),
            trxAwal?.length ? trxAwal : getTransactionsAktif(),
            getPelangganSuggestions(),
            getPromoCodes(),
            getSettingTenant("diskon_stack", "terbesar"),
            getSettingTenant("diskon_maks_persen", 50),
            getSettingTenant("promo_min_transaksi", 0),
            getSettingTenant("printilan_daftar", []),
            getSettingTenant("printilan_invoice_mode", "dicentang"),
            getSettingTenant("daftar_jaminan", DEFAULT_JAMINAN),
          ]);
        if (!aktif) return;
        setInv(iv || []);
        setTrxAll(tx || []);
        setDaftarMember(members || []);
        setDaftarPromo(promos || []);
        setAturanDiskon({
          stack,
          maksPersen: Number(maks) || 0,
          minTransaksi: Number(min) || 0,
        });
        setPrintilanDaftar(Array.isArray(pl) ? pl : []);
        setPrintilanMode(mode || "dicentang");
        const dasar = Array.isArray(dj) && dj.length ? dj : DEFAULT_JAMINAN;
        // "Tanpa Jaminan" selalu tersedia, walau tenant menyesuaikan daftar.
        setDaftarJaminan(
          dasar.includes(TANPA_JAMINAN) ? dasar : [...dasar, TANPA_JAMINAN],
        );
      } catch {
        /* data pendukung opsional: modal tetap bisa dibuka */
      }
    })();
    return () => {
      aktif = false;
    };
  }, [invAwal, trxAwal]);

  const indeks = useMemo(() => bangunIndeks(trxAll, inv), [trxAll, inv]);

  function hitungStokBebas(item, mulaiISO, selesaiISO, kecualiId) {
    return hitungStokIdx(indeks, item, mulaiISO, selesaiISO, kecualiId);
  }

  function snsBebasCepat(idBarang, mulaiISO, selesaiISO, kecualiId) {
    return snsBebasIdx(indeks, idBarang, mulaiISO, selesaiISO, kecualiId);
  }

  function buildPrintilanSnapshot(terpilih, custom) {
    return {
      mode: printilanMode,
      daftar: printilanDaftar,
      terpilih,
      custom: String(custom || "").trim(),
    };
  }

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
          ? hitungStokBebas(item, mulaiE, selesaiE, trx?.id)
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
    trx?.id,
  ]);

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
        ? bebasJumlahPerPeriode(inv, trxAll, refBarang, mulaiISO, selesaiISO, trx.id)
        : getStok(refBarang, inv);
    if (stok < 1) return notify("Stok habis!", "error");

    if (refBarang.jenis === "satuan") {
      const qtyInput = document.getElementById("edit_qty_input");
      const qty = Math.max(1, parseInt(qtyInput?.value || 1, 10) || 1);
      const exist = editItems.find((x) => x.idBarang == editSelectedId);
      const totalQty = (exist?.qty || 0) + qty;
      if (totalQty > stok)
        return notify(`Unit bebas tidak cukup (sisa ${stok}).`, "error");
      if (exist) {
        exist.qty = totalQty;
        exist.sn = "";
      } else {
        editItems.push({ idBarang: editSelectedId, ref: refBarang, qty, sn: "", subtotal: 0 });
      }
    } else {
      const qtyInput = document.getElementById("edit_qty_input");
      const qty = parseInt(qtyInput?.value || 1);
      const exist = editItems.find((x) => x.idBarang == editSelectedId);
      if (qty < 1 || qty + (exist?.qty || 0) > stok)
        return notify(`Unit bebas tidak cukup (sisa ${stok}).`, "error");
      if (exist) {
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

  function ubahQtyEdit(idx, nilai) {
    // Qty minimal 1 (sama seperti keranjang): tidak ada penghapusan otomatis.
    const qty = Math.max(1, parseInt(nilai, 10) || 1);
    const items = [...editItems];
    const item = items[idx];
    const mulai = editForm.waktu_ambil_rencana?.toISOString() || "";
    const selesai = editForm.waktu_kembali_rencana?.toISOString() || "";
    const stok = mulai && selesai
      ? bebasJumlahPerPeriode(inv, trxAll, item.ref, mulai, selesai, trx?.id)
      : getStok(item.ref, inv);
    if (qty > stok) return notify(`Unit bebas tidak cukup (sisa ${stok}).`, "error");
    const sns = (item.sn || "").split(", ").filter(Boolean);
    if (sns.length && sns.length !== qty) return notify("Jumlah S/N terkunci harus sama dengan jumlah unit.", "error");
    items[idx] = { ...item, qty };
    setEditItems(items);
  }

  // Satu modal untuk semua baris satuan (selaras modal booking/status sewa).
  function kunciSNEdit() {
    const mulaiISO = editForm.waktu_ambil_rencana
      ? new Date(editForm.waktu_ambil_rencana).toISOString()
      : "";
    const selesaiISO = editForm.waktu_kembali_rencana
      ? new Date(editForm.waktu_kembali_rencana).toISOString()
      : "";
    const entries = editItems
      .map((item, idx) => ({ item, idx }))
      .filter(({ item }) => item?.ref?.jenis === "satuan")
      .map(({ item, idx }) => ({
        key: String(idx),
        nama: item.ref?.nama ?? "(barang tidak ditemukan)",
        butuh: item.qty || 1,
        bebas: snsBebasCepat(item.idBarang, mulaiISO, selesaiISO, trx.id),
        pilihan: (item.sn || "").split(", ").filter(Boolean),
      }));
    if (entries.length === 0) return;
    setEditSnModal(entries);
  }

  function simpanKunciSNEdit(entries) {
    const items = [...editItems];
    for (const e of entries) {
      const item = items[Number(e.key)];
      if (!item) continue;
      items[Number(e.key)] = { ...item, sn: (e.pilihan || []).join(", ") };
    }
    setEditItems(items);
    setEditSnModal(null);
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
          ? snsBebasIdx(indeks, item.id, mulaiISO, selesaiISO, trx.id)
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

  async function simpanEdit() {
    const t = trx;
    if (!t) return;
    const ambil = editForm.waktu_ambil_rencana?.toISOString() || "";
    const kembali = editForm.waktu_kembali_rencana?.toISOString() || "";
    const dur = hitungDurasi(ambil, kembali);
    if (dur.error) return notify(dur.error, "error");
    if (lewatJamTutup(editForm.waktu_kembali_rencana))
      notify(
        `Waktu kembali lewat jam tutup (${parseInt(getSetting("jam_tutup", "22"), 10) || 22}.00). Perubahan tetap tersimpan.`,
        "warning",
      );

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

      // Validasi periode baru terhadap transaksi lain
      for (let item of editItems) {
        const refInventaris = rawInv.find((i) => i.id == item.idBarang) || item.ref;
        const stokBebasJumlah = bebasJumlahPerPeriode(inv, trxAllSebelum, refInventaris, ambil, kembali, t.id);
        if (item.qty > stokBebasJumlah)
          return notify(`Unit bebas tidak cukup untuk ${item.ref?.nama ?? "barang tidak ditemukan"} (sisa ${stokBebasJumlah}).`, "error");
        if (item.ref.jenis === "satuan") {
          const snsTerkunci = (item.sn || "").split(", ").filter(Boolean);
          if (snsTerkunci.length && snsTerkunci.length !== item.qty)
            return notify("Jumlah S/N terkunci harus sama dengan jumlah unit.", "error");
          const terpakai = snsTerpakaiIdx(
            idx,
            item.idBarang,
            ambil,
            kembali,
            t.id,
          );
          for (let s of (item.sn || "").split(", ").filter(Boolean)) {
            if (terpakai.includes(s))
              return notify(
                `S/N ${s} pada ${item.ref?.nama ?? "barang tidak ditemukan"} sudah di-booking pada periode tersebut.`,
                "error",
              );
          }
        } else {
          const stokBebas = hitungStokIdx(idx, item.ref, ambil, kembali, t.id);
          if (item.qty > stokBebas)
            return notify(
              `Stok ${item.ref?.nama ?? "barang tidak ditemukan"} tidak cukup pada periode tersebut.`,
              "error",
            );
        }
      }

      // Kurangi stok untuk barang baru di editItems (pakai salinan agar tidak memutasi state)
      const editItemsBaru = editItems.map((item) => ({ ...item }));
      for (let item of editItemsBaru) {
        if (item.ref.jenis === "satuan") {
          let dbItem = tempInv.find((i) => i.id == item.idBarang);
          if (!dbItem)
            return notify(`Barang ${item.ref?.nama ?? "barang tidak ditemukan"} tidak ditemukan!`, "error");
          let snList = (item.sn || "").split(", ").filter(Boolean);
          for (let s of snList) {
            let snIdx = (dbItem.sns || []).indexOf(s);
            if (snIdx !== -1) dbItem.sns.splice(snIdx, 1);
          }
          if (snList.length) invDiubah.add(dbItem.id);
        }
        // Paket: S/N komponen dipilih saat Serahkan; tidak ada pencadangan di sini.
      }

      let totalBiaya = 0;
      editItemsBaru.forEach((item) => {
        const sub = hitungSubtotal(item, dur);
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
      const dEdit = hitungDiskonMurni(totalBiaya, {
        member: memberLama,
        promo: promoLama,
        totalJam: dur.totalJam,
        aturanDiskon,
        now: Date.now(),
        fiturMemberPromo: getFITUR().memberPromo,
        promoKadaluarsa: promoSudahKadaluarsa,
      });

      const namaPelayan = (await getNamaInvoice()) || "-";
      const trxBaru = {
        ...t,
        items: editItemsBaru,
        penyewa: editForm.penyewa,
        hp_penyewa: hpNormal(editForm.hp_penyewa),
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
        printilan: buildPrintilanSnapshot(
          editPrintilanTerpilih,
          editPrintilanCustom,
        ),
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
      onClose();
      onSaved();
      notify("Jadwal berhasil diperbarui!");
    } finally {
      setLoading("");
    }
  }

  if (!trx || typeof document === "undefined") return null;

  return (
    <>
      {editSnModal && (
        <PilihSN
          subjudul="Pilih unit yang akan dimasukkan ke transaksi."
          labelUtama="Simpan"
          entries={editSnModal}
          onBatal={() => setEditSnModal(null)}
          onSimpan={simpanKunciSNEdit}
        />
      )}
      {createPortal(
        <div
          onClick={() => onClose()}
          className="fixed inset-0 z-[9999] flex items-center justify-center overflow-y-auto bg-black/50 p-4 backdrop-blur-sm"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative flex max-h-[90vh] w-full max-w-4xl flex-col rounded-xl border-2 border-solid border-[var(--border-color)] bg-[var(--bg-surface)] shadow-2xl"
          >
            <div className="mb-4 flex items-center justify-between px-6 pt-6">
              <h3 className="text-lg font-semibold">
                Edit Booking
                <span className="ml-2 text-sm font-normal text-[var(--text-secondary)]">
                  {editForm.penyewa || trx.no_invoice}
                </span>
              </h3>
              <button
                type="button"
                onClick={() => onClose()}
                aria-label="Tutup"
                className="inline-flex items-center justify-center rounded-lg px-4 py-2 text-xl font-semibold text-[var(--text-secondary)] transition-colors hover:bg-surface-secondary focus:outline-none"
              >
                &times;
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6">
              <div className="flex items-center gap-3 mb-3 bg-[var(--bg-subtle)] rounded-lg p-3">
                <span className="font-semibold">{trx.no_invoice}</span>
                <span className="inline-flex items-center rounded-md px-2 py-1 text-xs font-medium bg-[var(--bg-subtle)] text-[var(--text-secondary)]">
                  {trx.status}
                </span>
              </div>

              {/* Identitas Penyewa */}
              <div className="bg-[var(--bg-subtle)] rounded-lg p-3">
                <p className="text-xs font-bold uppercase tracking-wide text-[var(--text-secondary)] mb-2">
                  Identitas Penyewa
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="col-span-full">
                    <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">
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
                    <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">
                      No. HP
                    </label>
                    <InputHP name="hp_penyewa" ariaLabel="No. HP penyewa" value={editForm.hp_penyewa || ""} onChange={(hp_penyewa) => setEditForm({ ...editForm, hp_penyewa })} daftarPembanding={daftarMember} onPilihDuplikat={(orang) => setEditForm({ ...editForm, penyewa: orang.nama, hp_penyewa: hpNormal(orang.hp), alamat_penyewa: orang.alamat || editForm.alamat_penyewa })} />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">
                      Jaminan
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {daftarJaminan.map((o) => {
                        const arr = editForm.jaminan_sewa || [];
                        const aktif = arr.includes(o);
                        const nonaktif =
                          o !== TANPA_JAMINAN &&
                          arr.includes(TANPA_JAMINAN);
                        return (
                          <button
                            key={o}
                            type="button"
                            disabled={nonaktif}
                            onClick={() =>
                              setEditForm({
                                ...editForm,
                                jaminan_sewa: toggleJaminan(arr, o),
                              })
                            }
                            className={`${aktif ? "rounded-lg px-3 py-1.5 text-xs font-medium bg-[#7181E0] text-white border-0" : "rounded-lg px-3 py-1.5 text-xs font-medium bg-[var(--bg-subtle)] text-[var(--text-secondary)] border-0 hover:bg-[var(--bg-subtle)]"} ${nonaktif ? "opacity-40 cursor-not-allowed" : ""}`}
                          >
                            {aktif ? "✓ " : ""}
                            {o}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div className="col-span-full">
                    <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">
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
              <div className="mt-3 bg-[var(--bg-subtle)] rounded-lg p-3">
                <p className="text-xs font-bold uppercase tracking-wide text-[var(--text-secondary)] mb-2">
                  Jadwal
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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

              {/* Aksesoris */}
              {printilanDaftar.length > 0 && (
                <PanelAksesoris
                  varian="modal"
                  daftar={printilanDaftar}
                  terpilih={editPrintilanTerpilih}
                  custom={editPrintilanCustom}
                  onToggle={(item, dicentang) =>
                    setEditPrintilanTerpilih(
                      dicentang
                        ? [...editPrintilanTerpilih, item]
                        : editPrintilanTerpilih.filter((x) => x !== item),
                    )
                  }
                  onChangeCustom={setEditPrintilanCustom}
                />
              )}

              {/* Barang */}
              <div className="mt-3 rounded-xl border-2 border-solid border-[var(--border-color)] overflow-x-auto">
                <p className="font-semibold mb-2 px-3 pt-3">Barang</p>
                <table className="w-full min-w-[640px] border-collapse text-sm">
                  <thead className="bg-[var(--bg-subtle)] text-xs font-bold uppercase tracking-wide text-[var(--text-secondary)]">
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
                          className="px-4 py-6 text-center text-[var(--text-secondary)] italic"
                        >
                          Belum ada barang.
                        </td>
                      </tr>
                    )}
                    {editItems.map((item, idx) => (
                      <tr key={idx} className="bg-[var(--bg-surface)] even:bg-[var(--bg-subtle)]">
                        <td className="px-4 py-3 align-middle font-semibold">
                          {item.ref?.nama ?? "barang tidak ditemukan"}
                        </td>
                        <td className="px-4 py-3 align-middle text-center text-[var(--text-secondary)]">
                          <input type="text" inputMode="numeric" value={item.qty} onChange={(e) => ubahQtyEdit(idx, e.target.value.replace(/\D/g, ""))} className="w-16 rounded border border-[var(--border-color)] bg-[var(--bg-surface)] px-2 py-1 text-center" aria-label={`Jumlah ${item.ref?.nama ?? "barang tidak ditemukan"}`} />
                        </td>
                        <td className="px-4 py-3 align-middle text-[var(--text-secondary)]">
                          {item.ref.jenis === "satuan" ? (
                            <button
                              type="button"
                              onClick={() => kunciSNEdit()}
                              className="inline-block max-w-full truncate align-bottom text-xs text-[#7181E0] underline decoration-dotted"
                              style={{ fontFamily: "ui-monospace, monospace" }}
                              title="Klik untuk memilih S/N"
                            >
                              {item.sn || "Pilih S/N"}
                            </button>
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
                           qtyInp.style.display = "";
                          qtyInp.value = 1;
                        }
                      }
                    }}
                    placeholder="-- Pilih Barang --"
                  />
                  <input
                    type="text"
                    inputMode="numeric"
                    id="edit_qty_input"
                    className="w-full rounded-[0.375rem] border-2 border-border bg-surface-card px-3.5 py-2.5 text-sm text-text-primary outline-none transition focus:border-brand focus:ring-2 focus:ring-brand-light"
                    defaultValue={1}
                    onChange={(e) => {
                      e.target.value = e.target.value.replace(/\D/g, "");
                    }}
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

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-solid border-[var(--border-color)] px-6 pb-6 pt-4">
              <div className="flex flex-wrap items-center gap-2">
                {onBatalkan && (
                  <button
                    type="button"
                    onClick={() => onBatalkan(trx)}
                    disabled={trx.status === "Disewa" || Boolean(loading)}
                    title={
                      trx.status === "Disewa"
                        ? "Barang sudah diambil. Gunakan Terima Kembali di board Status Sewa."
                        : ""
                    }
                    className={
                      trx.status === "Disewa" || loading
                        ? "inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-brand focus:ring-offset-2 border-2 border-solid border-[#7181E0] text-[#7181E0] bg-transparent disabled:cursor-not-allowed disabled:opacity-60"
                        : "inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-brand focus:ring-offset-2 bg-[#F04438] text-white shadow-sm hover:bg-[#d03a2f]"
                    }
                  >
                    Batalkan
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => onClose()}
                  className="inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-brand focus:ring-offset-2 bg-transparent text-[var(--text-secondary)] hover:bg-surface-secondary"
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
    </>
  );
}
