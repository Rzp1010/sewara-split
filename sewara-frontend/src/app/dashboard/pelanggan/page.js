"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  getPelanggan,
  getMembers,
  getBlacklist,
  hapusMember,
  hapusBlacklist,
  simpanMember,
} from "@/lib/db";
import { samaOrangnya, terBlacklist, unduhCSV } from "@/lib/utils";
import { ErrorState, LoadingSpinner } from "@/components/ui";
import { useNotify } from "@/components/NotificationProvider";
import TabelOrang from "@/components/orang/TabelOrang";
import DetailOrang from "@/components/orang/DetailOrang";
import FormMember from "@/components/orang/FormMember";
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
  const orang = pool.map((r) => ({
    ...r,
    key: `${r.sumber}-${r.id}-${r.member_id}`,
    member: r.member_id ? petaMember.get(Number(r.member_id)) || null : null,
    black: terBlacklist(daftarBlack, { nama: r.nama, hp: r.hp }),
  }));
  for (const b of daftarBlack) {
    if (orang.some((o) => samaOrangnya(o, b))) continue;
    const mid = b.memberId ? Number(b.memberId) : 0;
    orang.push({
      key: `blacklist-${b.id}`,
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
  if (tab === "member") return Boolean(orang.member_id);
  if (tab === "pelanggan")
    return orang.sumber === "pelanggan" || orang.sumber === "riwayat";
  if (tab === "blacklist") return Boolean(orang.black);
  return true;
}

function IsiHalaman() {
  const router = useRouter();
  const sp = useSearchParams();
  const tabParam = sp.get("tab");
  const tab = TABS.some((t) => t.kode === tabParam) ? tabParam : "semua";
  const { notify, confirm: konfirm } = useNotify();
  const [orang, setOrang] = useState([]);
  const [muat, setMuat] = useState(true);
  const [gagal, setGagal] = useState(false);
  const [putarUlang, setPutarUlang] = useState(0);
  const [cari, setCari] = useState("");
  const [urut, setUrut] = useState("nama-az");
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
  const gantiTab = (kode) =>
    router.replace(`/dashboard/pelanggan?tab=${kode}`, { scroll: false });

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
    if (kode === "jadikan-member") {
      const r = await simpanMember({
        nama: o.nama,
        hp: o.hp,
        alamat: o.alamat,
        email: o.email || null,
      });
      if (!r.ok) return notify(r.error || "Gagal menjadikan member.", "error");
      notify("Member ditambahkan.");
      return muatUlang();
    }
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

  /** Ekspor daftar yang sedang tampil (tab aktif, sudah difilter/diurutkan). */
  function eksporCSV() {
    if (!daftar.length) return notify("Tidak ada data untuk diekspor.", "error");
    const baris = daftar.map((o) => {
      const status = [o.member_id ? "Member" : "Pelanggan", o.black ? "Blacklist" : ""]
        .filter(Boolean)
        .join(" / ");
      const alamat = String(o.alamat || "").replace(/\r?\n/g, " ");
      return `"${o.nama || ""}","${o.hp || ""}","${o.email || ""}","${alamat}","${status}"`;
    });
    unduhCSV(
      ["Nama,No HP,Email,Alamat,Status", ...baris].join("\n") + "\n",
      `Pelanggan_${tab}.csv`,
    );
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

  return (
    <div className="min-h-full">
      <div className="mb-5">
        <h2 className="text-2xl font-bold tracking-tight">Pelanggan</h2>
        <p className="text-sm text-[var(--text-secondary)]">
          Direktori orang: member, pelanggan, dan blacklist dalam satu daftar.
        </p>
      </div>

      <section className="overflow-visible rounded-xl bg-[var(--bg-surface)] shadow-lg">
        <nav
          className="flex gap-1 overflow-x-auto border-b border-[var(--border-color)] px-2 pt-3"
          aria-label="Filter direktori"
        >
          {TABS.map((t) => (
            <button
              key={t.kode}
              type="button"
              onClick={() => gantiTab(t.kode)}
              className={`flex-none whitespace-nowrap border-b-2 px-3 pb-2 pt-1 text-sm font-semibold ${tab === t.kode ? "border-[var(--color-primary)] text-[var(--color-primary)]" : "border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]"}`}
            >
              {t.label}
              <span className="ml-1.5 text-[11px] text-[var(--text-muted)]">
                {jumlah[t.kode]}
              </span>
            </button>
          ))}
        </nav>

        <div className="flex flex-wrap items-center gap-3 p-4">
          <input
            value={cari}
            onChange={(e) => setCari(e.target.value)}
            placeholder="Cari nama, HP, email, atau alamat"
            aria-label="Cari"
            className="h-9 min-w-[12rem] max-w-[26rem] flex-1 rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)] px-3 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--color-primary)]"
          />
          <select
            value={urut}
            onChange={(e) => setUrut(e.target.value)}
            aria-label="Urutkan"
            className="h-9 rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)] px-2 text-sm text-[var(--text-primary)]"
          >
            <option value="nama-az">Nama A–Z</option>
            <option value="nama-za">Nama Z–A</option>
            <option value="alamat-az">Alamat A–Z</option>
            <option value="alamat-za">Alamat Z–A</option>
          </select>
          <span className="text-xs text-[var(--text-muted)]">
            {daftar.length} orang ditampilkan
          </span>
          <div className="ml-auto flex flex-wrap gap-2">
            {tab === "member" ? (
              <>
                <button
                  type="button"
                  onClick={() => setFormMember({ member: null })}
                  className="rounded-lg border-0 bg-[var(--color-primary)] px-3 py-1.5 text-sm font-semibold text-white hover:opacity-90"
                >
                  + Member
                </button>
                <button
                  type="button"
                  onClick={() => setModalTipe(true)}
                  className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)] px-3 py-1.5 text-sm font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-subtle)]"
                >
                  Tipe member
                </button>
              </>
            ) : null}
            {tab === "blacklist" ? (
              <button
                type="button"
                onClick={() => setPrefillBlacklist({ nama: "", hp: "", alamat: "" })}
                className="rounded-lg border-0 bg-[var(--color-danger)] px-3 py-1.5 text-sm font-semibold text-white hover:opacity-90"
              >
                + Blacklist
              </button>
            ) : null}
            {tab !== "blacklist" ? (
              <button
                type="button"
                onClick={eksporCSV}
                className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)] px-3 py-1.5 text-sm font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-subtle)]"
              >
                Ekspor CSV
              </button>
            ) : null}
          </div>
        </div>
        {muat ? (
          <div className="p-8">
            <LoadingSpinner message="Memuat direktori..." />
          </div>
        ) : gagal ? (
          <div className="p-6">
            <ErrorState message="Gagal memuat data." onRetry={muatUlang} />
          </div>
        ) : (
          <TabelOrang
            people={daftar}
            menuUntuk={menuUntuk}
            onPilih={setDetail}
            onAksi={aksi}
          />
        )}
      </section>

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
          key={formMember.member?.id || "baru"}
          member={formMember.member}
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
