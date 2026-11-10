"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";

const CHIP =
  "h-8 rounded-md border border-solid border-[var(--border-color)] bg-[var(--bg-surface)] px-3 font-mono text-[12.5px] text-[var(--text-primary)] transition-colors hover:border-[var(--color-primary-soft-strong)] disabled:cursor-not-allowed disabled:opacity-40";
const CHIP_ON =
  "border-[var(--color-primary-soft-strong)] bg-[var(--color-primary-soft)] font-semibold text-[var(--color-primary-soft-text)]";

/**
 * Modal "Pilih S/N" bersama untuk Status Sewa (serahkan) dan Booking Baru/Edit
 * (masukkan): satu modal memuat semua barang yang butuh S/N sekaligus, dengan
 * progres dan tombol utama yang aktif hanya setelah semua barang terpenuhi.
 * Pilihan disimpan sebagai draft di komponen ini lalu dikembalikan via
 * `onSimpan(entries)` — pemanggil tidak perlu menjaga state pilihan.
 */
export default function PilihSN({
  judul = "Pilih S/N",
  subjudul,
  labelUtama = "Simpan",
  entries = [],
  onBatal,
  onSimpan,
}) {
  const [pilihan, setPilihan] = useState(() =>
    Object.fromEntries(entries.map((e) => [e.key, [...(e.pilihan || [])]])),
  );

  const dipilih = (key) => pilihan[key] || [];
  const terpenuhi = entries.filter((e) => dipilih(e.key).length === e.butuh).length;
  const semuaTerpenuhi = entries.length > 0 && terpenuhi === entries.length;
  const dipakaiLain = (key, sn) =>
    entries.some((x) => x.key !== key && dipilih(x.key).includes(sn));

  function toggle(entry, sn) {
    setPilihan((lama) => {
      const kini = lama[entry.key] || [];
      const aktif = kini.includes(sn);
      const baru = { ...lama };
      baru[entry.key] = aktif
        ? kini.filter((v) => v !== sn)
        : kini.length < entry.butuh
          ? [...kini, sn]
          : kini;
      // Satu unit tidak boleh dipakai dua barang sekaligus.
      if (!aktif) {
        for (const x of entries) {
          if (x.key !== entry.key && (baru[x.key] || []).includes(sn)) {
            baru[x.key] = baru[x.key].filter((v) => v !== sn);
          }
        }
      }
      return baru;
    });
  }

  const ringkasan = entries
    .filter((e) => dipilih(e.key).length > 0)
    .map((e) => ({ key: e.key, nama: e.nama, sns: dipilih(e.key) }));

  return (
    <Modal
      isOpen
      onClose={onBatal}
      title={judul}
      description={subjudul}
      size="lg"
      zClass="z-[10001]"
      footer={
        <>
          <Button variant="ghost" onClick={onBatal}>
            Batal
          </Button>
          <Button
            disabled={!semuaTerpenuhi}
            onClick={() =>
              onSimpan(entries.map((e) => ({ ...e, pilihan: dipilih(e.key) })))
            }
          >
            {labelUtama}
          </Button>
        </>
      }
    >
      <p className="m-0 text-[11.5px] text-[var(--text-muted)]">
        <span className="font-semibold text-[var(--text-primary)]">{terpenuhi}</span> dari{" "}
        {entries.length} barang terpenuhi
      </p>
      <div className="mt-2.5 flex flex-col gap-2.5">
        {entries.map((e) => {
          const sns = [...new Set([...(e.bebas || []), ...dipilih(e.key)])];
          const jml = dipilih(e.key).length;
          const kurang = (e.bebas || []).length < e.butuh;
          return (
            <section
              key={e.key}
              className="rounded-[10px] border border-solid border-[var(--border-color)] px-3.5 py-3"
            >
              <div className="flex items-baseline justify-between gap-2">
                <p className="m-0 text-[13.5px] font-semibold">{e.nama}</p>
                <span
                  className={`text-xs font-semibold ${
                    jml === e.butuh
                      ? "text-[#579171]"
                      : jml > e.butuh
                        ? "text-[#e5484d]"
                        : "text-[var(--text-muted)]"
                  }`}
                >
                  {jml} / {e.butuh}
                </span>
              </div>
              <p className="m-0 mt-0.5 text-[11.5px] text-[var(--text-secondary)]">
                Butuh {e.butuh} unit
                {kurang ? ` — unit bebas tidak cukup (sisa ${(e.bebas || []).length})` : ""}
              </p>
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {sns.map((sn) => {
                  const aktif = dipilih(e.key).includes(sn);
                  const pakai = dipakaiLain(e.key, sn);
                  return (
                    <button
                      key={sn}
                      type="button"
                      className={`${CHIP} ${aktif ? CHIP_ON : ""}`}
                      disabled={pakai || (!aktif && jml >= e.butuh)}
                      onClick={() => toggle(e, sn)}
                    >
                      {sn}
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
      <p className="m-0 mt-2.5 text-xs text-[var(--text-secondary)]">
        {ringkasan.length === 0
          ? "Belum ada unit dipilih."
          : ringkasan.map((r, i) => (
              <span key={r.key}>
                {i > 0 ? " · " : ""}
                {r.nama}:{" "}
                <b className="font-semibold text-[var(--text-primary)]">{r.sns.join(", ")}</b>
              </span>
            ))}
      </p>
    </Modal>
  );
}
