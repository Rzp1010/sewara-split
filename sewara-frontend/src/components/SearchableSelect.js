"use client";

import { useState, useRef, useEffect } from "react";

const KAPASITAS_PANEL = 320;

export default function SearchableSelect({
  options,
  placeholder,
  onChange,
  value,
  noSearch,
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [posesi, setPosesi] = useState({ arah: "bawah", tinggi: 240 });
  const ref = useRef(null);

  const selected = options.find((o) => o.value === value);

  const q = noSearch ? "" : search.trim().toLowerCase();
  const cocok = (o) =>
    o.label.toLowerCase().includes(q) ||
    (o.tag || "").toLowerCase().includes(q);
  const filtered = noSearch
    ? options.filter((o) => !o.disabled)
    : options.filter((o) => !o.disabled && cocok(o));
  if (!noSearch && q) {
    const banding = (a, b) =>
      a.label.toLowerCase().localeCompare(b.label.toLowerCase());
    const awalan = filtered
      .filter((o) => o.label.toLowerCase().startsWith(q))
      .sort(banding);
    const lainnya = filtered
      .filter((o) => !o.label.toLowerCase().startsWith(q))
      .sort(banding);
    filtered.length = 0;
    filtered.push(...awalan, ...lainnya);
  }

  const grouped = {};
  filtered.forEach((o) => {
    if (!grouped[o.group]) grouped[o.group] = [];
    grouped[o.group].push(o);
  });

  useEffect(() => {
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) {
        setOpen(false);
        setSearch("");
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function bukaDropdown() {
    const akanBuka = !open;
    if (ref.current && akanBuka) {
      const rect = ref.current.getBoundingClientRect();
      const ruangBawah = window.innerHeight - rect.bottom;
      const ruangAtas = rect.top;
      const arah = ruangBawah > ruangAtas ? "bawah" : "atas";
      const tersedia = arah === "bawah" ? ruangBawah : ruangAtas;
      const tinggi = Math.max(120, Math.min(KAPASITAS_PANEL, tersedia - 8));
      setPosesi({ arah, tinggi });
    }
    setOpen(akanBuka);
    setSearch("");
  }

  return (
    <div ref={ref} className="relative w-full">
      <div
        className="flex min-h-12 w-full items-center justify-between rounded-md border border-solid border-gray-300 bg-white px-3 py-2.5 leading-[1.6] cursor-pointer transition-colors focus-within:border-blue-600 focus-within:ring-2 focus-within:ring-blue-600/20 hover:border-gray-400"
        onClick={() => bukaDropdown()}
      >
        <span className={selected ? "truncate" : "truncate text-gray-500"}>
          {selected ? selected.label : placeholder}
        </span>
      </div>

      {open && (
        <div
          className={`absolute z-50 max-h-60 w-full overflow-y-auto rounded-xl border border-gray-200 bg-white shadow-xl ${posesi.arah === "atas" ? "bottom-full mb-2" : "top-full mt-2"}`}
        >
          {!noSearch && (
            <div>
              <input
                autoFocus
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Cari barang..."
                className="w-full px-3 py-2 border-b focus:outline-none"
              />
            </div>
          )}
          {Object.keys(grouped).length === 0 && (
            <div className="px-3 py-2 text-gray-500">Tidak ditemukan</div>
          )}
          {Object.entries(grouped).map(([group, items]) => (
            <div key={group || "__nogroup"}>
              {group && (
                <div className="sticky top-0 bg-slate-200 px-3 py-2 text-xs font-bold uppercase tracking-wide text-slate-700">
                  {group}
                </div>
              )}
              {items.map((o) => (
                <div
                  key={o.value}
                  className={`px-3 py-2 cursor-pointer hover:bg-gray-100 ${o.value === value ? "bg-blue-50 text-blue-700" : ""}`}
                  onClick={() => {
                    onChange(o.value);
                    setOpen(false);
                    setSearch("");
                  }}
                >
                  <span>{o.label}</span>
                  {o.badge && (
                    <span className="ml-2 inline-flex items-center gap-1 px-2 py-1 bg-blue-100 text-blue-700 rounded text-sm">
                      {o.badge}
                    </span>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
