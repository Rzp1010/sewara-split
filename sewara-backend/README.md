# sewara-backend

Backend API untuk aplikasi rental **Sewara**. Dibangun dengan **Next.js App Router** (route handler di `app/api/`), berjalan di Node.js runtime, dan memakai **Supabase** sebagai database + auth. Backend ini **hanya menyediakan API** — UI/frontend ada di project terpisah.

- Supabase project: `obhvrzholszhjnpvmnna`
- Domain produksi: `https://app.sewara.my.id`
- Repo: `https://github.com/Rzp1010/sewara-split.git` (branch `main`)
- Deploy: VPS + PM2 (lihat bagian [Deploy](#deploy))

---

## Struktur direktori

```
sewara-backend/
├── app/
│   └── api/                 # Semua route handler (endpoint HTTP)
│       ├── auth/            # login, logout, register, me, callback, resend-verification
│       ├── admin/           # endpoint superadmin (akun, users, logs, data)
│       ├── inventory/       # CRUD inventory + [id] + bulk-delete
│       ├── inventory-units/ # unit S/N per inventory
│       ├── transactions/    # CRUD transaksi + [id]
│       ├── transaction-items/    # item per transaksi
│       ├── transaction-payments/ # pembayaran per transaksi
│       ├── members/         # member + [id]
│       ├── member/          # upload & photo (dokumen member di R2)
│       ├── member-types/    # template tipe member + [id]
│       ├── promo/           # promo code + [id] + validate + use
│       ├── dashboard/       # ringkasan + statistik + manajemen
│       ├── settings/        # setting per tenant
│       ├── logs/            # activity log + logs/login
│       ├── telegram/        # webhook & test notifikasi Telegram
│       ├── invoice-counter/ # nomor invoice berikutnya
│       ├── profiles/        # list profile
│       ├── webhooks/        # webhook payment provider (skeleton)
│       ├── check-inventory/ # debug/diagnostik inventory
│       ├── test-atomic/     # test integrasi RPC saveTransactionAtomic (non-prod)
│       └── test-rpc/        # test RPC save_transaction_atomic (non-prod)
├── lib/
│   ├── api/                 # helper API bersama
│   │   ├── supabase.ts      # factory client Supabase (server/service/anon)
│   │   ├── auth.ts          # requireAuth, requireRole, requireActiveProfile, dll
│   │   ├── tenant.ts        # resolusi tenant (getTenantId, withTenant)
│   │   ├── response.ts      # successResponse, errorResponse, dll
│   │   ├── errors.ts        # withErrorHandler + ApiError classes
│   │   ├── validation.ts    # skema Zod + parseAndValidate
│   │   ├── rate-limit.ts    # rate limit (Upstash Redis, fallback in-memory)
│   │   ├── login-lockout.ts / login-rate-limit.ts / login-logging.ts
│   │   ├── webhook-security.ts # verifikasi secret webhook
│   │   └── constants.ts     # ERROR_CODES, dll
│   ├── services/            # telegram, audit, admin-user
│   ├── db/                  # service transaksi atomic + mapper
│   └── storage.ts           # helper Cloudflare R2 (upload berkas member)
├── supabase/
│   └── migrations/          # file migrasi SQL (dijalankan manual)
├── proxy.ts                 # CORS untuk dev (pengganti middleware Next.js 16)
├── next.config.ts           # konfigurasi Next.js
├── package.json             # script & dependency
├── .env.example             # contoh env untuk dev
└── .env.production.example  # contoh env untuk produksi
```

Catatan: hampir semua route diberi `// @ts-nocheck` — project ini campuran JS/TS dan tidak mengandalkan strict type checking di layer route.

---

## Cara jalan lokal

Prasyarat: Node.js (versi yang mendukung Next.js 16) dan npm.

1. Install dependency:

   ```bash
   npm install
   ```

2. Siapkan env. Copy `.env.example` menjadi `.env.local`, lalu isi nilainya:

   ```bash
   copy .env.example .env.local
   ```

3. Jalankan dev server:

   ```bash
   npm run dev
   ```

   Backend jalan di `http://localhost:4000`.

Perintah lain:

| Perintah | Fungsi |
|---|---|
| `npm run dev` | Dev server di port 4000 (`next dev -p 4000`) |
| `npm run build` | Build produksi (`next build`) |
| `npm start` | Jalankan build produksi di port 4000 (`next start -p 4000`) |
| `npm run lint` | ESLint |

### Variabel environment

Dari `.env.example` (dev):

| Variabel | Wajib | Keterangan |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | ya | URL project Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ya | Anon key Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | ya | Service role key (bypass RLS, dipakai operasi admin) |
| `FRONTEND_URL` | ya | Origin frontend (CORS + redirect verifikasi email) |
| `WEBHOOK_TELEGRAM_SECRET` | opsional | Secret verifikasi webhook Telegram |
| `NODE_ENV` | ya | `development` / `production` |

Tambahan dari `.env.production.example`:

| Variabel | Wajib | Keterangan |
|---|---|---|
| `OWNER_EMAILS` | opsional | Daftar email owner (comma-separated) |
| `PURGE_SECRET` | untuk purge | Secret header `x-purge-secret` untuk `POST /api/pembayaran/purge` (dipanggil cron VPS) |
| `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME` | untuk upload | Kredensial Cloudflare R2 (foto/dokumen member) |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | opsional | Notifikasi Telegram |
| `PORT` | ya (produksi) | Port backend, harus sama dengan target `proxy_pass` Nginx |

Variabel lain yang dibaca kode tetapi tidak ada di file contoh: `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` (rate limit), `INVOICE_MULAI`, `NEXT_PUBLIC_SITE_URL` / `APP_URL` (redirect verifikasi fallback), dan kredensial payment provider (`MIDTRANS_SERVER_KEY`, `XENDIT_WEBHOOK_TOKEN`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`) untuk skeleton webhook.

---

## API routes

Format response standar: sukses `{ ok: true, data: {...} }`, error `{ ok: false, error: { code, message } }`. Auth dilakukan lewat cookie session Supabase; kolom "Auth" di bawah menunjukkan apakah route memanggil `requireAuth`/cek user.

### Auth

| Method | Path | Auth | Fungsi |
|---|---|---|---|
| POST | `/api/auth/login` | publik | Login (validasi, lockout, rate limit, log, notif Telegram) |
| POST | `/api/auth/logout` | requireAuth | Logout + catat ke `login_logs` |
| POST | `/api/auth/register` | publik | Pendaftaran owner baru (rate limit per-IP) |
| GET | `/api/auth/me` | sesi | Cek session + ambil profile user |
| GET | `/api/auth/callback` | publik | Callback verifikasi email dari Supabase → redirect ke frontend |
| POST | `/api/auth/resend-verification` | publik | Kirim ulang email verifikasi (rate limit) |

### Inventory

| Method | Path | Auth | Fungsi |
|---|---|---|---|
| GET | `/api/inventory` | requireAuth | List inventory (filter `ids`, `kolom`, `ringkas`) |
| POST | `/api/inventory` | requireAuth | Tambah inventory |
| PATCH | `/api/inventory/[id]` | requireAuth | Update inventory milik tenant |
| DELETE | `/api/inventory/[id]` | requireAuth | Hapus inventory milik tenant |
| POST | `/api/inventory/bulk-delete` | requireAuth | Hapus banyak inventory (preflight FK ke `transaction_items`) |
| GET | `/api/inventory-units` | requireAuth | List unit S/N per `inventory_id` |
| POST | `/api/inventory-units` | requireAuth | Replace unit S/N satu inventory |

### Transaksi

| Method | Path | Auth | Fungsi |
|---|---|---|---|
| GET | `/api/transactions` | requireAuth | List transaksi (preset kolom, filter, nested items+payments) |
| POST | `/api/transactions` | requireAuth | Simpan transaksi atomic via RPC |
| GET | `/api/transactions/[id]` | requireAuth | Ambil satu transaksi + items + payments |
| PATCH | `/api/transactions/[id]` | requireAuth | Update transaksi (child table difilter keluar) |
| GET | `/api/transaction-items` | requireAuth | List item satu transaksi |
| POST | `/api/transaction-items` | requireAuth | Replace item satu transaksi |
| GET | `/api/transaction-payments` | requireAuth | List pembayaran satu transaksi |
| POST | `/api/transaction-payments` | requireAuth | Replace pembayaran satu transaksi |
| POST | `/api/invoice-counter` | requireAuth | Ambil nomor invoice berikutnya (`PREFIX-NNNNNN`) |

### Member

| Method | Path | Auth | Fungsi |
|---|---|---|---|
| GET | `/api/members` | requireAuth | List member + `tipeNama`, `diskon_persen`, `diskon_durasi_aturan` dari tipe-nya |
| POST | `/api/members` | requireAuth | Tambah member |
| PATCH | `/api/members/[id]` | requireAuth | Update member milik tenant |
| DELETE | `/api/members/[id]` | requireAuth | Hapus member milik tenant |
| GET | `/api/member-types` | requireAuth | List template tipe member |
| POST | `/api/member-types` | requireAuth | Tambah tipe member (body pass-through, termasuk `diskon_durasi_aturan`) |
| PATCH | `/api/member-types/[id]` | requireAuth | Update tipe member |
| DELETE | `/api/member-types/[id]` | requireAuth | Hapus tipe member |
| GET | `/api/member/photo` | requireAuth | Generate signed URL dokumen member dari R2 |
| POST | `/api/member/upload` | requireAuth | Upload dokumen/foto member ke R2 |

### Pembayaran (Foto Bukti)

| Method | Path | Auth | Fungsi |
|---|---|---|---|
| POST | `/api/pembayaran/upload` | requireAuth | Upload foto bukti bayar transaksi ke R2 (multipart: `file`, `transaksiId`; JPG/PNG/WebP maks 5 MB) |
| GET | `/api/pembayaran/photo` | requireAuth | Generate signed URL bukti bayar (`?path=`) |
| GET | `/api/pembayaran/export` | requireAuth | ZIP semua bukti bayar satu bulan (`?bulan=YYYY-MM`) |
| POST | `/api/pembayaran/purge` | header secret | Purge bukti bayar lebih tua dari 2 bulan (dipanggil cron VPS, `x-purge-secret`) |

Catatan purge: retensi bukti bayar **tidak** memakai lifecycle R2 — dilakukan lewat route purge. Set env `PURGE_SECRET` di `.env` backend produksi, lalu tambah crontab di VPS (sesuaikan port backend lokal VPS, contoh 3001):

```cron
0 3 15 * * curl -s -X POST -H "x-purge-secret: <isi PURGE_SECRET>" http://localhost:3001/api/pembayaran/purge
```

### Promo

| Method | Path | Auth | Fungsi |
|---|---|---|---|
| GET | `/api/promo` | requireAuth | List promo tenant (auto-tandai yang kedaluwarsa) |
| POST | `/api/promo` | requireAuth | Tambah promo code |
| PATCH | `/api/promo/[id]` | requireAuth | Update promo |
| DELETE | `/api/promo/[id]` | requireAuth | Hapus promo |
| POST | `/api/promo/validate` | requireAuth | Validasi promo (balas `{ valid, promo?, error? }`) |
| POST | `/api/promo/use` | requireAuth | Naikkan counter terpakai (guard concurrency) |

### Dashboard

| Method | Path | Auth | Fungsi |
|---|---|---|---|
| GET | `/api/dashboard` | requireAuth | Rekap status + pembayaran (RPC), rentang opsional |
| GET | `/api/dashboard/statistik` | requireAuth | Angka ringkas (barang, transaksi aktif/selesai, pendapatan) |
| GET | `/api/dashboard/manajemen` | requireAuth | Ringkasan akun (owner/staf aktif–nonaktif) |

### Admin (superadmin)

| Method | Path | Auth | Fungsi |
|---|---|---|---|
| GET | `/api/admin/akun` | requireAuth | Daftar semua akun |
| GET | `/api/admin/users` | requireAuth | List user (agregat staf per owner) |
| POST | `/api/admin/users` | requireAuth | Buat user |
| PATCH | `/api/admin/users` | requireAuth | Edit user (superadmin/owner sesuai izin) |
| DELETE | `/api/admin/users` | requireAuth | Hapus user (superadmin/owner sesuai izin) |
| GET | `/api/admin/logs` | requireAuth | Log aksi admin |
| POST | `/api/admin/data` | sesi + role | Hapus seluruh data tenant (khusus owner/superadmin) |

### Settings & Log

| Method | Path | Auth | Fungsi |
|---|---|---|---|
| GET | `/api/settings` | requireAuth | Ambil setting tenant (opsional `?key=`) |
| POST | `/api/settings` | requireAuth | Upsert setting tenant |
| GET | `/api/profiles` | requireAuth | List profile (opsional filter `?email=`) |
| GET | `/api/logs` | requireAuth | List activity log (range tanggal, paging) |
| POST | `/api/logs` | requireAuth | Insert activity log |
| DELETE | `/api/logs` | requireAuth | Hapus activity log |
| GET | `/api/logs/login` | requireAuth | Log login (superadmin: semua; owner: miliknya) |

### Telegram & Webhook

| Method | Path | Auth | Fungsi |
|---|---|---|---|
| POST | `/api/telegram/webhook` | secret | Terima webhook DB → kirim notif ke Telegram (transaksi/pendaftaran) |
| POST | `/api/telegram/test` | requireAuth | Kirim test message Telegram (superadmin) |
| POST | `/api/webhooks/payment` | publik (skeleton) | Webhook payment provider (Midtrans/Xendit/Stripe) — belum diimplementasi penuh |

### Debug / diagnostik (non-produksi)

| Method | Path | Auth | Fungsi |
|---|---|---|---|
| GET | `/api/check-inventory` | sesi | Diagnostik koneksi & inventory (balas 404 di produksi) |
| GET | `/api/test-rpc` | sesi | Test RPC `save_transaction_atomic` (balas 404 di produksi) |
| GET | `/api/test-atomic` | sesi | Test integrasi `saveTransactionAtomic` (balas 404 di produksi) |

---

## Database & migrasi

- Database: Supabase project `obhvrzholszhjnpvmnna`.
- File migrasi ada di `supabase/migrations/`, penamaan `YYYYMMDD_nama.sql` (mis. `20260923_member_diskon_durasi.sql`). Sebagian file lama memakai prefix `phaseN_` / nama bebas.
- **Migrasi dijalankan MANUAL oleh user** lewat Supabase SQL Editor — tidak otomatis saat deploy. Tidak ada tool migrasi otomatis di repo ini.

Alur kerja:

1. Tambah file baru di `supabase/migrations/` dengan nama `YYYYMMDD_nama.sql`.
2. Buka Supabase SQL Editor, jalankan isi file tersebut.
3. Verifikasi kolom/tabel/RPC sesuai kebutuhan.

Kolom terbaru yang relevan: `member_types.diskon_durasi_aturan` (JSONB, default `[]`) dari migrasi `20260923_member_diskon_durasi.sql`. Isinya array aturan diskon durasi `[{min_hari, persentase}]`; array kosong berarti tipe itu fallback ke `diskon_persen` fixed lama. Kolom ini diekspos di `GET /api/members`. Backend tidak menghitung diskon — hanya menyimpan/menyampaikan apa yang dikirim frontend.

---

## Deploy

Target VPS: `ubuntu@<IP_VPS>` (lihat catatan internal deploy), path aplikasi `~/sewara-apps-production/sewara-split/`, proses PM2 bernama `sewara-backend`, domain `https://app.sewara.my.id`.

Alur umum:

1. Masuk ke VPS dan ke folder backend:
   ```bash
    ssh ubuntu@<IP_VPS>
   cd ~/sewara-apps-production/sewara-split/sewara-backend
   ```
2. Tarik kode terbaru dari branch `main`.
3. Pastikan `.env` produksi terisi (lihat `.env.production.example`).
4. Install + build:
   ```bash
   npm install
   npm run build
   ```
5. Restart proses PM2:
   ```bash
   pm2 restart sewara-backend
   ```
6. Cek status/log: `pm2 status`, `pm2 logs sewara-backend`.

Nginx jadi reverse proxy dari domain ke port backend (`PORT=4000`). Webhook/notifikasi butuh header yang benar agar `secure` cookie dan deteksi `x-forwarded-proto` bekerja.

> **Penting:** setting `proxy_buffer 32k` ada di konfigurasi Nginx **di server**, BUKAN di repo ini. Kalau server di-rebuild/dibuat ulang, setting itu berisiko hilang dan harus dipasang ulang manual di Nginx agar request besar tidak error.

---

## Catatan penting

- **Pola response:** gunakan `successResponse({ key: data })` untuk sukses dan `errorResponse(...)` untuk error. Bungkus handler dengan `withErrorHandler` agar error konsisten.
- **Autentikasi:** `requireAuth(supabase)` untuk user login; helper peran/ownership lain ada di `lib/api/auth.ts`.
- **Multi-tenant (RLS):** baris data milik owner (`owner_id`), staf mengikuti tenant owner-nya. Frontend tidak mengirim `user_id`; resolusi tenant dilakukan backend lewat `getTenantId` / `withTenant` supaya tidak bisa dipalsukan client.
- **Backend tidak menghitung diskon** (termasuk diskon durasi). Perhitungan diskon dilakukan di frontend; backend hanya menyimpan dan mengembalikan nilai.
- Route debug (`check-inventory`, `test-rpc`, `test-atomic`) mengembalikan 404 saat `NODE_ENV=production`.
