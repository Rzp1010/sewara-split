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
