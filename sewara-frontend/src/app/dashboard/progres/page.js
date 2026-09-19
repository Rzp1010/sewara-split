"use client";

import { useState } from "react";

const itemsData = [
  // ── Tahap 0 ──
  { id: "0a", done: true, label: "Tahap 0 — Persiapan & Setup", bold: true },
  { id: "0b", done: true, label: "  Uninstall opencode lama (bersih dari config orang lain)" },
  { id: "0c", done: true, label: "  Install opencode fresh dengan API key sendiri" },
  { id: "0d", done: true, label: "  Buat folder project rentalpro" },
  { id: "0e", done: true, label: "  File spec dokumentasi & roadmap" },

  // ── Tahap 1 ──
  { id: "1a", done: true, label: "Tahap 1 — Kerangka Dashboard (UI)", bold: true },
  { id: "1b", done: true, label: "  Init project Next.js + Tailwind" },
  { id: "1c", done: true, label: "  Sidebar navigasi" },
  { id: "1d", done: true, label: "  Halaman kosong masing-masing fitur" },
  { id: "1e", done: true, label: "  Bisa dibuka di localhost" },

  // ── Tahap 2 ──
  { id: "2a", done: true, label: "Tahap 2 — Database Inventory (Supabase)", bold: true },
  { id: "2b", done: true, label: "  Setup project Supabase + API key & URL" },
  { id: "2c", done: true, label: "  Install library Supabase" },
  { id: "2d", done: true, label: "  Bikin tabel inventory + RLS" },
  { id: "2e", done: true, label: "  Connect Next.js ke Supabase" },
  { id: "2f", done: true, label: "  Fitur CRUD inventory jalan" },
  { id: "2g", done: true, label: "  Test: data muncul di Supabase Table Editor" },

  // ── Tahap 3 ──
  { id: "3a", done: true, label: "Tahap 3 — Fitur Booking", bold: true },
  { id: "3b", done: true, label: "  Bikin tabel transactions di Supabase (JSONB items)" },
  { id: "3c", done: true, label: "  Halaman Booking Baru: form penyewa + pilih barang dari stok" },
  { id: "3d", done: true, label: "  Assign Nomor Seri otomatis saat booking" },
  { id: "3e", done: true, label: "  Stok otomatis berkurang saat booking" },
  { id: "3f", done: true, label: "  Halaman Status Sewa: daftar transaksi aktif" },
  { id: "3g", done: true, label: '  Aksi "Serahkan" (Booking → Disewa)' },
  { id: "3h", done: true, label: '  Aksi "Terima Kembali" (Disewa → Selesai + denda)' },
  { id: "3i", done: true, label: "  Edit jadwal + Batalkan booking (stok dikembalikan)" },
  { id: "3j", done: true, label: "  Riwayat Invoice + Print" },
  { id: "3k", done: true, label: "  Tracking Alat" },

  // ── Tahap 4 ──
  { id: "4a", done: true, label: "Tahap 4 — Kalender Jadwal Visual", bold: true },
  { id: "4b", done: true, label: "  Tampilan kalender custom (tanpa library tambahan)" },
  { id: "4c", done: true, label: "  Jadwal sewa aktif per tanggal" },
  { id: "4d", done: true, label: "  Event bar span hari sesuai durasi" },

  // ── Tahap 5 ──
  { id: "5a", done: true, label: "Tahap 5 — Laporan Keuangan", bold: true },
  { id: "5b", done: true, label: "  Halaman laporan dengan filter periode" },
  { id: "5c", done: true, label: "  Rekap total pemasukan + denda" },
  { id: "5d", done: true, label: "  Tabel riwayat transaksi selesai" },
  { id: "5e", done: true, label: "  Export CSV" },

  // ── Tahap 6 ──
  { id: "6a", done: false, label: "Tahap 6 — Autentikasi & Role", bold: true },
  { id: "6b", done: true, label: "  Login dengan Supabase Auth" },
  { id: "6c", done: true, label: "  Proteksi halaman (redirect ke login)" },
  { id: "6d", done: true, label: "  Fitur logout" },
  { id: "6e", done: false, label: "  Bikin tabel profiles dengan kolom role" },
  { id: "6f", done: false, label: "  Halaman SDM (tambah/edit user)" },
  { id: "6g", done: false, label: "  Filter menu sidebar berdasarkan role (Owner/CS/Gudang)" },
  { id: "6h", done: false, label: "  Tambah kolom user_id + RLS (pisah data per user)" },

  // ── Tahap 7 ──
  { id: "7a", done: false, label: "Tahap 7 — Deploy ke Internet", bold: true },
  { id: "7b", done: false, label: "  Upload ke GitHub" },
  { id: "7c", done: false, label: "  Deploy ke Vercel" },
  { id: "7d", done: false, label: "  Environment variables di Vercel" },
  { id: "7e", done: false, label: "  Test dari HP/device lain" },

  // ── Ekstra ──
  { id: "8a", done: true, label: "Tambahan — Fitur Lainnya", bold: true },
  { id: "8b", done: true, label: "  Log S/N aktivitas" },
  { id: "8c", done: true, label: "  Board Status 5 kolom (Booking/Disewa/Mendekati/Telat/Selesai)" },
  { id: "8d", done: true, label: "  Drag & drop antar kolom" },
  { id: "8e", done: true, label: "  Detail popup (tabel barang + biaya)" },
  { id: "8f", done: true, label: "  Board mode Tumpuk/Geser (horizontal scroll)" },
  { id: "8g", done: true, label: "  Pengaturan: tema, invoice, notifikasi, aturan sewa" },
  { id: "8h", done: true, label: "  Dark mode" },
  { id: "8i", done: true, label: "  CSV Import/Export inventaris" },
  { id: "8j", done: true, label: "  Duplicate S/N handling + merge produk" },
  { id: "8k", done: false, label: "  Hapus menu Progres ini" },
];

