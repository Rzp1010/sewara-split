"use client";
import { useState } from "react";
import { api } from "@/lib/api-client";
import { useNotify } from "@/components/NotificationProvider";

// Slot dokumen jaminan — label adalah identitas slot; maksimum lima slot tetap.
export const FOTO_SLOTS = ["KTP", "Kartu Keluarga", "SIM", "NPWP", "Lainnya"];
// Kunci unggah per slot (dipakai endpoint /api/member/upload).
const KUNCI = ["ktp", "kk", "sim", "npwp", "lainnya"];
const MAKS_BYTE = 5 * 1024 * 1024;
const TIPE_OK = ["image/jpeg", "image/png", "application/pdf"];
const ACCEPT = "image/jpeg,image/png,application/pdf";

// Kotak satu slot — dipakai bersama oleh DokumenJaminan (server) dan SlotJaminan (file lokal).
function KotakSlot({
  label,
  terisi,
  media,
  catatan,
  busy,
  bolehUbah = true,
  dragging,
  onHapus,
  onPickFile,
  onClick,
  onDragOver,
  onDragLeave,
  onDrop,
  inputId,
  capture,
}) {
  return (
    <div
      className={`relative flex h-14 flex-col items-center justify-center gap-0.5 rounded-lg border-[1.5px] px-2 py-1.5 text-center text-[11px] transition-colors ${terisi ? "border-solid border-[#a7f3d0] bg-[#f0fdf4] text-[#047857]" : `border-dashed border-[#cbd5e1] text-[var(--text-secondary)] ${bolehUbah && onPickFile ? "cursor-pointer hover:border-[var(--color-primary)] hover:bg-[var(--bg-subtle)]" : ""}`}`}
      onClick={onClick}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      aria-label={label}
      onKeyDown={(e) => {
        if (!onClick) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick(e);
        }
      }}
    >
      <div
        className={`text-sm leading-none ${terisi ? "text-[#047857]" : "text-[var(--text-muted)]"}`}
      >
        {media || <span>{dragging ? "↓" : "+"}</span>}
      </div>
      <div
        className={`text-[11px] font-semibold ${terisi ? "text-[#047857]" : "text-[var(--text-secondary)]"}`}
      >
        {label}
      </div>
      {catatan}
      {busy && (
        <span className="text-xs" aria-live="polite">
          Mengunggah...
        </span>
      )}
      {terisi && bolehUbah && onHapus && (
        <div
          className="text-center text-[10px] text-red-500"
          role="button"
          tabIndex={0}
          aria-label={`Hapus ${label || "dokumen"}`}
          onClick={(e) => {
            e.stopPropagation();
            onHapus();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              e.stopPropagation();
              onHapus();
            }
          }}
        >
          Hapus
        </div>
      )}
      {onPickFile && (
        <input
          id={inputId}
          type="file"
          hidden
          accept={ACCEPT}
          capture={capture}
          onChange={(e) => {
            onPickFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      )}
    </div>
  );
}

/**
 * Dokumen jaminan yang dikelola server: unggah/hapus langsung ke backend.
 * dokumen: [{ label, path }]
 */
export default function DokumenJaminan({
  judul = "Dokumen Jaminan",
  dokumen = [],
  onUpload,
  onHapus,
  urlDokumen,
  maks = 5,
  bolehUbah = true,
  tampilkanJudul = true,
}) {
  const [preview, setPreview] = useState(null);
  const [dragging, setDragging] = useState(null);
  const [busy, setBusy] = useState({});
  const valid = Array.isArray(dokumen) ? dokumen : [];
  const jumlah = valid.filter((d) => d?.path).length;

  const pilih = async (file, index) => {
    if (!file || !bolehUbah) return;
    const label = FOTO_SLOTS[index];
    const sudahAda = valid.some((d) => d?.label === label && d.path);
    if (!sudahAda && jumlah >= maks) return;
    setBusy((x) => ({ ...x, [index]: true }));
    try {
      await onUpload(file, KUNCI[index], label);
    } finally {
      setBusy((x) => ({ ...x, [index]: false }));
    }
  };

  return (
    <section className="w-full">
      {tampilkanJudul ? <div className="mb-2 flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium text-[var(--text-secondary)]">
          {judul}
        </span>
        <span className="text-xs font-semibold text-[var(--text-primary)]">
          {jumlah} / {maks}
        </span>
      </div> : null}
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
        {FOTO_SLOTS.map((label, index) => {
          const item = valid.find((d) => d?.label === label && d.path);
          const url = item ? urlDokumen(item.path) : "";
          const pdf = Boolean(item?.path && /\.pdf(?:$|[?#])/i.test(item.path));
          return (
            <KotakSlot
              key={label}
              label={label}
              terisi={Boolean(item)}
              bolehUbah={bolehUbah}
              busy={busy[index]}
              dragging={dragging === index}
              media={
                item ? (
                  pdf ? (
                    <span className="text-[11px] font-semibold">PDF</span>
                  ) : (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={url}
                      alt={label}
                      className="max-h-9 max-w-full object-contain"
                    />
                  )
                ) : null
              }
              onHapus={item ? () => onHapus(label) : null}
              onPickFile={(f) => void pilih(f, index)}
              capture="environment"
              inputId={`dj-${index}`}
              onClick={() => {
                if (item) {
                  setPreview({ url, pdf, label });
                  return;
                }
                if (!bolehUbah || jumlah >= maks) return;
                document.getElementById(`dj-${index}`)?.click();
              }}
              onDragOver={(e) => {
                if (bolehUbah) {
                  e.preventDefault();
                  setDragging(index);
                }
              }}
              onDragLeave={() => setDragging(null)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(null);
                void pilih(e.dataTransfer.files[0], index);
              }}
            />
          );
        })}
      </div>
      {preview && (
        <div
          className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/80 p-4"
          onClick={() => setPreview(null)}
        >
          <div className="max-h-full max-w-full" onClick={(e) => e.stopPropagation()}>
            {preview.pdf ? (
              <iframe
                title={`Pratinjau ${preview.label}`}
                src={preview.url}
                className="h-[80vh] w-[min(90vw,800px)] bg-white"
              />
            ) : (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={preview.url}
                alt={`Pratinjau ${preview.label}`}
                className="max-h-[85vh] max-w-[90vw] object-contain"
              />
            )}
            <button
              type="button"
              aria-label="Tutup pratinjau"
              className="mt-2 rounded bg-[var(--bg-surface)] px-4 py-2 text-[var(--text-primary)]"
              onClick={() => setPreview(null)}
            >
              Tutup
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

/**
 * Slot jaminan terkendali untuk file lokal (dipakai form blacklist: file baru
 * dikirim setelah entri punya id).
 * items: array(5) tiap elemen null | {label, path?, url?, file?, snapshot?}
 */
export function SlotJaminan({ items, onChange, allowRemoveSnapshot = false }) {
  const { notify } = useNotify();
  const daftar = Array.isArray(items) ? items : [];
  const slots = FOTO_SLOTS.map((label) => daftar.find((it) => it?.label === label) || null);
  const jumlah = slots.filter((it) => it && (it.path || it.file || it.url)).length;

  function pilih(index, file) {
    if (!file) return;
    if (!TIPE_OK.includes(file.type))
      return notify("File harus JPG, PNG, atau PDF.", "error");
    if (file.size > MAKS_BYTE) return notify("Ukuran file maksimal 5MB.", "error");
    const next = [...slots];
    next[index] = {
      label: FOTO_SLOTS[index],
      file,
      url: URL.createObjectURL(file),
      snapshot: false,
    };
    onChange(next);
  }

  function hapus(index) {
    const next = [...slots];
    next[index] = null;
    onChange(next);
  }

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium text-[var(--text-secondary)]">
          Foto jaminan
        </span>
        <span className="text-xs font-semibold text-[var(--text-primary)]">
          {jumlah} / 5
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-5">
        {FOTO_SLOTS.map((label, index) => {
          const it = slots[index];
          const terisi = Boolean(it && (it.path || it.file || it.url));
          return (
            <KotakSlot
              key={label}
              label={label}
              terisi={terisi}
              media={
                it?.url ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={it.url}
                    alt={label}
                    className="max-h-9 max-w-full object-contain"
                  />
                ) : it?.path && !it.snapshot ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={api.blacklist.photoUrl(it.path)}
                    alt={label}
                    className="max-h-9 max-w-full object-contain"
                  />
                ) : it?.path && it.snapshot ? (
                  <span className="text-[11px] font-semibold text-emerald-700">
                    {it.label || label}
                  </span>
                ) : null
              }
              catatan={
                it?.snapshot ? (
                  <span className="text-[9px] leading-tight text-[var(--text-muted)]">
                    Dokumen dari member — akan disalin saat disimpan.
                  </span>
                ) : null
              }
              onHapus={
                terisi && (!it?.snapshot || allowRemoveSnapshot) ? () => hapus(index) : null
              }
              onPickFile={!terisi ? (f) => pilih(index, f) : null}
              inputId={`blf-${index}`}
              onClick={() => {
                if (!terisi) document.getElementById(`blf-${index}`)?.click();
              }}
            />
          );
        })}
      </div>
    </div>
  );
}
