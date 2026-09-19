# Audit Sewara Apps — Temuan & Saran

Tanggal: 10 Sep 2026
Cakupan: Keamanan & Performance
Status: Audit read-only, belum ada perbaikan.

---

# AUDIT KEAMANAN

## P1 — Confirmed (butuh tindakan)

### 1. Session cookie `httpOnly: false` — token JWT terbaca JavaScript
- File: `src/app/api/auth/login/route.js:62`
- Juga: `admin/data/route.js:18`, `check-inventory/route.js:17`, `test-atomic/route.js:18`, `test-rpc/route.js:18`
- Access token Supabase disimpan di cookie non-httpOnly, dibaca client via `document.cookie`.
- Risiko: satu XSS = token curi = akun takeover penuh. XSS surface kecil (grep `dangerouslySetInnerHTML`/`innerHTML` bersih), tapi risiko sistemik.
- Saran: pindah ke server-session `httpOnly:true`, semua query via route handler/server client. Atau kompensasi wajib: CSP ketat + audit deps.

### 2. Endpoint debug/test live di produksi
- `src/app/api/test-atomic/route.js` — ekspos `error.stack`, buat/hapus transaksi, gate cuma "authenticated" tanpa role.
- `src/app/api/test-rpc/route.js` — probe isolasi tenant, inject `user_id` asing.
- `src/app/api/check-inventory/route.js:44` — balas `invErr.message` mentah.
- Saran: hapus atau gate `NODE_ENV !== 'production'` + wajib superadmin.

### 3. Secret material di file lokal & zip
- `.env.local` — `SUPABASE_SERVICE_ROLE_KEY`, R2 keys, `R2_ENCRYPTION_MASTER_KEY` (dormant, tak dipakai kode).
- `sewaraapps.zip` (untracked, 941KB) berisi `.env.local`.
- Tidak ter-commit di git (confirmed), tapi zip mudah ter-share.
- Saran: hapus zip, tambah `*.zip` ke `.gitignore`, rotate keys, hapus `R2_ENCRYPTION_MASTER_KEY`.

## P2 — Confirmed

### CSV injection
- `src/lib/utils.js:78` `unduhCSV` tanpa sanitasi prefix formula.
- Field user-controlled (`= + - @ \t \r`) diekspor mentah. Quoting `"..."` tidak mencegah formula injection.
- File terkait: `inventaris/page.js:510-516`, `laporan/page.js:177`, `pelanggan/page.js:138`.
- Saran: prefix `'` pada cell yang dimulai `= + - @ \t \r` sebelum build CSV.

### Permission system mati / authorization UI-only
- `src/lib/permission.js:10` — "belum enforce di semua route".
- `src/lib/role.js:10` `HAK_MENU` hanya hide menu client-side di `layout.js:757,869`.
- Enforcement data sudah benar via RLS + RPC guard, tapi role akses menu murni client-side.
- Saran: enforce `has_permission`/role di server untuk aksi sensitif, atau buang sistem permission kalau tak dipakai (YAGNI).

## Perlu verifikasi live DB (belum confirmed)

### P0-check — RLS tabel induk bisnis
Verifikasi di SQL Editor SEWARA:
```sql
SELECT tablename, policyname, cmd, qual, with_check
FROM pg_policies
WHERE schemaname='public'
  AND tablename IN ('inventory','transactions','members','member_types','profiles')
ORDER BY tablename, policyname;
```
Kalau masih ada `USING (true)` di tabel induk → P0 cross-tenant.

### Versi guard `rpc_set_role` / `rpc_toggle_active`
Dua versi ada: `migration_multi_owner.sql` (aman) vs `migration_multi_user.sql` (hardcoded `owner@user.com`).
```sql
SELECT prosrc FROM pg_proc WHERE proname IN ('rpc_set_role','rpc_toggle_active');
```

### Owner bisa promote staf jadi `owner` via UPDATE langsung
- RLS `profiles_write_allowed` izinkan `owner_id = auth.uid()`, WITH CHECK tidak batasi kolom `role`.
- Trigger `protect_profile_self_escalation` hanya blok self-escalation, bukan baris staf.
- Dampak: role confusion dalam tenant (bukan cross-tenant).
- Saran: tambah CHECK policy/trigger supaya `NEW.role` staf tidak boleh `owner`/`superadmin`, atau buang UPDATE langsung profiles dari client.

## Catatan positif (sudah benar)
- Service role cuma server-side, tidak bocor ke client.
- Login anti-enumeration, rate-limit + lockout berlapis.
- `rpc_save_transaction` validasi field whitelist + tenant + `SECURITY INVOKER`.
- Upload member validasi MIME/size + path key `user.id`.

