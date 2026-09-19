# Fitur Multi Cabang — Sewara

## Latar Belakang

Fitur multi cabang memungkinkan satu akun Sewara mengelola beberapa cabang bisnis rental sekaligus. Setiap cabang beroperasi secara mandiri dengan inventori dan operasional tersendiri, namun tetap dapat dipantau secara terpusat oleh Owner.

---

## Struktur Hierarki Role

```
Owner
├── Cabang A
│   ├── Supervisor
│   ├── CS
│   └── Gudang
└── Cabang B
    ├── Supervisor
    ├── CS
    └── Gudang
```

### Deskripsi Role

| Role | Scope | Akses |
|---|---|---|
| **Owner** | Semua cabang | Read + Write semua cabang, laporan gabungan atau per cabang |
| **Supervisor** | 1 cabang | Read + Write di cabangnya saja (setara Owner tapi terbatas 1 cabang) |
| **CS** | 1 cabang | Booking, member, promo di cabangnya |
| **Gudang** | 1 cabang | Kelola inventori dan tracking alat di cabangnya |

---

## Isolasi Data Antar Cabang

### Inventori
Setiap cabang memiliki katalog inventori **terpisah dan terisolasi**. Alat di Cabang A tidak terlihat di Cabang B.

### Operasional
Booking, status sewa, dan kanban bersifat **per cabang**. Staff hanya melihat transaksi di cabangnya masing-masing.

### Data Pelanggan
Data pelanggan bersifat **shared antar cabang**. Pelanggan yang terdaftar di Cabang A bisa melakukan sewa di Cabang B tanpa perlu daftar ulang.

> **Catatan:** Walaupun data pelanggan shared, scope laporan dan export tetap mengikuti role yang sedang login — Supervisor hanya bisa export data pelanggan yang bertransaksi di cabangnya.

---

## Akses Laporan & Export

| Role | Scope Laporan |
|---|---|
| Owner | Pilih: per cabang, atau gabungan semua cabang |
| Supervisor | Hanya cabangnya sendiri |
| CS / Gudang | Tidak ada akses laporan |

---

## Implikasi Teknis

### Perubahan Arsitektur Database

Saat ini isolasi tenant berbasis `user_id` di level akun (Row Level Security Supabase). Untuk mendukung multi cabang, isolasi perlu bergeser ke level **cabang (branch)**.

Perubahan yang diperlukan:
- Tambah tabel `branches` sebagai entitas baru
- Tambah kolom `branch_id` di tabel-tabel utama (inventori, booking, transaksi)
- Update RLS policy dari `user_id` menjadi `branch_id`
- Tabel `profiles` perlu kolom `branch_id` dan `role` yang mengacu ke cabang

### Struktur Tabel Baru (Usulan)

```sql
-- Tabel cabang
branches (
  id uuid PK,
  owner_id uuid FK → profiles.id,
  name text,
  created_at timestamptz
)

-- Update profiles
profiles (
  id uuid PK,
  branch_id uuid FK → branches.id,  -- null jika Owner
  role text,  -- 'owner' | 'supervisor' | 'cs' | 'gudang'
  ...
)
```

### RLS Policy (Konsep)

```sql
-- CS dan Gudang hanya lihat data di cabangnya
CREATE POLICY branch_isolation ON bookings
  USING (branch_id = (SELECT branch_id FROM profiles WHERE id = auth.uid()));

-- Owner bisa lihat semua
CREATE POLICY owner_access ON bookings
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'owner'
  );
```

---

## Alur Pembuatan Cabang (Owner)

1. Owner login ke Sewara
2. Buka menu **Perusahaan → Cabang**
3. Klik **Tambah Cabang** → isi nama cabang
4. Buat akun Supervisor untuk cabang tersebut
5. Supervisor login dan bisa mulai buat akun CS dan Gudang di cabangnya

---

## Prioritas Implementasi

| Tahap | Item | Keterangan |
|---|---|---|
| **Fase 1** | Struktur DB multi cabang | Migrasi RLS dari user ke branch level |
| **Fase 1** | UI manajemen cabang | Halaman Owner untuk tambah/kelola cabang |
| **Fase 2** | Role Supervisor | Tambah role baru di atas CS/Gudang |
| **Fase 2** | Filter laporan per cabang | Owner bisa switch antar cabang di laporan |
| **Fase 3** | Laporan gabungan | Agregasi data semua cabang untuk Owner |

---

## Catatan Risiko

- **Migrasi RLS** adalah perubahan terbesar — perlu testing ketat agar data antar cabang tidak bocor
- **Data pelanggan shared** perlu policy khusus supaya Supervisor tidak bisa edit data pelanggan cabang lain
- Fitur ini berdampak ke hampir semua modul yang sudah ada (inventori, operasional, data, perusahaan)