export default function ProgresPage() {
  const [items, setItems] = useState(itemsData);
  const all = items.filter((i) => !i.bold);
  const done = all.filter((i) => i.done);

  function toggle(id) {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, done: !i.done } : i)));
  }

  return (
    <div className="w-full mx-auto" style={{ maxWidth: 768 }}>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-[26px] font-bold tracking-[-0.01em] leading-[1.2]">📈 Progres</h2>
        <span className="inline-flex items-center gap-1 rounded-full bg-[var(--color-primary-soft)] px-[10px] py-[3px] text-xs font-bold leading-[1.4] text-[var(--color-primary-soft-text)]">
          {done.length}/{all.length}
        </span>
      </div>
      <div className="mb-6" style={{ height: 12, borderRadius: 999, background: "var(--bg-inset)", overflow: "hidden" }}>
        <div style={{ height: 12, borderRadius: 999, background: "var(--color-primary)", transition: "all 0.25s ease", width: `${(done.length / all.length) * 100}%` }} />
      </div>
      <div className="flex-col" style={{ gap: 2 }}>
        {items.map((item, idx) =>
          item.bold ? (
            <div key={item.id} className="mt-5 mb-2" style={idx === 0 ? { marginTop: 0 } : undefined}>
              <span className="text-13 font-bold">{item.label}</span>
            </div>
          ) : (
            <label
              key={item.id}
              className="flex items-center gap-3"
              style={{
                cursor: "pointer",
                borderRadius: 8,
                border: "1px solid",
                padding: "10px 12px",
                transition: "background-color 0.15s ease, border-color 0.15s ease",
                background: item.done ? "var(--color-success-soft)" : "var(--bg-surface)",
                borderColor: item.done ? "var(--color-success)" : "var(--border-color)",
              }}
            >
              <input type="checkbox" checked={item.done} onChange={() => toggle(item.id)} style={{ width: 16, height: 16, accentColor: "var(--color-primary)", cursor: "pointer" }} />
              <span
                className="text-13"
                style={{
                  color: item.done ? "var(--color-success-text)" : "var(--text-primary)",
                  textDecoration: item.done ? "line-through" : "none",
                }}
              >
                {item.label}
              </span>
            </label>
          )
        )}
      </div>
      <p className="text-center text-xs text-[var(--text-muted)] mt-6 mb-0">Centang/silang manual sesuai progres. Menu ini akan dihapus setelah aplikasi selesai.</p>
    </div>
  );
}