## P3 — Minor
- `src/proxy.js:29` `punyaSesi` hanya cek nama cookie, bukan validitas JWT (kosmetik).
- Settings RLS `user_id = auth.uid()` → staf tak bisa baca/tulis setting owner (auto-logout staf tak sinkron).
- `register/route.js:35` password min 6 vs `validation.js` `PASSWORD_MIN_LENGTH=8` — inkonsisten.
- `member/upload/route.js:53` & `photo/route.js:45` pakai `user.id`, bukan `ownerId` → staf gagal akses dokumen tenant (fail-closed).

---

# AUDIT PERFORMANCE

## P0 — Confirmed

### 1. Status page polling 15 detik refetch seluruh board + riwayat
- `src/app/dashboard/status/page.js:478-481` — `setInterval 15s` → `muatAktif` + `muatSelesai` (kolom penuh JSONB, tanpa limit, scan semua riwayat).
- Saran: batasi riwayat `.limit(100)` + kolom ringkas; ganti polling → Supabase Realtime; naikkan 15s→60s; pisahkan aktif vs riwayat.

### 2. `layout.js` 957 baris client + 4 interval + SettingsModal eager
- Clock 1 detik re-render sidebar tiap detik; poll versi 20s; `setKini` 30s; auto-logout 60s; SettingsModal (34KB) di-render selalu.
- Saran: Clock → komponen `<Clock>` kecil; SettingsModal → `dynamic()` lazy load; drop/replace poll versi.

### 3. `getOwnerIdAktif` = 2 query (auth + profiles) diulang di mana-mana
- `src/lib/db/helpers/tenantHelper.js:24-40` — dipanggil per operasi (setSetting, getSettingTenant 3x di booking mount, getMembers, dll).
- Saran: cache `ownerId` module-level, atau pass dari session yang sudah ada.

### 4. `select("*")` scan penuh tanpa batas
- `inventoryService.js:29`, `db.js:450/460/216`, `ambilSemua` + `fetchAllPages` (1000/halaman tanpa limit).
- Saran: kolom spesifik (`KOLOM_KARTU`/`KOLOM_LAPORAN`), `.limit()` + pagination, `items`/`pembayaran` lazy.

## P1 — Confirmed

- 27 file `"use client"`, zero server component — semua fetch di `useEffect`, waterfall, no SSR.
- `createBrowserClient` dibuat ulang di banyak tempat — buat singleton.
- Cache `useTransactionsAktif` kalah oleh polling 15s + `dataChanged` force fresh.
- html2pdf.js 940KB — sudah lazy tapi berat.
- Font Google via `<link>` — bukan `next/font`, CLS + dependensi jaringan.
- Member photo `<img>` + N+1 — fetch foto per dokumen.

## P2 — Confirmed

- `globals-legacy.css` 1834 baris dead code (import di-comment) — hapus.
- `window.sewaraSupabase = supabase` test hook di `dashboard/page.js:35` — hapus (risiko keamanan juga).
- `useSyncExternalStore` hydration hack tak berguna.
- `MutationObserver` seluruh `document.body` di `status/page.js:363-369` — mahal.
- `hitungSum` jumlah di JS bukan SQL aggregate (`db.js:69-85`).
- `getPelangganSuggestions` berat di mount (getMembers + 1000 trx).

## Perlu pengukuran runtime

- Prod build gagal — build.log berisi "Turbopack build failed with 2 errors". `.next` saat ini hasil dev. Perlu fix build dulu untuk lihat chunk size asli. Jalankan `ANALYZE=true npm run build`.
- Indeks DB — verifikasi `EXPLAIN` untuk `transactions.status`, `waktu_ambil_rencana`, `waktu_kembali_rencana`, `created_at`, `transaction_items.transaction_id`, `settings(user_id,key)`, `profiles.user_id`.

---

# AUDIT SCALABILITY, CODE EFFICIENCY & MAINTAINABILITY

## P0 — Kritis (data loss / korupsi / security)

### 1. Save transaksi non-atomik = path LIVE. RPC atomik = mati.
- `rpc_save_transaction` dibangun di `supabase/migrations/20260904_phase2c2_atomic_transaction_save.sql` tapi hanya dipanggil test route (`api/test-atomic`, `api/test-rpc`). Grep konfirmasi.
- UI produksi pakai `tambahTransactions`/`updateTransactions` → `booking/page.js:1276,1188,1642,1736`, `status/page.js:737,861,928,949,1028`.
- Path non-atomik (`db.js:353-389`, duplikat di `transactionService.js:51-52`): upsert parent → `saveTransactionItems` delete-all + insert (`db.js:271-293`) → `saveTransactionPayments` delete-all + insert (`db.js:305-322`). Tanpa transaksi DB, tanpa row lock.
- **Dampak:** dua device edit bersamaan = lost update / partial write / child yatim. Double-booking / korupsi data. Persis bug yang diklaim diperbaiki di v0.1.4/v0.1.5 (`version.js:12,24`) tapi sebenarnya belum.

