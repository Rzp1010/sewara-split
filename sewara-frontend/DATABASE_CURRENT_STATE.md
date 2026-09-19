# Database Schema Snapshot - POST PHASE 1
**Date:** 27 Agustus 2026 13:28 UTC  
**Project:** Sewara (obhvrzholszhjnpvmnna)  
**Status:** After Phase 1 consolidation

---

## 1. `transactions` (53 rows)

### Kolom Aktif (Snake_case - USE THESE)

| Column | Type | Nullable | Default | Note |
|---|---|---|---|---|
| `id` | bigint | NO | 0 | PK |
| `user_id` | uuid | YES | null | Tenant/owner |
| `id_transaksi` | text | YES | null | ID transaksi lama |
| `no_invoice` | text | YES | null | ✅ **NEW** - Nomor invoice canonical |
| `penyewa` | text | YES | null | Nama penyewa |
| `hp_penyewa` | text | YES | null | HP penyewa |
| `alamat_penyewa` | text | YES | null | Alamat penyewa |
| `jaminan_sewa` | text | YES | null | Jaminan |
| `waktu_ambil_rencana` | timestamptz | YES | null | Rencana ambil |
| `waktu_kembali_rencana` | timestamptz | YES | null | Rencana kembali |
| `waktu_ambil_aktual` | timestamptz | YES | null | Aktual ambil |
| `waktu_kembali_aktual` | timestamptz | YES | null | Aktual kembali |
| `status` | text | YES | 'Booking' | Status transaksi |
| `items` | jsonb | YES | '[]' | Daftar barang (belum dinormalisasi) |
| `durasi_teks` | text | YES | null | Durasi display |
| `biaya` | numeric | YES | 0 | Biaya dasar |
| `denda` | numeric | YES | 0 | Denda |
| `total_akhir` | numeric | YES | 0 | ✅ **NEW** - Total akhir |
| `pembayaran` | jsonb | YES | {...} | Riwayat bayar (belum dinormalisasi) |
| `riwayatDilayani` | jsonb | YES | '[]' | Riwayat pelayan |
| `dilayani_oleh` | text | YES | null | Nama pelayan |
| `diskon` | jsonb | YES | null | Diskon detail |
| `member_id` | bigint | YES | null | ✅ **NEW** - FK ke members |
| `created_by` | uuid | YES | null | ✅ **NEW** - Pembuat |
| `updated_by` | uuid | YES | null | ✅ **NEW** - Editor |
| `created_at` | timestamptz | YES | now() | Waktu dibuat |
| `updated_at` | timestamptz | YES | now() | Waktu diubah |

### Kolom Legacy (CamelCase - DEPRECATED, DO NOT USE)

| Column | Type | Note |
|---|---|---|
| `noInvoice` | text | ❌ Legacy, use `no_invoice` |
| `hpPenyewa` | text | ❌ Legacy, use `hp_penyewa` |
| `alamatPenyewa` | text | ❌ Legacy, use `alamat_penyewa` |
| `jaminanSewa` | text | ❌ Legacy, use `jaminan_sewa` |
| `waktuAmbilRencana` | text | ❌ Legacy (text!), use `waktu_ambil_rencana` |
| `waktuKembaliRencana` | text | ❌ Legacy (text!), use `waktu_kembali_rencana` |
| `waktuAmbilAktual` | text | ❌ Legacy (text!), use `waktu_ambil_aktual` |
| `waktuKembaliAktual` | text | ❌ Legacy (text!), use `waktu_kembali_aktual` |
| `durasiTeks` | text | ❌ Legacy, use `durasi_teks` |
| `biayaDasar` | numeric | ❌ Legacy, use `biaya` |
| `dendaTambahan` | numeric | ❌ Legacy, use `denda` |
| `totalAkhir` | numeric | ❌ Legacy, use `total_akhir` |

### Indexes
- `transactions_pkey` ON (id)
- `idx_transactions_no_invoice` ON (no_invoice) WHERE no_invoice IS NOT NULL ✅ NEW
- `idx_transactions_member_id` ON (member_id) WHERE member_id IS NOT NULL ✅ NEW
- `idx_transactions_user_status` ON (user_id, status) ✅ NEW

---

## 2. `inventory` (61 rows)

