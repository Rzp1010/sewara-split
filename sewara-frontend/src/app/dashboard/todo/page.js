"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui";

const awal = [
  "Reminder WhatsApp",
  "Kwitansi pembayaran",
  "Grafik pendapatan",
  "Export laporan PDF",
  "Riwayat per S/N alat",
  "Manajemen jaminan",
  "Deploy & akses HP (Tahap 7)",
  "SDM & role (Tahap 6)",
];

export default function TodoPage() {
  const [items, setItems] = useState([]);
  const [input, setInput] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const saved = JSON.parse(localStorage.getItem("rentalpro_todo"));
        if (Array.isArray(saved) && saved.length > 0) setItems(saved);
        else setItems(awal.map((t) => ({ teks: t, done: false })));
      } catch {
        setItems(awal.map((t) => ({ teks: t, done: false })));
      }
    })();
  }, []);

  useEffect(() => {
    if (items.length > 0) localStorage.setItem("rentalpro_todo", JSON.stringify(items));
  }, [items]);

  function toggle(i) {
    setItems((prev) => prev.map((x, idx) => (idx === i ? { ...x, done: !x.done } : x)));
  }

  function tambah() {
    const t = input.trim();
    if (!t) return;
    setItems((prev) => [...prev, { teks: t, done: false }]);
    setInput("");
  }

  function hapus(i) {
    setItems((prev) => prev.filter((_, idx) => idx !== i));
  }

  function reset() {
    if (confirm("Reset semua to-do ke daftar awal?")) {
      localStorage.removeItem("rentalpro_todo");
      setItems(awal.map((t) => ({ teks: t, done: false })));
    }
  }

  const done = items.filter((i) => i.done).length;

      return (
    <div className="max-w-2xl">
       <div className="mb-6 flex items-center justify-between">
         <h2 className="text-[26px] font-bold tracking-[-0.01em] leading-[1.2]">✅ To Do</h2>
         <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-[3px] text-xs font-bold leading-[1.4] whitespace-nowrap" style={{ background: "var(--color-primary-soft)", color: "var(--color-primary-soft-text)" }}>
          {done}/{items.length} selesai
        </span>
      </div>
      <div className="mb-4" style={{ height: 12, borderRadius: 999, background: "var(--bg-inset)", overflow: "hidden" }}>
        <div style={{ height: 12, borderRadius: 999, background: "var(--color-primary)", transition: "all 0.25s ease", width: `${items.length ? (done / items.length) * 100 : 0}%` }} />
      </div>

      <div className="mb-4 flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && tambah()}
          placeholder="Tambah item to-do baru..."
          className="flex-1 min-w-0 rounded-md border border-[var(--border-color)] bg-[var(--bg-surface)] px-3.5 py-2.5 text-sm text-[var(--text-primary)]"
        />
        <Button onClick={tambah}>Tambah</Button>
      </div>

      <div className="flex-col" style={{ gap: 6 }}>
        {items.length === 0 && <p className="text-center text-13 text-muted mb-0" style={{ padding: "32px 0", fontStyle: "italic" }}>Belum ada to-do.</p>}
        {items.map((item, i) => (
          <div
            key={i}
            className="flex gap-3"
            style={{
              borderRadius: 8,
              border: "1px solid",
              padding: "10px 12px",
              transition: "background-color 0.15s ease, border-color 0.15s ease",
              background: item.done ? "var(--color-success-soft)" : "var(--bg-surface)",
              borderColor: item.done ? "var(--color-success)" : "var(--border-color)",
            }}
          >
            <input type="checkbox" checked={item.done} onChange={() => toggle(i)} style={{ width: 16, height: 16, accentColor: "var(--color-primary)", cursor: "pointer" }} />
            <span
              className="flex-1 text-13"
              style={{
                color: item.done ? "var(--color-success-text)" : "var(--text-primary)",
                textDecoration: item.done ? "line-through" : "none",
              }}
            >{item.teks}</span>
            <button onClick={() => hapus(i)} className="text-xs font-bold" style={{ color: "var(--color-danger)", background: "none", border: 0, cursor: "pointer", padding: 0 }}>Hapus</button>
          </div>
        ))}
      </div>

      <button onClick={reset} className="mt-6 inline-flex items-center justify-center rounded-md border px-3 py-[7px] text-xs font-semibold" style={{ borderColor: "var(--color-danger)", color: "var(--color-danger-text)" }}>↺ Reset ke daftar awal</button>
      <p className="mt-4 mb-0 text-center text-xs text-[var(--text-muted)]">Daftar tersimpan di browser (localStorage).</p>
    </div>
  );
}
