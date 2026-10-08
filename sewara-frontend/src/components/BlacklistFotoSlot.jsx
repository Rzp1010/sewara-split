"use client";

import { api } from "@/lib/api-client";
import { useNotify } from "@/components/NotificationProvider";

// Slot dokumen jaminan — label adalah identitas slot; upload mengganti per-label.
export const FOTO_SLOTS = ["KTP", "Kartu Keluarga", "SIM", "NPWP", "Lainnya"];
const MAKS_BYTE = 5 * 1024 * 1024;
const TIPE_OK = ["image/jpeg", "image/png", "application/pdf"];

/** items: array(5) tiap elemen null | {label, path?, url?, file?, snapshot?} */
export default function BlacklistFotoSlot({ items, onChange, allowRemoveSnapshot = false }) {
  const { notify } = useNotify();
  const slots = FOTO_SLOTS.map(
    (label) => items.find((it) => it?.label === label) || null,
  );
  const jml = slots.filter((it) => it && (it.path || it.file || it.url)).length;

  function pilih(index, file) {
    if (!file) return;
    if (!TIPE_OK.includes(file.type))
      return notify("File harus JPG, PNG, atau PDF.", "error");
    if (file.size > MAKS_BYTE)
      return notify("Ukuran file maksimal 5MB.", "error");
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
      <div className="mb-2 flex items-center gap-3">
        <div className="h-px flex-1 bg-[var(--border-color)]" />
        <span className="whitespace-nowrap text-xs font-semibold text-[var(--text-muted)]">
          Foto Jaminan (Opsional · {jml}/5)
        </span>
        <div className="h-px flex-1 bg-[var(--border-color)]" />
      </div>
      <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-5">
        {FOTO_SLOTS.map((label, index) => {
          const it = slots[index];
          const terisi = Boolean(it && (it.path || it.file || it.url));
          return (
            <div
              key={label}
              className={`relative flex min-h-20 flex-col items-center justify-center gap-1.5 rounded-[10px] border-[1.5px] px-2 py-3.5 text-center transition-colors ${terisi ? "border-solid border-emerald-500 bg-green-50" : "cursor-pointer border-dashed border-[var(--border-color)] hover:border-[#7181E0] hover:bg-[var(--bg-subtle)]"}`}
              onClick={() =>
                !terisi &&
                document.getElementById(`blf-${index}`)?.click()
              }
            >
              <div
                className={`text-xl leading-none ${terisi ? "text-emerald-500" : "text-[var(--text-muted)]"}`}
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
                className={`text-[11px] font-semibold ${terisi ? "text-emerald-800" : "text-[var(--text-muted)]"}`}
              >
                {it?.label || label}
              </div>
              {it?.snapshot && (
                <span className="text-[9px] leading-tight text-[var(--text-muted)]">
                  Dokumen dari member — akan disalin saat disimpan.
                </span>
              )}
              {terisi && (!it?.snapshot || allowRemoveSnapshot) && (
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