### 2. `id: Date.now()` client-generated vs `GENERATED ALWAYS AS IDENTITY`.
- `booking/page.js:1224` set `id: Date.now()` → `tambahTransactions` insert id eksplisit (`db.js:356`).
- Schema: `transactions.id BIGINT GENERATED ALWAYS AS IDENTITY` (`supabase/migration.sql:17`).
- Insert id eksplisit ke kolom `GENERATED ALWAYS` → Postgres tolak kecuali `OVERRIDING SYSTEM VALUE`. **Confirmed mismatch, probable runtime fail** atau DB diubah manual ke `BY DEFAULT`. Verifikasi live DB.

### 3. RPC `increment_invoice_counter` tidak ada di migration mana pun.
- `db.js:713` panggil `.rpc("increment_invoice_counter")`. Grep = 0 hasil.
- Fallback (`db.js:716-721`) increment counter localStorage → nomor invoice duplikat saat konkurensi. **Confirmed missing, probable fallback racy aktif.**

## P1 — Tinggi

### 4. Pola `ambilSemua`/`fetchAllPages` pecah saat data besar.
- `db.js:24`, `transactionService.js:12`, `paginationHelper.js:9` — fetch SEMUA baris page-1000 ke memori.
- Dipakai: `getTransactions`, `getTransactionsStatistik`, `getTransactionsLaporan`, `getTransactionsAktif`.
- `getRekapStatus` (`db.js:107-142`) fetch baris penuh cuma buat count. `getPembayaranRentang` fetch semua `pembayaran` JSONB buat sum di JS. `hitungSum`/`hitungPendapatan` sum semua `total_akhir` di JS.
- **Confirmed.** Ganti ke agregat DB: `.select('total_akhir.sum()')` / RPC / `count:'exact', head:true`.

### 5. Duplikasi db.js vs db/services — tanpa sumber kebenaran tunggal.
- `ambilSemua` 3 varian, `sisipUserId` 3x, `getOwnerIdAktif` 2x, `getUserId` 2x, `getStok` 2x identik.
- `tambahTransactions`/`updateTransactions`/`saveTransactionItems`/`saveTransactionPayments`/`saveInventoryUnits`/`updateInventory`/`hapusInventory` duplikat db.js vs services.
- `KOLOM_LAPORAN`/`KOLOM_KARTU` 2x.
- **Confirmed.** Refactor services tidak tuntas; db.js simpan salinan sendiri. Separuh services ter-shadowing/mati.

### 6. `reportingService.js` = dead code + schema salah.
- Di-import `db.js:5`, tidak pernah dipanggil (grep: 0).
- Kolom stale `rencana_ambil`/`rencana_kembali`/`total` (`reportingService.js:52,55,76,106`). `getSetting` baca localStorage raw-key, salah. **Confirmed dead + crash bila dipanggil.**

### 7. SaaS infra + permission.js + subscription.js = ~900 LOC + 11 tabel + 2 fungsi SQL, unenforced (YAGNI).
- `phase9_saas_infrastructure.sql` buat 11 tabel + `has_permission`/`get_feature_limit`.
- `permission.js` (486 baris) tidak di-import. `subscription.js` (432 baris) tidak di-import; `hasReachedLimit`/`canUseFeature` return hardcoded.
- Duplikat `has_permission` (SQL) vs `hasPermission` (JS). **Confirmed dead.**

### 8. RLS tabel parent DB sewara tidak ter-commit → isolasi tenant tidak reproducible.
- `transactions`/`inventory`/`activity_logs` policy `access_own_or_owner` hanya di `migration_multi_owner.sql:148-161` (target DB produksi `wbujlusshrrvkjjxkhtj`). Tidak ada migration sewara (`obhvrzholszhjnpvmnna`).
- Child tables ada (`phase9_5_tenant_integrity.sql`). Parent TIDAK. **Confirmed missing dari repo, probable diterapkan manual.** Risiko drift / kebocoran antar-tenant.

### 9. Error handling tidak konsisten — migrasi setengah.
- Route pakai lib `api/*` vs route inline `NextResponse` + try/catch.
- `requireActiveSubscription` baca `profile.subscription_end` (`api/auth.js:132`) — field tidak ada (asli `subscribed_until`). `getSafeErrorMessage` regex salah (`api/errors.js:233`). **Confirmed.**

## P2 — Sedang/rendah

