# Database Schema Documentation

**Project:** Sewara Apps  
**Database:** PostgreSQL (Supabase)  
**Project ID:** obhvrzholszhjnpvmnna  
**Last Updated:** 30 August 2026  
**Total Tables:** 28  
**Schema Version:** Phase 9 (SaaS Infrastructure + Permission System)

---

## Table of Contents

1. [Overview](#overview)
2. [Table Categories](#table-categories)
3. [Business Rental Tables (14)](#business-rental-tables)
4. [SaaS Platform Tables (11)](#saas-platform-tables)
5. [Utility Tables (3)](#utility-tables)
6. [Enum Types (9)](#enum-types)
7. [Foreign Key Relationships](#foreign-key-relationships)
8. [RLS Policies](#rls-policies)
9. [Indexes](#indexes)

---

## Overview

Sewara Apps menggunakan arsitektur database multi-tenant dengan Row Level Security (RLS) untuk isolasi data per user. Database terdiri dari 28 tabel yang dikelompokkan menjadi:

- **Business Rental (14 tabel):** Core bisnis rental (inventory, transactions, members)
- **SaaS Platform (11 tabel):** Subscription, payment, permission system
- **Utility (3 tabel):** Helper tables untuk konfigurasi dan counter

**Key Design Principles:**
- Snake_case naming convention untuk semua kolom
- JSONB normalized ke relational tables dengan dual-write fallback
- RLS tenant isolation menggunakan `user_id = auth.uid()`
- Enum types untuk status fields (type safety)
- Foreign keys dengan proper ON DELETE behavior

---

## Table Categories

### Business Rental (14 tables)
Core bisnis rental untuk inventory, transaksi, dan customer management.

### SaaS Platform (11 tables)
Infrastruktur subscription, usage metering, payment webhook, dan role-based permission system.

### Utility (3 tables)
Helper tables untuk konfigurasi global dan counter.

---

## Business Rental Tables

### 1. `inventory`
**Purpose:** Katalog barang yang disewakan

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | TEXT | NO | - | Primary key (format: INV-XXX) |
| nama | TEXT | NO | - | Nama barang |
| stok | INTEGER | YES | - | Jumlah total unit |
| harga | INTEGER | YES | - | Harga sewa per durasi |
| satuan | TEXT | YES | - | Satuan waktu (hari/jam) |
| jenis | enum_jenis_inventory | NO | 'satuan' | Jenis: 'satuan' atau 'bundling' |
| kondisi | enum_kondisi_inventory | YES | - | Kondisi: 'baik', 'rusak', 'hilang' |
| gambar | TEXT | YES | - | URL gambar barang |
| komponen | JSONB | YES | - | Komponen bundling (jika jenis=bundling) |
| sns | JSONB | YES | - | LEGACY: Serial numbers (normalized ke inventory_units) |
| user_id | UUID | NO | - | Owner (tenant key) |
| created_at | TIMESTAMPTZ | YES | NOW() | Timestamp dibuat |

**Relationships:**
- Has many: `inventory_units` (serial numbers)
- Has many: `transaction_items`

**RLS:** User hanya bisa akses inventory miliknya (`user_id = auth.uid()`)

**Indexes:**
- PRIMARY KEY: `id`
- INDEX: `user_id`

---

### 2. `inventory_units`
**Purpose:** Serial numbers per unit inventory (normalized dari `inventory.sns`)

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | UUID | NO | gen_random_uuid() | Primary key |
| inventory_id | TEXT | NO | - | FK ke inventory.id |
| serial_number | TEXT | NO | - | Serial number unit |
| status | TEXT | YES | - | Status unit (available/rented/damaged) |
| user_id | UUID | NO | - | Owner (tenant key) |
| created_at | TIMESTAMPTZ | YES | NOW() | Timestamp dibuat |

**Relationships:**
- Belongs to: `inventory` (FK: inventory_id)

**RLS:** User hanya bisa akses units miliknya

**Indexes:**
- PRIMARY KEY: `id`
- INDEX: `inventory_id`
- INDEX: `user_id`

**Constraints:**
- FK: `inventory_id` REFERENCES `inventory(id)` ON DELETE CASCADE
- CHECK: `serial_number <> ''`

---

### 3. `transactions`
**Purpose:** Transaksi sewa pelanggan

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | TEXT | NO | - | Primary key (format: TRX-XXX) |
| no_invoice | TEXT | YES | - | Nomor invoice |
| penyewa | TEXT | NO | - | Nama penyewa |
| hp_penyewa | TEXT | YES | - | Nomor HP penyewa |
| alamat_penyewa | TEXT | YES | - | Alamat penyewa |
| member_id | TEXT | YES | - | FK ke members.id (jika penyewa adalah member) |
| jaminan_sewa | JSONB | YES | - | Data jaminan (KTP/SIM/dll) |
| waktu_ambil_rencana | TIMESTAMPTZ | YES | - | Jadwal ambil rencana |
| waktu_kembali_rencana | TIMESTAMPTZ | YES | - | Jadwal kembali rencana |
| waktu_ambil_aktual | TIMESTAMPTZ | YES | - | Waktu ambil aktual |
| waktu_kembali_aktual | TIMESTAMPTZ | YES | - | Waktu kembali aktual |
| durasi_teks | TEXT | YES | - | Durasi sewa (text readable) |
| status | enum_status_transaksi | NO | 'Booking' | Status: Booking/Disewa/Selesai/dll |
| biaya | INTEGER | YES | - | Biaya dasar sewa |
| denda | INTEGER | YES | 0 | Denda keterlambatan |
| total_akhir | INTEGER | YES | - | Total tagihan (biaya + denda) |
| items | JSONB | YES | - | LEGACY: Item sewa (normalized ke transaction_items) |
| pembayaran | JSONB | YES | - | LEGACY: Pembayaran (normalized ke transaction_payments) |
| user_id | UUID | NO | - | Owner (tenant key) |
| created_by | UUID | YES | - | User yang buat transaksi |
| updated_by | UUID | YES | - | User yang update transaksi |
| created_at | TIMESTAMPTZ | YES | NOW() | Timestamp dibuat |
| updated_at | TIMESTAMPTZ | YES | NOW() | Timestamp update |

**Relationships:**
- Belongs to: `members` (FK: member_id, optional)
- Has many: `transaction_items` (items sewa)
- Has many: `transaction_payments` (pembayaran)

**RLS:** User hanya bisa akses transaksi miliknya

**Indexes:**
- PRIMARY KEY: `id`
- INDEX: `user_id`
- INDEX: `status`
- INDEX: `waktu_ambil_rencana`
- INDEX: `member_id`

**Constraints:**
- FK: `member_id` REFERENCES `members(id)` ON DELETE SET NULL

---

### 4. `transaction_items`
**Purpose:** Item barang per transaksi (normalized dari `transactions.items`)

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | SERIAL | NO | auto-increment | Primary key |
| transaction_id | BIGINT | NO | - | ID transaksi |
| inventory_id | BIGINT | YES | - | ID inventory (nullable untuk historical data) |
| item_name | TEXT | NO | - | Nama barang (snapshot) |
| item_type | TEXT | YES | - | Jenis: `satuan` atau `bundling` |
| qty | INTEGER | NO | 1 | Jumlah unit |
| unit_price | NUMERIC(12,2) | YES | 0 | Harga per unit (snapshot) |
| subtotal | NUMERIC(12,2) | YES | 0 | Subtotal |
| rate_type | TEXT | YES | - | Tarif, misalnya `h6`, `h12`, `h24` |
| serial_number | TEXT | YES | - | Serial number item satuan |
| assigned_components | JSONB | YES | `[]` | Komponen item bundling |
| user_id | UUID | NO | - | Owner (tenant key) |
| created_at | TIMESTAMPTZ | NO | NOW() | Timestamp dibuat |
| updated_at | TIMESTAMPTZ | NO | NOW() | Timestamp update |

**Relationships:**
- Belongs to: `transactions` (FK: transaction_id)
- Belongs to: `inventory` (FK: inventory_id, optional)

**RLS:** User hanya bisa akses items miliknya

**Indexes:**
- PRIMARY KEY: `id`
- INDEX: `transaction_id`
- INDEX: `inventory_id`
- INDEX: `user_id`

**Constraints:**
- FK: `transaction_id` REFERENCES `transactions(id)` ON DELETE CASCADE
- FK: `inventory_id` REFERENCES `inventory(id)` ON DELETE SET NULL
- CHECK: `qty > 0`
- CHECK: `unit_price >= 0`
- CHECK: `subtotal >= 0`

---

### 5. `transaction_payments`
**Purpose:** Pembayaran per transaksi (normalized dari `transactions.pembayaran`)

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | UUID | NO | gen_random_uuid() | Primary key |
| transaction_id | TEXT | NO | - | FK ke transactions.id |
| payment_method | enum_metode_bayar | NO | - | Metode: Tunai/Transfer/QRIS |
| amount | INTEGER | NO | - | Jumlah pembayaran |
| payment_date | TIMESTAMPTZ | YES | NOW() | Tanggal bayar |
| notes | TEXT | YES | - | Catatan pembayaran |
| user_id | UUID | NO | - | Owner (tenant key) |
| created_at | TIMESTAMPTZ | YES | NOW() | Timestamp dibuat |

**Relationships:**
- Belongs to: `transactions` (FK: transaction_id)

**RLS:** User hanya bisa akses payments miliknya

**Indexes:**
- PRIMARY KEY: `id`
- INDEX: `transaction_id`
- INDEX: `user_id`

**Constraints:**
- FK: `transaction_id` REFERENCES `transactions(id)` ON DELETE CASCADE
- CHECK: `amount > 0`

---

### 6. `members`
**Purpose:** Data pelanggan member

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | TEXT | NO | - | Primary key (format: MBR-XXX) |
| nama | TEXT | NO | - | Nama lengkap |
| hp | TEXT | YES | - | Nomor HP |
| alamat | TEXT | YES | - | Alamat |
| member_type_id | TEXT | YES | - | FK ke member_types.id |
| diskon | INTEGER | YES | 0 | Diskon member (%) |
| status | enum_status_aktif | YES | 'aktif' | Status: aktif/nonaktif |
| user_id | UUID | NO | - | Owner (tenant key) |
| created_at | TIMESTAMPTZ | YES | NOW() | Timestamp dibuat |

**Relationships:**
- Belongs to: `member_types` (FK: member_type_id)
- Has many: `transactions` (via member_id)

**RLS:** User hanya bisa akses members miliknya

**Indexes:**
- PRIMARY KEY: `id`
- INDEX: `user_id`
- INDEX: `member_type_id`

**Constraints:**
- FK: `member_type_id` REFERENCES `member_types(id)` ON DELETE SET NULL

---

### 7. `member_types`
**Purpose:** Tier membership (Gold, Silver, Bronze, dll)

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | TEXT | NO | - | Primary key (format: MT-XXX) |
| nama | TEXT | NO | - | Nama tier (Gold, Silver, dll) |
| diskon | INTEGER | YES | 0 | Diskon default tier (%) |
| status | enum_status_aktif | YES | 'aktif' | Status: aktif/nonaktif |
| user_id | UUID | NO | - | Owner (tenant key) |
| created_at | TIMESTAMPTZ | YES | NOW() | Timestamp dibuat |

**Relationships:**
- Has many: `members`

**RLS:** User hanya bisa akses member_types miliknya

**Indexes:**
- PRIMARY KEY: `id`
- INDEX: `user_id`

---

### 8. `activity_logs`
**Purpose:** Log aktivitas user (CRUD operations)

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | BIGSERIAL | NO | - | Primary key |
| user_id | UUID | NO | - | User yang melakukan aksi |
| action | TEXT | NO | - | Jenis aksi (create/update/delete) |
| entity_type | TEXT | NO | - | Tipe entitas (inventory/transaction/member) |
| entity_id | TEXT | YES | - | ID entitas terkait |
| details | JSONB | YES | - | Detail perubahan |
| created_at | TIMESTAMPTZ | YES | NOW() | Timestamp aksi |

**RLS:** User hanya bisa akses logs miliknya

**Indexes:**
- PRIMARY KEY: `id`
- INDEX: `user_id`
- INDEX: `created_at DESC`

---

### 9. `profiles`
**Purpose:** User profile data

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| user_id | UUID | NO | - | Primary key, FK ke auth.users |
| nama | TEXT | YES | - | Nama lengkap user |
| role | TEXT | YES | 'owner' | Role: owner/supervisor/cs/gudang |
| is_active | BOOLEAN | YES | true | Status aktif |
| created_at | TIMESTAMPTZ | YES | NOW() | Timestamp dibuat |

**Relationships:**
- Belongs to: `auth.users` (Supabase Auth)

**RLS:** User hanya bisa akses profile sendiri

**Indexes:**
- PRIMARY KEY: `user_id`

---

### 10. `login_logs`
**Purpose:** Log login user

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | BIGSERIAL | NO | - | Primary key |
| user_id | UUID | NO | - | User yang login |
| event_type | TEXT | NO | - | Tipe event (login_sukses/login_gagal/logout) |
| ip_address | TEXT | YES | - | IP address |
| user_agent | TEXT | YES | - | Browser/device info |
| created_at | TIMESTAMPTZ | YES | NOW() | Timestamp login |

**RLS:** User hanya bisa akses logs sendiri

**Indexes:**
- PRIMARY KEY: `id`
- INDEX: `user_id`
- INDEX: `created_at DESC`

---

### 11. `admin_logs`
**Purpose:** Log aktivitas admin/superadmin

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | BIGSERIAL | NO | - | Primary key |
| admin_user_id | UUID | NO | - | Admin yang melakukan aksi |
| action | TEXT | NO | - | Jenis aksi |
| target_user_id | UUID | YES | - | Target user (jika ada) |
| details | JSONB | YES | - | Detail aksi |
| created_at | TIMESTAMPTZ | YES | NOW() | Timestamp aksi |

**RLS:** Hanya admin yang bisa akses

**Indexes:**
- PRIMARY KEY: `id`
- INDEX: `admin_user_id`
- INDEX: `created_at DESC`

---

### 12. `settings`
**Purpose:** Pengaturan sistem per user

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | TEXT | NO | - | Primary key |
| key | TEXT | NO | - | Setting key |
| value | TEXT | YES | - | Setting value |
| user_id | UUID | NO | - | Owner (tenant key) |
| created_at | TIMESTAMPTZ | YES | NOW() | Timestamp dibuat |

**RLS:** User hanya bisa akses settings miliknya

**Indexes:**
- PRIMARY KEY: `id`
- INDEX: `user_id, key`

---

### 13. `promo_codes`
**Purpose:** Kode promo untuk diskon

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | TEXT | NO | - | Primary key |
| code | TEXT | NO | - | Kode promo (unique per user) |
| discount_percent | INTEGER | YES | - | Diskon persen |
| discount_amount | INTEGER | YES | - | Diskon nominal |
| valid_from | TIMESTAMPTZ | YES | - | Tanggal mulai berlaku |
| valid_until | TIMESTAMPTZ | YES | - | Tanggal kadaluarsa |
| max_usage | INTEGER | YES | - | Maksimal penggunaan |
| current_usage | INTEGER | YES | 0 | Jumlah penggunaan saat ini |
| is_active | BOOLEAN | YES | true | Status aktif |
| user_id | UUID | NO | - | Owner (tenant key) |
| created_at | TIMESTAMPTZ | YES | NOW() | Timestamp dibuat |

**Promo auto-expire:** Migration `supabase/migrations/promo_auto_expire.sql` permits status `aktif`, `nonaktif`, `expired`. Promo expires when `now() >= berlaku_sampai` or `terpakai >= kuota` when quota is set. Persistence is request-triggered during promo listing, validation/application, and immediately after final quota use; no clock scheduler. Booking rejects invalid/expired promo; UI displays `Expired` and blocks editing.

**RLS:** User hanya bisa akses promo codes miliknya

**Indexes:**
- PRIMARY KEY: `id`
- INDEX: `user_id, code` (UNIQUE)

---

### 14. `versi_akun`
**Purpose:** Tracking versi akun user

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| user_id | UUID | NO | - | Primary key, FK ke auth.users |
| versi | TEXT | YES | - | Versi akun |
| updated_at | TIMESTAMPTZ | YES | NOW() | Timestamp update |

**RLS:** User hanya bisa akses versi sendiri

**Indexes:**
- PRIMARY KEY: `user_id`

---

## SaaS Platform Tables

### 15. `sewara_plans`
**Purpose:** Paket langganan SaaS (Starter, Pro, Business)

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | UUID | NO | gen_random_uuid() | Primary key |
| name | TEXT | NO | - | Nama paket (Starter, Pro, Business) |
| slug | TEXT | NO | - | Slug unik (starter, pro, business) |
| description | TEXT | YES | - | Deskripsi paket |
| price_monthly | INTEGER | NO | - | Harga per bulan (Rupiah) |
| price_yearly | INTEGER | YES | - | Harga per tahun (Rupiah) |
| trial_days | INTEGER | YES | 0 | Jumlah hari trial gratis |
| is_active | BOOLEAN | YES | true | Status aktif |
| display_order | INTEGER | YES | 0 | Urutan display |
| created_at | TIMESTAMPTZ | YES | NOW() | Timestamp dibuat |
| updated_at | TIMESTAMPTZ | YES | NOW() | Timestamp update |

**Relationships:**
- Has many: `sewara_plan_features`
- Has many: `sewara_subscriptions`

**RLS:** Public read (semua user bisa lihat plans)

**Indexes:**
- PRIMARY KEY: `id`
- UNIQUE: `slug`
- INDEX: `is_active`

**Seed Data:**
- Starter: Rp 99.000/bulan, 14 hari trial
- Pro: Rp 199.000/bulan, 14 hari trial
- Business: Rp 399.000/bulan, 14 hari trial

---

### 16. `sewara_plan_features`
**Purpose:** Fitur dan limit per paket

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | UUID | NO | gen_random_uuid() | Primary key |
| plan_id | UUID | NO | - | FK ke sewara_plans.id |
| feature_code | TEXT | NO | - | Kode fitur (max_transactions_monthly, dll) |
| feature_name | TEXT | NO | - | Nama display untuk UI |
| limit_value | INTEGER | YES | - | Nilai limit (NULL = unlimited) |
| is_enabled | BOOLEAN | YES | true | Status aktif |
| created_at | TIMESTAMPTZ | YES | NOW() | Timestamp dibuat |

**Relationships:**
- Belongs to: `sewara_plans` (FK: plan_id)

**RLS:** Public read

**Indexes:**
- PRIMARY KEY: `id`
- UNIQUE: `(plan_id, feature_code)`
- INDEX: `plan_id`
- INDEX: `feature_code`

**Constraints:**
- FK: `plan_id` REFERENCES `sewara_plans(id)` ON DELETE CASCADE

**Feature Codes:**
- `max_transactions_monthly` — Limit transaksi per bulan
- `max_inventory_items` — Limit jumlah item inventori
- `max_members` — Limit jumlah member
- `max_staff` — Limit jumlah staff
- `max_storage_mb` — Limit storage (MB)

---

### 17. `sewara_subscriptions`
**Purpose:** Langganan aktif per owner (1 owner = 1 subscription)

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | UUID | NO | gen_random_uuid() | Primary key |
| owner_id | UUID | NO | - | FK ke auth.users.id |
| plan_id | UUID | NO | - | FK ke sewara_plans.id |
| status | enum_subscription_status | NO | 'trialing' | Status subscription |
| trial_ends_at | TIMESTAMPTZ | YES | - | Akhir masa trial |
| current_period_start | TIMESTAMPTZ | NO | - | Awal periode langganan |
| current_period_end | TIMESTAMPTZ | NO | - | Akhir periode langganan |
| cancel_at | TIMESTAMPTZ | YES | - | Jadwal cancel |
| cancelled_at | TIMESTAMPTZ | YES | - | Waktu dibatalkan |
| ended_at | TIMESTAMPTZ | YES | - | Waktu berakhir |
| metadata | JSONB | YES | '{}' | Data tambahan fleksibel |
| created_at | TIMESTAMPTZ | YES | NOW() | Timestamp dibuat |
| updated_at | TIMESTAMPTZ | YES | NOW() | Timestamp update |

**Relationships:**
- Belongs to: `auth.users` (FK: owner_id)
- Belongs to: `sewara_plans` (FK: plan_id)
- Has many: `sewara_subscription_payments`
- Has many: `sewara_subscription_events`

**RLS:** Owner hanya bisa akses subscription sendiri

**Indexes:**
- PRIMARY KEY: `id`
- UNIQUE: `owner_id`
- INDEX: `plan_id`
- INDEX: `status`
- INDEX: `current_period_end`

**Constraints:**
- FK: `owner_id` REFERENCES `auth.users(id)` ON DELETE CASCADE
- FK: `plan_id` REFERENCES `sewara_plans(id)`

---

### 18. `sewara_subscription_payments`
**Purpose:** Riwayat pembayaran langganan

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | UUID | NO | gen_random_uuid() | Primary key |
| subscription_id | UUID | NO | - | FK ke sewara_subscriptions.id |
| amount | INTEGER | NO | - | Jumlah pembayaran (Rupiah) |
| currency | TEXT | YES | 'IDR' | Mata uang |
| status | TEXT | NO | - | Status: pending/succeeded/failed/refunded |
| payment_provider | TEXT | YES | - | Provider: midtrans/xendit/stripe |
| external_payment_id | TEXT | YES | - | ID dari payment gateway |
| payment_method | TEXT | YES | - | Metode: credit_card/bank_transfer/qris |
| paid_at | TIMESTAMPTZ | YES | - | Waktu dibayar |
| failed_at | TIMESTAMPTZ | YES | - | Waktu gagal |
| refunded_at | TIMESTAMPTZ | YES | - | Waktu refund |
| metadata | JSONB | YES | '{}' | Data tambahan |
| created_at | TIMESTAMPTZ | YES | NOW() | Timestamp dibuat |

**Relationships:**
- Belongs to: `sewara_subscriptions` (FK: subscription_id)

**RLS:** Owner hanya bisa akses payments sendiri

**Indexes:**
- PRIMARY KEY: `id`
- INDEX: `subscription_id`
- INDEX: `status`
- INDEX: `external_payment_id`
- INDEX: `created_at DESC`

**Constraints:**
- FK: `subscription_id` REFERENCES `sewara_subscriptions(id)` ON DELETE CASCADE

---

### 19. `sewara_subscription_events`
**Purpose:** Log webhook event dari payment gateway

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | UUID | NO | gen_random_uuid() | Primary key |
| subscription_id | UUID | YES | - | FK ke sewara_subscriptions.id |
| event_type | enum_subscription_event | NO | - | Tipe event |
| event_source | TEXT | YES | - | Source: midtrans/xendit/stripe/internal |
| payload | JSONB | NO | - | Raw webhook payload |
| processed | BOOLEAN | YES | false | Sudah diproses? |
| processed_at | TIMESTAMPTZ | YES | - | Waktu diproses |
| error_message | TEXT | YES | - | Error message (jika gagal) |
| created_at | TIMESTAMPTZ | YES | NOW() | Timestamp dibuat |

**Relationships:**
- Belongs to: `sewara_subscriptions` (FK: subscription_id, optional)

**RLS:** Owner hanya bisa akses events sendiri

**Indexes:**
- PRIMARY KEY: `id`
- INDEX: `subscription_id`
- INDEX: `event_type`
- INDEX: `processed`
- INDEX: `created_at DESC`

**Constraints:**
- FK: `subscription_id` REFERENCES `sewara_subscriptions(id)` ON DELETE SET NULL

---

### 20. `sewara_usage_counters`
**Purpose:** Tracking pemakaian bulanan per owner (untuk enforce limit)

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | UUID | NO | gen_random_uuid() | Primary key |
| owner_id | UUID | NO | - | FK ke auth.users.id |
| feature_code | TEXT | NO | - | Kode fitur (transactions, inventory, dll) |
| period_start | DATE | NO | - | Awal periode (2026-08-01) |
| period_end | DATE | NO | - | Akhir periode (2026-08-31) |
| current_value | INTEGER | YES | 0 | Nilai usage saat ini |
| limit_value | INTEGER | YES | - | Limit dari plan (NULL = unlimited) |
| created_at | TIMESTAMPTZ | YES | NOW() | Timestamp dibuat |
| updated_at | TIMESTAMPTZ | YES | NOW() | Timestamp update |

**Relationships:**
- Belongs to: `auth.users` (FK: owner_id)

**RLS:** Owner hanya bisa akses usage counters sendiri

**Indexes:**
- PRIMARY KEY: `id`
- UNIQUE: `(owner_id, feature_code, period_start)`
- INDEX: `owner_id`
- INDEX: `feature_code`
- INDEX: `period_start, period_end`

**Constraints:**
- FK: `owner_id` REFERENCES `auth.users(id)` ON DELETE CASCADE

---

### 21. `sewara_feature_overrides`
**Purpose:** Override limit khusus per owner (bonus, promo, custom deal)

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | UUID | NO | gen_random_uuid() | Primary key |
| owner_id | UUID | NO | - | FK ke auth.users.id |
| feature_code | TEXT | NO | - | Fitur yang di-override |
| override_value | INTEGER | YES | - | Nilai override (NULL = unlimited) |
| reason | TEXT | YES | - | Alasan override (bonus promo/custom deal) |
| valid_from | TIMESTAMPTZ | YES | NOW() | Mulai berlaku |
| valid_until | TIMESTAMPTZ | YES | - | Sampai tanggal (NULL = permanent) |
| created_by | UUID | YES | - | Admin yang buat override |
| created_at | TIMESTAMPTZ | YES | NOW() | Timestamp dibuat |

**Relationships:**
- Belongs to: `auth.users` (FK: owner_id)

**RLS:** Owner hanya bisa lihat override sendiri

**Indexes:**
- PRIMARY KEY: `id`
- UNIQUE: `(owner_id, feature_code)`
- INDEX: `owner_id`
- INDEX: `valid_from, valid_until`

**Constraints:**
- FK: `owner_id` REFERENCES `auth.users(id)` ON DELETE CASCADE

---

### 22. `sewara_payment_methods`
**Purpose:** Metode pembayaran tersimpan per owner (untuk auto-renewal)

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | UUID | NO | gen_random_uuid() | Primary key |
| owner_id | UUID | NO | - | FK ke auth.users.id |
| payment_provider | TEXT | NO | - | Provider: midtrans/xendit/stripe |
| external_method_id | TEXT | NO | - | Token/ID dari payment provider |
| type | TEXT | NO | - | Type: credit_card/bank_account/ewallet |
| last4 | TEXT | YES | - | 4 digit terakhir kartu/rekening |
| brand | TEXT | YES | - | Brand: visa/mastercard/bca/dll |
| is_default | BOOLEAN | YES | false | Metode default? |
| expires_at | TIMESTAMPTZ | YES | - | Tanggal kadaluarsa |
| created_at | TIMESTAMPTZ | YES | NOW() | Timestamp dibuat |

**Relationships:**
- Belongs to: `auth.users` (FK: owner_id)

**RLS:** Owner hanya bisa manage payment methods sendiri

**Indexes:**
- PRIMARY KEY: `id`
- INDEX: `owner_id`
- INDEX: `is_default` (WHERE is_default = true)

**Constraints:**
- FK: `owner_id` REFERENCES `auth.users(id)` ON DELETE CASCADE

**Security Note:** Jangan simpan data kartu mentah, hanya token dari payment provider.

---

### 23. `permissions`
**Purpose:** Master list permission yang tersedia

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | UUID | NO | gen_random_uuid() | Primary key |
| code | TEXT | NO | - | Kode unik (inventory.view, transaction.create) |
| name | TEXT | NO | - | Nama display |
| description | TEXT | YES | - | Deskripsi permission |
| category | enum_permission_category | NO | - | Kategori: inventory/transaction/member/dll |
| is_active | BOOLEAN | YES | true | Status aktif |
| created_at | TIMESTAMPTZ | YES | NOW() | Timestamp dibuat |

**Relationships:**
- Has many: `role_permissions`
- Has many: `staff_permissions`

**RLS:** Public read (semua user bisa lihat list permissions)

**Indexes:**
- PRIMARY KEY: `id`
- UNIQUE: `code`
- INDEX: `category`
- INDEX: `is_active`

**Seed Data:** 20 permissions grouped by 6 categories
- inventory: view, create, edit, delete
- transaction: view, create, edit, delete
- member: view, create, edit, delete
- report: view, export
- setting: view, edit
- staff: view, create, edit, delete

---

### 24. `role_permissions`
**Purpose:** Default permission template per role

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | UUID | NO | gen_random_uuid() | Primary key |
| role | TEXT | NO | - | Role: owner/supervisor/cs/gudang |
| permission_id | UUID | NO | - | FK ke permissions.id |
| is_default | BOOLEAN | YES | true | Permission default untuk role ini? |
| created_at | TIMESTAMPTZ | YES | NOW() | Timestamp dibuat |

**Relationships:**
- Belongs to: `permissions` (FK: permission_id)

**RLS:** Public read

**Indexes:**
- PRIMARY KEY: `id`
- UNIQUE: `(role, permission_id)`
- INDEX: `role`
- INDEX: `permission_id`

**Constraints:**
- FK: `permission_id` REFERENCES `permissions(id)` ON DELETE CASCADE

**Seed Data:** 50 role permissions
- owner: 20 (semua)
- supervisor: 17 (semua kecuali staff.create, staff.delete, setting.edit)
- cs: 8 (transaction.*, member.*)
- gudang: 5 (inventory.*, transaction.view)

---

### 25. `staff_permissions`
**Purpose:** Custom permission override per staff per owner

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | UUID | NO | gen_random_uuid() | Primary key |
| staff_user_id | UUID | NO | - | FK ke auth.users.id (staff) |
| owner_id | UUID | NO | - | FK ke auth.users.id (owner/workspace) |
| permission_id | UUID | NO | - | FK ke permissions.id |
| is_granted | BOOLEAN | NO | - | true=grant, false=revoke |
| overridden_at | TIMESTAMPTZ | YES | NOW() | Waktu override |
| overridden_by | UUID | YES | - | Admin yang override |

**Relationships:**
- Belongs to: `auth.users` (FK: staff_user_id, owner_id)
- Belongs to: `permissions` (FK: permission_id)

**RLS:** Owner dan staff terkait bisa akses

**Indexes:**
- PRIMARY KEY: `id`
- UNIQUE: `(staff_user_id, owner_id, permission_id)`
- INDEX: `staff_user_id, owner_id`
- INDEX: `permission_id`

**Constraints:**
- FK: `staff_user_id` REFERENCES `auth.users(id)` ON DELETE CASCADE
- FK: `owner_id` REFERENCES `auth.users(id)` ON DELETE CASCADE
- FK: `permission_id` REFERENCES `permissions(id)` ON DELETE CASCADE

---

## Utility Tables

### 26. `app_config`
**Purpose:** Konfigurasi global aplikasi (tidak per user)

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| key | TEXT | NO | - | Primary key, config key |
| value | TEXT | YES | - | Config value |
| description | TEXT | YES | - | Deskripsi config |
| updated_at | TIMESTAMPTZ | YES | NOW() | Timestamp update |

**RLS:** Read-only untuk semua user

**Indexes:**
- PRIMARY KEY: `key`

---

### 27. `log_count`
**Purpose:** Helper counter untuk log tables

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| user_id | UUID | NO | - | Primary key |
| count | INTEGER | YES | 0 | Counter |

**Indexes:**
- PRIMARY KEY: `user_id`

---

### 28. `mt_count`
**Purpose:** Helper counter untuk member_types

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| user_id | UUID | NO | - | Primary key |
| count | INTEGER | YES | 0 | Counter |

**Indexes:**
- PRIMARY KEY: `user_id`

---

## Enum Types

### 1. `enum_status_transaksi`
Status transaksi sewa

**Values:**
- `Booking` — Transaksi booking (belum ambil)
- `Disewa` — Barang sedang disewa
- `Selesai` — Transaksi selesai (barang dikembalikan)
- `Belum Selesai` — Belum selesai (ada keterlambatan/masalah)
- `Dibatalkan` — Transaksi dibatalkan

**Used in:** `transactions.status`

---

### 2. `enum_jenis_inventory`
Jenis barang inventory

**Values:**
- `satuan` — Barang satuan
- `bundling` — Paket bundling (gabungan beberapa barang)

**Used in:** `inventory.jenis`

---

### 3. `enum_metode_bayar`
Metode pembayaran

**Values:**
- `Tunai` — Pembayaran tunai
- `Transfer` — Transfer bank
- `QRIS` — QRIS/e-wallet

**Used in:** `transaction_payments.payment_method`

---

### 4. `enum_status_aktif`
Status aktif/nonaktif

**Values:**
- `aktif` — Aktif
- `nonaktif` — Nonaktif

**Used in:** `members.status`, `member_types.status`

---

### 5. `enum_kondisi_inventory`
Kondisi barang inventory

**Values:**
- `baik` — Kondisi baik
- `rusak` — Rusak
- `hilang` — Hilang

**Used in:** `inventory.kondisi`

---

### 6. `enum_status_unit`
Status unit inventory (NOT USED YET)

**Values:**
- `available` — Tersedia
- `rented` — Sedang disewa
- `damaged` — Rusak
- `maintenance` — Maintenance

**Note:** Belum diterapkan ke `inventory_units.status` (masih TEXT)

---

### 7. `enum_subscription_status`
Status langganan SaaS

**Values:**
- `trialing` — Masa trial gratis
- `active` — Langganan aktif
- `past_due` — Pembayaran telat, masih bisa akses
- `grace_period` — Grace period sebelum suspend
- `cancelled` — Dibatalkan oleh user
- `expired` — Masa berlangganan habis
- `suspended` — Ditangguhkan (admin action)

**Used in:** `sewara_subscriptions.status`

---

### 8. `enum_subscription_event`
Tipe event subscription webhook

**Values:**
- `subscription.created`
- `subscription.updated`
- `subscription.cancelled`
- `subscription.expired`
- `payment.succeeded`
- `payment.failed`
- `payment.refunded`
- `plan.upgraded`
- `plan.downgraded`

**Used in:** `sewara_subscription_events.event_type`

---

### 9. `enum_permission_category`
Kategori permission

**Values:**
- `inventory` — Permission terkait inventory
- `transaction` — Permission terkait transaksi
- `member` — Permission terkait member
- `report` — Permission terkait laporan
- `setting` — Permission terkait pengaturan
- `staff` — Permission terkait staff management

**Used in:** `permissions.category`

---

## Foreign Key Relationships

### Business Rental Domain

```
inventory (1) ──< inventory_units (many)
inventory (1) ──< transaction_items (many)

member_types (1) ──< members (many)
members (1) ──< transactions (many)

transactions (1) ──< transaction_items (many)
transactions (1) ──< transaction_payments (many)

auth.users (1) ──< profiles (1)
auth.users (1) ──< login_logs (many)
auth.users (1) ──< activity_logs (many)
auth.users (1) ──< admin_logs (many)
```

### SaaS Platform Domain

```
sewara_plans (1) ──< sewara_plan_features (many)
sewara_plans (1) ──< sewara_subscriptions (many)

auth.users (1) ──< sewara_subscriptions (1)
sewara_subscriptions (1) ──< sewara_subscription_payments (many)
sewara_subscriptions (1) ──< sewara_subscription_events (many)

auth.users (1) ──< sewara_usage_counters (many)
auth.users (1) ──< sewara_feature_overrides (many)
auth.users (1) ──< sewara_payment_methods (many)

permissions (1) ──< role_permissions (many)
permissions (1) ──< staff_permissions (many)

auth.users (staff) ──< staff_permissions (many)
auth.users (owner) ──< staff_permissions (many)
```

---

## RLS Policies

### Tenant Isolation Strategy

Semua tabel bisnis menggunakan RLS dengan pattern `user_id = auth.uid()` untuk isolasi data per tenant (owner).

**Total RLS Policies:** ~30 policies

### Business Rental Tables (18 policies)
- `inventory`: 4 policies (SELECT, INSERT, UPDATE, DELETE)
- `inventory_units`: 4 policies
- `transactions`: 4 policies
- `transaction_items`: 4 policies
- `transaction_payments`: 4 policies
- `members`: 4 policies
- `member_types`: 4 policies
- ... (dll untuk tables lain)

### SaaS Platform Tables (18 policies)
- `sewara_plans`: 1 policy (public SELECT only)
- `sewara_plan_features`: 1 policy (public SELECT only)
- `sewara_subscriptions`: 4 policies (owner only)
- `sewara_subscription_payments`: 1 policy (owner SELECT only)
- `sewara_subscription_events`: 1 policy (owner SELECT only)
- `sewara_usage_counters`: 4 policies (owner only)
- `sewara_feature_overrides`: 1 policy (owner SELECT only)
- `sewara_payment_methods`: 4 policies (owner only)
- `permissions`: 1 policy (public SELECT only)
- `role_permissions`: 1 policy (public SELECT only)
- `staff_permissions`: 2 policies (owner ALL, staff SELECT)

### Policy Pattern Examples

**Standard tenant isolation:**
```sql
CREATE POLICY "Users can only access their own data" ON table_name
  FOR ALL USING (user_id = auth.uid());
```

**Public read:**
```sql
CREATE POLICY "Public read access" ON table_name
  FOR SELECT USING (true);
```

**Owner + staff access:**
```sql
CREATE POLICY "Owner can manage all" ON staff_permissions
  FOR ALL USING (owner_id = auth.uid());

CREATE POLICY "Staff can view their own" ON staff_permissions
  FOR SELECT USING (staff_user_id = auth.uid());
```

---

## Indexes

### Primary Keys
Semua tabel memiliki PRIMARY KEY index (automatic).

### Performance Indexes

**Foreign Key Indexes:**
- Semua FK columns memiliki index untuk performance JOIN

**Timestamp Indexes:**
- `created_at DESC` untuk sorting recent records
- `updated_at DESC` untuk tracking changes

**Status/Category Indexes:**
- `transactions.status` — filter by status
- `inventory.jenis` — filter by type
- `sewara_subscriptions.status` — filter active subscriptions

**Partial Indexes:**
- `sewara_plans.is_active` WHERE is_active = true
- `sewara_payment_methods.is_default` WHERE is_default = true

**Composite Indexes:**
- `(user_id, key)` pada settings
- `(user_id, code)` pada promo_codes
- `(owner_id, feature_code, period_start)` pada sewara_usage_counters

---

## Schema Evolution History

**Phase 1 (27 Aug 2026):** Konsolidasi transactions columns ke snake_case  
**Phase 2 (27 Aug 2026):** Rename tables (member_templates → member_types, logs → activity_logs)  
**Phase 3 (28 Aug 2026):** Drop legacy camelCase columns  
**Phase 4-6 (28 Aug 2026):** JSONB normalization (transaction_items, transaction_payments, inventory_units)  
**Phase 7 (28 Aug 2026):** Foreign keys & check constraints  
**Phase 8 (28 Aug 2026):** Enum types & defaults  
**Phase 9 (30 Aug 2026):** SaaS infrastructure (11 tables) + Permission system  

**Current Version:** Phase 9 (30 August 2026)  
**Total Tables:** 28  
**Total Enum Types:** 9  
**Total RLS Policies:** ~30

---

## Notes

1. **JSONB Fallback:** Kolom JSONB legacy (`transactions.items`, `transactions.pembayaran`, `inventory.sns`) masih dipertahankan dengan dual-write untuk observasi. Belum di-drop sampai stabil.

2. **Enum Conversion Pending:** `inventory_units.status` masih TEXT (bukan enum) karena schema conflict. Akan dievaluasi terpisah.

3. **Multi-Tenant Strategy:** Saat ini isolasi menggunakan `user_id`. Multi-cabang (branch_id) dijadwalkan sebagai future update.

4. **SaaS Restrictions:** Infrastruktur SaaS sudah siap, tapi usage limits belum di-enforce (backward compatible). Akan diaktifkan bertahap saat rilis.

5. **Payment Gateway:** Webhook skeleton siap, tapi belum connect ke provider (Midtrans/Xendit/Stripe). Integrasi dijadwalkan setelah rilis.

---

**Last Updated:** 30 August 2026  
**Maintained by:** Development Team  
**For questions:** Refer to `docs/database/MIGRATIONS.md` or `PHASE9_PLAN.md`
