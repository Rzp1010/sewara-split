"use client";

import { useRef, useState } from "react";
import { useNotify } from "@/components/NotificationProvider";

const ACCEPT = "image/jpeg,image/png,image/webp";
const TIPE_DIIZINKAN = ACCEPT.split(",");
const MAX_BYTE = 5 * 1024 * 1024;

function ukuranMB(byte) {
  return (byte / 1024 / 1024).toFixed(1);
}

/**
 * Dropzone bukti bayar — drag & drop + klik Browse.
 * Gaya senada area upload dokumen jaminan di halaman member.
 *
 * Props:
 * - value: File | null
 * - onChange(file | null)
 * - compact: versi kecil (modal)
 * - previewUrl: URL bukti lama (opsional, untuk edit)
 * - onHapusPreview: aksi hapus bukti lama (opsional)
 */
export default function BuktiDropzone({
  value,
  onChange,
  compact = false,
  previewUrl = null,
  onHapusPreview = null,
}) {
  const { notify } = useNotify();
  const inputRef = useRef(null);
  const [hover, setHover] = useState(false);

  function terima(file) {
    if (!file) return;
    if (!TIPE_DIIZINKAN.includes(file.type)) {
      notify("Gunakan file JPG, PNG, atau WEBP.", "error");
      return;
    }
    if (file.size > MAX_BYTE) {
      notify("Ukuran file maksimal 5MB.", "error");
      return;
    }
    onChange(file);
  }

  function reset() {
    onChange(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  const r = compact ? "rounded-lg" : "rounded-[10px]";
  const pad = compact ? "px-3 py-3" : "px-4 py-5";
  const teks = compact ? "text-[12px]" : "text-[13px]";
  const isi = value;

  return (
    <div>
      {previewUrl && (
        <div className="mb-2 flex items-center gap-3">
          <img
            src={previewUrl}
            alt="Bukti pembayaran"
            className={`${r} border border-solid border-slate-200 object-cover`}
            style={{ width: 56, height: 56 }}
          />
          {onHapusPreview && (
            <button
              type="button"
              onClick={onHapusPreview}
              className="border-0 bg-transparent text-xs font-semibold text-red-600 hover:text-red-700"
            >
              Hapus bukti
            </button>
          )}
        </div>
      )}

      <div
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setHover(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          setHover(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setHover(false);
          terima(e.dataTransfer.files?.[0]);
        }}
        className={`flex cursor-pointer flex-col items-center justify-center gap-1.5 border-[1.5px] text-center transition-colors ${r} ${pad} ${teks} ${
          isi
            ? "border-solid border-emerald-500 bg-green-50"
            : hover
              ? "border-dashed border-[#7181E0] bg-[#EEF2FF]"
              : "border-dashed border-gray-200 hover:border-[#7181E0] hover:bg-[#EEF2FF]"
        }`}
      >
        {isi ? (
          <div className="flex flex-col items-center gap-1">
            <span
              className="font-semibold text-emerald-800"
              style={{ wordBreak: "break-word" }}
            >
              {isi.name}
            </span>
            <span className="text-[11px] text-emerald-700">
              {ukuranMB(isi.size)} MB
            </span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                reset();
              }}
              className="border-0 bg-transparent text-[11px] font-semibold text-red-600 hover:text-red-700"
            >
              Hapus
            </button>
          </div>
        ) : (
          <>
            <span className="text-gray-400">
              Tarik &amp; lepas foto di sini, atau
            </span>
            <span className="rounded-md bg-gray-200 px-3 py-1 text-[11px] font-semibold text-slate-700">
              Browse
            </span>
            <span className="text-[10px] text-gray-400">
              JPG, PNG, WEBP · maks 5MB
            </span>
          </>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        hidden
        onChange={(e) => terima(e.target.files?.[0])}
      />
    </div>
  );
}
