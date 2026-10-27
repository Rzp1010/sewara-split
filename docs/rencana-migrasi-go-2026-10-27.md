# Rencana Migrasi Sewara: Go + Postgres Self-Hosted

Status: **DISETUJUI** — 2026-10-27
Target rilis: launch publik, jendela 8 minggu (±22 Des 2026 / awal Jan 2027)
Pemilik: Rizki (solo dev + AI)

Dokumen ini adalah rujukan tunggal. Setiap sesi kerja baru membaca ini dulu sebelum
menyentuh kode migrasi. Kalau ada keputusan baru, perbarui dokumen ini — jangan
disimpan di kepala atau di percakapan.

---

## 1. Keputusan

Pindah **keluar dari Supabase sepenuhnya**: backend Go, Postgres self-hosted, session
auth sendiri, frontend static export. Node hilang total dari runtime VPS.

Ditolak:

- **Go + Supabase tetap** — supaya bisa jalan, Go harus meniru semantik `@supabase/ssr`
  (cookie session, refresh, `getUser` per request). Kerja paling banyak, biaya hosted
  tetap, manfaat resource paling kecil.
- **DB pindah, auth tetap** — butuh lapisan kompatibilitas session Supabase di Go,
  plus dua kali cutover. Terburuk dari keduanya.
- **Rewrite total tanpa cut line** — launch bergantung pada 100% rewrite selesai tepat
  waktu. Tidak diterima.

## 2. Alasan

1. `supabase-js` memakai query builder dengan embedded select. Terhitung **158 `.from()`
   dan 13 `.rpc()`** di backend. Tidak ada padanan di Go, jadi begitu backend ditulis Go,
   semuanya tetap harus jadi SQL manual. Pindah DB sudah inheren, bukan pilihan tambahan.
2. Setelah itu Supabase hanya menyisakan auth — bagian yang paling mahal ditiru.
3. Resource: frontend static menghapus satu proses Node, Go menggantikan yang lain.
   Postgres lokal menambah ~150-250 MB, tapi totalnya tetap lebih kecil dari sekarang.

| | Sekarang | Target |
|---|---|---|
| Frontend | Next Node ~200-350 MB | static di nginx, 0 MB |
| Backend | Next Node ~200-350 MB | Go ~40-80 MB |
| DB | Supabase remote | Postgres lokal ~150-250 MB |
| Total | ~450-750 MB + PM2 | ~400-550 MB |

4. Keluhan "import CSV lambat" **bukan** alasan migrasi dan **tidak** ikut selesai
   dengan migrasi. Penyebabnya N+1: `db.js:226-241` melakukan `api.inventory.create`
   serial per baris, dan tiap request melakukan `requireAuth` → `supabase.auth.getUser()`
   lalu `.insert`. N baris = 2N round trip. Diperbaiki terpisah lewat endpoint bulk.

## 3. Arsitektur target

```
Cloudflare (HSTS, Full strict)
        │
      nginx
        ├── /            → file static hasil `next build` (output: 'export')
        └── /api/*       → Go service (127.0.0.1:4000, systemd)
                                │
                           Postgres (localhost)
                                │
                    R2 (presigned URL + streaming proxy)
```

- Tidak ada Node di runtime. `next build` tetap dipakai sebagai build tool saja.
- Tidak ada PM2. Tidak ada Kong/PostgREST/GoTrue/Studio.
- Satu origin, jadi cookie tidak perlu lintas-domain dan CSRF sederhana.

## 4. Keputusan teknis (terkunci)

| Lapisan | Pilihan | Alasan |
|---|---|---|
| HTTP | Go stdlib `net/http` + `ServeMux` pattern (Go 1.22+) | tanpa framework, rute eksplisit terbaca |
| DB driver | `pgx/v5` pool | SQL langsung, tanpa ORM |
| Query | SQL tangan | embedded select → join eksplisit |
| Session | token opaque 32 byte acak; **hash SHA-256 disimpan**, token mentah tidak | revokable instan, bocor DB tidak membocorkan sesi |
| Cookie | `HttpOnly`, `Secure`, `SameSite=Lax`, expiry 30 hari | satu origin, tanpa refresh dance |
| Password | bcrypt (hash lama tetap valid) | user lama tidak perlu reset |
| CSRF | `SameSite=Lax` + cek `Origin` pada request mutasi | cukup untuk satu origin |
| Rate limit | token bucket in-process | hapus Upstash; batas: satu instance |
| Frontend | `output: 'export'`, disajikan nginx | Node hilang total |
| Proses | systemd unit | ganti PM2 |
| Migrasi DB | file SQL + ledger `schema_migrations` | **pakai konvensi anti-drift yang sudah ada** |
| Backup | `pg_dump` → R2, + uji restore | pengganti `sewara-backup` versi REST |

