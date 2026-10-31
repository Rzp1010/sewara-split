# Rencana cutover Sewara: Next+Supabase → Go+Postgres (self-hosted)

Status: **rencana**. Jadwal yang disepakati: **Go masuk saat launching, Januari 2027**;
sepanjang 2026 produksi tetap dilayani Next+Supabase sementara Go dimatangkan
paralel.

Tujuan: saat launching, layanan berpindah ke Go+Postgres di VPS yang sama tanpa
kehilangan data, dengan jalur rollback yang jelas — dan sampai hari itu, **tidak
ada satu pun perubahan yang menyentuh produksi**.

---

## 0. Dua jalur paralel (Okt 2026 → Jan 2027)

```
SEKARANG (produksi)                      PARALEL (pematangan, tanpa trafik)
Next + Supabase                          Go + Postgres self-hosted
  sewara-backend/  (main)                  sewara-api/  (dev)
  sewara-frontend/ (main)                  staging: Docker di homelab (terpasang 2026-10-31)
  VPS: pm2, /home/sewara-apps-production   VPS: Docker, /srv/sewara (belum dipasang)
```

Tidak ada penyalinan direktori yang diperlukan: pemisahan sudah nyata di dalam
repo (folder berbeda + cabang rilis berbeda + stack VPS berbeda). Salinan justru
melahirkan dua sumber kebenaran (fix dikerjakan dua kali, dokumen bercabang).

Tonggak waktu:

| Kapan | Yang dikerjakan |
|---|---|
| Okt–Nov 2026 | Pematangan Go: drift skema dicerminkan (§4), jalur belum terbukti diuji (§6 langkah 5), drill bulanan mulai |
| Des 2026 | Bekukan penambahan endpoint baru di Next (boleh fix bug, tidak boleh fitur endpoint baru) kalau jendela Januari dipertahankan; siapkan Fase 0 |
| Awal Jan 2027 | Jendela produksi sekali (Fase 2), lalu Fase 3, lalu Fase 4 |

Yang **wajib** dijaga berdampingan selama 2026 bukan folder, melainkan **skema DB**
(§4) dan kesiapan jalur yang belum terbukti (§6 langkah 5).

---

## 1. Keputusan yang sudah diambil

| Topik | Keputusan | Alasan |
|---|---|---|
| Letak kode | **Satu repo** (`sewara-split`), `sewara-api/` tetap di dalamnya | Pemisahan sudah nyata (folder + stack VPS sendiri); repo kedua = dua sinkronisasi yang harus dijaga |
| Cabang | `dev` = pengembangan (Next **dan** Go). `main` = **terminal Next**. Go dirilis dari `dev` juga — tidak ada cabang `go-prod` | Satu cabang pengembangan; yang memisahkan Go dan Next adalah folder + stack VPS, bukan cabang. Rilis Go ke VPS belum pernah terjadi (menunggu Januari) |
| Direktori VPS | Next: `/home/sewara-apps-production/sewara-split` (pm2). Go: `/srv/sewara/app` + `/srv/sewara/pgdata` + `/etc/sewara/*` (Docker) | Dua stack tidak berbagi berkas; `git pull` salah satu tidak mengganggu yang lain |
| Cara rilis | Next: `git pull` → `npm run build` → `pm2 restart`. Go: `scripts/deploy-vps.sh` (pull → build → up → uji sehat → rollback otomatis) | Terbukti di homelab 2026-10-30 |
| Pemindahan data | **Satu jendela** (API + data bersamaan), didahului latihan kering | Lihat §3 |

---

## 2. Struktur kode dan aturan cabang

```
sewara-split/
  sewara-backend/    Next backend   -> rilis dari `main`, pm2 di VPS
  sewara-frontend/   Next frontend  -> rilis dari `main` (nanti static export)
  sewara-api/        Go backend     -> rilis dari `dev`, Docker di VPS
  deploy/            systemd, nginx
  docs/              runbook, checklist, rencana ini
```

Aturan yang mengikat:

1. Perubahan kode Go tidak boleh menyentuh `sewara-backend/`/`sewara-frontend/`
   kecuali diminta eksplisit (dan sebaliknya) — supaya rilis Go tidak membawa
   perubahan Next yang belum diuji.
