# Matriks Endpoint Backend

Sumber: `sewara-backend/app/api/**/route.ts`
Dibuat: 2026-10-27, otomatis dari ekspor route.
Total: **51 file route, 74 endpoint HTTP**.

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
| /api/admin/akun | GET | ADMIN |
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
| /api/dashboard/statistik | GET | AGREGAT |
| /api/inventory | GET, POST | CRUD |
| /api/inventory/:id | PATCH, DELETE | LOGIKA |
| /api/inventory/bulk-delete | POST | CRUD |
| /api/inventory-units | GET, POST | CRUD |
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
| /api/transaction-payments | GET, POST | CRUD |
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

Tersisa 61 endpoint. Deviasi kontrak yang disengaja dicatat di
`rencana-migrasi-go-2026-10-27.md` §17, §22, dan §23.
