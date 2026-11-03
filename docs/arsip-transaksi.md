# Arsip transaksi: kebijakan hapus inventory & arsip beku

Status: **wacana, belum dikerjakan.** Disepakati 2026-11-02. Dokumen ini mencatat
temuan, keputusan, dan urutan kerja supaya tidak perlu diulang dari nol.

Cakupan: hubungan `inventory` ↔ `transactions` (+ `transaction_items`) ↔ arsip nota,
dan kebijakan "barang boleh dihapus atau tidak".

---

## 0. Versi bahasa mudah (untuk mengingat maksudnya)

- **Gudang** = `inventory`. **Nota jalan** = transaksi status `Booking` / `Disewa` /
  `Belum Selesai`. **Arsip** = nota yang sudah `Selesai` / `Dibatalkan`.
- Maksud yang disepakati: gudang dan arsip **berdiri sendiri**. Hapus atau ubah barang
  di gudang tidak boleh mengubah nota lama. Yang dikunci hanya barang yang sedang
  dipakai nota jalan.

---

## 1. Keputusan yang disepakati (2026-11-02)

1. **Kunci hapus inventory = hanya saat ada di jadwal aktif** (`Booking`, `Disewa`,
   `Belum Selesai`). Barang yang hanya tinggal di arsip **boleh dihapus**.
2. **Arsip benar-benar beku.** Setelah nota berstatus `Selesai`/`Dibatalkan`, isinya
   tidak bisa diubah siapa pun. Pengecualian: pencatatan/penghapusan **pembayaran**
   tetap boleh (memang terjadi setelah transaksi selesai).
3. **Salinan beku diisi server, sekali saja (fill-once).** `ref` diisi dari inventory
   saat item pertama kali disimpan; tidak pernah ditimpa, jadi harga/nama katalog yang
   berubah kemudian tidak merusak arsip.
4. **Isi paket ikut dicatat dan ikut terkunci** saat paketnya sedang dipakai.
5. **Recycle bin:** soft delete + purge otomatis setelah 30 hari, tidak tampil untuk
   tenant, **restore hanya oleh admin Sewara** (owner tidak punya UI sampah).

---

## 2. Temuan: keadaan sekarang

### 2.1 Kunci hapus berlaku untuk SEMUA status, bukan hanya jadwal aktif
- DB: `transaction_items -> inventory ON DELETE RESTRICT` dua kali —
  `fk_transaction_items_inventory` (`sewara-backend/supabase/migrations/phase7b_add_foreign_keys.sql:23-30`,
  komentarnya sendiri: *"can't delete inventory if in use"*) dan
  `fk_ti_inventory_tenant` (`phase9_5_tenant_integrity.sql:46-48`).
  `RESTRICT` tidak melihat status.
- Bukti constraint itu hidup di produksi: komentar di
  `20260913f_hapus_fitur_versi_dan_fix_hapus_user.sql:4` — FK ini yang menolak hapus
  akun owner.
- Go: `internal/db/inventory.go:300-323` (`DeleteInventory`) preflight
  `EXISTS (SELECT 1 FROM transaction_items WHERE inventory_id = ANY($1::bigint[]))`
  **tanpa filter status** → `ErrInventoryDipakai`.
- Next: `app/api/inventory/bulk-delete/route.ts:23-36` preflight juga tanpa filter
  status (pesan jelas `INVENTORY_IN_USE`); `app/api/inventory/[id]/route.ts:106-120`
  hapus langsung tanpa preflight → yang muncul error FK mentah.
- Beda pesan dua jalur itu (bulk vs single) mudah terbaca sebagai "aturannya beda",
  padahal aturannya sama: semua status.
- UI yang membuat kesan lain: `sewara-frontend/src/app/dashboard/inventaris/page.js:92-93`
  hanya melacak S/N yang "sedang dipegang transaksi aktif (Booking/Disewa)".

### 2.2 Arsip sudah berupa salinan beku, tapi diisi oleh klien
- `transactions.items` (jsonb) menyimpan `ref` = salinan penuh barang. Bentuknya
  identik dengan `to_jsonb(inventory)` (kolom `inventory`: id, nama, jenis, h24, h12,
  h6, denda, sns, komponen, created_at, updated_at, user_id, tipeSewa, kondisi,
  keterangan, tarif, tag, kondisi_sn).
- Semua tampilan arsip membaca dari `items` + `item.ref`, tidak ada yang join ke
  inventory: `lib/utils.js:116` (`item?.ref || item || {}`), `kalender/page.js:117`,
  `status/page.js:187`, `tracking/page.js:1790`, `booking/page.js:76`.
- Masalahnya **siapa yang mengisi**: Go menulis mentah payload klien —
  `tambah("items = $%d::jsonb", tx.Items)` (`internal/db/transactions.go:568-569`) dan
  INSERT `jsonbAwal(tx.Items, "array", "[]")` (`:606`); kolom `transaction_items`
  juga dari input. Jadi mutu arsip bergantung halaman web, bukan server.
