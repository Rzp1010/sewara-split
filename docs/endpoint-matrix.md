# Matriks Endpoint Backend

Sumber: `sewara-backend/app/api/**/route.ts`
Dibuat: 2026-10-27, otomatis dari ekspor route.
Total: **51 file route, 74 endpoint HTTP** saat audit 2026-10-28. Setelah empat
route mati dibuang pada tanggal yang sama: **47 file route, 68 endpoint**.

Kategori:
- **CRUD** — baca/tulis satu tabel, pola seragam.
- **AUTH** — sesi, kredensial, verifikasi.
- **ADMIN** — lintas tenant, wajib role check ketat.
- **AGREGAT** — query laporan/statistik, rawan N+1 bila ditulis sembarangan.
- **FILE** — upload/streaming R2, presigned URL, proxy.
- **LOGIKA** — aturan bisnis nontrivial (bundling, promo, blacklist match).
- **EKSTERNAL** — Telegram, webhook pembayaran.

| Path | Methods | Kategori |
|---|---|---|
| /api/admin/data | POST | ADMIN |
| /api/admin/logs | GET | ADMIN |
| /api/admin/users | GET, POST, DELETE, PATCH | ADMIN |
| /api/auth/callback | GET | AUTH |
| /api/auth/login | POST | AUTH |
| /api/auth/logout | POST | AUTH |
| /api/auth/me | GET | AUTH |
| /api/auth/register | POST | AUTH |
| /api/auth/resend-verification | POST | AUTH |
| /api/blacklist | GET, POST | CRUD |
| /api/blacklist/:id | PATCH, DELETE | CRUD |
| /api/blacklist/check | GET | LOGIKA |
| /api/blacklist/header | GET | FILE |
| /api/blacklist/upload | POST | FILE |
| /api/dashboard | GET | AGREGAT |
| /api/dashboard/manajemen | GET | AGREGAT |
| /api/inventory | GET, POST | CRUD |
| /api/inventory/:id | PATCH, DELETE | LOGIKA |
| /api/inventory/bulk-delete | POST | CRUD |
| /api/invoice/header | GET, POST, DELETE | FILE |
| /api/invoice-counter | POST | LOGIKA |
| /api/logs | GET, POST, DELETE | CRUD |
| /api/logs/login | GET | CRUD |
| /api/member/photo | GET | FILE |
| /api/member/upload | POST | FILE |
| /api/members | GET, POST | CRUD |
| /api/members/:id | PATCH, DELETE | CRUD |
| /api/member-types | GET, POST | CRUD |
| /api/member-types/:id | DELETE, PATCH | CRUD |
| /api/pembayaran/export | GET | FILE |
| /api/pembayaran/photo | GET | FILE |
| /api/pembayaran/purge | POST | LOGIKA |
| /api/pembayaran/reminder | GET | AGREGAT |
| /api/pembayaran/reminder-ack | POST | CRUD |
| /api/pembayaran/upload | POST | FILE |
| /api/profiles | GET | CRUD |
| /api/promo | GET, POST | CRUD |
| /api/promo/:id | PATCH, DELETE | CRUD |
| /api/promo/use | POST | LOGIKA |
| /api/promo/validate | POST | LOGIKA |
| /api/settings | GET, POST | LOGIKA |
| /api/telegram/test | POST | EKSTERNAL |
| /api/telegram/webhook | POST | EKSTERNAL |
| /api/transaction-items | GET, POST | CRUD |
| /api/transactions | GET, POST | CRUD |
| /api/transactions/:id | GET, PATCH | CRUD |
| /api/webhooks/payment | POST | EKSTERNAL |

## Catatan urutan pengerjaan

CRUD lebih dulu (volume besar, risiko rendah, cepat jadi pola). AUTH dikerjakan paling
awal di W1 karena semua route bergantung padanya. FILE dan EKSTERNAL paling akhir:
keduanya butuh keputusan desain (presigned URL, verifikasi signature) yang tidak boleh
ditulis sambil buru-buru.

## Route wajib punya test khusus

Selain test isolasi tenant standar, route berikut butuh kasus tambahan:

| Route | Kasus wajib |
|---|---|
| /api/admin/users | staf biasa tidak boleh membaca/mengubah user tenant lain |
| /api/settings | staf tidak boleh membaca/menulis key privat (`KEY_PRIVAT`) |
| /api/invoice/header | path di luar prefix tenant ditolak |
| /api/blacklist/header | path di luar prefix tenant ditolak |
| /api/inventory/:id | PATCH komponen paket saat dipakai → 409 `PAKET_IN_USE` |
| /api/telegram/webhook | secret salah ditolak |
| /api/webhooks/payment | signature salah ditolak, replay ditolak |

