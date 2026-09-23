# Sewara Frontend

Frontend dashboard aplikasi rental **Sewara**. Repo ini adalah bagian frontend dari arsitektur split
frontend/backend (lihat `../AUDIT-PEMISAHAN-FRONTEND-BACKEND.md` dan `../sewara-backend`).

Frontend **tidak mengakses database langsung**. Semua data lewat `src/lib/db.js` →
`src/lib/api-client.js` → REST backend `/api/*`. Tidak ada import `@supabase/supabase-js` di `src/`
(aturan keras, lihat `AGENTS.md`).

## Ringkasan

- UI dashboard Sewara: booking, status sewa, inventaris, member, promo, laporan, pengaturan, admin.
- Autentikasi berbasis cookie sesi HttpOnly (bukan token di JS).
- Multi-tenant per Owner; tiap owner punya bisnis & data sendiri, staf (CS/Gudang) bekerja di data bisnis yang sama.
- Guard akses role di sisi klien (`src/lib/role.js`), fail-closed.

## Stack

- **Next.js 16 (App Router)** — `next@16.2.12`, React 19.
- **JavaScript murni** — tanpa TypeScript di source (hanya `next-env.d.ts` + `tsconfig.json` bawaan).
- **Tailwind CSS 3** (`tailwindcss@^3.4.19`, PostCSS + autoprefixer).
- **Supabase JS** — masih ada di `package.json` untuk script verifikasi dev di `scripts/`; runtime app pakai REST backend.
- Library pendukung: `zod`, `use-debounce`, `html2pdf.js` (PDF invoice), `browser-image-compression`,
  `@aws-sdk/client-s3` + `s3-request-presigner` (upload R2).
- Font: Plus Jakarta Sans.

## Struktur direktori

```
src/
├── app/
│   ├── layout.js                 # Root layout (provider notif & tema)
│   ├── page.js                   # Halaman login (/)
│   ├── daftar/page.js            # Registrasi akun
│   ├── verifikasi-email/page.js  # Halaman verifikasi email
│   ├── auth/callback/success/page.js
│   └── dashboard/
│       ├── layout.js             # Guard auth + auto-logout + shell menu
│       ├── page.js               # Dashboard utama
│       └── <fitur>/page.js       # Halaman per fitur (lihat tabel)
├── components/
│   ├── DateTimePicker.jsx        # Date+time picker popover fixed-position
│   ├── DatePicker.jsx            # Picker tanggal saja
│   ├── TimePicker.jsx            # Time picker native
│   ├── BatalBookingModal.jsx     # Modal pembatalan booking
│   ├── InvoiceView.jsx           # Tampilan invoice (cetak/PDF)
│   ├── LoadingOverlay.jsx, PasswordInput.jsx
│   ├── Emoji.js, SearchableSelect.js
│   ├── NotificationProvider.js, ThemeProvider.js
│   └── ui/                       # UI kit internal (BUKAN shadcn)
│       ├── Button.jsx, Modal.jsx, FormField.jsx
│       ├── LoadingSpinner.jsx, EmptyState.jsx, ErrorState.jsx, index.js
├── hooks/
│   └── useTransactions.js
└── lib/
    ├── api-client.js             # SATU-SATUNYA entry point HTTP ke backend
    ├── db.js                     # Data layer (API-backed + sync localStorage)
    ├── utils.js                  # Utilitas format & kalkulasi murni
    ├── role.js                   # Role & hak menu (HAK_MENU)
    ├── features.js               # Feature flags (semua aktif)
    ├── storage.js                # Upload R2 (server-side, env R2_*)
    └── version.js                # Metadata versi & riwayat perubahan
```

**Peran tiap folder:**

- `src/app/` — routing App Router. `dashboard/layout.js` melakukan guard auth (panggil `api.auth.me()`,
  401/!user → redirect `/`), hydrate setting tenant (`initSettings()`), pasang idle auto-logout dari
  `rentalpro_last_activity` + setting `auto_logout_minutes` (default 15 menit).
- `src/components/` — komponen UI reusable, termasuk UI kit internal di `ui/`.
- `src/lib/` — data layer, kalkulasi, role, storage, konfigurasi fitur. `db.js` adalah jembatan
  tunggal ke `api-client.js`.

## Cara jalan lokal

**Prasyarat:** Node.js + backend Sewara (`../sewara-backend`) jalan di port `4000`.

**Install:**

```bash
npm install
```

**Environment** — buat `.env.local` (referensi `.env.production.example`):

