"use client";

import { useState } from "react";
import { hpNormal } from "@/lib/utils";

function formatHp(value) {
  const digit = hpNormal(value);
  if (digit.length <= 3) return digit;
  if (digit.length <= 7) return `${digit.slice(0, 3)}-${digit.slice(3)}`;
  return `${digit.slice(0, 3)}-${digit.slice(3, 7)}-${digit.slice(7)}`;
}

export default function InputHP({ value = "", onChange, name, placeholder, disabled, className = "", autoFocus, ariaLabel, daftarPembanding, onPilihDuplikat }) {
  const [fokus, setFokus] = useState(false);
  const [kabur, setKabur] = useState(false);
  const [editedValue, setEditedValue] = useState(null);
  const normal = hpNormal(value);
  const nilaiBlur = editedValue === null ? normal : editedValue;
  const teks = fokus ? normal : formatHp(normal);
  const duplikat = kabur && nilaiBlur && Array.isArray(daftarPembanding)
    ? daftarPembanding.find((item) => hpNormal(item.hp) === nilaiBlur)
    : null;
  const belumLengkap = kabur && nilaiBlur.length > 0 && nilaiBlur.length < 9;

  function masukanAktif(raw) {
    const kanonik = hpNormal(raw);
    setEditedValue(kanonik);
    onChange?.(kanonik);
  }

  return (
    <div className="w-full">
      <div className={`flex h-10 items-center overflow-hidden rounded-lg border border-solid border-[var(--border-color)] bg-[var(--bg-surface)] focus-within:border-[var(--color-primary)] ${className}`}>
        <span aria-hidden="true" className="flex h-full flex-none items-center border-r border-solid border-[var(--border-color)] px-3 text-sm text-[var(--text-secondary)]">+62</span>
        <input
          type="tel"
          inputMode="numeric"
          name={name}
          aria-label={ariaLabel || name || "Nomor HP"}
          autoFocus={autoFocus}
          disabled={disabled}
          value={teks}
          placeholder={placeholder}
          onFocus={() => { setFokus(true); setKabur(false); setEditedValue(null); }}
          onChange={(event) => masukanAktif(event.target.value)}
          onBlur={() => { setFokus(false); setKabur(true); }}
          onPaste={(event) => {
            event.preventDefault();
            masukanAktif(event.clipboardData.getData("text"));
          }}
          className="h-full min-w-0 flex-1 border-0 bg-transparent px-3 text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] disabled:cursor-not-allowed disabled:opacity-60"
        />
      </div>
      {duplikat ? (
        <div className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-[var(--text-secondary)]">
          <span>Sudah terdaftar: {duplikat.nama} — {formatHp(duplikat.hp)}</span>
          {onPilihDuplikat ? <button type="button" onClick={() => onPilihDuplikat(duplikat)} className="border-0 bg-transparent p-0 font-semibold text-[var(--color-primary)] underline">Pakai data itu</button> : null}
        </div>
      ) : belumLengkap ? <p className="mt-1 text-xs text-[var(--text-muted)]">Nomor HP belum lengkap.</p> : null}
    </div>
  );
}
