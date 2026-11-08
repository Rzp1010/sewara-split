"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  getPelanggan,
  getMembers,
  getBlacklist,
  hapusMember,
  hapusBlacklist,
} from "@/lib/db";
import { hpNormal, samaOrangnya, terBlacklist, unduhCSV } from "@/lib/utils";
import { ErrorState, LoadingSpinner } from "@/components/ui";
import { useNotify } from "@/components/NotificationProvider";
import TabelOrang from "@/components/orang/TabelOrang";
import PencarianAdaptif from "@/components/ui/PencarianAdaptif";
import DetailOrang from "@/components/orang/DetailOrang";
import FormMember from "@/components/orang/FormMember";
import FormPelanggan from "@/components/orang/FormPelanggan";
import ModalTipeMember from "@/components/orang/ModalTipeMember";
import BlacklistModal from "@/components/BlacklistModal";

const TABS = [
  { kode: "semua", label: "Semua" },
  { kode: "member", label: "Member" },
  { kode: "pelanggan", label: "Pelanggan" },
  { kode: "blacklist", label: "Blacklist" },
];

const FIELD_CARI = ["nama", "hp", "email", "alamat"];

// Daftar orang gabungan: pool pelanggan/member dari backend (sudah menyerap
// riwayat) + entri blacklist yang belum punya baris pelanggan.
async function ambilOrang() {
  const [pool, members, black] = await Promise.all([
    getPelanggan(),
    getMembers(),
    getBlacklist(),
  ]);
  const daftarBlack = Array.isArray(black) ? black : [];
  const petaMember = new Map((members || []).map((m) => [Number(m.id), m]));
  // Kunci baris = pasangan nama+HP (aturan identitas), plus penghitung kecil
  // supaya tetap unik kalau pool membawa orang yang sama dua kali. Jangan pakai
  // `id`/`member_id`: keduanya 0 pada baris riwayat dan bikin key duplikat.
  const dipakai = new Map();
  const kunci = (nama, hp) => {
    const dasar = `${String(nama || "").trim().toLowerCase()}|${hpNormal(hp)}`;
    const n = (dipakai.get(dasar) || 0) + 1;
    dipakai.set(dasar, n);
    return `${dasar}#${n}`;
  };
  const orang = pool.map((r) => ({
    ...r,
    key: kunci(r.nama, r.hp_normal || r.hp),
    member: r.member_id ? petaMember.get(Number(r.member_id)) || null : null,
    black: terBlacklist(daftarBlack, { nama: r.nama, hp: r.hp }),
  }));
  for (const b of daftarBlack) {
    if (orang.some((o) => samaOrangnya(o, b))) continue;
    const mid = b.memberId ? Number(b.memberId) : 0;
    orang.push({
      key: kunci(b.nama, b.hp),
      id: 0,
      nama: b.nama,
      hp: b.hp || "",
      email: "",
      alamat: b.alamat || "",
      catatan: "",
      foto: b.fotoJaminan || [],
      sumber: "blacklist",
      updated_at: null,
      member_id: mid,
      foto_dari: "blacklist",
      member: mid ? petaMember.get(mid) || null : null,
      black: b,
    });
  }
  return orang;
}

function dalamTab(orang, tab) {
  // Tab bersifat eksklusif: satu orang hanya muncul di satu tab, sesuai
  // prioritas Blacklist > Member > Pelanggan (badge memakai urutan yang sama).
  if (tab === "member") return Boolean(orang.member_id) && !orang.black;
  if (tab === "pelanggan")
    return (
      (orang.sumber === "pelanggan" || orang.sumber === "riwayat") &&
      !orang.black &&
      !orang.member_id
    );
  if (tab === "blacklist") return Boolean(orang.black);
  return true;
}