2. Rilis Go: di VPS metode `/srv/sewara/app` pada branch `dev`
   (`SEWARA_BRANCH=dev` di `sewara-api/.env`, diisi `install.sh`), lalu
   `./sewara-api/scripts/deploy-vps.sh`. Skrip itu menarik `dev`, jadi commit yang
   belum lolos uji jangan di-push ke `dev`.
3. Rilis Next: pola lama tetap berlaku (`dev` → `main`, `main` = terminal).
4. Migrasi DB terpisah dan **tidak pernah** tercampur:
   - `sewara-backend/supabase/migrations/` → Supabase (ledger `schema_migrations`)
   - `sewara-api/bootstrap/` + `sewara-api/migrations/` → Postgres self-hosted
     (ledger diisi runner; jangan tulis INSERT di berkas migrasi Go)
5. `sewara-api/` tidak pernah ikut build Next (dicek: `.dockerignore` dan
   `next.config.mjs` tidak menyapu folder itu).

---

## 3. Kenapa satu jendela (dan bukan bertahap per-path)

Diperiksa di kode, tiga hal ini menutup jalur bertahap:

1. **Frontend murni pemanggil API** (`sewara-frontend/src/lib/db.js:5-6`,
   `src/lib/api-client.js:1`). Dasar alamat API **relatif** sejak 2026-10-31
   (`NEXT_PUBLIC_API_URL || ''`), jadi bundel memanggil origin yang sama — cocok
   untuk nginx per-path, dan ganti domain/IP tidak menuntut bangun ulang. Supabase
   dipakai frontend hanya untuk `preconnect` (`src/app/layout.js:33`). Artinya
   begitu `/api/` dialihkan ke Go, halaman lama tetap jalan tanpa diubah.
2. **Jembatan "Go memakai DB Supabase" mustahil tanpa perubahan kode**: Go
   menulis langsung ke `auth.users` dan `auth.sessions`
   (`internal/db/login.go:33`, `session.go:23,37`, `admin_users.go:58`).
   Supabase sudah memakai `auth.sessions` untuk GoTrue dengan bentuk kolom
   berbeda → bentrok nama tabel; bentuk `auth.users` juga berbeda.
3. **Sesi tidak bisa dicampur**: cookie sesi Go ≠ cookie sesi Supabase. Kalau
   sebagian path dilayani Go dan sebagian Next, satu pengguna butuh dua sesi.
   Jadi pemisahan per-path hanya masuk akal untuk endpoint tanpa auth
   (`/api/health`, proxy gambar) — bukan untuk CRUD.

Karena itu: **API + data pindah dalam satu jendela**, dan risiko dipindahkan ke
latihan kering memakai data produksi nyata (§5). Halaman tetap disajikan Next
sampai Fase 3, jadi yang berubah di jendela cuma `location /api/` dan `DATABASE_URL`.

Yang membuat rollback murah: stack Next **tetap hidup** (pm2 tidak dimatikan),
hanya `location /api/` yang diarahkan kembali. Tulisan yang terjadi setelah flip
ada hanya di DB baru dan **hilang** saat rollback — karena itu jendela dibuat
singkat, di luar jam kerja, dan dump akhir diambil tepat sebelum flip.

---

## 4. Cermin skema Supabase ↔ Go (wajib dijaga sepanjang 2026)

Drift skema adalah risiko terbesar dari pengembangan paralel. Angka per 31 Okt 2026:

| Sumber | Isi |
|---|---|
| `sewara-backend/supabase/migrations/` | **47 berkas** dan terus bertambah sampai Januari |
| `sewara-api/bootstrap/` + `migrations/` | baseline snapshot **30 Sep 2026** + `0001_auth_shim`, `0002_grants`, `0003_drop_pgnet`, `0004_sessions`, `0005_blacklist` |

Peta cermin (isi lengkapnya menyusul sebagai tabel per berkas):

