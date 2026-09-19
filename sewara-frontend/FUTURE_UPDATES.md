# Future Updates — Sewara

Daftar fitur yang direncanakan untuk update mendatang.

---

## 1. Multi Cabang
**Status:** Dijeda — high risk, butuh ubah arsitektur fundamental
**Difficulty:** Tinggi (~30 jam)

Satu akun Owner bisa mengelola beberapa cabang bisnis rental. Setiap cabang punya inventori dan operasional terpisah, tapi data pelanggan shared. Staff (Supervisor, CS, Gudang) di-assign per cabang. Owner bisa lihat laporan per cabang atau gabungan.

Perubahan besar: RLS isolasi bergeser dari `user_id` ke `branch_id`. Semua modul terpengaruh.

Detail lengkap: `sewara-multi-cabang.md`

---

## 2. Data Pelanggan Detail + Foto Jaminan (R2 + SSE-C)
**Status:** Planning
**Difficulty:** Sedang (~8-9 jam)

Extend data member dengan HP, email, alamat, catatan, dan upload foto jaminan (KTP/SIM/dokumen). Foto disimpan di Cloudflare R2 dengan enkripsi SSE-C (customer-managed key). Signed URL expired 1 jam. Client-side image compression sebelum upload.

Detail lengkap: `FITUR_BARU.md` (Fitur #1)

---

## 3. Integrasi Payment Gateway
**Status:** Ditunda sampai rilis resmi
**Difficulty:** Sedang (~6-8 jam)

Integrasi pembayaran langganan otomatis. Provider belum dipilih (Midtrans/Xendit/Stripe). Webhook handler, signature verification, auto-renewal, upgrade/downgrade subscription. Infrastruktur tabel SaaS disiapkan di Phase 9, tapi payment gateway belum di-connect.

---

## 4. Laporan Gabungan Multi Cabang
**Status:** Menunggu fitur Multi Cabang
**Difficulty:** Sedang

Agregasi data semua cabang untuk Owner. Filter laporan per cabang atau gabungan. Export per cabang atau total. Bergantung pada fitur Multi Cabang (#1).

---

## 5. Audit Logging Foto
**Status:** Optional
**Difficulty:** Rendah (~1-2 jam)

Track siapa yang upload/view/delete foto jaminan pelanggan. Tabel `photo_access_logs` dengan IP address dan user agent. Berguna untuk forensic trail dan compliance.

---

## 6. Server-Side Filter & Pagination
**Status:** Backlog
**Difficulty:** Sedang

Saat data transaksi > 1000 rows, pindahkan filter/sort dari client-side ke server-side (Supabase query). Tambah cursor-based pagination. Saat ini client-side filter cukup untuk skala kecil.

---

## 7. Retensi Otomatis Log
**Status:** Backlog
**Difficulty:** Rendah (~1 jam)

Scheduled cleanup untuk log lama:
- `login_logs`: hapus setelah 30 hari
- `activity_logs`: hapus setelah 90 hari
- `admin_logs`: hapus setelah 180 hari

Bisa pakai `pg_cron` atau Supabase Edge Function terjadwal.

---

## 8. Verifikasi Email — Link Aktivasi → Kode Verifikasi
**Status:** Tahap 1 selesai dan production verified — link aktivasi aktif; kode 6 digit belum dikerjakan
**Difficulty:** Sedang

Tambahkan verifikasi email pada pendaftaran akun Sewara. Tahap awal memakai link aktivasi email. Tahap berikutnya dapat dipindah ke kode verifikasi 6 digit tanpa mengubah kontrak alur auth aplikasi.

### Tahap 1 — Link Aktivasi Email
**Alur:**
1. User mengisi form `/daftar`.
2. Sistem membuat akun dengan email belum terverifikasi.
3. Sistem mengirim link verifikasi ke email user.
4. User klik link dan diarahkan ke callback aplikasi.
5. Sistem menandai email sudah terverifikasi.
6. Akun tetap berstatus `menunggu` sampai disetujui superadmin.
7. Setelah approval, user dapat login.

**Aturan:**
- Verifikasi email tidak sama dengan approval akun.
- Login ditolak jika email belum terverifikasi.
- Link memiliki expiry dan hanya bisa digunakan sesuai token valid.
- Tambahkan resend verification dengan rate-limit.
- Gunakan SMTP custom saat siap produksi, bukan bergantung pada limit email bawaan provider.

**Rencana teknis:**
- Hapus `email_confirm: true` dari proses register.
- Konfigurasi email confirmation dan redirect URL.
- Tambah route callback auth.
- Tambah status/error UI: belum terverifikasi, link expired, resend berhasil/gagal.
- Pisahkan kontrak internal `sendVerificationLink()` dan `verifyEmail()` dari detail provider.
- Uji alur: daftar → email masuk → klik link → login masih pending → approve → login berhasil.

**Email delivery:**
- Provider awal: **Resend**.
- Sender produksi: `Sewara <accounts@sewara.id>` (atau domain Sewara yang sudah diverifikasi).
- Konfigurasi disimpan di environment, bukan source code:
  - `EMAIL_PROVIDER=resend`
  - `RESEND_API_KEY` (secret)
  - `EMAIL_FROM=accounts@sewara.id`
- Verifikasi domain Resend melalui DNS: SPF, DKIM, dan DMARC.
- Email provider dibuat sebagai abstraction agar nanti dapat dipindah ke Amazon SES/Postmark tanpa mengubah alur auth.
- Jangan memakai alamat/domain Supabase sebagai sender produksi.
- Tambahkan logging status kirim tanpa mencatat API key atau token verifikasi.
- Siapkan fallback/error handling jika Resend gagal; kegagalan kirim tidak boleh membocorkan apakah email terdaftar.
- Tambahkan rate-limit untuk resend dan cegah spam email.

### Tahap 2 — Kode Verifikasi 6 Digit (masa depan)
- Ganti atau tambahkan opsi kode 6 digit.
- Kode disimpan dalam bentuk hash, bukan plaintext.
- Expiry, misalnya 10 menit.
- Batas percobaan dan rate-limit resend.
- Kode lama di-invalidate saat kode baru dikirim.
- Gunakan untuk daftar, reset password, ganti email, perangkat baru, dan aksi sensitif.

**Keputusan arsitektur:** mulai dari link, tetapi isolasikan provider di balik kontrak internal agar migrasi ke kode tidak merombak seluruh auth.

---

## 9. Migrasi Auth — Lepas Supabase Auth
**Status:** Long-term (eksekusi saat user sudah mulai banyak)
**Difficulty:** Tinggi (~20-30 jam)

Pindah dari Supabase Auth ke auth yang dihandle langsung oleh aplikasi, supaya tidak terkunci ke satu provider. Strategi vendor-agnostic (storage sudah pindah ke Cloudflare R2, auth = fase berikutnya).

**Provider yang direkomendasikan:**
- **Better Auth** — credentials-first, session database, multi-tenant plugin, self-hosted. Rekomendasi utama.
- **Custom auth manual** — bcrypt/argon2 + opaque session cookie. Kontrol penuh, dependency minimal. Alternatif jika mau zero-dependency.

**Audit dependency saat ini (29 Agustus 2026):**
- 22 call sites `getSession()`/`getUser()` di 12 file dashboard (client-side)
- 9 route files server-side auth check
- 4 admin auth API sites (`createUser`/`deleteUser`/`updateUser`)
- 7 route + proxy pakai cookie `sb-*-auth-token`
- 15+ file SQL migrasi pakai `auth.uid()`/`auth.jwt()` (RLS tenant isolation)
- 7 route groups pakai service role

**Yang harus diganti:**
1. Login/Register/Logout — 3 route (`signInWithPassword`, `createUser`, `signOut`)
2. Session cookie — pola `sb-*-auth-token` di proxy + 7 route → cookie custom
3. Client session — 12 halaman dashboard baca `getSession()`/`getUser()` → provider baru
4. Admin user lifecycle — `admin.auth.admin.*` → tabel `users` sendiri + bcrypt/argon2
5. RLS — **paling berat**: 15+ file SQL pakai `auth.uid()`. Opsi: (a) server-side authorization + filter tenant_id manual, (b) JWT kompatibel Supabase, (c) set DB context per-request
6. Proxy guard — `src/proxy.js` cek cookie name `sb-*` → pola cookie baru

**Strategi migrasi:**
1. Tambah tabel `users` + `sessions` sendiri
2. Migrasi data dari `auth.users` → `users` baru
3. Dual-auth sementara (lama + baru jalan bareng)
4. Ganti route satu per satu
5. Ganti RLS → server-side authorization
6. Matikan Supabase Auth setelah semua pindah

---

## 10. MinIO Self-Hosted (Migrasi dari R2)
**Status:** Long-term
**Difficulty:** Rendah (kode sama, ganti endpoint saja)

Saat sudah punya VPS sendiri, migrasi storage dari Cloudflare R2 ke MinIO self-hosted. Kode tidak berubah karena sama-sama S3-compatible API. Tinggal ganti endpoint di `.env`.

---

## 10. Notifikasi Real-Time (WebSocket/Realtime)
**Status:** Backlog
**Difficulty:** Sedang

Notifikasi real-time saat ada booking baru, barang dikembalikan, atau pembayaran masuk. Bisa pakai Supabase Realtime (sudah termasuk). Saat ini pakai Telegram bot untuk notifikasi.

---

## 11. Mobile App (PWA / React Native)
**Status:** Long-term
**Difficulty:** Tinggi

Versi mobile native atau PWA untuk akses cepat dari HP. Prioritas rendah karena web app sudah responsive.

---

## Prioritas Implementasi

| Prioritas | Fitur |
|---|---|
| Phase 9 (sekarang) | SaaS infrastructure, Role & Permission |
| Setelah rilis | Payment Gateway (#3) |
| Setelah tester online | Data Pelanggan Detail (#2) |
| Future | Multi Cabang (#1), Laporan Gabungan (#4) |
| Backlog | Audit Log (#5), Pagination (#6), Retensi (#7), Realtime (#10) |
| Long-term | Migrasi Auth (#8), MinIO (#9), Mobile App (#11) |