## 5. Prinsip kode — WAJIB

Ini bukan saran. Port yang melanggar ini dianggap belum selesai.
Tujuannya: **efisien, terbaca, terawat** — bukan "asal pindah bahasa".

### 5.1 Port perilaku, bukan struktur

Jangan menerjemahkan file route Next menjadi file Go satu-lawan-satu secara mekanis.
Bentuk yang ada sekarang terbentuk oleh batasan Next, bukan oleh domain.

Handler Go harus tipis dan seragam:

```
decode → authorize → use-case → encode
```

Tidak ada logika bisnis di handler. Tidak ada query di handler. Kalau sebuah handler
lebih dari ~40 baris, pemecahannya salah.

### 5.2 Tata letak paket

Berdasarkan domain, bukan lapisan:

```
cmd/api/main.go
internal/auth/         session, password, middleware
internal/tenant/       TenantDB — satu-satunya pintu ke Postgres
internal/httpapi/      router, middleware chain, helper response
internal/inventory/    domain + query
internal/transaction/  ...
internal/member/       ...
internal/db/           pool, runner migrasi
```

Dilarang membuat bucket global `handlers/`, `services/`, `models/`, `utils/`.
Bucket seperti itu jadi tempat sampah dan menghapus batas domain.

### 5.3 Isolasi tenant — pengamanan by construction

Ini risiko terbesar migrasi. Aturannya:

- Pool `pgx` **tidak pernah** diekspos ke paket domain. Hanya `tenant.DB` yang bisa
  melakukan query, dan setiap method-nya wajib membawa tenant ID dari context.
- Setiap query menyertakan `tenant_id` eksplisit. Tidak ada pengecualian "sudah dijaga RLS".
- RLS tetap dipertahankan sebagai lapis kedua: `SET LOCAL app.tenant_id` di dalam
  transaksi yang sama dengan query. `SET` biasa dilarang — bocor lewat koneksi pool.
- Role aplikasi bukan owner tabel dan tanpa `BYPASSRLS`.
- Setiap route wajib punya test negatif: tenant A tidak bisa read/update/delete data
  tenant B. Test ini prasyarat merge, bukan "nanti".

### 5.4 Error dan kontrak

- Error domain bertipe, dipetakan ke HTTP **sekali** di `internal/httpapi`. Pakai
  `errors.Is`/`errors.As`, jangan mencocokkan string.
- Kode error PostgREST hilang bersama Supabase. Jangan ada sisa percabangan pada
  `PGRST116` dan sejenisnya.
- Bentuk respons **wajib identik** dengan sekarang: envelope `{data: {...}}` yang
  di-unwrap `api-client.js`, dan error dengan `.status`/`.code`. Golden fixture yang
  menegakkan ini.
- Jangan "memperbaiki" bentuk API sambil port. Itu perubahan terpisah, setelah launch.

### 5.5 Efisiensi yang benar-benar berdampak

- Endpoint bulk (`POST /api/inventory/bulk`) menggantikan N round trip. Ini yang
  menghapus keluhan lambat.
- Satu request = satu verifikasi session, bukan satu per item.
- Query selalu terbatas kolomnya; jangan `select *` untuk kebutuhan yang sempit.
- Hindari N+1: ambil relasi dengan join atau `WHERE ... = ANY($1)`.
- Ukur sebelum dan sesudah. Klaim performa tanpa angka tidak diterima.

### 5.6 Anti-pola terlarang

