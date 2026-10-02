"use client";

import { api } from "@/lib/api-client";
import { useNotify } from "@/components/NotificationProvider";

// Slot dokumen jaminan — label tetap per index (0-4), sinkron dengan
// backend POST /api/blacklist/upload (index mengganti slot yang sama).
export const FOTO_SLOTS = ["KTP", "Kartu Keluarga", "SIM", "NPWP", "Lainnya"];
const MAKS_BYTE = 10 * 1024 * 1024;
const TIPE_OK = ["image/jpeg", "image/png", "application/pdf"];

/** items: array(5) tiap elemen null | {label, path?, url?, file?, snapshot?} */
export default function BlacklistFotoSlot({ items, onChange }) {
  const { notify } = useNotify();
  const jml = items.filter(
    (it) => it && (it.path || it.file || it.url),
  ).length;

  function pilih(index, file) {
    if (!file) return;
    if (!TIPE_OK.includes(file.type))
      return notify("File harus JPG, PNG, atau PDF.", "error");
    if (file.size > MAKS_BYTE)
      return notify("Ukuran file maksimal 10MB.", "error");
    const next = [...items];
    next[index] = {
      label: FOTO_SLOTS[index],
      file,
      url: URL.createObjectURL(file),
      snapshot: false,
    };
    onChange(next);
  }

  function hapus(index) {
    const next = [...items];
    next[index] = null;
    onChange(next);
  }

  return (
    <div>
      <div className="mb-2 flex items-center gap-3">
        <div className="h-px flex-1 bg-gray-200" />
        <span className="whitespace-nowrap text-xs font-semibold text-gray-400">
          Foto Jaminan (Opsional · {jml}/5)
        </span>
        <div className="h-px flex-1 bg-gray-200" />
      </div>
      <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-5">
        {FOTO_SLOTS.map((label, index) => {
          const it = items[index];
          const terisi = Boolean(it && (it.path || it.file || it.url));
          return (
            <div
              key={label}
              className={`relative flex min-h-20 flex-col items-center justify-center gap-1.5 rounded-[10px] border-[1.5px] px-2 py-3.5 text-center transition-colors ${terisi ? "border-solid border-emerald-500 bg-green-50" : "cursor-pointer border-dashed border-gray-200 hover:border-[#7181E0] hover:bg-[#EEF2FF]"}`}
              onClick={() =>
                !terisi &&
                document.getElementById(`blf-${index}`)?.click()
              }
            >
              <div
                className={`text-xl leading-none ${terisi ? "text-emerald-500" : "text-gray-400"}`}
              >
                {it?.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={it.url}
                    alt={label}
                    className="max-h-20 max-w-full object-contain"
                  />
                ) : it?.path && !it.snapshot ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={api.blacklist.photoUrl(it.path)}
                    alt={label}
                    className="max-h-20 max-w-full object-contain"
                  />
                ) : it?.path && it.snapshot ? (
                  <span className="text-[11px] font-semibold text-emerald-700">
                    {it.label || label}
                  </span>
                ) : (
                  <span>+</span>
                )}
              </div>
              <div
                className={`text-[11px] font-semibold ${terisi ? "text-emerald-800" : "text-gray-400"}`}
              >
                {it?.snapshot ? "snapshot" : it?.label || label}
              </div>
              {terisi && !it?.snapshot && (
                <div
                  className="text-center text-[10px] text-red-500"
                  onClick={(e) => {
                    e.stopPropagation();
                    hapus(index);
                  }}
                >
                  Hapus
                </div>
              )}
              <input
                id={`blf-${index}`}
                type="file"
                hidden
                accept="image/jpeg,image/png,application/pdf"
                onChange={(e) => {
                  pilih(index, e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}