| Column | Type | Nullable | Default |
|---|---|---|---|
| `id` | bigint | NO | 0 |
| `user_id` | uuid | YES | null |
| `nama` | text | NO | null |
| `jenis` | text | NO | null |
| `h24` | numeric | YES | 0 |
| `h12` | numeric | YES | 0 |
| `h6` | numeric | YES | 0 |
| `tarif` | text | YES | null |
| `denda` | text | YES | null |
| `tipeSewa` | text | YES | 'fleksibel' |
| `kondisi` | text | YES | 'Baik' |
| `keterangan` | text | YES | '-' |
| `tag` | text | YES | null |
| `sns` | jsonb | YES | '[]' |
| `komponen` | jsonb | YES | '[]' |
| `created_at` | timestamptz | YES | now() |
| `updated_at` | timestamptz | YES | now() |

**Constraint:** `inventory_jenis_check` (jenis IN ('satuan', 'bundling'))

---

## 3. `members` (4 rows)

| Column | Type | Nullable | Default |
|---|---|---|---|
| `id` | bigint | NO | null |
| `user_id` | uuid | NO | null |
| `nama` | text | NO | null |
| `hp` | text | NO | '' |
| `email` | text | YES | null |
| `alamat` | text | NO | '' |
| `diskon_persen` | numeric | NO | 0 |
| `status` | text | NO | 'aktif' |
| `tipe_id` | bigint | YES | null |
| `foto_jaminan` | jsonb | YES | '{}' |
| `catatan` | text | YES | null |
| `created_at` | timestamptz | NO | now() |

**Constraint:**
- `members_diskon_persen_check` (0-100)
- `members_status_check` ('aktif', ...)
- `foto_jaminan_array_check`

---

## 4. `member_templates` (2 rows)

| Column | Type | Nullable | Default |
|---|---|---|---|
| `id` | bigint | NO | null |
| `user_id` | uuid | NO | null |
| `nama` | text | NO | null |
| `diskon_persen` | numeric | NO | 0 |
| `status` | text | NO | 'aktif' |
| `created_at` | timestamptz | NO | now() |

**Constraint:**
- `member_templates_diskon_persen_check` (0-100)
- `member_templates_status_check`

---

## 5. `promo_codes` (1 row)

| Column | Type | Nullable | Default |
|---|---|---|---|
| `id` | bigint | NO | null |
| `user_id` | uuid | NO | null |
| `kode` | text | NO | null |
| `diskon_persen` | numeric | NO | 0 |
| `berlaku_dari` | timestamptz | YES | null |
| `berlaku_sampai` | timestamptz | YES | null |
| `kuota` | int4 | YES | null |
| `terpakai` | int4 | NO | 0 |
| `status` | text | NO | 'aktif' |
| `created_at` | timestamptz | NO | now() |

**Constraint:**
- `promo_codes_user_kode` UNIQUE (user_id, kode)
- `promo_codes_diskon_persen_check` (0-100)
- `promo_codes_status_check`

---

## 6. `logs` (140 rows)

| Column | Type | Nullable | Default |
|---|---|---|---|
| `id` | bigint | NO | 0 |
| `user_id` | uuid | YES | null |
| `time` | text | YES | null |
| `waktu` | text | YES | null |
| `aksi` | text | YES | null |
| `aktivitas` | text | YES | null |
| `sn` | text | YES | null |
| `nama_barang` | text | YES | null |
| `id_barang` | text | YES | null |
| `detail` | text | YES | null |
| `catatan` | text | YES | null |
| `pelayan` | text | YES | null |
| `trx_info` | text | YES | null |
| `created_at` | timestamptz | YES | now() |

⚠️ **Tabel ini belum dirapikan** — banyak kolom duplikat (`time`/`waktu`, `aksi`/`aktivitas`)

---

## 7. `settings` (71 rows)

| Column | Type | Nullable | Default |
|---|---|---|---|
| `user_id` | uuid | NO | auth.uid() |
| `key` | text | NO | null |
| `value` | text | YES | null |
| `updated_at` | timestamptz | YES | now() |

**PK:** (user_id, key)

---

## 8. `profiles` (10 rows)

