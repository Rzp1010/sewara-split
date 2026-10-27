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