## Yang tidak boleh berubah saat port

Nilai `ERROR_CODES` (15 nilai, sumber `lib/api/constants.ts`) dan bentuk amplop
`{ok, data?}` / `{ok:false, error:{code, message, details?}}`. Keduanya dikunci oleh
golden fixture.

## Status port ke Go (2026-10-28)

Diperbarui manual setiap kali route baru selesai. Sumber kebenaran jumlah
skenario: `sewara-api/scripts/smoke-*.ps1`.

| Endpoint | Go | Skenario |
|---|---|---|
| POST /api/auth/login | `handlers_login.go` | 18 |
| GET /api/auth/me | `handlers_auth.go` | (tercakup smoke-login) |
| GET /api/settings | `handlers_settings.go` | 12 |
| POST /api/settings | `handlers_settings.go` | 12 |
| GET /api/member-types | `handlers_member_types.go` | 8 |
| POST /api/member-types | `handlers_member_types.go` | 8 |
| GET /api/profiles | `handlers_profiles.go` | 8 |
| GET /api/dashboard | `handlers_dashboard.go` | 6 |
| GET /api/inventory | `handlers_inventory.go` | 20 |
| POST /api/inventory | `handlers_inventory.go` | 20 |
| PATCH /api/inventory/{id} | `handlers_inventory.go` | 32 |
| DELETE /api/inventory/{id} | `handlers_inventory.go` | 32 |
| POST /api/inventory/bulk-delete | `handlers_inventory.go` | 32 |
| GET /api/blacklist | `handlers_blacklist.go` | 41 |
| POST /api/blacklist | `handlers_blacklist.go` | 41 |
| PATCH /api/blacklist/{id} | `handlers_blacklist.go` | 41 |
| DELETE /api/blacklist/{id} | `handlers_blacklist.go` | 41 |
| GET /api/blacklist/check | `handlers_blacklist.go` | 41 |
| POST /api/blacklist/upload | `handlers_blacklist.go` | 41 (storage off) |
| GET /api/blacklist/header | `handlers_blacklist.go` | 41 (storage off + guard) |

Sisa kerja setelah audit pemakaian (bagian berikut): **32 path / 48 metode**
(angka "61" sebelumnya belum dikurangi endpoint mati). Deviasi kontrak yang
disengaja dicatat di `rencana-migrasi-go-2026-10-27.md` §17, §22, dan §23.

## Pemakaian endpoint di frontend (audit 2026-10-28)

Alat: `node scripts/audit-endpoint-usage.js`. Yang dilacak adalah rantai
**halaman/komponen -> `lib/db.js` -> `lib/api-client.js` -> route**, ditambah
pemakaian path literal (`<img src>`, tautan unduh, `fetch` manual) dan pemanggil
di luar frontend (cron, webhook). Endpoint berparameter ditulis `:id`.

Total saat audit **51 path / 74 metode**. Dari jumlah itu, **43 path
(64 metode) dipakai**, **4 path (6 metode) pembungkusnya
mati**, dan **4 path masih dipakai tetapi bukan oleh frontend**.

Empat path mati itu **sudah dibuang** pada 2026-10-28 (route Next, definisi
`api-client`, dan pembungkus `db.js`; tabel DB tidak di-drop). Skrip yang sama
kini melaporkan **47 path / 68 metode** tanpa satu pun pembungkus mati.

| Kelompok | Path | Metode |
|---|---|---|
| Dipakai langsung dari halaman/komponen | 12 | 14 |
| Dipakai lewat pembungkus `lib/db.js` | 27 | 46 |
| Dipakai sebagai URL langsung (gambar/unduh/anchor) | 4 | 4 |
| **Subtotal dipakai** | **43** | **64** |
| Pembungkus mati (kandidat dibuang) | 4 | 6 |
| Dipakai pihak lain, bukan frontend | 4 | 4 |

### A. Dipakai langsung dari halaman/komponen