### 10. God component.
- `booking/page.js` 2741 baris, `status` 2022, `tracking` 1747, `inventaris` 1491, `layout.js` 925. Modal/sub-komponen tidak diekstrak. **Confirmed.**

### 11. Dua sistem CSS.
- `globals-legacy.css` (59KB rp-*) dinonaktifkan tapi masih di repo. `globals-base.css` simpan design token deprecated. **Confirmed.**

### 12. Naming campur + magic string.
- Indonesia (`ambilSemua`, `tambahTransactions`, `hapusInventory`) vs Inggris (`fetchAllPages`, `saveTransactionAtomic`).
- Magic string status `"Booking"/"Disewa"/"Selesai"`, metode `"Tunai"/"Transfer"/"QRIS"`, key `"notif_jam"/"basis_pendapatan"/"invoice_prefix"` tersebar tanpa konstanta. **Confirmed.**

### 13. Nol test otomatis.
- `package.json` tanpa script test. Hanya `supabase/tests/*.sql` manual. **Confirmed.**

### 14. Tanpa pagination log/member.
- `logsService.getLogs` tanpa limit. `getMembers` semua member. `activity_logs` tumbuh tak terbatas. **Confirmed.**

### 15. Dual-write settings racy.
- `settingsService.setSetting` tulis localStorage sinkron lalu upsert async (fire-and-forget). `getSetting` baca localStorage saja. Multi-device best-effort. **Confirmed.**

### 16. `getDashboardStatistik` campur pola.
- `hitungCount` pakai `count:'exact', head:true` (benar) tapi `hitungPendapatan` pakai `hitungSum` O(N). **Confirmed.**

---

## Risiko terbesar (scalability/maintainability)

1. **Save transaksi non-atomik (live) + mismatch `id: Date.now()` vs `GENERATED ALWAYS`** → korupsi data / booking gagal saat multi-user. Ancaman #1 karena menyentuh core money-path.
2. **RLS parent tidak ter-commit** → isolasi tenant tidak bisa diverifikasi; policy salah/absens = kebocoran data antar-owner.

## Quick wins terbaik

1. Ganti `tambahTransactions`/`updateTransactions` di booking/status dengan `saveTransactionAtomic` — sudah dibangun + dites di test route. Hapus path non-atomik.
2. Hapus dead code: `reportingService.js`, `permission.js`, `subscription.js`, `globals-legacy.css`, route `test-atomic`/`test-rpc`. Drop 11 tabel SaaS + 2 fungsi SQL bila tak dipakai (atau flag-gate).
3. Jadikan `db.js` thin re-export murni dari `db/services/*`, hapus helper duplikat.
4. Ganti `hitungSum`/`getRekapStatus`/`getPembayaranRentang` ke agregat DB / RPC.
5. Commit migration RLS tabel parent untuk DB sewara + definisikan `increment_invoice_counter` RPC.

---

# Prioritas tindakan gabungan

| Urutan | Item | Kategori | Status |
|---|---|---|---|
| 1 | Verifikasi RLS tabel induk (SQL di atas) | Keamanan P0-check | ✅ Aman — semua access_own_or_owner + is_active |
| 2 | Ganti save non-atomik → `saveTransactionAtomic` | Scalability P0 | ✅ Selesai — verified end-to-end booking→selesai |
| 3 | Fix mismatch `id: Date.now()` vs `GENERATED ALWAYS` | Scalability P0 | ✅ Selesai — DB is_identity=NO, id client valid |
| 4 | Definisi `increment_invoice_counter` RPC | Scalability P0 | ✅ Verified ter-install live |
| 5 | Hapus zip + rotate keys | Keamanan P1 | ✅ Zip dihapus; R2_ENCRYPTION_MASTER_KEY dihapus; rotate keys sisa manual |
| 6 | Hapus/gate endpoint test | Keamanan P1 | ✅ Selesai — 404 di production |
| 7 | Fix prod build (Turbopack errors) | Performance | ✅ Selesai — build pass |
| 8 | Status page polling + limit riwayat | Performance P0 | ✅ Selesai — 15s→60s, aktif board only |
| 9 | Cache `getOwnerIdAktif` + singkirkan duplikasi db.js | Performance/Maintainability | ✅ Selesai — cache 5min uid-aware |
| 10 | Hapus dead code (reportingService, permission, subscription, legacy CSS) | Maintainability | ✅ Selesai batch 1 |
| 11 | CSV injection sanitasi | Keamanan P2 | ✅ Selesai |
| 12 | `select("*")` → kolom spesifik + agregat DB | Performance P0 | ✅ Selesai — sum() aggregate, count-only rekap, SQL filter |
| 13 | Commit migration RLS parent DB sewara | Scalability P1 | ✅ Selesai — snapshot verified live |