| Column | Type | Nullable | Default |
|---|---|---|---|
| `user_id` | uuid | NO | null |
| `email` | text | NO | null |
| `username` | text | YES | null |
| `role` | text | NO | 'cs' |
| `nama_lengkap` | text | NO | '' |
| `nama_invoice` | text | YES | null |
| `owner_id` | uuid | YES | null |
| `is_active` | boolean | NO | true |
| `status` | text | YES | 'aktif' |
| `subscribed_until` | timestamptz | YES | null |
| `failed_login` | int4 | NO | 0 |
| `last_failed_at` | timestamptz | YES | null |
| `cooldown_until` | timestamptz | YES | null |
| `locked_until` | timestamptz | YES | null |
| `created_at` | timestamptz | NO | now() |
| `updated_at` | timestamptz | NO | now() |

**Constraint:**
- `profiles_email_key` UNIQUE (email)
- `profiles_role_check`
- `profiles_status_check`

---

## 9. `login_logs` (373 rows)

| Column | Type | Nullable | Default |
|---|---|---|---|
| `id` | bigint | NO | null |
| `email` | text | NO | null |
| `owner_id` | uuid | YES | null |
| `event` | text | NO | null |
| `detail` | text | YES | null |
| `ip` | text | YES | null |
| `user_agent` | text | YES | null |
| `created_at` | timestamptz | NO | now() |

**Constraint:** `login_logs_event_check` (login_sukses, login_gagal, logout)

---

## 10. `admin_logs` (16 rows)

| Column | Type | Nullable | Default |
|---|---|---|---|
| `id` | bigint | NO | null |
| `actor_email` | text | NO | null |
| `aksi` | text | NO | null |
| `target_email` | text | YES | null |
| `detail` | text | YES | '' |
| `created_at` | timestamptz | NO | now() |

---

## 11. `app_config` (1 row)

| Column | Type | Nullable | Default |
|---|---|---|---|
| `key` | text | NO | null |
| `value` | text | NO | '' |
| `updated_at` | timestamptz | NO | now() |

**PK:** (key)

---

## 12. `versi_akun` (2 rows)

| Column | Type | Nullable | Default |
|---|---|---|---|
| `email` | text | NO | null |
| `mode` | text | NO | 'lama' |
| `updated_at` | timestamptz | NO | now() |

**PK:** (email)  
**Constraint:** `versi_akun_mode_check`

---

## Summary

| # | Table | Rows | Status After Phase 1 |
|---|---|---:|---|
| 1 | `transactions` | 53 | ✅ Kolom baru ditambah, legacy masih ada |
| 2 | `inventory` | 61 | ⚠️ Belum diubah |
| 3 | `members` | 4 | ⚠️ Belum diubah |
| 4 | `member_templates` | 2 | ⚠️ Belum diubah |
| 5 | `promo_codes` | 1 | ⚠️ Belum diubah |
| 6 | `logs` | 140 | ⚠️ Belum diubah, banyak duplikat |
| 7 | `settings` | 71 | ✅ OK |
| 8 | `profiles` | 10 | ⚠️ Belum diubah |
| 9 | `login_logs` | 373 | ✅ OK |
| 10 | `admin_logs` | 16 | ✅ OK |
| 11 | `app_config` | 1 | ✅ OK |
| 12 | `versi_akun` | 2 | ✅ OK |

**Total:** 12 tabel, 735 rows

---

## Masalah Umum di Fase 1 (Dev)

### 1. Query masih pakai kolom camelCase

❌ **Salah:**
```js
const { data } = await supabase
  .from('transactions')
  .select('noInvoice, hpPenyewa, totalAkhir')
```

✅ **Benar:**
```js
const { data } = await supabase
  .from('transactions')
  .select('no_invoice, hp_penyewa, total_akhir')
```

### 2. Insert/Update masih kirim camelCase

❌ **Salah:**
```js
await supabase.from('transactions').insert({
  noInvoice: 'INV-001',
  hpPenyewa: '0812345678',
  totalAkhir: 100000
})
```

✅ **Benar:**
```js
await supabase.from('transactions').insert({
  no_invoice: 'INV-001',
  hp_penyewa: '0812345678',
  total_akhir: 100000
})
```

### 3. Destructuring property salah

❌ **Salah:**
```js
const { noInvoice, hpPenyewa } = transaction
```

✅ **Benar:**
```js
const { no_invoice, hp_penyewa } = transaction
```

### 4. Filter/Where masih pakai camelCase

❌ **Salah:**
```js
.eq('noInvoice', invoice)
```

✅ **Benar:**
```js
.eq('no_invoice', invoice)
```

---

## Apa masalah yang ditemui di sesi dev?

Kirim detail error atau masalah yang dihadapi.