| Supabase | Padanan Go |
|---|---|
| semua migrasi sebelum 30 Sep 2026 | sudah termasuk di `schema_prod_20260930.sql` (baseline) |
| `20260930_jaminan_multi.sql` | `sewara-api/migrations/0006_jaminan_multi.sql` **dibuat 2026-10-31** (lihat §4a) |
| `20261002_penyewa_blacklist.sql` | `sewara-api/migrations/0005_blacklist.sql` **sudah** |
| *migrasi baru Nov 2026 → Jan 2027* | **belum ada padanannya — wajib dibuat saat itu** |
| — | `0001_auth_shim`, `0002_grants`, `0003_drop_pgnet`, `0004_sessions` khusus Go (tidak ada padanan Supabase) |

### 4a. Koreksi asumsi baseline (2026-10-31)

Asumsi "semua migrasi ≤ 30 Sep 2026 sudah termasuk di baseline" **salah**. Buktinya:

- `schema_prod_20260930.sql:367` masih `jaminan_sewa text`, tanpa constraint
  `jaminan_sewa_is_array`, dan RPC di baseline masih `->>'jaminan_sewa'`;
- padahal `20260930_jaminan_multi.sql` (tanggal **sama** dengan baseline, sudah
  tercatat di ledger produksi) mengubah kolom itu menjadi **jsonb array**.
  Artinya dump baseline diambil **sebelum** migrasi hari itu dijalankan.

Akibat nyata: DB Go (`text`) ≠ DB produksi (`jsonb`), dan handler Go menolak
payload UI nyata (`jaminan_sewa: ["E-KTP"]` → `400 Body tidak valid.`). Rantai
temuan: `booking/page.js:1400` (kirim array) → `internal/db/transactions.go`
(dulu `*string`) → `handlers_transactions.go:214`. Tutup: migrasi `0006`,
tipe `json.RawMessage` + normalisasi, cast `::jsonb`, skenario smoke ber-array.

Dua pelajaran yang mengikat:

1. Tanggal berkas migrasi **bukan** bukti isi baseline. Urutan penulisan dump
   (generator `tools_dump_schema.mjs`) harus dipastikan setelah migrasi hari itu.
2. `audit-cermin-skema.ps1` dulu memakai `-gt $Baseline` sehingga migrasi
   bertanggal sama dilewatkan dan skrip melaporkan "cermin lengkap" padahal
   drift nyata. Sekarang migrasi bertanggal `>=` baseline ikut diperiksa
   (dengan jalur lewat-sadar eksplisit bila memang sudah tercermin).

Aturan yang mengikat mulai sekarang:

1. Setiap PR yang menambah berkas di `sewara-backend/supabase/migrations/` **wajib**
   menyertakan padanannya di `sewara-api/migrations/` (bernomor, TANPA `INSERT` ke
   ledger — dijalankan runner Go), atau menulis alasan eksplisit di deskripsi PR
   kenapa migrasi itu tidak relevan untuk Go.
2. Jangan menimpa `schema_prod_20260930.sql`; drift diselesaikan dengan menambah
   migrasi delta di `sewara-api/migrations/`, bukan dengan snapshot baru.
3. **Drill bulanan** (sampai Desember): muat backup produksi terbaru ke Postgres Go
   di homelab → jalankan 22 skrip smoke → bandingkan angka kunci dengan Supabase.
   Drill ini yang menangkap drift, bukan ingatan.
4. Sebelum setiap rilis Next (`dev` → `main`), jalankan
   `powershell -File sewara-api/scripts/audit-cermin-skema.ps1` — keluar `1` kalau
   ada migrasi Supabase tanpa padanan Go, jadi rilis Next tidak jalan dulu sebelum
   cerminnya lengkap.

---

## 5. Fase 0 — prasyarat (belum satu pun dijalankan)

- [ ] Vhost produksi sekarang disimpan: `sudo nginx -T > ~/nginx-prod-sebelum-<tanggal>.conf`
      (tanpa ini kita menebak `location`, header, dan timeout). Bentuk yang dibaca
      2026-10-31 ada di `docker-runbook.md` §nginx host: `/api/` → `localhost:4000`,
      `/` → `localhost:3002`.
- [ ] Pemasangan mesin dijalankan satu perintah:
      `sudo ./sewara-api/scripts/install.sh --prod` — folder, grup, `pg_password`,
      `api.env` (rahasia acak), `.env` compose, skema tanpa seed, tiga unit
      systemd. Sudah terbukti di homelab 2026-10-31 (idempoten); di VPS belum.
