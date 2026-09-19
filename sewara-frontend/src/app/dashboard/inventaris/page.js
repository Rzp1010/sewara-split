"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { getStok, getInventory, updateInventory, hapusInventory, getTransactionsAktif } from "@/lib/db";
import Image from "next/image";
import { createPortal } from "react-dom";

import { formatRupiah, unduhCSV } from "@/lib/utils";
import { useNotify } from "@/components/NotificationProvider";
import { Button } from "@/components/ui";

export default function InventarisPage() {
  const { notify, confirm: konfirm } = useNotify();
  const [inv, setInv] = useState([]);
  const [editId, setEditId] = useState(null);
  const tempKomponenRef = useRef([]);
  const [refresh, setRefresh] = useState(0);
  const [dupModal, setDupModal] = useState(null);
  const [snDelModal, setSnDelModal] = useState(null);
  const [editItem, setEditItem] = useState(null);
  const [editForm, setEditForm] = useState({
    tipeSewa: "fleksibel",
    h6: 0,
    h12: 0,
    h24: 0,
    denda: 0,
    snBaru: "",
  });
  const [showTambah, setShowTambah] = useState(false);
  const [tabTambah, setTabTambah] = useState("manual");
  const [showExport, setShowExport] = useState(false);
  const [csvLoading, setCsvLoading] = useState(false);
  const [trxAktif, setTrxAktif] = useState([]);
  const [tampilkanKosong, setTampilkanKosong] = useState(false);

  async function muat() {
    const [invData, trxAktifData] = await Promise.all([
      getInventory(),
      getTransactionsAktif(),
    ]);
    setInv(invData);
    setTrxAktif(trxAktifData || []);
    setRefresh((r) => r + 1);
  }

  // S/N yang sedang dipegang transaksi aktif (Booking/Disewa) per id barang.
  // inventory.sns = rak; booking memindahkan S/N keluar rak, kembali mendorong masuk lagi.
  const heldMap = useMemo(() => {
    const map = new Map();
    trxAktif.forEach((t) => {
      (t.items || []).forEach((i) => {
        if (!i.idBarang) return;
        const key = String(i.idBarang);
        if (i.assignedSNs?.length) {
          i.assignedSNs.forEach((a) => {
            if (a.idKomp == null) return;
            const kunci = String(a.idKomp);
            map.set(kunci, (map.get(kunci) || 0) + (a.sns || []).length);
          });
        } else if (i.sn) {
          const banyak = String(i.sn)
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean).length;
          map.set(key, (map.get(key) || 0) + banyak);
        }
      });
    });
    return map;
  }, [trxAktif]);

  // Total kepemilikan = rak + yang dipegang transaksi aktif.
  const totalDimiliki = (item, inv) => {
    if (item.jenis === "satuan")
      return (item.sns || []).length + (heldMap.get(String(item.id)) || 0);
    if (!item.komponen || item.komponen.length === 0) return 0;
    return Math.min(
      ...item.komponen.map((k) => {
        const dbItem = inv.find((x) => String(x.id) === String(k.idBarang));
        const shelf = dbItem ? (dbItem.sns || []).length : 0;
        const held = heldMap.get(String(k.idBarang)) || 0;
        return Math.floor((shelf + held) / k.qty);
      }),
    );
  };

  useEffect(() => {
    (async () => {
      const [invData, trxAktifData] = await Promise.all([
        getInventory(),
        getTransactionsAktif(),
      ]);
      setInv(invData);
      setTrxAktif(trxAktifData || []);
    })();
  }, [refresh]);

  useEffect(() => {
    const handler = () => setRefresh((r) => r + 1);
    window.addEventListener("dataChanged", handler);
    return () => window.removeEventListener("dataChanged", handler);
  }, []);

  function toggleJenis(e) {
    const v = e.target.value;
    const satuan = document.getElementById("area_satuan");
    const bundling = document.getElementById("area_bundling");
    if (satuan) satuan.style.display = v === "satuan" ? "" : "none";
    if (bundling) bundling.style.display = v === "bundling" ? "" : "none";
    if (v === "bundling") updateDropdownKomponen();
  }

  function toggleTipeSewa(e) {
    const tipe = e.target.value;
    const h6 = document.getElementById("harga_6");
    const h12 = document.getElementById("harga_12");
    const deskripsi = document.getElementById("deskripsi_tipe_sewa");
    if (tipe === "harian") {
      h6.disabled = true;
      h12.disabled = true;
      h6.required = false;
      h12.required = false;
      h6.value = "";
      h12.value = "";
      h6.className =
        "w-full rounded-md border border-solid border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-[#7181E0] focus:ring-2 focus:ring-[#7181E0]/20 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:opacity-60 text-lg font-bold";
      h12.className =
        "w-full rounded-md border border-solid border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-[#7181E0] focus:ring-2 focus:ring-[#7181E0]/20 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:opacity-60 text-lg font-bold";
      if (deskripsi)
        deskripsi.textContent = "Harian Saja: durasi tetap 24 Jam (mutlak).";
    } else {
      h6.disabled = false;
      h12.disabled = false;
      h6.required = true;
      h12.required = true;
      h6.className =
        "w-full rounded-md border border-solid border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-[#7181E0] focus:ring-2 focus:ring-[#7181E0]/20 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:opacity-60 text-lg font-bold";
      h12.className =
        "w-full rounded-md border border-solid border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-[#7181E0] focus:ring-2 focus:ring-[#7181E0]/20 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:opacity-60 text-lg font-bold";
      if (deskripsi)
        deskripsi.textContent =
          "Fleksibel: tersedia pilihan 6 Jam, 12 Jam, dan 24 Jam.";
    }
  }

  async function updateDropdownKomponen() {
    const select = document.getElementById("komp_pilih");
    select.textContent = "";
    const allInv = await getInventory();
    const listSatuan = allInv.filter((i) => i.jenis === "satuan");
    if (listSatuan.length === 0) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "(Inventaris Satuan Kosong)";
      select.appendChild(opt);
    } else {
      listSatuan.forEach((i) => {
        const opt = document.createElement("option");
        opt.value = String(i.id);
        opt.textContent = `${i.nama} (Tersedia: ${(i.sns || []).length})`;
        select.appendChild(opt);
      });
    }
  }

  async function tambahKomponenTemp() {
    const idBarang = document.getElementById("komp_pilih").value;
    const qty = parseInt(document.getElementById("komp_qty").value);
    if (!idBarang || qty < 1) return;
    const allInv = await getInventory();
    const dbItem = allInv.find((i) => i.id == idBarang);
    if (!dbItem) return;
    tempKomponenRef.current.push({
      idBarang: dbItem.id,
      nama: dbItem.nama,
      qty,
    });
    renderListKomponenTemp();
  }

  function renderListKomponenTemp() {
    const ul = document.getElementById("list_komponen_temp");
    ul.textContent = "";
    if (tempKomponenRef.current.length === 0) {
      const li = document.createElement("li");
      li.className = "text-gray-500";
      li.style.fontStyle = "italic";
      li.textContent = "Belum ada alat.";
      ul.appendChild(li);
      return;
    }
    tempKomponenRef.current.forEach((k, idx) => {
      const li = document.createElement("li");
      li.className = "flex items-center justify-between gap-3";
      li.style.cssText =
        "padding:4px 8px;background:var(--bg-subtle);border:1px solid var(--border-color);border-radius:var(--radius-sm);margin-bottom:4px";
      const span = document.createElement("span");
      span.textContent = `${k.qty}x ${k.nama}`;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "text-red-600 font-bold";
      btn.style.cssText =
        "background:none;border:0;cursor:pointer;font-size:13px;padding:2px 6px";
      btn.textContent = "Hapus";
      btn.addEventListener("click", () => window.tempSplice(idx));
      li.appendChild(span);
      li.appendChild(btn);
      ul.appendChild(li);
    });
  }

  async function tambahBarang(e) {
    e.preventDefault();
    const f = e.target;
    const jenis = document.querySelector(
      'input[name="jenis_produk"]:checked',
    ).value;
    const nama = f.nama_barang.value;
    const tipeSewa = f.tipe_sewa.value;
    const h6 = tipeSewa === "harian" ? 0 : parseInt(f.harga_6.value);
    const h12 = tipeSewa === "harian" ? 0 : parseInt(f.harga_12.value);
    const h24 = parseInt(f.harga_24.value);
    const denda = parseInt(f.denda_jam?.value || 0) || 0;
    if (!nama) return notify("Nama produk wajib diisi!", "error");
    if (!h24) return notify("Tarif 24 Jam wajib diisi!", "error");

    const semuaInv = await getInventory();
    let itemBaru = null;

    if (jenis === "satuan") {
      const snInput = f.sn_barang.value;
      let sns = snInput
        .split(",")
        .map((s) => s.trim().toUpperCase())
        .filter((s) => s !== "");
      if (sns.length === 0)
        return notify("Minimal masukkan 1 Nomor Seri!", "error");
      if (new Set(sns).size !== sns.length)
        return notify("Ada Nomor Seri kembar!", "error");

      const semuaSN = semuaInv
        .filter((i) => i.jenis === "satuan")
        .flatMap((i) => i.sns);
      const dup = sns.find((s) => semuaSN.includes(s));
      if (dup) return notify(`S/N [${dup}] sudah ada di database!`, "error");

      const existing = semuaInv.find(
        (i) =>
          i.jenis === "satuan" && i.nama.toLowerCase() === nama.toLowerCase(),
      );
      if (existing) {
        existing.sns = [...(existing.sns || []), ...sns];
        if (!(await updateInventory([existing])))
          return notify("Gagal menambahkan S/N. Silakan coba lagi.", "error");
        f.reset();
        toggleTipeSewa({ target: { value: "fleksibel" } });
        muat();
        setShowTambah(false);
        return notify(
          `${sns.length} S/N ditambahkan ke produk "${existing.nama}"`,
        );
      }

      itemBaru = {
        jenis,
        nama,
        tipeSewa,
        h6,
        h12,
        h24,
        denda,
        tag: f.tag_barang.value.trim() || "",
      };
      itemBaru.kondisi = f.kondisi_barang.value;
      itemBaru.keterangan = f.keterangan_barang.value || "-";
      itemBaru.sns = sns;
      semuaInv.push(itemBaru);
    } else {
      if (tempKomponenRef.current.length === 0)
        return notify("Paket Bundling minimal 1 komponen!", "error");
      itemBaru = {
        jenis,
        nama,
        tipeSewa,
        h6,
        h12,
        h24,
        denda,
        tag: f.tag_barang.value.trim() || "",
      };
      itemBaru.komponen = [...tempKomponenRef.current];
      tempKomponenRef.current = [];
      renderListKomponenTemp();
      semuaInv.push(itemBaru);
    }
    if (!(await updateInventory([itemBaru])))
      return notify("Gagal menyimpan katalog. Silakan coba lagi.", "error");
    f.reset();
    toggleTipeSewa({ target: { value: "fleksibel" } });
    muat();
    setShowTambah(false);
    notify("Katalog Tersimpan!");
  }

  async function hapusBarang(id) {
    const inv = await getInventory();
    if (
      inv.some(
        (i) =>
          i.jenis === "bundling" &&
          (i.komponen || []).some((k) => k.idBarang == id),
      )
    )
      return notify("Gagal! Alat ini terikat dalam Paket Bundling.", "error");
    if (await konfirm("Yakin hapus produk ini?")) {
      const hasil = await hapusInventory([id]);
      if (!hasil.ok) {
        return notify(
          hasil.code === "INVENTORY_IN_USE"
            ? "Gagal! Produk sudah digunakan dalam transaksi dan tidak dapat dihapus."
            : `Gagal menghapus produk: ${hasil.error}`,
          "error",
        );
      }
      muat();
    }
  }

  async function bukaEdit(id) {
    const inv = await getInventory();
    const item = inv.find((i) => i.id === id);
    if (!item) return;
    setEditId(id);
    setEditItem(item);
    setEditForm({
      tipeSewa: item.tipeSewa || "fleksibel",
      h6: item.h6 || 0,
      h12: item.h12 || 0,
      h24: item.h24 || 0,
      denda: item.denda || 0,
      tag: item.tag || "",
      snBaru: "",
    });
  }

  function tutupEdit() {
    setEditId(null);
    setEditItem(null);
  }

  async function simpanEdit(e) {
    e.preventDefault();
    const inv = await getInventory();
    const item = inv.find((i) => i.id === editId);
    if (!item) return;
    if (editForm.tipeSewa !== "harian") {
      item.h6 = parseInt(editForm.h6);
      item.h12 = parseInt(editForm.h12);
    }
    item.h24 = parseInt(editForm.h24);
    item.denda = parseInt(editForm.denda);
    item.tipeSewa = editForm.tipeSewa;
    item.tag = (editForm.tag || "").trim();
    if (item.jenis === "satuan") {
      const text = editForm.snBaru;
      if (text.trim() !== "") {
        let snsBaru = text
          .split(",")
          .map((s) => s.trim().toUpperCase())
          .filter((s) => s !== "");
        const semuaInv = await getInventory();
        const semuaSN = semuaInv
          .filter((i) => i.jenis === "satuan")
          .flatMap((i) => i.sns);
        const dup = snsBaru.find((s) => semuaSN.includes(s));
        if (dup)
          return notify(`Gagal! S/N [${dup}] sudah ada di database!`, "error");
        item.sns = [...(item.sns || []), ...snsBaru];
      }
    }
    if (!(await updateInventory([item])))
      return notify("Gagal menyimpan perubahan. Silakan coba lagi.", "error");
    tutupEdit();
    muat();
    notify("Perubahan disimpan!");
  }

  // Parser CSV sadar-kutip: field di dalam "..." boleh berisi pemisah; "" = kutip lolos.
  function parseBarisCSV(line, delim) {
    const out = [];
    let cur = "";
    let inQuote = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuote) {
        if (ch === '"') {
          if (line[i + 1] === '"') {
            cur += '"';
            i++;
          } else inQuote = false;
        } else cur += ch;
      } else if (ch === '"') {
        inQuote = true;
      } else if (ch === delim) {
        out.push(cur);
        cur = "";
      } else cur += ch;
    }
    out.push(cur);
    return out;
  }

  // Deteksi pemisah file: hitung ; vs , DI LUAR kutipan dari baris pertama berisi data.
  function deteksiDelimCSV(line) {
    let semikolon = 0;
    let koma = 0;
    let inQuote = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuote) {
        if (ch === '"') inQuote = false;
      } else if (ch === '"') inQuote = true;
      else if (ch === ";") semikolon++;
      else if (ch === ",") koma++;
    }
    return semikolon > koma ? ";" : ",";
  }

  async function prosesCSV() {
    if (csvLoading) return;
    const file = document.getElementById("file_csv").files[0];
    if (!file) return notify("Pilih file CSV!", "error");
    setCsvLoading(true);
    const reader = new FileReader();
    reader.onload = async function (e) {
      try {
        const baris = e.target.result.split("\n");
        const delim = deteksiDelimCSV(baris.find((l) => l.trim()) || "");
        const inv = await getInventory();
        const semuaSN = inv
          .filter((i) => i.jenis === "satuan")
          .flatMap((i) => i.sns);
        const rows = [];
        const drop = { format: 0, snKosong: 0, bundling: 0 };

        for (let i = 1; i < baris.length; i++) {
          const str = baris[i].trim();
          if (!str) continue;
          const k = parseBarisCSV(str, delim);
          if (k.length >= 8) {
            const bersihkan = (s) => (s || "").trim();
            const nama = bersihkan(k[0]);
            const tipeSewa =
              bersihkan(k[1]).toLowerCase() === "harian"
                ? "harian"
                : "fleksibel";
            const h6 = parseInt(bersihkan(k[2])) || 0;
            const h12 = parseInt(bersihkan(k[3])) || 0;
            const h24 = parseInt(bersihkan(k[4])) || 0;
            const denda = parseInt(bersihkan(k[5])) || 0;
            const snRaw = bersihkan(k[6]);
            let snsArray = [];
            const isBundling = snRaw.toLowerCase().includes("bundling");
            if (snRaw !== "" && !isBundling) {
              snsArray = snRaw
                .split("/")
                .map((s) => s.trim().toUpperCase())
                .filter((s) => s !== "");
            }
            const KONDISI_VALID = [
              "Sangat Baik",
              "Baik",
              "Rusak Ringan",
              "Rusak Berat",
            ];
            const kondisiRaw = bersihkan(k[7]);
            const kondisi =
              KONDISI_VALID.find(
                (v) => v.toLowerCase() === kondisiRaw.toLowerCase(),
              ) || "Baik";
            const keterangan = bersihkan(k[8]) || "-";
            const tag = bersihkan(k[9]) || "";
            if (nama && snsArray.length > 0)
              rows.push({
                nama,
                tipeSewa,
                h6,
                h12,
                h24,
                denda,
                sns: snsArray,
                kondisi,
                keterangan,
                tag,
              });
            else if (isBundling) drop.bundling++;
            else if (nama) drop.snKosong++;
          } else {
            drop.format++;
          }
        }

        const rincian = () => {
          const bagian = [];
          if (drop.format > 0) bagian.push(`${drop.format} baris format salah`);
          if (drop.snKosong > 0) bagian.push(`${drop.snKosong} tanpa S/N`);
          if (drop.bundling > 0) bagian.push(`${drop.bundling} baris bundling`);
          return bagian.join(", ");
        };

        if (rows.length === 0) {
          const rinc = rincian();
          return notify(
            rinc
              ? `Tidak ada data yang diimpor. ${rinc}.`
              : "Gagal. Pastikan file CSV sesuai format.",
            "error",
          );
        }

        const dupSNs = rows.flatMap((r) =>
          r.sns.filter((s) => semuaSN.includes(s)),
        );
        const uniqueDups = [...new Set(dupSNs)];
        let dupAction = null;

        if (uniqueDups.length > 0) {
          const detailData = rows
            .map((r) => {
              const dupSNs = r.sns.filter((s) => semuaSN.includes(s));
              if (dupSNs.length === 0) return null;
              const existingItem = inv.find(
                (x) =>
                  x.jenis === "satuan" &&
                  x.sns?.some((s) => dupSNs.includes(s)),
              );
              return {
                produk: r.nama,
                sn: dupSNs,
                adaDi: existingItem?.nama || "-",
              };
            })
            .filter(Boolean);

          const firstChoice = await new Promise((resolve) => {
            setDupModal({ detail: detailData, resolve, stage: "intro" });
          });
          if (!firstChoice) return;
          dupAction = firstChoice;

          if (firstChoice === "skip") {
            rows.forEach((r) => {
              r.sns = r.sns.filter((s) => !semuaSN.includes(s));
            });
          }
        }

        let jml = 0;
        const byId = new Map();
        rows.forEach((r, i) => {
          if (r.sns.length === 0) return;
          const existing = inv.find(
            (x) =>
              x.jenis === "satuan" &&
              x.nama.toLowerCase() === r.nama.toLowerCase(),
          );
          if (existing) {
            existing.sns = [...new Set([...(existing.sns || []), ...r.sns])];
            byId.set(existing.id, existing);
          } else {
            const itemBaru = {
              jenis: "satuan",
              nama: r.nama,
              tipeSewa: r.tipeSewa,
              kondisi: r.kondisi,
              keterangan: r.keterangan,
              tag: r.tag,
              h6: r.h6,
              h12: r.h12,
              h24: r.h24,
              denda: r.denda,
              sns: r.sns,
            };
            inv.push(itemBaru);
            byId.set(itemBaru, itemBaru);
          }
          jml++;
        });

        const dupInfo =
          uniqueDups.length > 0
            ? ` (${uniqueDups.length} S/N duplikat ${
                dupAction === "skip" ? "diabaikan" : "tetap dimasukkan"
              })`
            : "";

        if (jml > 0) {
          if (!(await updateInventory([...byId.values()])))
            return notify("Gagal mengimpor CSV. Silakan coba lagi.", "error");
          muat();
          const rinc = rincian();
          notify(
            `SUKSES! ${jml} alat diimpor.${dupInfo}${rinc ? ` (${rinc})` : ""}`,
          );
          document.getElementById("file_csv").value = "";
        } else {
          const rinc = rincian();
          notify(
            `Tidak ada data yang diimpor.${dupInfo}${rinc ? ` ${rinc}.` : ""}`,
            "error",
          );
        }
      } finally {
        setCsvLoading(false);
      }
    };
    reader.readAsText(file);
  }

  function downloadTemplateCSV() {
    let csv =
      "Nama Alat,TipeSewa(fleksibel/harian),Harga6J,Harga12J,Harga24J,Denda/Jam,NomorSeri(/),Kondisi,Keterangan,Tag Kategori\n";
    csv +=
      '"Sony A7III",fleksibel,75000,125000,150000,15000,"SN-001/SN-002","Sangat Baik","Body + Kit Lens","Kamera Sony"\n';
    csv +=
      '"Tripod Carbon",harian,0,0,25000,5000,"SN-003","Baik","Tripod ringan carbon",""\n';
    unduhCSV(csv, "Template_CSV_Sewara.csv");
  }

  async function hapusSN() {
    if (!snDelModal || snDelModal.selected.length === 0) return;
    const inv = await getInventory();
    const item = inv.find((i) => i.id === snDelModal.id);
    if (!item) return;
    item.sns = item.sns.filter((s) => !snDelModal.selected.includes(s));
    if (!(await updateInventory([item])))
      return notify("Gagal menghapus S/N. Silakan coba lagi.", "error");
    setSnDelModal(null);
    muat();
    notify(
      `${snDelModal.selected.length} S/N berhasil dihapus dari "${item.nama}"`,
    );
  }

  async function exportDataBarang() {
    const inv = await getInventory();
    // Format identik template 10 kolom (tanpa Jenis) — round-trip export->import aman.
    let csv =
      "Nama Alat,TipeSewa(fleksibel/harian),Harga6J,Harga12J,Harga24J,Denda/Jam,NomorSeri(/),Kondisi,Keterangan,Tag Kategori\n";
    inv.forEach((i) => {
      const tag = i.tag || "";
      if (i.jenis === "satuan") {
        let sns = (i.sns || []).join("/");
        csv += `"${i.nama}","${i.tipeSewa}",${i.h6},${i.h12},${i.h24},${i.denda},"${sns}","${i.kondisi || "Baik"}","${i.keterangan || "-"}","${tag}"\n`;
      } else {
        let kompStr = (i.komponen || [])
          .map((k) => `${k.qty}x ${k.nama}`)
          .join(", ");
        csv += `"${i.nama}","${i.tipeSewa}",${i.h6},${i.h12},${i.h24},${i.denda},"Bundling: ${kompStr}","-","-","${tag}"\n`;
      }
    });
    unduhCSV(csv, `Katalog_Sewara.csv`);
  }

  useEffect(() => {
    window.tempSplice = (idx) => {
      tempKomponenRef.current.splice(idx, 1);
      renderListKomponenTemp();
    };
  }, []);

  return (
    <div className="min-h-screen bg-gray-100">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-2xl font-bold">Daftar Katalog Produk</h2>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => {
              setShowTambah(true);
              setTabTambah("manual");
            }}
            className="rounded-lg border-0 bg-[#7181E0] px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#5d6fcc]"
          >
            Tambah Produk
          </button>
          <button
            type="button"
            onClick={() => setShowExport(true)}
            className="rounded-lg border-0 bg-gray-200 px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-gray-300"
          >
            Export Katalog
          </button>
          <button
            type="button"
            onClick={() => setTampilkanKosong((v) => !v)}
            className={`rounded-lg border-0 px-4 py-2 text-sm font-semibold transition-colors ${tampilkanKosong ? "bg-slate-600 text-white hover:bg-slate-700" : "bg-gray-200 text-slate-700 hover:bg-gray-300"}`}
            title="Tampilkan/sembunyikan produk dengan total stok 0"
          >
            Tampilkan yang kosong
          </button>
        </div>
      </div>

      {typeof document !== "undefined" &&
        showTambah &&
        createPortal(
          <div
            className="fixed inset-0 z-[9999] flex items-center justify-center overflow-y-auto bg-black/55 p-4 backdrop-blur-sm"
            onClick={() => setShowTambah(false)}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="relative flex max-h-[90vh] w-full max-w-3xl flex-col rounded-xl border-2 border-solid border-slate-200 bg-white shadow-2xl"
            >
              <div className="flex items-center justify-between border-b border-border px-6 pb-4 pt-6">
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => setTabTambah("manual")}
                    className={`rounded-lg border-0 px-3 py-2 text-sm font-semibold transition-colors ${tabTambah === "manual" ? "bg-[#7181E0] hover:bg-[#5d6fcc] text-white" : "bg-gray-100 hover:bg-gray-200 text-slate-600"}`}
                  >
                    Tambah Manual
                  </button>
                  <button
                    type="button"
                    onClick={() => setTabTambah("import")}
                    className={`rounded-lg border-0 px-3 py-2 text-sm font-semibold transition-colors ${tabTambah === "import" ? "bg-[#7181E0] hover:bg-[#5d6fcc] text-white" : "bg-gray-100 hover:bg-gray-200 text-slate-600"}`}
                  >
                    Import CSV
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => setShowTambah(false)}
                  aria-label="Tutup"
                  className="rounded-lg border-0 bg-transparent hover:bg-gray-100 px-2 py-2 text-xl text-slate-600 transition-colors"
                >
                  &times;
                </button>
              </div>
              <div className="flex-1 overflow-y-auto px-6 pb-6">
                {tabTambah === "manual" ? (
                  <form onSubmit={tambahBarang} className="space-y-3">
                    <div className="flex items-center gap-5 rounded-lg border-2 border-solid border-[#7181E0] bg-[#7181E0]/10 p-4">
                      <label
                        className="text-sm font-semibold"
                        style={{ cursor: "pointer" }}
                      >
                        <input
                          type="radio"
                          name="jenis_produk"
                          value="satuan"
                          defaultChecked
                          onChange={toggleJenis}
                        />{" "}
                        Alat Satuan
                      </label>
                      <label
                        className="text-sm font-semibold"
                        style={{ cursor: "pointer" }}
                      >
                        <input
                          type="radio"
                          name="jenis_produk"
                          value="bundling"
                          onChange={toggleJenis}
                        />{" "}
                        Paket/Bundling
                      </label>
                    </div>
                    <div className="space-y-1">
                      <label className="mb-2 block text-[12.5px] font-bold tracking-[0.02em] text-text-secondary">
                        Nama Produk
                      </label>
                      <input
                        name="nama_barang"
                        required
                        className="w-full rounded-md border border-solid border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-[#7181E0] focus:ring-2 focus:ring-[#7181E0]/20 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:opacity-60 mt-2"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="mb-2 block text-[12.5px] font-bold tracking-[0.02em] text-text-secondary">
                        Tag Kategori{" "}
                        <span className="text-xs text-gray-500">
                          (opsional)
                        </span>
                      </label>
                      <input
                        name="tag_barang"
                        list="tag_saran"
                        className="w-full rounded-md border border-solid border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-[#7181E0] focus:ring-2 focus:ring-[#7181E0]/20 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:opacity-60 mt-2"
                        placeholder="Cth: Kamera Sony"
                      />
                      <datalist id="tag_saran">
                        {[
                          ...new Set(
                            inv
                              .map((i) => (i.tag || "").trim())
                              .filter(Boolean),
                          ),
                        ]
                          .sort()
                          .map((t) => (
                            <option key={t} value={t} />
                          ))}
                      </datalist>
                    </div>
                    <div
                      id="area_satuan"
                      className="grid grid-cols-2 gap-4 rounded-lg border-2 border-solid border-slate-200 bg-slate-50 p-4"
                    >
                      <div>
                        <label className="mb-2 block text-[12.5px] font-bold tracking-[0.02em] text-[#7181E0]">
                          Nomor Seri
                        </label>
                        <p className="text-xs text-gray-500 mb-2">
                          Pisahkan dgn koma.
                        </p>
                        <textarea
                          name="sn_barang"
                          rows={3}
                          className="w-full rounded-md border border-solid border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-[#7181E0] focus:ring-2 focus:ring-[#7181E0]/20 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:opacity-60"
                          placeholder="SN-01, SN-02..."
                        />
                      </div>
                      <div
                        className="flex-col"
                        style={{ gap: "var(--space-3)" }}
                      >
                        <div>
                          <label className="mb-2 block text-[12.5px] font-bold tracking-[0.02em] text-text-secondary">
                            Kondisi
                          </label>
                          <select
                            name="kondisi_barang"
                            className="w-full rounded-md border border-solid border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-[#7181E0] focus:ring-2 focus:ring-[#7181E0]/20 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:opacity-60 mt-2"
                          >
                            <option value="Sangat Baik">Sangat Baik</option>
                            <option value="Baik">Baik</option>
                            <option value="Cukup">Cukup</option>
                          </select>
                        </div>
                        <div>
                          <label className="mb-2 block text-[12.5px] font-bold tracking-[0.02em] text-text-secondary">
                            Keterangan
                          </label>
                          <input
                            name="keterangan_barang"
                            className="w-full rounded-md border border-solid border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-[#7181E0] focus:ring-2 focus:ring-[#7181E0]/20 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:opacity-60 mt-2"
                            placeholder="Cth: Tas lengkap"
                          />
                        </div>
                      </div>
                    </div>
                    <div
                      id="area_bundling"
                      className="rounded-lg border-2 border-solid border-[#F89774] bg-[#F89774]/10 p-4"
                      style={{ display: "none" }}
                    >
                      <label
                        className="mb-2 block text-[12.5px] font-bold tracking-[0.02em] text-text-secondary mb-2"
                        style={{ color: "var(--color-warning-text)" }}
                      >
                        Komponen Paket
                      </label>
                      <div className="flex items-center gap-2 mb-2">
                        <select
                          id="komp_pilih"
                          className="w-full rounded-md border border-solid border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-[#7181E0] focus:ring-2 focus:ring-[#7181E0]/20 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:opacity-60 flex-1 min-w-0"
                        />
                        <input
                          type="number"
                          id="komp_qty"
                          className="w-full rounded-md border border-solid border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-[#7181E0] focus:ring-2 focus:ring-[#7181E0]/20 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:opacity-60"
                          style={{ width: 80 }}
                          placeholder="Qty"
                          min="1"
                          defaultValue={1}
                        />
                        <button
                          type="button"
                          onClick={tambahKomponenTemp}
                          className="rounded-lg border-0 bg-[#F89774] hover:bg-[#e67d5a] px-4 py-2 text-sm font-semibold text-white transition-colors"
                        >
                          Tambah
                        </button>
                      </div>
                      <ul
                        id="list_komponen_temp"
                        className="flex flex-col gap-1 rounded-md border border-solid border-slate-200 bg-white p-2 text-sm"
                        style={{ minHeight: 50 }}
                      />
                    </div>
                    <div className="rounded-lg border-2 border-solid border-[#7181E0] bg-[#7181E0]/10 p-4">
                      <label className="mb-2 block text-[12.5px] font-bold tracking-[0.02em] text-text-secondary mb-2">
                        Tipe Sewa & Harga
                      </label>
                      <select
                        name="tipe_sewa"
                        id="tipe_sewa"
                        onChange={toggleTipeSewa}
                        className="w-full rounded-md border border-solid border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-[#7181E0] focus:ring-2 focus:ring-[#7181E0]/20 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:opacity-60 mb-3 font-semibold"
                      >
                        <option value="fleksibel">Fleksibel</option>
                        <option value="harian">Harian Saja</option>
                      </select>
                      <p
                        id="deskripsi_tipe_sewa"
                        className="text-xs text-gray-500 mb-3"
                      >
                        Fleksibel: tersedia pilihan 6 Jam, 12 Jam, dan 24 Jam.
                      </p>
                      <div className="grid grid-cols-4 gap-3">
                        <div>
                          <label className="mb-2 block text-[12.5px] font-bold tracking-[0.02em] text-text-secondary">
                            Tarif 6 Jam
                          </label>
                          <input
                            type="number"
                            name="harga_6"
                            id="harga_6"
                            required
                            className="w-full rounded-md border border-solid border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-[#7181E0] focus:ring-2 focus:ring-[#7181E0]/20 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:opacity-60 text-lg font-bold"
                          />
                        </div>
                        <div>
                          <label className="mb-2 block text-[12.5px] font-bold tracking-[0.02em] text-text-secondary">
                            Tarif 12 Jam
                          </label>
                          <input
                            type="number"
                            name="harga_12"
                            id="harga_12"
                            required
                            className="w-full rounded-md border border-solid border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-[#7181E0] focus:ring-2 focus:ring-[#7181E0]/20 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:opacity-60 text-lg font-bold"
                          />
                        </div>
                        <div>
                          <label className="mb-2 block text-[12.5px] font-bold tracking-[0.02em] text-[#7181E0]">
                            Tarif 24 Jam
                          </label>
                          <input
                            type="number"
                            name="harga_24"
                            id="harga_24"
                            required
                            className="w-full rounded-md border border-solid border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-[#7181E0] focus:ring-2 focus:ring-[#7181E0]/20 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:opacity-60 text-lg font-bold"
                          />
                        </div>
                        <div>
                          <label
                            className="mb-2 block text-[12.5px] font-bold tracking-[0.02em] text-text-secondary"
                            style={{ color: "var(--color-danger-text)" }}
                          >
                            Denda / Jam
                          </label>
                          <input
                            type="number"
                            name="denda_jam"
                            id="denda_jam"
                            required
                            className="w-full rounded-md border border-solid border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-[#7181E0] focus:ring-2 focus:ring-[#7181E0]/20 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:opacity-60 text-lg font-bold"
                          />
                        </div>
                      </div>
                    </div>
                    <button
                      type="submit"
                      className="rounded-lg border-0 bg-[#7181E0] hover:bg-[#5d6fcc] px-4 py-2 text-base font-semibold text-white transition-colors w-full"
                    >
                      Simpan Produk
                    </button>
                  </form>
                ) : (
                  <div className="space-y-3">
                    <div className="rounded-md border border-solid border-slate-300 bg-slate-50 p-3 text-xs font-mono overflow-x-auto whitespace-nowrap mb-3">
                      <strong>10 Kolom:</strong> NamaAlat, TipeSewa, Harga6J,
                      Harga12J, Harga24J, Denda/Jam, NomorSeri(/), Kondisi,
                      Keterangan, Tag Kategori
                    </div>
                    <div className="flex items-center flex-wrap gap-3">
                      <input
                        type="file"
                        id="file_csv"
                        accept=".csv"
                        className="w-full rounded-md border border-solid border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-[#7181E0] focus:ring-2 focus:ring-[#7181E0]/20 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:opacity-60 text-sm flex-1 min-w-0"
                      />
                      <button
                        type="button"
                        onClick={prosesCSV}
                        disabled={csvLoading}
                        className="rounded-lg border-0 bg-[#579171] hover:bg-[#447057] px-4 py-2 text-sm font-semibold text-white transition-colors disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {csvLoading ? "Mengunggah..." : "Upload"}
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={downloadTemplateCSV}
                      className="rounded-lg border-2 border-solid border-[#7181E0] bg-[#7181E0]/10 px-4 py-2 text-sm font-semibold text-[#7181E0] hover:bg-[#7181E0]/20 transition-colors w-full mt-3"
                    >
                      Download Template CSV
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>,
          document.body,
        )}

      {typeof document !== "undefined" &&
        showExport &&
        createPortal(
          <div
            className="fixed inset-0 z-[9999] flex items-center justify-center overflow-y-auto bg-black/55 p-4 backdrop-blur-sm"
            onClick={() => setShowExport(false)}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="relative flex max-h-[90vh] w-full max-w-md flex-col rounded-xl border-2 border-solid border-slate-200 bg-white shadow-2xl"
            >
              <div className="flex items-center justify-between border-b border-border px-6 pb-4 pt-6">
                <h3 className="text-lg font-semibold">Export Data</h3>
                <button
                  type="button"
                  onClick={() => setShowExport(false)}
                  aria-label="Tutup"
                  className="rounded-lg border-0 bg-transparent hover:bg-gray-100 px-2 py-2 text-xl text-slate-600 transition-colors"
                >
                  &times;
                </button>
              </div>
              <div className="flex-1 overflow-y-auto px-6 pb-6 space-y-3">
                <p className="text-sm text-gray-600">
                  Unduh daftar inventaris (semua produk) ke file CSV.
                </p>
                <button
                  type="button"
                  onClick={exportDataBarang}
                  className="rounded-lg border-0 bg-[#F89774] hover:bg-[#e67d5a] px-4 py-2 text-sm font-semibold text-white transition-colors w-full"
                >
                  Download Inventaris (CSV)
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}

      <div className="overflow-x-auto">
        <table
          className="w-full table-fixed border-collapse text-left text-sm text-text-primary"
          style={{ whiteSpace: "nowrap" }}
        >
          <thead className="bg-slate-100 text-xs font-bold uppercase tracking-wide text-slate-600">
            <tr>
              <th className="border-b border-border px-4 py-3">Jenis</th>
              <th className="border-b border-border px-4 py-3">Produk</th>
              <th className="border-b border-border px-4 py-3">
                Tarif & Denda
              </th>
              <th
                className="border-b border-border px-4 py-3"
                style={{ textAlign: "center" }}
              >
                Stok (Tersedia/Total)
              </th>
              <th
                className="border-b border-border px-4 py-3"
                style={{ textAlign: "center" }}
              >
                Opsi
              </th>
            </tr>
          </thead>
          <tbody>
            {inv.length === 0 && (
              <tr>
                <td
                  colSpan={5}
                  className="text-gray-500"
                  style={{
                    textAlign: "center",
                    padding: "48px 16px",
                    fontStyle: "italic",
                  }}
                >
                  Belum ada data inventaris.
                </td>
              </tr>
            )}
            {inv.length > 0 &&
              (() => {
                let kosongTersembunyi = 0;
                if (!tampilkanKosong)
                  kosongTersembunyi = inv.filter(
                    (i) => totalDimiliki(i, inv) === 0,
                  ).length;
                return kosongTersembunyi > 0 && kosongTersembunyi === inv.length
                  ? [
                      <tr key="kosong-semua">
                        <td
                          colSpan={5}
                          className="text-gray-500"
                          style={{
                            textAlign: "center",
                            padding: "48px 16px",
                            fontStyle: "italic",
                          }}
                        >
                          Semua produk kosong (stok 0). Aktifkan &quot;Tampilkan
                          yang kosong&quot;.
                        </td>
                      </tr>,
                    ]
                  : null;
              })()}
            {(() => {
              // Render-scope filter: jangan mutasi state inv (Del/edit/muat pakai inv penuh).
              const invTampil = tampilkanKosong
                ? inv
                : inv.filter((i) => totalDimiliki(i, inv) > 0);
              const tagSet = [
                ...new Set(
                  invTampil.map((i) => (i.tag || "").trim()).filter(Boolean),
                ),
              ].sort();
              const kelompok = tagSet.map((t) => ({
                tag: t,
                items: invTampil.filter((i) => (i.tag || "").trim() === t),
              }));
              kelompok.push({
                tag: "Tanpa Tag",
                items: invTampil.filter((i) => !(i.tag || "").trim()),
              });
              let globalIdx = 0;
              return kelompok
                .filter((k) => k.items.length > 0)
                .flatMap((kel) => [
                  <tr key={`${kel.tag}-hdr`} className="bg-slate-200">
                    <td
                      colSpan={5}
                      className="px-4 py-3 text-sm font-bold text-gray-900"
                    >
                      <Image
                        src="/icons/tag.png"
                        width={14}
                        height={14}
                        alt=""
                        className="mr-1 inline-block align-middle"
                      />{" "}
                      {kel.tag}{" "}
                      <span className="ml-1 inline-flex items-center rounded-md bg-gray-200 px-2 py-1 text-xs font-medium text-gray-700">
                        {kel.items.length}
                      </span>
                    </td>
                  </tr>,
                  ...kel.items.map((item) => {
                    const currentIdx = globalIdx++;
                    const stok = getStok(item, inv);
                    const badgeJenis =
                      item.jenis === "satuan" ? "Satuan" : "Bundling";
                    const badgeKelas =
                      item.jenis === "satuan"
                        ? "inline-flex items-center rounded px-2 py-1 text-xs font-medium bg-gray-100 text-gray-700"
                        : "inline-flex items-center rounded px-2 py-1 text-xs font-medium bg-yellow-100 text-yellow-800";
                    const isEven = currentIdx % 2 === 0;
                    return (
                      <tr
                        key={item.id}
                        className="transition-colors hover:bg-slate-100"
                        style={{
                          backgroundColor: isEven ? "#ffffff" : "#f8fafc",
                        }}
                      >
                        <td style={{ padding: "8px 12px" }}>
                          <span className={badgeKelas}>{badgeJenis}</span>
                        </td>
                        <td
                          className="text-sm"
                          style={{ padding: "8px 12px", lineHeight: 1.25 }}
                        >
                          <strong>{item.nama}</strong>
                          <br />
                          <span className="text-xs text-gray-500">
                            {item.keterangan || "-"}
                          </span>
                        </td>
                        <td style={{ padding: "8px 12px" }}>
                          {item.tipeSewa === "harian" ? (
                            <>
                              <span
                                className="inline-flex items-center rounded px-2 py-1 text-xs font-medium bg-blue-100 text-blue-800"
                                style={{ fontSize: 10, padding: "1px 6px" }}
                              >
                                HARIAN
                              </span>
                              <br />
                              <span
                                className="text-xs"
                                style={{
                                  lineHeight: 1.8,
                                  color: "var(--text-secondary)",
                                }}
                              >
                                Tarif:{" "}
                                <strong className="text-sm font-bold text-gray-900">
                                  {formatRupiah(item.h24)}
                                </strong>
                              </span>
                            </>
                          ) : (
                            <span
                              className="text-xs"
                              style={{
                                lineHeight: 1.8,
                                color: "var(--text-secondary)",
                              }}
                            >
                              6J:{" "}
                              <strong className="text-sm text-gray-900">
                                {formatRupiah(item.h6)}
                              </strong>
                              <br />
                              12J:{" "}
                              <strong className="text-sm font-bold text-gray-900">
                                {formatRupiah(item.h12)}
                              </strong>
                              <br />
                              24J:{" "}
                              <strong className="text-sm font-bold text-gray-900">
                                {formatRupiah(item.h24)}
                              </strong>
                            </span>
                          )}
                        </td>
                        <td
                          style={{
                            padding: "8px 12px",
                            textAlign: "center",
                            verticalAlign: "middle",
                          }}
                        >
                          {(() => {
                            const total = totalDimiliki(item, inv);
                            const warna =
                              total === 0
                                ? "var(--text-muted)"
                                : stok > 0
                                  ? "#059669"
                                  : "#dc2626";
                            return (
                              <span
                                className="text-lg font-bold"
                                style={{ color: warna }}
                              >
                                {stok}
                                <span
                                  className="text-xs font-normal"
                                  style={{ color: "var(--text-muted)" }}
                                >
                                  {" "}
                                  / {total}
                                </span>{" "}
                                {item.jenis === "satuan" ? "Unit" : "Paket"}
                              </span>
                            );
                          })()}
                          {item.jenis === "satuan" &&
                            item.sns &&
                            item.sns.length > 0 && (
                              <div
                                style={{
                                  maxWidth: 150,
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  whiteSpace: "nowrap",
                                  fontSize: 10,
                                  color: "var(--text-muted)",
                                }}
                              >
                                {item.sns.join(", ")}
                              </div>
                            )}
                          {item.jenis === "bundling" && item.komponen && (
                            <div
                              style={{
                                maxWidth: 150,
                                whiteSpace: "normal",
                                fontSize: 9,
                                color: "var(--text-muted)",
                              }}
                            >
                              (
                              {item.komponen
                                .map((k) => `${k.qty}x ${k.nama}`)
                                .join(", ")}
                              )
                            </div>
                          )}
                        </td>
                        <td
                          style={{ padding: "8px 12px", textAlign: "center" }}
                        >
                          <div className="flex items-center justify-center gap-1">
                            <button
                              type="button"
                              onClick={() => bukaEdit(item.id)}
                              className="rounded-lg border-0 bg-[#7181E0] px-3 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-[#5d6fcc] focus:outline-none focus:ring-2 focus:ring-[#7181E0]/40"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                if (
                                  item.jenis === "satuan" &&
                                  item.sns?.length > 0
                                )
                                  setSnDelModal({
                                    id: item.id,
                                    nama: item.nama,
                                    sns: [...item.sns],
                                    selected: [],
                                  });
                                else hapusBarang(item.id);
                              }}
                              className="rounded-lg border-0 bg-[#F04438] px-3 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-[#d03a2f] focus:outline-none focus:ring-2 focus:ring-[#F04438]/40"
                            >
                              Del
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  }),
                ]);
            })()}
          </tbody>
        </table>
      </div>

      {/* Modal Duplikat SN */}
      {typeof document !== "undefined" &&
        dupModal &&
        createPortal(
          <div
            onClick={() => {
              dupModal.resolve(null);
              setDupModal(null);
            }}
            className="fixed inset-0 z-[9999] flex items-center justify-center overflow-y-auto bg-black/55 p-4 backdrop-blur-sm"
          >
            <div onClick={(e) => e.stopPropagation()}>
              {dupModal.stage === "intro" ? (
                <div className="relative flex max-h-[90vh] w-full max-w-md flex-col rounded-xl border-2 border-solid border-slate-200 bg-white p-6 shadow-2xl">
                  <p className="text-center text-base font-semibold mb-2">
                    Ditemukan {dupModal.detail.length} produk dengan Serial
                    Number duplikat.
                  </p>
                  <div className="flex items-center justify-center gap-3 mt-6">
                    <button
                      type="button"
                      onClick={() => {
                        dupModal.resolve("detail");
                        setDupModal({ ...dupModal, stage: "detail" });
                      }}
                      className="inline-flex items-center justify-center rounded-lg px-4 py-2 font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-brand focus:ring-offset-2 bg-blue-600 text-white hover:bg-blue-700"
                    >
                      Lihat Detail
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        dupModal.resolve(null);
                        setDupModal(null);
                      }}
                      className="inline-flex items-center justify-center rounded-lg px-4 py-2 font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-brand focus:ring-offset-2 border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
                    >
                      Batal
                    </button>
                  </div>
                </div>
              ) : (
                <div className="relative flex max-h-[90vh] w-full max-w-2xl flex-col rounded-xl border-2 border-solid border-slate-200 bg-white shadow-2xl">
                  <div className="flex items-center justify-between border-b border-solid border-slate-200 px-6 pb-4 pt-6">
                    <h3 className="text-lg font-semibold">
                      Detail S/N Duplikat
                    </h3>
                    <button
                      type="button"
                      onClick={() => {
                        dupModal.resolve(null);
                        setDupModal(null);
                      }}
                      className="rounded-lg border-0 bg-transparent hover:bg-gray-100 px-2 py-2 text-xl text-slate-600 transition-colors"
                    >
                      &times;
                    </button>
                  </div>
                  <div className="flex-1 overflow-y-auto px-6 pb-6">
                    <div className="rounded-xl border-2 border-solid border-slate-200 overflow-hidden mb-4">
                      <table className="w-full table-fixed border-collapse text-sm">
                        <thead className="bg-slate-100">
                          <tr>
                            <th className="px-4 py-3 text-xs font-bold uppercase tracking-wide text-slate-600 text-left">
                              Produk (CSV)
                            </th>
                            <th className="px-4 py-3 text-xs font-bold uppercase tracking-wide text-slate-600 text-left">
                              S/N Duplikat
                            </th>
                            <th className="px-4 py-3 text-xs font-bold uppercase tracking-wide text-slate-600 text-left">
                              Sudah Ada di
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {dupModal.detail.map((d, i) => (
                            <tr key={i} className="bg-white even:bg-slate-50">
                              <td className="px-4 py-3 font-semibold">
                                {d.produk}
                              </td>
                              <td className="px-4 py-3 text-xs text-red-600">
                                {d.sn.join(", ")}
                              </td>
                              <td className="px-4 py-3 text-xs text-gray-500">
                                {d.adaDi}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="flex items-center justify-center gap-3 mt-6 flex-wrap">
                      <button
                        type="button"
                        onClick={() => {
                          dupModal.resolve("skip");
                          setDupModal(null);
                        }}
                        className="rounded-lg border-0 bg-[#7181E0] hover:bg-[#5d6fcc] px-4 py-2 text-sm font-semibold text-white transition-colors"
                      >
                        Jangan Masukkan Duplikat
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          dupModal.resolve("force");
                          setDupModal(null);
                        }}
                        className="rounded-lg border-0 bg-[#F04438] hover:bg-[#d03a2f] px-4 py-2 text-sm font-semibold text-white transition-colors"
                      >
                        Tetap Masukkan
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          dupModal.resolve(null);
                          setDupModal(null);
                        }}
                        className="rounded-lg border-0 bg-gray-200 hover:bg-gray-300 px-4 py-2 text-sm font-semibold text-slate-700 transition-colors"
                      >
                        Batal
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>,
          document.body,
        )}

      {/* Modal Hapus S/N */}
      {typeof document !== "undefined" &&
        snDelModal &&
        createPortal(
          <div
            onClick={() => setSnDelModal(null)}
            className="fixed inset-0 z-[9999] flex items-center justify-center overflow-y-auto bg-black/55 p-4 backdrop-blur-sm"
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="relative flex max-h-[90vh] w-full max-w-2xl flex-col rounded-xl border-2 border-solid border-slate-200 bg-white shadow-2xl"
            >
              <div className="flex items-center justify-between border-b border-border px-6 pb-4 pt-6">
                <h3 className="text-lg font-semibold">
                  Hapus S/N - {snDelModal.nama}
                </h3>
                <button
                  type="button"
                  onClick={() => setSnDelModal(null)}
                  className="rounded-lg border-0 bg-transparent hover:bg-gray-100 px-2 py-2 text-xl text-slate-600 transition-colors"
                >
                  &times;
                </button>
              </div>
              <div className="p-6">
                <p className="text-sm text-gray-600 mb-3">
                  Centang S/N yang ingin dihapus:
                </p>
                <div className="max-h-60 overflow-y-auto">
                  {snDelModal.sns.map((s) => (
                    <label
                      key={s}
                      className="flex items-center gap-3 border-b border-solid border-slate-200 py-2.5 px-4 text-sm cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={snDelModal.selected.includes(s)}
                        onChange={() => {
                          const sel = snDelModal.selected;
                          setSnDelModal({
                            ...snDelModal,
                            selected: sel.includes(s)
                              ? sel.filter((x) => x !== s)
                              : [...sel, s],
                          });
                        }}
                        className="h-4 w-4 accent-[#F04438]"
                      />
                      <span style={{ fontFamily: "ui-monospace, monospace" }}>
                        {s}
                      </span>
                    </label>
                  ))}
                </div>
                {snDelModal.selected.length > 0 && (
                  <p className="text-xs text-red-600 mt-2">
                    {snDelModal.selected.length} S/N terpilih
                  </p>
                )}
                <div className="flex items-center gap-3 mt-6">
                  <button
                    type="button"
                    onClick={hapusSN}
                    disabled={snDelModal.selected.length === 0}
                    className="rounded-lg border-0 bg-[#F04438] hover:bg-[#d03a2f] px-4 py-2 text-sm font-semibold text-white transition-colors flex-1"
                  >
                    Hapus{" "}
                    {snDelModal.selected.length > 0
                      ? `(${snDelModal.selected.length})`
                      : ""}
                  </button>
                  <button
                    type="button"
                    onClick={() => setSnDelModal(null)}
                    className="rounded-lg border-0 bg-gray-200 hover:bg-gray-300 px-4 py-2 text-sm font-semibold text-slate-700 transition-colors flex-1"
                  >
                    Batal
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )}

      {/* Modal Edit */}
      {typeof document !== "undefined" &&
        editItem &&
        createPortal(
          <div className="fixed inset-0 z-[9999] flex items-center justify-center overflow-y-auto bg-black/55 p-4 backdrop-blur-sm">
            <div className="relative flex max-h-[90vh] w-full max-w-3xl flex-col rounded-xl border-2 border-solid border-slate-200 bg-white shadow-2xl">
              <div className="flex items-center justify-between border-b border-border px-6 pb-4 pt-6">
                <h3 className="text-lg font-semibold">Edit Produk</h3>
                <button
                  type="button"
                  onClick={() => {
                    setEditItem(null);
                  }}
                  className="rounded-lg border-0 bg-transparent hover:bg-gray-100 px-2 py-2 text-xl text-slate-600 transition-colors"
                >
                  &times;
                </button>
              </div>
              <form
                onSubmit={simpanEdit}
                className="flex-1 overflow-y-auto px-6 pb-6 space-y-3"
              >
                <div className="space-y-1">
                  <label className="mb-2 block text-[12.5px] font-bold tracking-[0.02em] text-text-secondary">
                    Nama Produk
                  </label>
                  <input
                    value={editItem.nama}
                    readOnly
                    className="w-full rounded-md border border-solid border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-[#7181E0] focus:ring-2 focus:ring-[#7181E0]/20 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:opacity-60 font-bold mt-2"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4 rounded-lg border-2 border-solid border-[#7181E0] bg-[#7181E0]/10 p-4">
                  <div
                    className="text-sm font-bold"
                    style={{ gridColumn: "1 / -1" }}
                  >
                    Update Tarif Sewa
                  </div>
                  <div className="space-y-1" style={{ gridColumn: "1 / -1" }}>
                    <label className="mb-2 block text-[12.5px] font-bold tracking-[0.02em] text-text-secondary text-xs">
                      Tag Kategori
                    </label>
                    <input
                      value={editForm.tag}
                      list="tag_saran"
                      onChange={(e) =>
                        setEditForm({ ...editForm, tag: e.target.value })
                      }
                      className="w-full rounded-md border border-solid border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-[#7181E0] focus:ring-2 focus:ring-[#7181E0]/20 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:opacity-60 text-sm"
                      placeholder="Cth: Kamera Sony"
                    />
                  </div>
                  <div className="space-y-1" style={{ gridColumn: "1 / -1" }}>
                    <label className="mb-2 block text-[12.5px] font-bold tracking-[0.02em] text-text-secondary text-xs">
                      Tipe Sewa
                    </label>
                    <select
                      value={editForm.tipeSewa}
                      onChange={(e) =>
                        setEditForm({ ...editForm, tipeSewa: e.target.value })
                      }
                      className="w-full rounded-md border border-solid border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-[#7181E0] focus:ring-2 focus:ring-[#7181E0]/20 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:opacity-60 text-sm"
                    >
                      <option value="fleksibel">Fleksibel</option>
                      <option value="harian">Harian</option>
                    </select>
                  </div>
                  <div>
                    <label className="mb-2 block text-[12.5px] font-bold tracking-[0.02em] text-text-secondary text-xs">
                      Tarif 6 Jam
                    </label>
                    <input
                      type="number"
                      value={editForm.h6}
                      disabled={editForm.tipeSewa === "harian"}
                      onChange={(e) =>
                        setEditForm({ ...editForm, h6: e.target.value })
                      }
                      className="w-full rounded-md border border-solid border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-[#7181E0] focus:ring-2 focus:ring-[#7181E0]/20 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:opacity-60 text-sm"
                    />
                  </div>
                  <div>
                    <label className="mb-2 block text-[12.5px] font-bold tracking-[0.02em] text-text-secondary text-xs">
                      Tarif 12 Jam
                    </label>
                    <input
                      type="number"
                      value={editForm.h12}
                      disabled={editForm.tipeSewa === "harian"}
                      onChange={(e) =>
                        setEditForm({ ...editForm, h12: e.target.value })
                      }
                      className="w-full rounded-md border border-solid border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-[#7181E0] focus:ring-2 focus:ring-[#7181E0]/20 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:opacity-60 text-sm"
                    />
                  </div>
                  <div>
                    <label className="mb-2 block text-[12.5px] font-bold tracking-[0.02em] text-[#7181E0] text-xs">
                      Tarif 24 Jam
                    </label>
                    <input
                      type="number"
                      value={editForm.h24}
                      required
                      onChange={(e) =>
                        setEditForm({ ...editForm, h24: e.target.value })
                      }
                      className="w-full rounded-md border border-solid border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-[#7181E0] focus:ring-2 focus:ring-[#7181E0]/20 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:opacity-60 text-sm"
                    />
                  </div>
                  <div>
                    <label className="mb-2 block text-[12.5px] font-bold tracking-[0.02em] text-[#F04438] text-xs">
                      Denda / Jam
                    </label>
                    <input
                      type="number"
                      value={editForm.denda}
                      required
                      onChange={(e) =>
                        setEditForm({ ...editForm, denda: e.target.value })
                      }
                      className="w-full rounded-md border border-solid border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-[#7181E0] focus:ring-2 focus:ring-[#7181E0]/20 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:opacity-60 text-sm"
                    />
                  </div>
                </div>
                {editItem.jenis === "satuan" && (
                  <div className="rounded-lg border-2 border-solid border-slate-200 bg-slate-50 p-4">
                    <label className="mb-2 block text-[12.5px] font-bold tracking-[0.02em] text-[#7181E0]">
                      Tambah S/N Baru
                    </label>
                    <p className="text-xs text-gray-500 mb-2">
                      Pisahkan dengan koma.
                    </p>
                    <textarea
                      value={editForm.snBaru}
                      onChange={(e) =>
                        setEditForm({ ...editForm, snBaru: e.target.value })
                      }
                      rows={2}
                      className="w-full rounded-md border border-solid border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-[#7181E0] focus:ring-2 focus:ring-[#7181E0]/20 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:opacity-60"
                      placeholder="S/N Tambahan..."
                    />
                  </div>
                )}
                <div className="flex items-center gap-3 mt-4">
                  <button
                    type="button"
                    onClick={() => {
                      const idAsli = editId;
                      tutupEdit();
                      hapusBarang(idAsli);
                    }}
                    className="rounded-lg border-2 border-solid border-[#F04438] bg-transparent hover:bg-[#F04438]/10 px-4 py-2 text-sm font-semibold text-[#F04438] transition-colors"
                  >
                    Hapus Produk
                  </button>
                  <button
                    type="submit"
                    className="rounded-lg border-0 bg-[#579171] hover:bg-[#447057] px-4 py-2 text-sm font-semibold text-white transition-colors flex-1"
                  >
                    Simpan Perubahan
                  </button>
                  <button
                    type="button"
                    onClick={tutupEdit}
                    className="rounded-lg border-0 bg-gray-200 hover:bg-gray-300 px-4 py-2 text-sm font-semibold text-slate-700 transition-colors flex-1"
                  >
                    Batal
                  </button>
                </div>
              </form>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