- Interface dengan satu implementasi. Kalau cuma ada satu yang nyata, tulis konkretnya.
- Reflection, "mini framework", generic berlebihan, DSL query buatan sendiri.
- `interface{}`/`any` di batas paket kalau tipe konkret bisa dipakai.
- Variabel global atau singleton yang menyembunyikan dependency. Semua lewat struct field.
- Mengkopi idiom TypeScript ke Go (Promise-style chaining, builder pattern berlapis).
- Komentar yang mengulang kode. Komentar hanya untuk alasan yang tidak terbaca dari kode.

### 5.7 Keterbacaan dan perawatan

- Dependensi eksplisit: `type Server struct { db *tenant.DB; ... }`, dirakit di `main.go`.
- Config dari env, divalidasi saat start, gagal cepat dengan pesan jelas.
- Test tabel-driven untuk handler; contract test dari golden fixture.
- Satu perilaku = satu tempat. Kalau aturan muncul dua kali, ekstrak.
- `@ts-nocheck` tidak punya padanan di Go. Jangan menciptakan padanannya.

## 6. Fase dan gate

| Minggu | Isi | Gate |
|---|---|---|
| W0 | Docker Compose staging (Go + Postgres + static) di laptop, load skema, rekam golden fixture, **freeze fitur** | static export frontend terbukti bisa |
| W1-2 | Auth, session, `TenantDB`, test isolasi tenant, 5-8 route sederhana | **G1**: seluruh test tenant negatif hijau, fixture lolos |
| W3-5 | Sisa route (CRUD, R2 streaming, ZIP, webhook, Telegram), endpoint bulk native | **G2**: ≥80% route lolos fixture |
| W5-6 | Rehearsal cutover di salinan DB produksi | **G3**: rollback terbukti < 5 menit |
| W6-7 | Static export live, hardening (rate limit, monitoring, restore drill, load test) | — |
| W8 | Buffer | — |

Kill criteria: kalau **G1 gagal** di akhir minggu 2, hentikan migrasi Go dan kembali ke
rencana launch di stack sekarang. Menemukan itu di minggu 2 murah; di minggu 6 fatal.

## 7. Cut line (disetujui)

nginx memilih tujuan **per path**. Route yang sudah lolos G2 dilayani Go; sisanya tetap
Next. Backend Next dibiarkan hidup sebagai fallback sampai launch stabil.

Konsekuensi: launch tidak bergantung pada selesainya 100% rewrite. Ini syarat yang sudah
disetujui, bukan rencana cadangan improvisasi.

## 8. Risiko

| Risiko | Dampak | Mitigasi |
|---|---|---|
| Kebocoran data antar tenant | fatal, tidak bisa ditarik | `TenantDB` choke point, RLS lapis kedua, test negatif per route |
| Bypass auth / session fixation | fatal | token di-hash, rotasi saat login, test jalur anon |
| Kontrak frontend↔backend melenceng | fitur rusak senyap | golden fixture sebagai gate |
| Scope 51 route membengkak | launch lewat jadwal | cut line hybrid, G2 diukur |
| Kehilangan data saat cutover | fatal | salinan DB, rehearsal, rollback teruji, Supabase disimpan 30 hari |
| OOM di 1 GB | downtime | frontend static, swap 2 GB, build di luar box |
| Disk EBS habis | build/DB gagal | cek `df -h`, minimal 20 GB gp3 |
| Solo dev tidak tersedia | launch gagal | buffer W8, dokumentasi ini |

## 9. W0 — hasil konkret

1. Docker Compose staging: Go + Postgres + static frontend, jalan di laptop
   (tidak menunggu homelab).
2. Load `sewara-backend/supabase/schema_prod_20260930.sql`.
3. Rekam golden fixture dari API sekarang untuk seluruh endpoint: respons sukses dan
   bentuk error.
4. Skrip uji isolasi tenant: dua tenant, kasus negatif per endpoint.
5. `next build` dengan `output: 'export'` — **uji paling awal**, karena kalau gagal,
   seluruh premis resource untuk pindah ke Go ikut gugur.

Poin 5 didahulukan supaya kegagalan premis ditemukan di hari ke-2, bukan minggu ke-6.

## 10. Definition of done per route

Sebuah route baru boleh dianggap selesai kalau:

- [ ] Lolos golden fixture (bentuk respons + status + kode error identik)
- [ ] Punya test negatif isolasi tenant (A tidak bisa menyentuh B)
- [ ] Punya test jalur anon (401) dan jalur role salah (403)
- [ ] Tidak menyentuh pool `pgx` langsung — hanya lewat `tenant.DB`
- [ ] Tidak ada logika bisnis di handler
- [ ] Error dipetakan di boundary, bukan string matching
- [ ] Terdaftar di nginx path switch

## 11. Yang tidak berubah

- Skema DB (kecuali tabel `sessions` dan `users` pengganti `auth.users`)
- UI/UX frontend, routing halaman, komponen
- R2 (presigned URL + proxy streaming)
- Cloudflare, domain, nginx TLS/HSTS
- Konvensi `settings` key-value dan semua perilakunya
- Aturan anti-drift migrasi, ledger `schema_migrations`

## 12. Pertanyaan terbuka

1. Kompatibilitas hash password: verifikasi `$2a$`/`$2b$` dari `auth.users.encrypted_password`
   bisa diverifikasi bcrypt Go — perlu dibuktikan dengan satu akun uji sebelum cutover.
2. Re-login massal saat cutover: diterima? (wajar untuk pre-launch, tapi harus diputuskan)
3. Ukuran disk EBS VPS sekarang (`df -h`) — penentu apakah perlu naik gp3 sebelum W0.
4. Tanggal launch final: 22 Des vs awal Jan. Libur akhir tahun mengurangi ketersediaan
   saat perbaikan darurat.
5. Apakah `sewara-backup` diganti total ke `pg_dump`, atau dua jalur selama masa transisi.

---

## 13. Hasil uji static export (2026-10-27)

Uji dijalankan pada konfigurasi asli dengan satu perubahan sementara (`output: "export"`),
lalu konfigurasi dipulihkan. Tidak ada file yang tertinggal berubah.

**Hasil: berhasil.**

- `next build` exit `0`, compile 35,6 s, 26 halaman seluruhnya `○ (Static)` — tidak ada
  route SSR sama sekali.
- Artefak: 298 file, **3,94 MB** total (3,65 MB non-HTML) di `sewara-frontend/out/`.
  Sudah tercakup `.gitignore` (`sewara-frontend/.gitignore:18`).
- Peringatan resmi Next: `headers()` **tidak diterapkan** saat export. Security header
  (CSP, HSTS, X-Frame-Options, Referrer-Policy, Permissions-Policy) wajib pindah ke nginx.
- Penamaan keluaran datar: `/dashboard` → `dashboard.html`, `/dashboard/booking` →
  `dashboard/booking.html`. nginx wajib `try_files $uri $uri.html $uri/ /404.html`.
- Route yang akan berubah/hilang saat keluar dari Supabase: `/auth/callback/success`,
  `/verifikasi-email`, `/daftar` — ketiganya bagian alur auth Supabase.

**Kesimpulan: premis resource sah.** Node bisa dihapus dari runtime, dan beban nginx
untuk aset statis 3,94 MB dapat diabaikan. Gate W0 lolos lebih awal dari jadwal.

## 14. Rencana kerja W0

Aturan selama W0: **`sewara-backend` tidak disentuh** — ia masih melayani produksi.
Semua pekerjaan Go tinggal di direktori baru `sewara-api/`.

### Hari 1

| # | Tugas | Pemilik | Keluaran |
|---|---|---|---|
| 1 | `df -h`, `free -m`, `pm2 list` di VPS; cek ukuran EBS | Kamu | angka nyata |
| 2 | Scaffold `sewara-api/`: `go.mod`, `cmd/api/main.go`, `internal/httpapi` (router + middleware stub), config dari env divalidasi saat start, endpoint `/api/health` | AI | `go run ./cmd/api` melayani `/api/health` |
| 3 | `docker-compose.yml`: `postgres:17`, `api`, `nginx` yang menyajikan `sewara-frontend/out/` | AI | staging jalan di laptop |

Gate hari 1: `free` EBS ≥ 20 GB. Kalau kurang, naikkan gp3 dulu — sebelum kode ditulis.

### Hari 2