- [ ] `/etc/sewara/api.env` dilengkapi kredensial asli: R2, Telegram, `PURGE_SECRET`
      (sudah dibangkitkan skrip), `EMAIL_TOKEN_SECRET`, Resend SMTP **port 587**
      (`smtp.resend.com`, user `resend`), `DATABASE_URL` (sudah diisi skrip).
- [ ] `/etc/sewara/rclone.conf` (600, dibuat kosong skrip) diisi + backup pertama
      sukses + `rclone check` → 0 differences. Timer sudah `enable --now` sejak
      `install.sh`, jadi isi segera atau `disable --now` dulu.
- [ ] Halaman maintenance statis siap (satu berkas HTML) + cara mengaktifkannya
      di nginx dan mengembalikannya.
- [ ] Image Go **sudah dibangun lebih dulu**: `./sewara-api/scripts/deploy-vps.sh api`
      di hari yang tenang (bukan di jendela), supaya jendela tidak menunggu
      build ~3-5 menit.
- [ ] Backup terakhir dari produksi (repo `sewara-backup`, REST JSON + `users.json`)
      diunduh untuk bahan latihan.
- [ ] Ukuran DB produksi & sisa disk EBS dicek (`df -h`, ukuran dump).
- [ ] Akun uji (owner + staf) dibuat lewat UI admin di DB baru untuk uji jendela.

---

## 6. Fase 1 — latihan kering di homelab (tanpa menyentuh produksi)

Tujuan: menemukan masalah skema/data **sekarang**, bukan di jendela. Hasil Fase 1
juga memberi angka nyata untuk menjadwalkan jendela.

1. Muat data produksi (dari backup REST) ke Postgres Go di homelab:
   `bootstrap/` → baseline → `migrations/` → impor data → isi ledger.
2. Jalankan stack Go di homelab (`APP_ENV=production`, `MAIL_DRIVER=log`).
3. Jalankan seluruh 22 skrip smoke.
4. Bandingkan angka kunci dengan Supabase: `members`, `users` (auth), `transactions`,
   total nominal per bulan, jumlah pembayaran, jumlah inventory.
5. Uji jalur yang **belum pernah terbukti** — ini penentu GO/NO-GO:
   - unggah bukti bayar ke R2 dan baca balik (`/api/pembayaran/upload`, `/photo`)
   - export ZIP pembayaran (`/api/pembayaran/export`)
   - header invoice (`/api/invoice/header` POST/GET/DELETE)
   - kirim satu email verifikasi lewat Resend (SMTP 587)
6. Catat durasi tiap langkah (dump, restore, verifikasi) → dasar jadwal jendela.
7. Opsional tapi disarankan untuk "memastikan matang": paparkan stack Go di homelab
   lewat cloudflared supaya bisa kamu klik-klik manual dengan data berbentuk
   produksi (bukan hanya lolos smoke).

---

## 7. Fase 2 — jendela produksi (Januari 2027, target 30-45 menit)

| Waktu | Langkah | Titik verifikasi |
|---|---|---|
| T-30 | Panaskan: `up -d db`, image Go siap, unit systemd aktif | `docker compose ps` sehat |
| T-0 | Aktifkan halaman maintenance (nginx) | `curl -I` domain → halaman maintenance |
| T+2 | `pm2 stop sewara-backend` (frontend tetap hidup) | API lama berhenti menulis |
| T+3 | Dump akhir Supabase (`pg_dump -Fc`) + simpan sha256 | berkas dump ada, ukuran wajar |
| T+8 | Restore ke Postgres Docker (skema dari bootstrap+baseline+migrations, lalu data) | `psql -c '\dt'` jumlah tabel cocok |
| T+15 | Verifikasi hitung (sama seperti Fase 1 langkah 4) | **angka identik, kalau tidak → NO-GO** |
| T+20 | Flip `location /api/` → `127.0.0.1:8098`; `nginx -t`; reload | `curl` health 200 || T+22 | Uji berurutan: login, dashboard, members, transactions, unggah bukti, export, cetak invoice | semua 200/berhasil |
| T+30 | Matikan maintenance, buka layanan | pengguna bisa login |
| T+30..T+90 | Pantau: `docker logs -f api`, `pm2 logs`, error 4xx/5xx | tidak ada lonjakan galat |

