"use client";

import { useEffect, useState } from "react";

const TONE = {
  member: "bg-[var(--color-primary-soft)] text-[var(--color-primary-soft-text)]",
  pelanggan: "bg-[var(--bg-subtle)] text-[var(--text-secondary)]",
  blacklist: "bg-[var(--color-danger-soft)] text-[var(--color-danger-text)]",
};

function Badge({ children, tone }) {
  return <span className={`inline-flex items-center whitespace-nowrap rounded-md px-[9px] py-[3px] text-[11px] font-semibold ${TONE[tone]}`}>{children}</span>;
}

export function StatusBadges({ orang }) {
  const tone = orang.black ? "blacklist" : orang.member ? "member" : orang.sumber === "pelanggan" || orang.sumber === "riwayat" ? "pelanggan" : null;
  if (!tone) return null;
  const label = tone === "blacklist" ? "Blacklist" : tone === "member" ? orang.member.tipeNama || "Member" : "Pelanggan";
  return <Badge tone={tone}>{label}</Badge>;
}

export default function TabelOrang({ people, menuUntuk, onPilih, onAksi }) {
  const [terbuka, setTerbuka] = useState(null);
  useEffect(() => {
    if (!terbuka) return undefined;
    const tutup = () => setTerbuka(null);
    document.addEventListener("click", tutup);
    return () => document.removeEventListener("click", tutup);
  }, [terbuka]);

  if (!people.length) return <div className="p-9 text-center text-[var(--text-muted)]">Belum ada data di filter ini.</div>;

  return (
    <div className="w-full overflow-x-hidden">
      <table className="w-full table-fixed text-[13px]">
        <thead>
          <tr className="border-b border-solid border-[var(--border-color)] text-left text-[var(--text-muted)]">
            <th className="w-[40%] px-2 py-3 text-[11px] font-semibold uppercase tracking-wide sm:w-[24%] sm:px-[18px]">Nama</th>
            <th className="w-[32%] px-2 py-3 text-[11px] font-semibold uppercase tracking-wide sm:w-[24%] sm:px-[18px]">Kontak</th>
            <th className="hidden px-[18px] py-3 text-[11px] font-semibold uppercase tracking-wide sm:table-cell sm:w-[28%]">Alamat</th>
            <th className="w-[24%] px-2 py-3 text-[11px] font-semibold uppercase tracking-wide sm:w-[20%] sm:px-[18px]">Status</th>
            <th className="w-11 px-1 py-3 text-right text-[11px] font-semibold uppercase tracking-wide sm:w-12 sm:px-3" />
          </tr>
        </thead>
        <tbody>
          {people.map((p, i) => {
            const kunci = p.key ?? i;
            const menu = menuUntuk(p);
            return <tr key={kunci} className="cursor-pointer hover:bg-[var(--bg-subtle)] [&:not(:last-child)>td]:border-b [&:not(:last-child)>td]:border-[var(--border-color)]" onClick={() => onPilih(p)}>
              <td className="max-w-0 truncate px-2 py-[13px] align-middle text-[13.5px] font-semibold text-[var(--text-primary)] sm:px-[18px]">{p.nama}</td>
              <td className="max-w-0 truncate px-2 py-[13px] align-middle text-[13px] text-[var(--text-secondary)] sm:px-[18px]">{p.hp || <span className="text-[var(--text-muted)]">Belum diisi</span>}</td>
              <td className="hidden max-w-0 truncate px-[18px] py-[13px] align-middle text-[13px] text-[var(--text-secondary)] sm:table-cell">{p.alamat || <span className="text-[var(--text-muted)]">Belum diisi</span>}</td>
              <td className="px-2 py-[13px] align-middle sm:px-[18px]" onClick={(e) => e.stopPropagation()}><StatusBadges orang={p} /></td>
              <td className="px-1 py-[13px] text-right align-middle sm:px-3" onClick={(e) => e.stopPropagation()}><div className="relative inline-block">
                <button type="button" aria-label={`Aksi ${p.nama}`} className="h-8 w-8 rounded-md border-0 text-lg leading-none text-[var(--text-secondary)] hover:bg-[var(--bg-surface)]" onClick={() => setTerbuka(terbuka === kunci ? null : kunci)}>⋮</button>
                {terbuka === kunci && <div className="absolute right-0 top-9 z-20 min-w-[11rem] overflow-hidden rounded-lg border border-solid border-[var(--border-color)] bg-[var(--bg-surface)] py-1 text-left shadow-lg" onClick={(e) => e.stopPropagation()}>{menu.map((m) => <button key={m.kode} type="button" className={`block w-full border-0 px-3 py-2 text-left text-sm hover:bg-[var(--bg-subtle)] ${m.danger ? "text-[var(--color-danger-text)]" : "text-[var(--text-primary)]"}`} onClick={() => { setTerbuka(null); onAksi(m.kode, p); }}>{m.label}</button>)}</div>}
              </div></td>
            </tr>;
          })}
        </tbody>
      </table>
    </div>
  );
}