| # | Tugas | Pemilik | Keluaran |
|---|---|---|---|
| 4 | Muat `sewara-backend/supabase/schema_prod_20260930.sql` ke Postgres staging, bandingkan jumlah tabel dengan produksi | AI | skema identik |
| 5 | Matriks endpoint: ekstrak 51 route file → daftar method + path dari ekspor route | AI | `docs/endpoint-matrix.md` (basis nginx switch + DoD) |
| 6 | Perekam golden fixture: panggil API Next di DB dev, simpan respons sukses dan bentuk error | AI | `sewara-api/testdata/fixtures/*.json` |

### Hari 3

| # | Tugas | Pemilik | Keluaran |
|---|---|---|---|
| 7 | Harness isolasi tenant: seed 2 tenant, kasus negatif per endpoint, bisa dijalankan ke Next (baseline) dan nanti ke Go | AI | `sewara-api/testdata/tenant_isolation_test.go` + skrip baseline |
| 8 | nginx staging: path switch `/api/*` → Go, sisanya static; security header dipindah dari `next.config.mjs` | AI | config nginx teruji lokal |
| 9 | Konfirmasi freeze fitur sampai launch | Kamu | keputusan tertulis |

### Hari 4

| # | Tugas | Pemilik | Keluaran |
|---|---|---|---|
| 10 | Bukti kompatibilitas hash: ambil 1 akun uji dari `users.json`, verifikasi bcrypt di Go | AI | test lulus |
| 11 | Putuskan pertanyaan terbuka §12 no. 2-5 | Kamu | dokumen diperbarui |
| 12 | Review gate W0 → masuk W1 | bersama | go / no-go |

### Artefak yang harus ada di akhir W0

```
sewara-api/
  go.mod
  cmd/api/main.go
  internal/httpapi/       router, middleware, response helper
  internal/db/            pool, runner migrasi
  internal/tenant/        (kosong sampai W1)
  testdata/fixtures/
  testdata/tenant_isolation_test.go
docker-compose.yml
docs/endpoint-matrix.md
```

Kalau salah satu artefak ini belum ada di akhir W0, W1 belum boleh dimulai — karena
tanpa fixture dan matriks endpoint, gate G1 tidak bisa diukur dan cut line tidak bisa
dipasang.

### Pratinjau W1-W2 (gate G1)

- Tabel `sessions` + `users` (migrasi dari `auth.users`), login/logout/me, bcrypt verify.
- `TenantDB` + `SET LOCAL app.tenant_id` dalam transaksi.
- Middleware: session, CSRF origin check, rate limit token bucket.
- 5-8 route sederhana diport, masing-masing lolos §10.
- **G1**: seluruh test tenant negatif hijau + fixture lolos. Kalau tidak, migrasi dihentikan.

---

## 15. Kapasitas disk (keputusan 2026-10-27)

EBS sekarang **16 GB**, di bawah gate 20 GB. Ini bukan penghalang, tapi harus dibereskan
sebelum W0 karena selama transisi dua stack hidup bersamaan (Next + Go + Postgres).

**Keputusan:**

1. **Naikkan EBS 16 → 24 GB gp3.** Biaya tambahan ± $0,64/bulan. Snapshot volume dulu,
   resize online tanpa reboot.
2. **Build di luar VPS, wajib sejak hari 1.** VPS diperlakukan sebagai runtime murni:
   - frontend: `next build` di laptop → salin `out/` (3,94 MB)
   - Go: cross-compile `GOOS=linux GOARCH=amd64` di laptop → salin binary
   - VPS tidak butuh Node, npm, node_modules, toolchain Go, maupun `next build`
3. **Swap 2 GB** swapfile di volume yang sudah diperbesar.

Efek gabungannya: setelah cutover VPS hanya berisi nginx + binary Go + Postgres. Disk
pemakaian turun drastis, dan — yang lebih penting di t3.micro — **CPU credit tidak
terbakar oleh build**, yang selama ini ikut menyebabkan aplikasi terasa lambat saat
burst baseline habis.

Langkah operasional (produksi, urut):