| Endpoint | Metode | Kategori | Bukti |
|---|---|---|---|
| `/api/auth/login` | POST | AUTH | app/page.js |
| `/api/auth/logout` | POST | AUTH | app/dashboard/layout.js, app/dashboard/page.js |
| `/api/auth/me` | GET | AUTH | app/dashboard/blacklist/page.js, app/dashboard/inventaris/page.js, app/dashboard/laporan/page.js |
| `/api/auth/register` | POST | AUTH | app/daftar/page.js |
| `/api/blacklist/header` | GET | FILE | app/dashboard/blacklist/page.js, components/BlacklistFotoSlot.jsx |
| `/api/dashboard` | GET | AGREGAT | app/dashboard/page.js |
| `/api/dashboard/manajemen` | GET | AGREGAT | app/dashboard/page.js |
| `/api/inventory` | GET, POST | CRUD | app/dashboard/page.js, app/dashboard/booking/page.js, app/dashboard/inventaris/page.js |
| `/api/pembayaran/reminder` | GET | AGREGAT | components/BannerBackupBukti.jsx |
| `/api/pembayaran/reminder-ack` | POST | CRUD | components/BannerBackupBukti.jsx |
| `/api/profiles` | GET | CRUD | app/dashboard/manajemen/page.js, app/dashboard/sdm/page.js |
| `/api/settings` | GET, POST | LOGIKA | app/dashboard/layout.js, app/dashboard/loginlog/page.js, app/dashboard/member/page.js |

### B. Dipakai lewat pembungkus `lib/db.js`

| Endpoint | Metode | Kategori | Bukti |
|---|---|---|---|
| `/api/admin/data` | POST | ADMIN | app/dashboard/pengaturan/page.js, app/dashboard/pengaturan/page.js [url] |
| `/api/admin/logs` | GET | ADMIN | app/dashboard/manajemen/page.js |
| `/api/admin/users` | GET, POST, DELETE, PATCH | ADMIN | app/dashboard/sdm/page.js, app/dashboard/manajemen/page.js, app/dashboard/pengaturan/page.js |
| `/api/blacklist` | GET, POST | CRUD | app/dashboard/blacklist/page.js, app/dashboard/booking/page.js, app/dashboard/pelanggan/page.js |
| `/api/blacklist/:id` | PATCH, DELETE | CRUD | app/dashboard/blacklist/page.js |
| `/api/blacklist/check` | GET | LOGIKA | app/dashboard/booking/page.js |
| `/api/blacklist/upload` | POST | FILE | app/dashboard/blacklist/page.js, components/BlacklistModal.jsx |
| `/api/inventory/:id` | PATCH, DELETE | LOGIKA | app/dashboard/booking/page.js, app/dashboard/inventaris/page.js, app/dashboard/status/page.js |
| `/api/inventory/bulk-delete` | POST | CRUD | app/dashboard/inventaris/page.js |
| `/api/invoice-counter` | POST | LOGIKA | app/dashboard/booking/page.js |
| `/api/invoice/header` | GET, POST, DELETE | FILE | components/InvoiceLayoutEditor.jsx, app/dashboard/pengaturan/page.js, components/InvoiceBody.jsx [url] |
| `/api/logs` | GET, POST, DELETE | CRUD | app/dashboard/booking/page.js, app/dashboard/status/page.js |
| `/api/logs/login` | GET | CRUD | app/dashboard/loginlog/page.js |
| `/api/member-types` | GET, POST | CRUD | app/dashboard/member/page.js, app/dashboard/member/page.js [url] |
| `/api/member-types/:id` | DELETE, PATCH | CRUD | app/dashboard/member/page.js |
| `/api/members` | GET, POST | CRUD | app/dashboard/member/page.js |
| `/api/members/:id` | PATCH, DELETE | CRUD | app/dashboard/member/page.js |
| `/api/pembayaran/export` | GET | FILE | app/dashboard/riwayat/page.js [url] |
| `/api/pembayaran/photo` | GET | FILE | app/dashboard/status/page.js [url], components/ModalBuktiBayar.jsx [url] |
| `/api/pembayaran/upload` | POST | FILE | app/dashboard/booking/page.js [url], app/dashboard/status/page.js [url] |
| `/api/promo` | GET, POST | CRUD | app/dashboard/booking/page.js, app/dashboard/promo/page.js |
| `/api/promo/:id` | PATCH, DELETE | CRUD | app/dashboard/promo/page.js |
| `/api/promo/use` | POST | LOGIKA | app/dashboard/booking/page.js |
| `/api/promo/validate` | POST | LOGIKA | app/dashboard/booking/page.js |
| `/api/transaction-items` | GET, POST | CRUD | app/dashboard/laporan/page.js |
| `/api/transactions` | GET, POST | CRUD | app/dashboard/status/page.js, app/dashboard/booking/page.js |
| `/api/transactions/:id` | GET, PATCH | CRUD | app/dashboard/booking/page.js, app/dashboard/riwayat/page.js, app/dashboard/status/page.js |

