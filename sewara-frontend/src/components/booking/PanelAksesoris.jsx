"use client";

/**
 * Panel Aksesoris (printilan) — dipakai dua tempat:
 * `varian="form"` (form booking) dan `varian="modal"` (modal edit transaksi).
 * Hanya kulit/wrapper yang beda; logika centang sama. State tetap di pemanggil.
 * Renders null kalau daftar kosong (dulu dijaga `{printilanDaftar.length > 0 && ...}`).
 */
export default function PanelAksesoris({
  varian = "form",
  daftar = [],
  terpilih = [],
  custom = "",
  onToggle,
  onChangeCustom,
}) {
  if (!daftar || daftar.length === 0) return null;
  const modal = varian === "modal";
  return (
    <div
      className={
        modal
          ? "mt-3 bg-[var(--bg-subtle)] rounded-lg p-3"
          : "mt-6 mb-4 rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)] p-4 shadow-lg"
      }
    >
      {modal ? (
        <p className="text-xs font-bold uppercase tracking-wide text-[var(--text-secondary)] mb-2">
          Aksesoris
        </p>
      ) : (
        <label className="mb-2 block text-[12.5px] font-bold tracking-[0.02em] text-[var(--text-secondary)]">
          Aksesoris
        </label>
      )}
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        {daftar.map((item) => (
          <label
            key={item}
            className="flex items-center gap-1.5 text-sm text-[var(--text-secondary)] cursor-pointer"
          >
            <input
              type="checkbox"
              checked={terpilih.includes(item)}
              onChange={(e) => onToggle(item, e.target.checked)}
              className="h-4 w-4 rounded border-[var(--border-color)] accent-[#7181E0]"
            />
            {item}
          </label>
        ))}
      </div>
      {modal ? (
        <input
          type="text"
          value={custom}
          onChange={(e) => onChangeCustom(e.target.value)}
          placeholder="Aksesoris lain (pisahkan dengan koma)..."
          className="mt-3 w-full rounded-[0.375rem] border-2 border-border bg-surface-card px-3.5 py-2.5 text-sm text-text-primary outline-none transition focus:border-brand focus:ring-2 focus:ring-brand-light"
        />
      ) : (
        <div className="mt-3">
          <input
            type="text"
            value={custom}
            onChange={(e) => onChangeCustom(e.target.value)}
            placeholder="Aksesoris lain (pisahkan dengan koma)..."
            className="w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none transition-colors focus:border-[#7181E0] focus:ring-2 focus:ring-[#7181E0]/20"
          />
        </div>
      )}
    </div>
  );
}