```bash
# 1. AWS Console → EC2 → Volumes → pilih volume → Actions → Create snapshot
# 2. AWS Console → volume → Modify volume → 24 GiB → Modify (online, tanpa reboot)
# 3. di instance:
lsblk
sudo growpart /dev/nvme0n1 1      # sesuaikan nama device
sudo resize2fs /dev/nvme0n1p1     # xfs: sudo xfs_growfs /
df -h
```

Upgrade path kalau nanti Postgres butuh ruang: pindahkan datadir ke volume terpisah
supaya bisa di-snapshot independen tanpa menyentuh sistem.

---

## 16. Hasil W0: staging Postgres self-hosted sudah berdiri

Diverifikasi 2026-10-27 di laptop. Postgres 16.10 portable (tanpa Docker, tanpa admin)
di `sewara-api/.data/pgsql`, data dir `.data/pg`, port 5433, auth trust lokal.
Siklus hidup lewat `sewara-api/scripts/staging-db.ps1` (init/start/stop/reset/psql)
dan `scripts/verify-schema.ps1` untuk pemeriksaan.

### 16.1 Hasil pemeriksaan

| Pemeriksaan | Hasil | Target |
|---|---|---|
| Tabel `public` | 28 | 28 (sama dengan produksi) |
| Policy RLS | 26 | 26 |
| Tabel dengan RLS aktif | 28 | semua tabel |
| Fungsi `auth` | 2 (`auth.uid`, `auth.jwt`) | ada |
| Ledger | 3 entri | 3 |
| Tabel tapi kosong | ya | data diisi nanti dari dump data |

### 16.2 Bukti RLS tetap berfungsi tanpa Supabase

Diuji dengan satu tabel `profiles` berisi 2 baris milik dua user berbeda:

| Skenario | Baris terlihat |
|---|---|
| superuser (bypass RLS) | 2 |
| `SET ROLE authenticated` + `app.user_id` = user A | 1 |
| `SET ROLE authenticated` + `app.user_id` = user asing | 0 |
| `SET ROLE authenticated` tanpa konteks | 0 |

Artinya: 26 policy yang ada **tidak perlu ditulis ulang**. Go cukup men-set
`SET LOCAL app.user_id` di dalam transaksi. Konteks yang lupa diset menghasilkan
0 baris, bukan kebocoran — default-nya aman.

### 16.3 Skema tidak portabel apa adanya (temuan)

Dump `schema_prod_20260930.sql` bergantung pada objek Supabase:

| Ketergantungan | Jumlah | Penanganan |
|---|---|---|
| `auth.uid()` | 97 | disediakan shim, baca GUC `app.user_id` |
| FK ke `auth.users` | 10 | tabel minimal di shim |
| `auth.jwt()` | 5 | shim, baca GUC `app.jwt` |
| Policy `TO authenticated` | 14 | role dibuat di shim |
| `CREATE EXTENSION pg_net` | 1 | dibuang saat memuat dump |
| Trigger `net.http_post` | 2 | dihapus (lihat 16.4) |
| GRANT ke `authenticated` | 0 | ditambahkan migrasi sendiri |

### 16.4 Notifikasi keluar dari database

Dua trigger (`trg_telegram_pendaftar`, `trg_telegram_transaksi`) memanggil
`net.http_post()` ke `https://app-sewara.vercel.app/api/telegram/webhook` dengan
**secret hardcoded di badan fungsi SQL**, dan URL-nya menunjuk deployment lama.
Ketiganya masalah: tidak portabel, rawan (secret ada di skema), dan menunjuk host
yang akan mati. Trigger dan fungsinya dihapus; pengiriman notifikasi menjadi
tanggung jawab Go setelah commit.

### 16.5 Urutan bootstrap (wajib, tidak boleh ditukar)

```
1. bootstrap/  -> objek yang harus ada SEBELUM baseline (schema auth, auth.users, role)
2. baseline    -> dump skema produksi (dump inilah yang membuat schema_migrations)
3. migrations/ -> perubahan di atas baseline (grant, hapus trigger pg_net, dst)
4. ledger      -> semua file yang diterapkan dicatat
```

Karena itu ada dua direktori: `sewara-api/bootstrap/` dan `sewara-api/migrations/`.
Migrasi yang mengubah objek hasil dump harus di `migrations/`, bukan `bootstrap/`.