### C. Dipakai sebagai URL langsung

| Endpoint | Metode | Kategori | Bukti |
|---|---|---|---|
| `/api/auth/resend-verification` | POST | AUTH | app/verifikasi-email/page.js [url] |
| `/api/member/photo` | GET | FILE | app/dashboard/member/page.js [url] |
| `/api/member/upload` | POST | FILE | app/dashboard/member/page.js [url] |
| `/api/telegram/test` | POST | EKSTERNAL | app/dashboard/loginlog/page.js [url], app/dashboard/pengaturan/page.js [url] |

### D. Pembungkus mati — SUDAH DIBUANG 2026-10-28

`api-client.js` mendefinisikan panggilan ini dan `lib/db.js` membungkusnya, tetapi
tidak ada halaman/komponen yang memanggil pembungkus tersebut. Sebelum dibuang,
keempatnya divalidasi ulang dari empat arah: pemanggil di `sewara-backend`,
`sewara-frontend/src`, `sewara-api` (SQL/seed), `.github`, serta akses dinamis
(`api[...]`, nama fungsi sebagai string) — semuanya nol. Route, definisi
`api-client`, dan pembungkus `db.js` dihapus; **tabel DB tidak di-drop** supaya
data lama tetap utuh sampai cutover.

| Endpoint | Metode | Kategori | Bukti |
|---|---|---|---|
| `/api/admin/akun` | GET | ADMIN | — |
| `/api/dashboard/statistik` | GET | AGREGAT | — |
| `/api/inventory-units` | GET, POST | CRUD | — |
| `/api/transaction-payments` | GET, POST | CRUD | — |

- `/api/admin/akun`: db.js:getSemuaAkun() tidak dipanggil siapa pun
- `/api/dashboard/statistik`: db.js:getDashboardStatistik() tidak dipanggil siapa pun
- `/api/inventory-units`: db.js:getInventoryUnits() tidak dipanggil siapa pun; db.js:saveInventoryUnits() tidak dipanggil siapa pun
- `/api/transaction-payments`: db.js:saveTransactionPayments() tidak dipanggil siapa pun

### E. Tidak dirujuk frontend, tetapi dipanggil pihak lain — wajib tetap ada

| Endpoint | Metode | Pemanggil |
|---|---|---|
| `/api/auth/callback` | GET | Tautan verifikasi email: `emailRedirectTo` di `/api/auth/register` |
| `/api/pembayaran/purge` | POST | Cron VPS harian (README backend, `PURGE_SECRET`). Di Go wajib jadi ticker internal, bukan cron OS |
| `/api/telegram/webhook` | POST | Server Telegram |
| `/api/webhooks/payment` | POST | Payment gateway |

### Catatan hasil audit

- Angka ini menggantikan asumsi "61 endpoint tersisa". Yang perlu ada di Go:
  43 path yang dipakai + 4 path yang dipanggil pihak lain = **47 path
  (68 metode)**. Sembilan path di antaranya sudah diport, jadi sisa **38 path
  / 55 metode**. Empat path ber-pembungkus mati tidak perlu diport sama sekali.
- `inventory_units` tidak lagi disentuh kode mana pun setelah route matinya
  dibuang (stok sekarang dihitung dari `inventory.sns`). Tabelnya sengaja
  dibiarkan; drop menyusul setelah cutover.
- Pembayaran **tidak** lewat `/api/transaction-payments` (sudah dibuang);
  `/api/transactions` menyimpannya lewat RPC (`p_payments`, `p_replace_payments`),
  jadi route terpisah itu memang duplikat.
- Masih ada metode mati di dalam route yang tetap hidup. Jangan diport, tapi juga
  jangan dihapus sebelum cutover (masih dipakai sebagai rujukan paritas):
  `DELETE /api/inventory/{id}` (`api.inventory.delete` tak pernah dipanggil; hapus
  inventaris selalu lewat `bulk-delete`), `POST /api/transaction-items`
  (`saveTransactionItems`), `GET /api/logs` dan `DELETE /api/logs`
  (`getLogs`, `deleteLogs`), serta `GET /api/invoice/header` lewat
  `api.invoice.headerGet` (yang dipakai adalah URL langsungnya di komponen).
