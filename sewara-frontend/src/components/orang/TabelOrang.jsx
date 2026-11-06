"use client";

import { useEffect, useState } from "react";
import { EmptyState } from "@/components/ui";

const TONE = {
  member:
    "border-[var(--color-primary)] bg-[var(--color-primary-soft)] text-[var(--color-primary-soft-text)]",
  pelanggan:
    "border-[var(--border-color)] bg-[var(--bg-subtle)] text-[var(--text-secondary)]",
  blacklist:
    "border-[var(--color-danger)] bg-[var(--color-danger-soft)] text-[var(--color-danger-text)]",
};

function Badge({ children, tone }) {
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold ${TONE[tone]}`}
    >
      {children}
    </span>
  );
}

export function StatusBadges({ orang }) {
  const punyaBarisPelanggan =
    orang.sumber === "pelanggan" || orang.sumber === "riwayat";
  return (
    <div className="flex flex-wrap gap-1">
      {orang.member ? (
        <Badge tone="member">{orang.member.tipeNama || "Member"}</Badge>
      ) : null}
      {punyaBarisPelanggan ? <Badge tone="pelanggan">Pelanggan</Badge> : null}
      {orang.black ? <Badge tone="blacklist">Blacklist</Badge> : null}
    </div>
  );
}

/**
 * Tabel gabungan orang. `menuUntuk(orang)` mengembalikan daftar aksi
 * [{ kode, label, danger }]; klik baris memanggil `onPilih(orang)`.
 */
export default function TabelOrang({ people, menuUntuk, onPilih, onAksi }) {
  const [terbuka, setTerbuka] = useState(null);

  useEffect(() => {
    if (!terbuka) return undefined;
    const tutup = () => setTerbuka(null);
    document.addEventListener("click", tutup);
    return () => document.removeEventListener("click", tutup);
  }, [terbuka]);

  if (!people.length)
    return (
      <div className="p-6">
        <EmptyState message="Belum ada data di filter ini." />
      </div>
    );

  return (
    <table className="w-full text-sm">
      <thead className="hidden sm:table-header-group">
        <tr className="border-b border-[var(--border-color)] text-left text-[11px] uppercase tracking-wide text-[var(--text-muted)]">
          <th className="px-4 py-3 font-bold">Nama &amp; kontak</th>
          <th className="px-4 py-3 font-bold">Status</th>
          <th className="px-4 py-3 font-bold">Alamat</th>
          <th className="px-4 py-3" />
        </tr>
      </thead>
      <tbody>
        {people.map((p) => {
          const kunci = p.key || p.id;
          const menu = menuUntuk(p);
          return (
            <tr
              key={kunci}
              className="flex cursor-pointer flex-col gap-1 border-b border-[var(--border-color)] px-4 py-3 hover:bg-[var(--bg-subtle)] sm:table-row sm:gap-0 sm:px-0 sm:py-0"
              onClick={() => onPilih(p)}
            >
              <td className="p-0 sm:px-4 sm:py-3">
                <div className="font-semibold text-[var(--text-primary)]">
                  {p.nama}
                </div>
                <div className="truncate text-xs text-[var(--text-muted)]">
                  {p.hp || "No. HP belum diisi"}
                  {p.email ? ` · ${p.email}` : " · Email belum diisi"}
                </div>
              </td>
              <td
                className="p-0 sm:px-4 sm:py-3"
                onClick={(e) => e.stopPropagation()}
              >
                <StatusBadges orang={p} />
              </td>
              <td className="p-0 text-xs text-[var(--text-muted)] sm:px-4 sm:py-3 sm:text-sm">
                {p.alamat || "Alamat belum diisi"}
              </td>
              <td className="p-0 text-right sm:px-4 sm:py-3">
                <div className="relative inline-block">
                  <button
                    type="button"
                    aria-label={`Aksi ${p.nama}`}
                    className="h-8 w-8 rounded-md text-lg leading-none text-[var(--text-secondary)] hover:bg-[var(--bg-surface)]"
                    onClick={(e) => {
                      e.stopPropagation();
                      setTerbuka(terbuka === kunci ? null : kunci);
                    }}
                  >
                    ⋮
                  </button>
                  {terbuka === kunci && (
                    <div
                      className="absolute right-0 top-9 z-20 min-w-[11rem] overflow-hidden rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)] py-1 text-left shadow-lg"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {menu.map((m) => (
                        <button
                          key={m.kode}
                          type="button"
                          className={`block w-full px-3 py-2 text-left text-sm hover:bg-[var(--bg-subtle)] ${m.danger ? "text-[var(--color-danger-text)]" : "text-[var(--text-primary)]"}`}
                          onClick={() => {
                            setTerbuka(null);
                            onAksi(m.kode, p);
                          }}
                        >
                          {m.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