function IsiHalaman() {
  const sp = useSearchParams();
  const tabAwal = sp.get("tab");
  const { notify, confirm: konfirm } = useNotify();
  const [tab, setTab] = useState(
    TABS.some((t) => t.kode === tabAwal) ? tabAwal : "semua",
  );
  const [orang, setOrang] = useState([]);
  const [muat, setMuat] = useState(true);
  const [gagal, setGagal] = useState(false);
  const [putarUlang, setPutarUlang] = useState(0);
  const [cari, setCari] = useState("");
  const [urut, setUrut] = useState("nama-az");
  const [urutMenu, setUrutMenu] = useState(false);
  const [eksporMenu, setEksporMenu] = useState(false);
  const [tambahMenu, setTambahMenu] = useState(false);
  const [formPelangganOpen, setFormPelangganOpen] = useState(false);
  useEffect(() => {
    if (!urutMenu) return undefined;
    const tutup = (event) => {
      if (event.type === "keydown" || !event.target.closest("[data-menu-urut]"))
        setUrutMenu(false);
    };
    document.addEventListener("click", tutup);
    document.addEventListener("keydown", tutup);
    return () => {
      document.removeEventListener("click", tutup);
      document.removeEventListener("keydown", tutup);
    };
  }, [urutMenu]);
  useEffect(() => {
    if (!eksporMenu) return undefined;
    const tutup = (event) => {
      if (event.type === "keydown" || !event.target.closest("[data-menu-ekspor]"))
        setEksporMenu(false);
    };
    document.addEventListener("click", tutup);
    document.addEventListener("keydown", tutup);
    return () => {
      document.removeEventListener("click", tutup);
      document.removeEventListener("keydown", tutup);
    };
  }, [eksporMenu]);
  useEffect(() => {
    if (!tambahMenu) return undefined;
    const tutup = (event) => {
      if (event.type === "keydown" || !event.target.closest("[data-menu-tambah]"))
        setTambahMenu(false);
    };
    document.addEventListener("click", tutup);
    document.addEventListener("keydown", tutup);
    return () => {
      document.removeEventListener("click", tutup);
      document.removeEventListener("keydown", tutup);
    };
  }, [tambahMenu]);
  const [detail, setDetail] = useState(null);
  const [prefillBlacklist, setPrefillBlacklist] = useState(null);
  const [formMember, setFormMember] = useState(null);
  const [modalTipe, setModalTipe] = useState(false);
  const [blackEdit, setBlackEdit] = useState(null);

  useEffect(() => {
    let batal = false;
    ambilOrang()
      .then((rows) => {
        if (batal) return;
        setOrang(rows);
        setGagal(false);
        setMuat(false);
      })
      .catch(() => {
        if (batal) return;
        setGagal(true);
        setMuat(false);
      });
    return () => {
      batal = true;
    };
  }, [putarUlang]);

  const muatUlang = () => setPutarUlang((n) => n + 1);
  const gantiTab = (kode) => setTab(kode);

  const jumlah = useMemo(
    () =>
      Object.fromEntries(
        TABS.map((t) => [
          t.kode,
          orang.filter((o) => dalamTab(o, t.kode)).length,
        ]),
      ),
    [orang],
  );

  const daftar = useMemo(() => {
    const q = cari.trim().toLowerCase();
    const [kunci, arah] = urut.split("-");
    const field = kunci === "nama" ? "nama" : "alamat";
    return orang
      .filter((o) => dalamTab(o, tab))
      .filter(
        (o) =>
          !q ||
          FIELD_CARI.map((f) => o[f])
            .join(" ")
            .toLowerCase()
            .includes(q),
      )
      .sort(
        (a, b) =>
          String(a[field] || "").localeCompare(String(b[field] || ""), "id") *
          (arah === "az" ? 1 : -1),
      );
  }, [orang, tab, cari, urut]);

  async function aksi(kode, o) {
    if (kode === "detail") return setDetail(o);
    if (kode === "edit-member")
      return setFormMember({
        member: o.member || {
          id: o.member_id,
          nama: o.nama,
          hp: o.hp,
          email: o.email,
          alamat: o.alamat,
        },
      });
    if (kode === "ubah-blacklist") return setBlackEdit(o.black);
    if (kode === "jadikan-member")
      return setFormMember({
        member: null,
        prefill: {
          nama: o.nama,
          hp: o.hp,
          email: o.email || "",
          alamat: o.alamat || "",
        },
      });
    if (kode === "blacklist") {
      if (!o.hp) return notify("HP wajib diisi untuk blacklist.", "error");
      return setPrefillBlacklist({
        nama: o.nama,
        hp: o.hp,
        alamat: o.alamat,
        memberId: o.member_id || undefined,
        fotoJaminan: o.foto || [],
      });
    }
    if (kode === "hapus-member") {
      if (!(await konfirm(`Hapus member ${o.nama}?`))) return;
      const r = await hapusMember(o.member_id);
      if (!r.ok) return notify(r.error || "Gagal menghapus member.", "error");
      notify("Member dihapus.");
      return muatUlang();
    }
    if (kode === "cabut-blacklist") {
      if (!(await konfirm(`Cabut ${o.nama} dari blacklist?`))) return;
      const r = await hapusBlacklist(o.black.id);
      if (!r.ok)
        return notify(r.error || "Gagal mencabut dari blacklist.", "error");
      notify("Dicabut dari blacklist.");
      return muatUlang();
    }
  }

  /** Ekspor direktori sesuai cakupan, pencarian, dan urutan aktif. */
  function eksporCSV(cakupan) {
    const q = cari.trim().toLowerCase();
    const [kunci, arah] = urut.split("-");
    const field = kunci === "nama" ? "nama" : "alamat";
    const hasil = orang
      .filter((o) => (cakupan === "member" ? dalamTab(o, "member") : true))
      .filter(
        (o) =>
          !q ||
          FIELD_CARI.map((f) => o[f])
            .join(" ")
            .toLowerCase()
            .includes(q),
      )
      .sort(
        (a, b) =>
          String(a[field] || "").localeCompare(String(b[field] || ""), "id") *
          (arah === "az" ? 1 : -1),
      );
    if (!hasil.length) {
      setEksporMenu(false);
      return notify("Tidak ada data untuk diekspor.", "error");
    }
    const baris = hasil.map((o) => {
      const status = o.black ? "Blacklist" : o.member_id ? "Member" : "Pelanggan";
      const alamat = String(o.alamat || "").replace(/\r?\n/g, " ");
      return `"${o.nama || ""}","${o.hp || ""}","${o.email || ""}","${alamat}","${status}"`;
    });
    unduhCSV(
      ["Nama,No HP,Email,Alamat,Status", ...baris].join("\n") + "\n",
      `Pelanggan_${cakupan}.csv`,
    );
    setEksporMenu(false);
    notify("Ekspor selesai.");
  }

  function menuUntuk(o) {
    return [
      { kode: "detail", label: "Detail" },
      {
        kode: "edit-member",
        label: "Edit member",
        tampil: Boolean(o.member_id),
      },
      { kode: "jadikan-member", label: "Jadikan member", tampil: !o.member_id },
      {
        kode: "blacklist",
        label: "Tambahkan ke blacklist",
        danger: true,
        tampil: !o.black,
      },
      {
        kode: "ubah-blacklist",
        label: "Ubah entri blacklist",
        tampil: Boolean(o.black),
      },
      {
        kode: "hapus-member",
        label: "Hapus member",
        danger: true,
        tampil: Boolean(o.member_id),
      },
      {
        kode: "cabut-blacklist",
        label: "Cabut dari blacklist",
        danger: true,
        tampil: Boolean(o.black),
      },
    ].filter((m) => m.tampil !== false);
  }

  const opsiUrut = [
    ["nama-az", "Nama A–Z"],
    ["nama-za", "Nama Z–A"],
    ["alamat-az", "Alamat A–Z"],
    ["alamat-za", "Alamat Z–A"],
  ];

  return (
    <div className="min-h-full">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-[22px] font-bold tracking-tight text-[var(--text-primary)]">Pelanggan</h2>
        <nav className="inline-flex gap-[6px] rounded-lg border border-solid border-[var(--border-color)] bg-[var(--bg-body)] p-[3px]" aria-label="Filter direktori">
          {TABS.map((t) => (
            <button key={t.kode} type="button" onClick={() => gantiTab(t.kode)} className={`h-8 whitespace-nowrap rounded-md border-0 px-3 text-[13px] font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)] ${tab === t.kode ? "bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-sm" : ""}`}>
              {t.label}<span className={`ml-1.5 text-[11px] font-semibold ${tab === t.kode ? "text-[var(--text-secondary)]" : "text-[var(--text-muted)]"}`}>{jumlah[t.kode]}</span>
            </button>
          ))}
        </nav>
        <div className="flex items-center gap-1">
          <div className="relative" data-menu-urut>
            <button type="button" aria-label="Urutkan" onClick={(e) => { e.stopPropagation(); setUrutMenu(!urutMenu); }} className="flex h-[30px] w-[30px] items-center justify-center rounded-md border-0 text-[var(--text-secondary)] hover:bg-[var(--bg-surface)]">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M7 4v16M3 8l4-4 4 4M17 20V4M13 16l4 4 4-4"/></svg>
            </button>
            {urutMenu && <div className="absolute right-0 top-[calc(100%+8px)] z-30 w-[250px] rounded-[10px] border border-solid border-[var(--border-color)] bg-[var(--bg-surface)] p-2 shadow-lg" onClick={(e) => e.stopPropagation()}>
              <div className="px-1.5 py-2 text-[10.5px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Urutkan</div>
              {opsiUrut.map(([value, label]) => <button key={value} type="button" onClick={() => { setUrut(value); setUrutMenu(false); }} className={`flex w-full items-center gap-2 rounded-md border-0 px-2 py-2 text-left text-[13px] text-[var(--text-primary)] hover:bg-[var(--bg-subtle)] ${urut === value ? "font-semibold" : ""}`}><span className="w-3.5 text-[var(--color-primary)]">{urut === value ? "✓" : ""}</span>{label}</button>)}
            </div>}
          </div>
          <PencarianAdaptif value={cari} onChange={setCari} />
          <div className="relative" data-menu-ekspor>
            <button type="button" aria-label="Ekspor" title="Ekspor" onClick={(e) => { e.stopPropagation(); setEksporMenu(!eksporMenu); }} className="flex h-[30px] w-[30px] items-center justify-center rounded-md border-0 text-[var(--text-secondary)] hover:bg-[var(--bg-surface)]">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12M7 10l5 5 5-5M5 21h14"/></svg>
            </button>
            {eksporMenu && <div className="absolute right-0 top-[calc(100%+8px)] z-30 w-[250px] rounded-[10px] border border-solid border-[var(--border-color)] bg-[var(--bg-surface)] p-2 shadow-lg" onClick={(e) => e.stopPropagation()}>
              <div className="px-1.5 py-2 text-[10.5px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Ekspor</div>
              <button type="button" onClick={() => eksporCSV("semua")} className="block w-full rounded-md border-0 px-2 py-2 text-left text-[13px] text-[var(--text-primary)] hover:bg-[var(--bg-subtle)]">Ekspor semua</button>
              <button type="button" onClick={() => eksporCSV("member")} className="block w-full rounded-md border-0 px-2 py-2 text-left text-[13px] text-[var(--text-primary)] hover:bg-[var(--bg-subtle)]">Ekspor hanya member</button>
            </div>}
          </div>
          {tab === "member" ? <button type="button" onClick={() => setModalTipe(true)} className="h-[34px] rounded-lg border border-solid border-[var(--border-color)] bg-[var(--bg-surface)] px-3.5 text-[13px] font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-subtle)]">Tipe member</button> : null}
          <div className="relative" data-menu-tambah>
            <button type="button" onClick={(e) => { e.stopPropagation(); setTambahMenu(!tambahMenu); }} className="flex h-[34px] items-center gap-1.5 rounded-lg border-0 bg-[var(--color-primary)] px-3.5 text-[13px] font-semibold text-white hover:opacity-90">+ Tambah<span className="text-[10px] opacity-85">▾</span></button>
            {tambahMenu && <div className="absolute right-0 top-[calc(100%+8px)] z-30 w-[190px] rounded-[10px] border border-solid border-[var(--border-color)] bg-[var(--bg-surface)] p-1 shadow-lg">
              <button type="button" onClick={() => { setTambahMenu(false); setFormPelangganOpen(true); }} className="block w-full rounded-md border-0 px-2.5 py-2 text-left text-[13px] text-[var(--text-primary)] hover:bg-[var(--bg-subtle)]">Pelanggan baru</button>
              <button type="button" onClick={() => { setTambahMenu(false); setFormMember({ member: null }); }} className="block w-full rounded-md border-0 px-2.5 py-2 text-left text-[13px] text-[var(--text-primary)] hover:bg-[var(--bg-subtle)]">Member baru</button>
              <button type="button" onClick={() => { setTambahMenu(false); setPrefillBlacklist({ nama: "", hp: "", alamat: "" }); }} className="block w-full rounded-md border-0 px-2.5 py-2 text-left text-[13px] text-[var(--text-primary)] hover:bg-[var(--bg-subtle)]">Entri blacklist</button>
            </div>}
          </div>
        </div>
      </div>
      <section className="overflow-visible rounded-xl border border-solid border-[var(--border-color)] bg-[var(--bg-surface)]">
        {muat ? <div className="p-8"><LoadingSpinner message="Memuat direktori..." /></div> : gagal ? <div className="p-6"><ErrorState message="Gagal memuat data." onRetry={muatUlang} /></div> : <TabelOrang people={daftar} menuUntuk={menuUntuk} onPilih={setDetail} onAksi={aksi} />}
      </section>

      {formPelangganOpen ? (
        <FormPelanggan
          onClose={() => setFormPelangganOpen(false)}
          onDone={muatUlang}
        />
      ) : null}

      {detail ? (
        <DetailOrang
          orang={detail}
          onClose={() => setDetail(null)}
          onTersimpan={muatUlang}
        />
      ) : null}

      {prefillBlacklist ? (
        <BlacklistModal
          open
          prefill={prefillBlacklist}
          onClose={() => setPrefillBlacklist(null)}
          onDone={muatUlang}
        />
      ) : null}

      {formMember ? (
        <FormMember
          key={
            formMember.member?.id ||
            `baru-${formMember.prefill?.nama || ""}-${formMember.prefill?.hp || ""}`
          }
          member={formMember.member}
          prefill={formMember.prefill}
          onClose={() => setFormMember(null)}
          onDone={muatUlang}
        />
      ) : null}

      {modalTipe ? (
        <ModalTipeMember
          onClose={() => setModalTipe(false)}
          onBerubah={muatUlang}
        />
      ) : null}

      {blackEdit ? (
        <BlacklistModal
          open
          entry={blackEdit}
          onClose={() => setBlackEdit(null)}
          onDone={muatUlang}
        />
      ) : null}
    </div>
  );
}

export default function HalamanPelanggan() {
  return (
    <Suspense fallback={null}>
      <IsiHalaman />
    </Suspense>
  );
}