**Rollback (kapan saja dalam jendela):** kembalikan blok `location /api/` ke Next
(`nginx -t` → reload) + `pm2 start sewara-backend`. Sesi Go diabaikan; pengguna
cukup login sekali lagi. Tulisan sejak flip hilang — catat jamnya dan, kalau ada,
masukkan manual dari catatan pengguna.

Yang disentuh di jendela cuma vhost nginx host (punyamu; skrip deploy tidak pernah
menyentuhnya): satu baris `proxy_pass` di `location /api/`. Bentuk lengkap tahap 1
dan tahap 2 ada di `docker-runbook.md` §nginx host.

**NO-GO otomatis:** angka verifikasi tidak identik, login tidak jalan, unggah/export
gagal, atau `pg_restore` melaporkan galat yang tidak bisa dijelaskan.

---

## 8. Fase 3 — frontend jadi static export (terpisah, setelah stabil ≥3 hari)

`sewara-frontend` build static export (`npm run build:static`) → `/srv/sewara/www`
→ `edge` (container, `127.0.0.1:8090`) menyajikan berkas statis + `/api/` →
`api:4000`. Vhost host lalu cukup satu blok `location /` → `127.0.0.1:8090`; blok
`/api/` **dihapus** karena pembagian path pindah ke `edge` (yang tidak memuat
domain sama sekali). Rollback: kembalikan vhost dari `.bak` (dan `root`/`proxy_pass`
lama). Setelah fase ini pm2 benar-benar bisa dipensiunkan.

Di homelab fase ini sudah berjalan (frontend statis di `/srv/sewara/www`, 298
berkas, `login=200`); di VPS belum, karena `SEWARA_FRONTEND_STATIC=0` selama Next
masih melayani.

---

## 9. Fase 4 — pensiunkan Supabase (setelah stabil ≥7 hari)

Syarat wajib: (a) timer backup jalan tanpa gagal, (b) drill restore dari R2 hijau,
(c) tidak ada galat tak dijelaskan selama 7 hari. Setelah itu langganan Supabase
dibatalkan; backup R2 akun terpisah + drill berkala tetap jalan.

---

## 10. Setelah cutover: apa yang masih boleh diubah

`location /api/` → Go; seluruh path lain tetap Next (`try_files`). Sesudah Fase 3
(tahap 2), pembagian itu pindah ke `edge` dan host nginx cukup meneruskan `/` ke
`127.0.0.1:8090`.

| Perubahan | Aman? | Alasan |
|---|---|---|
| Halaman/komponen/style/copy `sewara-frontend` | **Aman** | Frontend murni lewat `API_BASE` (`src/lib/db.js:5-6`); Supabase hanya `preconnect` (`layout.js:33`) |
| Route halaman baru (mis. `/dashboard/laporan`) | **Aman** | Nginx hanya mengarahkan prefix `/api/` |
| Rilis frontend dengan pola lama (pm2) | **Aman** | Direktori/deploy dua stack terpisah |
| Route API baru di `sewara-backend` (Next) | **TIDAK** | `/api/` seluruhnya Go; route Next tidak akan pernah dipanggil |
| Fitur yang bergantung sesi Supabase | **TIDAK** | Sesi sesudah cutover = sesi Go |

**Aturan sesudah cutover: endpoint baru ditulis di Go (`sewara-api/`).**

Jebakan yang harus diingat (gejalanya halus, bukan error): fix pada
`sewara-backend` sesudah cutover **tidak akan berefek** walau sudah
push → pull → build → `pm2 restart`, karena `/api/` tidak lagi dilayani Next.
Fix di `sewara-frontend` tetap normal. Jadi: perbaikan logika/route API pindah ke
Go, perbaikan tampilan tetap di frontend.

Konsekuensi penjadwalan: kalau pengembangan Next sampai rilis publik masih
menambah **endpoint** baru, Fase 2 ditunda sampai setelah rilis (Fase 0 + Fase 1
boleh jalan lebih dulu, tanpa menyentuh produksi). Kalau tetap cutover lebih awal,
maka endpoint baru sejak itu wajib di Go — frontend tetap bebas.

---

## 11. Risiko terbuka (jujur, dicatat sebelum jendela)