### 16.6 Penyimpangan konvensi ledger (perlu diketahui)

`AGENTS.md` mewajibkan setiap file migration diakhiri `INSERT INTO schema_migrations`.
Untuk Postgres self-hosted, pencatatan dipindahkan ke runner (`staging-db.ps1`),
yang mencatat **semua** file yang diterapkan setelah baseline dimuat.

Alasan: pada urutan bootstrap di atas, migrasi `bootstrap/` berjalan sebelum tabel
ledger ada (tabel itu dibuat oleh dump), sehingga INSERT di dalam file akan gagal.
Pencatatan terpusat juga membuat status ledger = isi direktori, bukan ingatan
masing-masing file.

Konsekuensi: file migration baru **tidak** perlu (dan tidak boleh) menulis INSERT
sendiri. Aturan `AGENTS.md` untuk Supabase tetap berlaku di `sewara-backend/supabase/migrations/`
sampai cutover selesai.

---

## 17. Rekaman kontrak baseline (Next) dan penyimpangannya

`sewara-api/scripts/record-fixtures.ps1` menyalakan server dev Next sendiri, memanggil
**74 endpoint** tanpa sesi dan dengan body kosong, lalu menulis
`sewara-api/testdata/contracts/next-baseline.json`. Hasil: 67 × 401, 4 × 400, 1 × 200,
1 × 307, 1 × 503.

Yang direkam sengaja hanya permukaan yang tidak bergantung data. Respons sukses berisi
data tidak bisa dibandingkan apa adanya karena Go memakai database sendiri; paritas
jalur sukses diuji sebagai uji diferensial per route saat cutover.

### 17.1 Empat penyimpangan kontrak di Next

| Endpoint | Perilaku sekarang | Masalah |
|---|---|---|
| `POST /api/auth/register` | `{"error":"Format email tidak valid."}` | tidak memakai amplop `{ok:false,error:{code,message}}` sama sekali |
| `POST /api/webhooks/payment` | `{"error":"payment_webhook_not_configured","message":"..."}` | idem, tanpa `ok` dan tanpa `code` terstruktur |
| `POST /api/auth/resend-verification` | `{"ok":true,"data":{"ok":true,"message":"..."}}` | `ok` ganda (amplop dibungkus dua kali) |
| `PATCH`/`DELETE /api/admin/users` | 400 `VALIDATION_ERROR` **sebelum** cek autentikasi | validasi jalan sebelum auth; bertentangan dengan perbaikan "role-check sebelum zod" yang sudah dipakai di `POST` route yang sama |

Ditambah satu kasus khusus: `GET /api/auth/callback` membalas **307 redirect**, bukan JSON.

### 17.2 Keputusan yang diambil

Ketiga penyimpangan amplop diperbaiki di Go (bukan direplikasi). Alasannya: semuanya
jalur error, frontend tetap harus disentuh pada cutover, dan meniru bentuk yang salah
akan mengunci kesalahan itu selamanya. Untuk `admin/users`, urutan **auth → role →
validasi** diberlakukan konsisten di semua method; membocorkan detail skema ke pemanggil
tanpa sesi tidak ada manfaatnya.

Rekaman `next-baseline.json` tetap disimpan sebagai bukti historis. Uji kontrak Go
mengassert **kontrak yang diinginkan**, dan selisih yang disengaja didaftarkan di sini —
bukan disembunyikan.

### 17.3 Catatan tambahan

Path API yang tidak terdaftar di Next membalas **halaman HTML 404**, bukan JSON. Setelah
cutover, `/api/` seluruhnya dilayani Go, jadi bentuk JSON 404 menjadi perilaku yang
berlaku. Ini perubahan yang disengaja, bukan regresi.

---

## 18. Aturan agar `sewara-api` tetap mudah dipindah ke Docker

Keputusan sekarang: jalan dengan **systemd**, bukan Docker (VPS 1 GB, dan produksi
sekarang pun berbasis process manager, bukan container). Tapi perpindahan ke Docker
nantinya harus murah — diperkirakan setengah hari, bukan migrasi ulang.