- Utang lama yang berkaitan: `items` tanpa `ref` (cutover-plan §11) → jatuh ke
  fallback `item || {}` → nota tampil tanpa nama.

### 2.3 Isi paket tidak dijaga sama sekali
- `inventory.komponen` adalah jsonb `[{idBarang, qty, nama}]` — tidak ada FK.
  Yang dilindungi FK hanya baris paketnya di `transaction_items`, bukan isinya.
- Karena itu printilan bisa dihapus walau paketnya sedang disewa atau sudah masuk
  arsip. Ini kandidat terkuat penyebab pengamatan "barang hilang di arsip".
- Tampilan masih menengok gudang hidup: `tracking/page.js:289-321` dan `:412`
  menghitung ketersediaan paket dari `komponen[].idBarang` (inventory aktif), bukan
  dari salinan di nota.

### 2.4 Data saat diperiksa (staging homelab, 2026-11-01/02, read-only)
```
items tanpa ref = 0
transaksi punya jsonb tapi tanpa baris relasional = 0
18 baris transaction_items = 18 item jsonb
status: Booking=13, Disewa=4, Selesai=4, Dibatalkan=2, Belum Selesai=1
transactions: 216 kB, dead tuples 21
transaction_items.inventory_id = NULLABLE
FK: transaction_items->inventory ON DELETE RESTRICT (dua constraint)
```

---

## 3. Urutan kerja yang diusulkan

| # | Pekerjaan | Alasan/ketergantungan |
|---|---|---|
| 1 | **Server mengisi salinan beku (fill-once)** — saat save, item yang `ref`-nya kosong diisi `to_jsonb(inventory)` (satu query, tenant-scoped, dalam transaksi yang sama); `ref` yang sudah ada jangan ditimpa | Prasyarat untuk #3. Sekaligus menutup §2.2 dan utang §11 |
| 2 | **Arsip beku di jalur tulis** — untuk status `Selesai`/`Dibatalkan`, `items` dari klien diabaikan (pakai yang tersimpan); pembayaran tetap boleh berubah | UI mengirim ulang seluruh baris (termasuk `items`) saat mencatat pembayaran — jadi jangan balas 409, cukup abaikan |
| 3 | **Longgarkan penjaga DB** — FK jadi `ON DELETE SET NULL` supaya barang yang hanya tinggal di arsip bisa dihapus | Baru boleh setelah #1 terverifikasi (arsip tidak lagi butuh baris inventory) |
| 4 | **Isi paket** — snapshot isi paket diandalkan (`ref.komponen` sudah ada) dan tampilan berhenti menebak dari inventory hidup; kunci hapus komponen saat dipakai nota jalan | Menutup §2.3 |
| 5 | **Recycle bin** — soft delete + purge 30 hari, restore hanya admin Sewara | Menumpang pola purge yang sudah ada: ticker per jam `sewara-api/cmd/api/main.go:101-118`, TTL `30 * 24 * time.Hour` di `config.go:84` |

Catatan penegakan: kunci arsip di #2 hanya di kode. Kalau mau ditegakkan mesin,
tambahkan trigger `BEFORE UPDATE OF items` pada `transactions` yang menolak bila
`OLD.status` arsip dan `NEW.items` berbeda. Belum diputuskan.

---

## 4. Yang belum diputuskan

- Apakah arsip beku cukup di kode (#2) atau ditegakkan juga oleh trigger DB.
- Bentuk recycle bin untuk tenant: benar-benar tanpa UI (sesuai keputusan) — konfirmasi
  ulang saat dikerjakan, karena owner yang salah hapus harus lewat admin Sewara.
- Nama/lokasi skema & partitioning: dibahas terpisah, **tidak** bagian dari wacana ini.

---

## 5. Rujukan file

- `sewara-api/internal/db/transactions.go` — `SaveTransaction` (:429+), tulis `items`
  (:568-569, :606), replace anak (:615-640), `ErrInventoryLainTenant` (:379)
- `sewara-api/internal/db/inventory.go` — `DeleteInventory` (:300-323),
  `ErrInventoryDipakai` (:198-200)
- `sewara-backend/app/api/inventory/[id]/route.ts` — DELETE tanpa preflight (:106-120)
- `sewara-backend/app/api/inventory/bulk-delete/route.ts` — preflight semua status (:23-36)
- `sewara-frontend/src/lib/db.js` — `updateTransactions` kirim seluruh baris (:390-394)
- `sewara-frontend/src/app/dashboard/status/page.js` — catat/edit/hapus pembayaran pada
  transaksi `Selesai` (:1038-1276)
- `sewara-frontend/src/app/dashboard/tracking/page.js` — hitung paket dari inventory
  hidup (:289-321, :412)