| Risiko | Mitigasi |
|---|---|
| Perbedaan skema/bentuk data antara Supabase dan Postgres self-hosted | Fase 1 dengan data produksi nyata |
| **Baris `transactions.items` bentuk lama tanpa `ref` menjatuhkan halaman booking** | Ditemukan 2026-10-31 di homelab (lihat catatan di bawah). Sebelum dump produksi dimuat: jalankan audit bentuk items + tanam normalisasi di `lib/db.js` (bukan di render) |
| Jalur belum terbukti (unggah R2, export ZIP, SMTP Resend) | Diuji di Fase 1; gagal = NO-GO, bukan ditemukan di jendela |
| Tulisan hilang kalau rollback setelah flip | Jendela singkat + `pm2` tidak dimatikan + dump akhir sebelum flip |
| Semua pengguna ter-logout saat flip (cookie sesi berbeda) | Diumumkan sebelumnya; lakukan di luar jam kerja |
| Dua pengirim notifikasi Telegram (Next + Go) | Matikan pemicu di Next saat `pm2 stop`, pastikan Go yang mengirim |
| Timer/ticker ganda (purge sesi, purge bukti) setelah flip | Setelah `pm2 stop`, hanya ticker Go yang berjalan — dicatat di runbook |
| Ukuran disk EBS tidak diketahui | Cek di Fase 0 sebelum menetapkan `/srv/sewara` |
| Node runtime VPS masih v24.21.0 (laptop v24.22.1) | Tidak menghambat cutover Go; dirapikan sebelum Fase 4 |

### Utang terukur: `transactions.items` tanpa `ref` (2026-10-31)

**Gejala:** `/dashboard/booking` menampilkan halaman error bawaan Next 16 —
teks **"This page couldn't load"** (dari
`node_modules/next/dist/client/components/builtin/global-error.js:46`, bukan kode
kita). Console: `Uncaught TypeError: Cannot read properties of undefined
(reading 'nama')`, dua frame `Array.map` berurutan.

**Titik ledak:** `sewara-frontend/src/app/dashboard/booking/page.js:2825` —
`{i.qty}x {i.ref.nama}` di dalam `tampil.map((t) => (t.items || []).map(...))`.
Penjaga `(t.items || [])` hanya melindungi array-nya, bukan isi elemen.

**Penyebab data:** elemen `items` berbentuk lama tanpa kunci `ref`
(`{idBarang, qty, sn, hargaSatuan, subtotal}` ± `nama`/`jenis`). UI selalu menulis
`ref` (`page.js:960,973,1543,1562` membentuk `{ idBarang, ref: refBarang, ... }`);
yang cacat datang dari skrip smoke/uji API yang mengirim items ringkas. Di homelab
tercatat 5 dari 16 baris. Dibersihkan 2026-10-31 (cadangan
`/srv/sewara/backup/pra-bersih-20261031.sql`).

**Kelas bug, bukan satu baris:** titik baca `item.ref.*` tanpa penjaga di
`page.js` ada di baris `995, 1189, 1200, 1211, 1226, 1235, 1239, 1694, 1721, 1732,
1740, 1750, 1753, 2350, 2353, 2825, 2826, 3137, 3143, 3158`; halaman yang membaca
transaksi (riwayat, invoice, tracking) perlu diperiksa dengan pola yang sama.

**Bentuk perbaikan yang disetujui (dikerjakan dekat rilis, bukan sekarang):**
normalisasi **sekali di batas baca** (`sewara-frontend/src/lib/db.js`, tempat
`getTransactions*` mengembalikan data) — elemen lama diberi `ref` dari kuncinya
sendiri, sehingga `booking/page.js` tidak disentuh dan fix UI lain tidak
bertabrakan saat merge. Padanan gaya yang sudah ada: `parseJaminan`
(`utils.js:33`) dan `item?.ref || item || {}` (`utils.js:116`).

**Kenapa tidak boleh dilewati:** produksi Next sekarang memakai kode yang sama,
dan dump Supabase Januari 2027 bisa memuat baris items lama — gejalanya akan
identik: halaman booking mati setelah cutover. Audit data dump masuk daftar
prasyarat Fase B di `checklist-deploy-vps.md`.
