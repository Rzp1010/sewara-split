"use client";
import { useEffect, useMemo, useState } from "react";
import {
  getTransactionsLaporan,
  getPelangganSuggestions,
  getPelangganSuggestionsGagalTerakhir,
  getBlacklist,
} from "@/lib/db";
import { createPortal } from "react-dom";
import { api } from "@/lib/api-client";
import { unduhCSV, terBlacklist, samaOrangnya } from "@/lib/utils";
import { ROLE_OWNER, ROLE_SUPERADMIN } from "@/lib/role";
import { useNotify } from "@/components/NotificationProvider";
import BlacklistModal from "@/components/BlacklistModal";
import LoadingOverlay from "@/components/LoadingOverlay";
import ErrorMuat from "@/components/ErrorMuat";

export default function PelangganPage() {
  const { notify } = useNotify();
  const [rows, setRows] = useState([]);
  const [blacklist, setBlacklist] = useState([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [gagal, setGagal] = useState(false);
  const [userRole, setUserRole] = useState("");
  const [blRow, setBlRow] = useState(null);
  const [exportModal, setExportModal] = useState(false),
    [exportBulan, setExportBulan] = useState(""),
    [exportTipe, setExportTipe] = useState("semua");
  const monthOptions = Array.from({ length: 12 }, (_, i) => {
    const date = new Date(
      new Date().getFullYear(),
      new Date().getMonth() - i,
      1,
    );
    const names = [
      "Januari",
      "Februari",
      "Maret",
      "April",
      "Mei",
      "Juni",
      "Juli",
      "Agustus",
      "September",
      "Oktober",
      "November",
      "Desember",
    ];
    return {
      value: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`,
      label: `${names[date.getMonth()]} ${date.getFullYear()}`,
    };
  });
  useEffect(() => {
    let aktif = true;
    (async () => {
      try {
        const me = await api.auth.me();
        if (aktif) setUserRole(me?.user?.role || "");
      } catch {}
    })();
    return () => {
      aktif = false;
    };
  }, []);
  const bolehExport = userRole === ROLE_OWNER || userRole === ROLE_SUPERADMIN;
  const bolehBlacklist = bolehExport;
  async function load() {
    setLoading(true);
    setGagal(false);
    try {
      const suggestions = await getPelangganSuggestions();
      const saranGagal = getPelangganSuggestionsGagalTerakhir();
      const daftarBlacklist = await getBlacklist();
      if (saranGagal || daftarBlacklist === null)
        throw new Error("Gagal memuat data.");
      setRows(Array.isArray(suggestions) ? suggestions : []);
      setBlacklist(Array.isArray(daftarBlacklist) ? daftarBlacklist : []);
    } catch {
      setGagal(true);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);
  const isBlacklisted = (row) => !!terBlacklist(blacklist, { nama: row.nama, hp: row.hp });
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter(
      (r) =>
        !q ||
        [r.nama, r.hp, r.alamat].some((v) =>
          String(v || "")
            .toLowerCase()
            .includes(q),
        ),
    );
  }, [rows, query]);
  async function exportPelanggan() {
    const all = await getTransactionsLaporan();
    if (!all.length) return notify("Belum ada data pelanggan!", "error");
    const filtered = exportBulan
      ? all.filter((t) => {
          const date = new Date(
            t.waktu_kembali_aktual || t.waktu_kembali_rencana,
          );
          return (
            `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}` ===
            exportBulan
          );
        })
      : all;
    if (!filtered.length)
      return notify("Tidak ada data pada periode yang dipilih!", "error");
    // Data dari server sudah urut created_at DESC (preset laporan tidak kirim
    // created_at, jadi tidak perlu sort lokal — transaksi pertama = terbaru).
    const data = [];
    for (const t of filtered) {
      let pelanggan = data.find((p) =>
        samaOrangnya(p, { nama: t.penyewa, hp: t.hp_penyewa }),
      );
      if (!pelanggan) {
        pelanggan = {
          nama: t.penyewa || "",
          hp: t.hp_penyewa || "-",
          email: t.emailPenyewa || "-",
          alamat: t.alamat_penyewa || "-",
          totalTrx: 0,
          isMember: false,
        };
        data.push(pelanggan);
      }
      pelanggan.totalTrx += 1;
      // Tambal field kosong dari transaksi lebih lama (perilaku export lama).
      if (pelanggan.hp === "-" && t.hp_penyewa) pelanggan.hp = t.hp_penyewa;
      if (pelanggan.alamat === "-" && t.alamat_penyewa)
        pelanggan.alamat = t.alamat_penyewa;
      if (pelanggan.email === "-" && t.emailPenyewa)
        pelanggan.email = t.emailPenyewa;
    }
    const members = rows.filter((r) => r.sumber === "member");
    data.forEach((p) => {
      p.isMember = members.some((m) =>
        samaOrangnya(p, { nama: m.nama, hp: m.hp }),
      );
    });
    const dataEkspor = data.filter(
      (p) => exportTipe !== "member" || p.isMember,
    );
    if (!dataEkspor.length)
      return notify("Tidak ada data yang sesuai filter!", "error");
    let csv = "Nama,No HP,Email,Alamat,Daftar Anggota,Jumlah Transaksi\n";
    dataEkspor.forEach((p) => {
      const statusMember = p.isMember ? "Member" : "Non Member";
      csv += `"${p.nama}","${p.hp}","${p.email}","${p.alamat.replace(/\r?\n/g, " ")}","${statusMember}",${p.totalTrx}\n`;
    });
    unduhCSV(
      csv,
      `Pelanggan_${exportTipe === "member" ? "Member" : "Semua"}_${monthOptions.find((m) => m.value === exportBulan)?.label || "Semua"}.csv`,
    );
    setExportModal(false);
    notify("Export berhasil!");
  }
  function makeMember(row) {
    const params = new URLSearchParams({
      nama: row.nama || "",
      hp: row.hp || "",
      email: row.email || "",
      alamat: row.alamat || "",
    });
    window.location.href = `/dashboard/member?${params.toString()}`;
  }
  if (loading) return <LoadingOverlay />;
  if (gagal) return <ErrorMuat onRetry={load} />;

  return (
    <div className="min-h-full">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Data Pelanggan</h2>
          <p className="text-sm text-gray-500">
            Riwayat pelanggan dari transaksi.
          </p>
        </div>
        <div className="flex gap-3">
          {bolehExport && (
            <button
              className="rounded-lg border-0 bg-[#7181E0] px-4 py-2 text-sm font-semibold text-white hover:bg-[#5d6fcc]"
              onClick={() => setExportModal(true)}
            >
              Export CSV
            </button>
          )}
          <button
            className="rounded-lg border-0 bg-gray-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-gray-300"
            onClick={load}
          >
            Muat ulang
          </button>
        </div>
      </div>
      <div className="overflow-hidden rounded-xl bg-white shadow-lg">
        <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-100 p-4">
          <span className="text-xs font-bold uppercase tracking-wide text-slate-600">
            Daftar Pelanggan ({filtered.length})
          </span>
          <input
            className="w-full appearance-none rounded-lg border border-solid border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-[#7181E0] focus:ring-2 focus:ring-[#7181E0]/20 sm:max-w-md"
            placeholder="Cari nama, HP, atau alamat..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse whitespace-nowrap text-sm">
            <thead className="bg-slate-100 text-xs font-bold uppercase tracking-wide text-slate-600">
              <tr>
                <th className="px-4 py-3 text-left">Nama</th>
                <th className="px-4 py-3 text-left">HP</th>
                <th className="px-4 py-3 text-left">Alamat</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-left">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan="5">Memuat...</td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan="5">Pelanggan tidak ditemukan.</td>
                </tr>
              ) : (
                filtered.map((row) => (
                  <tr
                    key={`${row.sumber}-${row.id}`}
                    className="hover:bg-slate-50"
                  >
                    <td className="px-4 py-3 text-left">
                      {row.nama}
                      {isBlacklisted(row) && (
                        <span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-red-700">
                          Blacklist
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-left">{row.hp || "-"}</td>
                    <td className="px-4 py-3 text-left">{row.alamat || "-"}</td>
                    <td>
                      {row.sumber === "member" ? (
                        <span className="rounded-full bg-green-100 px-2 py-1 text-xs font-medium text-green-800">
                          Member{row.tipeNama ? ` · ${row.tipeNama}` : ""}
                        </span>
                      ) : (
                        <span className="rounded-full bg-gray-100 px-2 py-1 text-xs font-medium text-gray-700">
                          Riwayat
                        </span>
                      )}
                    </td>
                    <td>
                      {row.sumber !== "member" && (
                        <button
                          className="rounded-lg border-0 bg-[#7181E0] px-4 py-2 text-sm font-semibold text-white hover:bg-[#5d6fcc]"
                          onClick={() => makeMember(row)}
                        >
                          Jadikan Member
                        </button>
                      )}
                      {bolehBlacklist && !isBlacklisted(row) && (
                        <button
                          className="ml-2 rounded-lg border-0 bg-gray-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-gray-300"
                          onClick={() =>
                            setBlRow({
                              nama: row.nama || "",
                              hp: row.hp || "",
                              alamat: row.alamat || "",
                              memberId: row.sumber === "member" ? row.id : undefined,
                              fotoJaminan: Array.isArray(row.foto_jaminan)
                                ? row.foto_jaminan
                                : [],
                            })
                          }
                        >
                          Blacklist
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
      {typeof document !== "undefined" &&
        exportModal &&
        createPortal(
          <div
            className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm"
            onClick={() => setExportModal(false)}
          >
            <div
              className="relative flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-lg bg-white shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-gray-200 p-4">
                <h3 className="text-lg font-semibold">Export Data Pelanggan</h3>
                <button
                  className="text-2xl leading-none text-gray-500 hover:text-gray-700"
                  onClick={() => setExportModal(false)}
                >
                  ×
                </button>
              </div>
              <div className="flex-1 overflow-y-auto space-y-4 p-4">
                <label className="block text-xs font-bold text-gray-600">
                  Periode Bulan
                  <select
                    className="mt-2 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    value={exportBulan}
                    onChange={(e) => setExportBulan(e.target.value)}
                  >
                    <option value="">Semua Waktu</option>
                    {monthOptions.map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-xs font-bold text-gray-600">
                  Tipe Data
                  <select
                    className="mt-2 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    value={exportTipe}
                    onChange={(e) => setExportTipe(e.target.value)}
                  >
                    <option value="semua">Semua Pelanggan</option>
                    <option value="member">Hanya Member</option>
                  </select>
                </label>
              </div>
              <div className="flex justify-end gap-3 border-t border-gray-200 p-4">
                <button
                  className="rounded-lg border-0 bg-gray-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-gray-300"
                  onClick={() => setExportModal(false)}
                >
                  Batal
                </button>
                <button
                  className="rounded-lg border-0 bg-[#7181E0] px-4 py-2 text-sm font-semibold text-white hover:bg-[#5d6fcc]"
                  onClick={exportPelanggan}
                >
                  Export CSV
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
      {rows.length > 0 && (
        <p className="text-sm text-gray-500 mt-4">
          {filtered.length} pelanggan ditampilkan.
        </p>
      )}

      <BlacklistModal
        open={!!blRow}
        prefill={blRow}
        onClose={() => setBlRow(null)}
        onDone={load}
      />
    </div>
  );
}