Supaya tetap begitu, ada aturan yang mengikat. Melanggar salah satunya bukan
pelanggaran gaya, tapi utang yang harus dibayar saat pindah.

### 18.1 Jangan menyimpan state di disk lokal server

| Dilarang | Kenapa | Pakai ini |
|---|---|---|
| Upload/berkas pengguna ke folder lokal | Di container, filesystem mati bersama container; isinya hilang tanpa volume khusus | R2 (sudah dipakai) |
| Cache atau hasil ekspor yang harus bertahan | idem | R2 untuk yang bertahan, memory untuk yang sementara |
| Sesi/token di memori proses | Restart = semua user ter-logout; juga mustahil jalan >1 instance | tabel `auth.sessions` (sudah) |

File sementara (`os.CreateTemp`) **boleh**, dengan syarat isinya boleh hilang kapan saja
tanpa akibat. Kalau tidak boleh hilang, tempatnya bukan disk lokal.

### 18.2 Jangan mengandalkan jadwal tingkat sistem operasi

| Dilarang | Kenapa | Pakai ini |
|---|---|---|
| `systemd` timer / `cron` untuk urusan aplikasi | Terjemahannya ke Docker jadi pekerjaan tambahan, dan mudah terlupa saat deploy | ticker di dalam proses Go |
| Skrip shell yang dipanggil aplikasi | Image minimal (distroless/alpine) tidak punya bash, curl, zip | pustaka Go (`archive/zip`, dsb) |

Contoh yang sudah benar: pembersihan sesi kedaluwarsa dijalankan `cleanupSessions()`
di dalam proses (`cmd/api/main.go`), bukan timer systemd.

### 18.3 Jangan menulis path atau alamat mati di kode

| Dilarang | Pakai ini |
|---|---|
| `/home/ubuntu/...`, `C:\...`, `127.0.0.1:8080` di dalam kode | environment variable (`DATABASE_URL`, `ADDR`, `APP_ENV`, `SESSION_TTL`) |
| Membaca rahasia dari path lokal tetap | env var, atau path yang datang dari konfigurasi (bisa di-mount) |

Alamat internal antar-service (`nginx` → `sewara-api`) juga lewat konfigurasi: saat
systemd nilainya `127.0.0.1:8080`, saat Docker `sewara-api:8080`. Kode tidak berubah.

### 18.4 Build dan runtime yang portabel

| Aturan | Alasan |
|---|---|
| `CGO_ENABLED=0` saat build | Binary statis: jalan di image apa pun tanpa urusan libc |
| Log ke stdout, bukan file | `journalctl` tinggal jadi `docker logs`; tidak ada file yang harus dirotasi |
| Zona waktu eksplisit di konfigurasi | Container default UTC; jangan bergantung `time.Local` atau TZ sistem |
| Postgres versi dipatok | `postgres:16` harus sama dengan versi di VPS, bukan "terbaru" |

### 18.5 Database tetap dapat dibangun ulang dari nol

Sudah jadi aturan tersendiri (AGENTS.md aturan DB), tapi konsekuensinya di sini:
**satu-satunya** cara mengubah skema adalah file migrasi + ledger. Tidak ada ALTER
manual di server mana pun. Kalau database bisa dibangun ulang dari repo, memindahkannya
ke container hanya soal `pg_dump` dan `pg_restore`.

### 18.6 Cara memeriksa

Sebelum menandai sebuah pekerjaan selesai, cek cepat:

```
grep -rn "fs.WriteFile\|os.Create\|ioutil.WriteFile" sewara-api/     # state di disk?
grep -rn "os/exec" sewara-api/                                        # panggil binari luar?
grep -rn "C:\\\\\|/home/\|/tmp/" sewara-api/ --include=*.go           # path mati?
```

Ketiganya boleh menghasilkan nol. Kalau tidak nol, harus ada alasan tertulis di
komentar kode mengapa aman saat dipindah ke container.

### 18.7 Yang tidak perlu dikhawatirkan

Kode Go, SQL, migrasi, seed, dan uji tidak perlu diubah sama sekali saat pindah ke
Docker. Perpindahan hanya menyentuh: Dockerfile, file compose, config nginx, dan
skrip operasional.