| Variabel | Contoh | Keterangan |
|----------|--------|------------|
| `NEXT_PUBLIC_API_URL` | `http://localhost:4000` | Base URL backend REST. **Di-bake saat build** — ubah butuh `npm run build` ulang |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<project>.supabase.co` | Dipakai CSP + img-src di `next.config.mjs` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `...` | Sisa konfigurasi Supabase |
| `OWNER_EMAILS` | `owner@rentalpro.com` | Email owner |
| `PORT` | `3002` | Port frontend (prod) |
| `NODE_ENV` | `production` | |
| `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME` | — | Upload dokumen member (server-side) |

> `next.config.mjs` sudah men-set security header (CSP, X-Frame-Options DENY, dll) dan `connect-src`
> dari `NEXT_PUBLIC_API_URL` + host Supabase.

**Perintah:**

```bash
npm run dev     # dev server via scripts/dev.js (menampilkan semua URL network/Tailscale)
npm run build   # build produksi
npm start       # jalankan hasil build
npm run lint    # eslint
```

`npm run dev` memakai wrapper `scripts/dev.js` yang membungkus `next dev` dan mencetak daftar IP
jaringan (Tailscale/Wi-Fi/LAN) setelah server siap.

## Halaman utama

Hak akses diambil dari `HAK_MENU` di `src/lib/role.js`. Role: `superadmin`, `owner`, `cs`, `gudang`.

| Route | Fungsi | Role yang akses |
|-------|--------|-----------------|
| `/dashboard` | Dashboard utama: statistik, rekap status, ringkasan pembayaran; panel manajemen ekstra untuk superadmin | superadmin, owner, cs, gudang |
| `/dashboard/inventaris` | Katalog produk & stok (produk satuan/bundling, S/N, import/export CSV) | owner, gudang |
| `/dashboard/booking` | Buat booking baru: pilih alat, durasi, member/promo/diskon, DP, printilan | owner, cs |
| `/dashboard/status` | Status sewa (board aktif: Booking/Disewa/Mendekati/Telat/Belum Selesai/Selesai) | owner, cs |
| `/dashboard/riwayat` | Riwayat invoice (transaksi selesai) | owner, cs |
| `/dashboard/tracking` | Tracking alat & S/N | owner, cs, gudang |
| `/dashboard/log` | Log aktivitas | owner, gudang |
| `/dashboard/kalender` | Kalender jadwal sewa | owner, cs |
| `/dashboard/laporan` | Laporan keuangan & laporan alat populer | owner, cs |
| `/dashboard/sdm` | Manajemen karyawan (staf CS/Gudang) | owner |
| `/dashboard/member` | Data member + tipe member (diskon) | owner, cs |
| `/dashboard/pelanggan` | Data pelanggan | owner, cs |
| `/dashboard/promo` | Kode promo | owner, cs |
| `/dashboard/pengaturan` | Pengaturan (tab: invoice, profil, operasional, tampilan, integrasi, pengembangan, diskon, info) | owner, superadmin |
| `/dashboard/loginlog` | Log login | superadmin, owner |
| `/dashboard/manajemen` | Manajemen akun/tenant (superadmin) | superadmin |
| `/dashboard/progres` | Panel progres (superadmin) | superadmin |
| `/dashboard/todo` | To-do list (superadmin) | superadmin |

Halaman non-dashboard:

| Route | Fungsi |
|-------|--------|
| `/` | Login (`api.auth.login()` → cookie sesi → redirect `/dashboard`) |
| `/daftar` | Registrasi akun/bisnis baru |
| `/verifikasi-email` | Halaman verifikasi email |
| `/auth/callback/success` | Halaman sukses verifikasi |

> Guard menu & route: `roleBolehAkses(role, href)` — fail-closed (role kosong/unknown selalu ditolak).

## Sistem settings

Dua lapis:

1. **Lokal (sync)** — `getSetting(key, fallback)` / `setSetting(key, value)` di `src/lib/db.js`,
   baca/tulis `localStorage` key `rentalpro_settings` sebagai objek JSON `{ key: value }`.
   Halaman membaca setting secara sinkron agar bisa dirender langsung.
2. **Tenant (async, backend)** — `getSettingTenant(key, fallback)` / `setSettingTenant(key, value)`
   lewat `api.settings`. `setSetting()` juga mendorong nilai ke backend (fire-and-forget), lalu
   mengirim event `dataChanged`.

**Sinkronisasi saat mount:** `initSettings()` dipanggil sekali di `dashboard/layout.js` (setelah guard),
mengambil semua setting tenant dan menggabungkannya ke `localStorage`. Kalau tenant belum punya setting,
nilai lokal ditanam ke backend. Perubahan memicu event `settingChanged`.

Semua pengaturan digabung di satu halaman `/dashboard/pengaturan` dengan tab:
`invoice` (Invoice & Dokumen), `profil`, `operasional`, `tampilan`, `integrasi` (Integrasi & Notifikasi),
`pengembangan`, `diskon` (Diskon & Promo), `info` (Info Aplikasi).

## Logic penting

### `hitungDiskon` (booking)

Ada di `src/app/dashboard/booking/page.js`. **Diskon dihitung di frontend**; backend hanya menyimpan.
Di-gate feature flag `getFITUR().memberPromo`.

Alur:

1. **Persentase member efektif** (`persentaseMemberEfektif`) — tier diskon durasi
   (`diskon_durasi_aturan` = array `{min_hari, persentase}`) menang bila ada dan `totalJam > 0`.
   Dipilih aturan dengan `totalJam >= min_hari * 24`, ambil `min_hari` terbesar. Bila tidak ada yang
   cocok, fallback ke diskon fixed `diskon_persen`.
2. Member hanya aktif bila `member.status === "aktif"` dan persen > 0.
3. **Promo** valid bila status aktif, belum kadaluarsa, kuota tersisa, dan `biaya >= promo_min_transaksi`.
4. **`diskon_stack`** mengatur cara gabung:
   - `gabung` → `diskonMember + diskonPromo`
   - `satu` → pilih salah satu (member menang kecuali user pilih promo)
   - `terbesar` (default) → `max(diskonMember, diskonPromo)`
5. **Cap** `diskon_maks_persen` (default 50) membatasi total diskon terhadap biaya.
6. **Diskon custom** opsional dihitung di atas dasar setelah diskon (maks 100% untuk tipe `%`).
7. Hasil: `{ diskonMember, diskonPromo, diskonCustom, totalDiskon, biayaAkhir, persenEfektif, sumberDiskon }`.

Setting terkait: `diskon_stack`, `diskon_maks_persen`, `promo_min_transaksi`.

### `hitungDurasi` (utils)

`src/lib/utils.js`:

```js
hitungDurasi(ambil, kembali) // → { hari, sisaJam, totalJam, durasi_teks, error }
```

- `totalJam = Math.ceil(diff / 3600000)` (dibulatkan ke atas per jam)
- `hari = Math.floor(totalJam / 24)`, `sisaJam = totalJam % 24`
- `durasi_teks` mis. `"2 Hari 3 Jam"`
- Error bila salah satu kosong atau `diff <= 0`.

Ada juga `hitungDurasiDenganAturan` yang menyesuaikan waktu ambil efektif berdasarkan aturan
cepat/telat (`aturanCepat === "aktual"` / `aturanTelat === "aktual"`) sebelum memanggil `hitungDurasi`.

### DateTimePicker

`src/components/DateTimePicker.jsx` — picker tanggal + jam dengan popover.

- Popover diposisikan **fixed** (koordinat viewport) dengan flip otomatis ke atas bila ruang bawah
  kurang dari tinggi panel (`PANEL_H`/`PANEL_H_DATE_ONLY`), dan clamp horizontal agar tidak keluar layar.
- Panel berada di luar wrapper DOM trigger; click-outside memeriksa keduanya (`ref` + `panelRef`),
  plus tombol `Escape` untuk tutup.
- Grid time-chip per slot (jam/menit), auto-scroll ke slot terpilih saat dibuka.
- Props: `value`, `onChange`, `placeholder`, `minDate`, `filterTime` (menonaktifkan slot tertentu),
  `showTime` (mode tanggal saja), `className`.
- `TimePicker.jsx` adalah time input native terpisah; `DatePicker.jsx` versi tanggal saja.

> Catatan: `DateTimePicker` sudah punya marker `ponytail:` di kode (ukuran panel & scroll rect-based)
> — jangan diubah tanpa alasan; upgrade path tercatat di komentar kode.

## Deploy

Target: **VPS + PM2**, proses PM2 `sewara-frontend`, domain `https://app.sewara.my.id`,
repo `https://github.com/Rzp1010/sewara-split.git` (branch `main`).

Pola deploy (frontend + backend dalam satu VPS, Nginx reverse proxy same-origin):

1. Di server: `git pull`
2. `npm install`
3. `npm run build` (di sini `NEXT_PUBLIC_API_URL` di-bake — set ke `https://app.sewara.my.id`)
4. `pm2 reload` / `pm2 restart sewara-frontend`

Catatan:

- `next.config.mjs` menonaktifkan `output: "standalone"` — proses PM2 memakai `node_modules` langsung
  (bukan bundle standalone).
- Nginx meneruskan `/api/` ke backend dan `/` ke frontend pada domain yang sama; cookie sesi HttpOnly
  bekerja karena same-origin.
- Backend terpisah ada di folder `../sewara-backend`.

---

Versi aplikasi didokumentasikan di `src/lib/version.js` (`VERSI_APLIKASI`, saat ini `alfa v0.1.5`).
