# Runbook Docker — Sewara (staging dulu, produksi menyusul)

Lingkup saat ini: **Postgres + API Go** dalam satu `docker compose`.
Frontend/Next **belum** dipindah ke container — cutover frontend ditunda atas
permintaan user. nginx per-path juga belum (bagian dari cutover).

Rujukan aturan: `rencana-migrasi-go-2026-10-27.md` §8 (portabilitas runtime).

## Berkas

| Berkas | Isi |
|---|---|
| `sewara-api/Dockerfile` | build multi-stage; runtime alpine + ca-certificates/tzdata/wget, user non-root 10001 |
| `sewara-api/.dockerignore` | `.data/`, `.env*`, skema/seed/skrip (tidak dipakai runtime) |
| `sewara-api/docker-compose.yml` | service `db` (named volume `pgdata`), `db-init` (profil `init`), `api` |
| `sewara-api/docker/db-init/init.sh` | bootstrap → baseline dump (baris pg_net dibuang) → migrations → seed → ledger → setval |
| `sewara-api/.env.example` | daftar env lengkap; `cp` ke `.env` (gitignored) |

## Prasyarat

- Docker Engine + `docker compose` v2.24 atau lebih baru (`env_file: path: required:`).
- Jangan bentrok port: `sewara-staging-db` (harness smoke) memakai **5433** dan API
  smoke memakai **8099**. Compose ini memakai **8098** dan **tidak** mempublikasikan DB.
- Stop portable PostgreSQL (`sewara-api/.data/pgsql`) dulu kalau hidup.

## Jalanin staging

```powershell
cd "E:\Aplikasi Inventory\sewara-split\sewara-api"
Copy-Item .env.example .env        # opsional: nilai default compose sudah cukup
docker compose up -d db
docker compose --profile init run --rm db-init    # sekali saja, saat volume masih kosong
docker compose up -d api
```

`db-init` idempoten dan sengaja "berisik": kalau ledger `schema_migrations` sudah
ada dan semua berkas `bootstrap/*.sql` + `migrations/*.sql` sudah tercatat, skrip
keluar dengan pesan `ledger lengkap (N berkas) — dilewati` (exit 0). Kalau ada
berkas yang **belum** tercatat (mis. migration baru ditambah), skrip berhenti
dengan `exit 1` dan mencetak nama berkasnya — skema tidak diubah diam-diam.
Terapkan berkas itu secara sadar, seperti aturan rilis:

```powershell
docker compose exec -T db psql -U sewara -d sewara -v ON_ERROR_STOP=1 -f - < migrations\0006_xxx.sql
docker compose exec -T db psql -U sewara -d sewara -c "INSERT INTO schema_migrations (filename) VALUES ('0006_xxx.sql')"
```

Untuk membangun ulang dari nol (data staging memang disposable):

```powershell
docker compose down --volumes      # SENGAJA, hanya data staging yang boleh hilang
docker compose up -d db
docker compose --profile init run --rm db-init
docker compose up -d api
```

Output `db-init` mencetak `tabel=`, `policy=`, `ledger=`, `members=`, `users=` —
pakai itu sebagai penanda bahwa skema + seed + akun login termuat utuh. Ledger
harus memuat **semua** berkas `bootstrap/*.sql` + `migrations/*.sql`.

## Verifikasi

```powershell
curl.exe -s http://127.0.0.1:8098/api/health
docker compose ps                       # api: healthy, db: healthy
docker compose logs --tail=50 api       # log ke stdout (bukan berkas)
```

Uji fungsional minimal. Akun seed (dibuat oleh `seeds/staging_seed.sql`, password
`Rahasia123`): `owner-a@staging.local`, `cs-a@staging.local`,
`superadmin@staging.local`, `owner-b@staging.local`, `cs-b@staging.local`.

```powershell
# Body dikirim dari berkas: PowerShell memakan tanda kutip kalau -d dipakai langsung.
$body = "$env:TEMP\login.json"
[System.IO.File]::WriteAllText($body, '{"email":"owner-a@staging.local","password":"Rahasia123"}', (New-Object System.Text.UTF8Encoding($false)))
curl.exe -s -c "$env:TEMP\ck.txt" -H 'Content-Type: application/json' --data-binary "@$body" http://127.0.0.1:8098/api/auth/login
curl.exe -s -b "$env:TEMP\ck.txt" http://127.0.0.1:8098/api/dashboard
curl.exe -s -b "$env:TEMP\ck.txt" http://127.0.0.1:8098/api/inventory
```

Hasil yang diharapkan (sudah diverifikasi 2026-10-30): `/api/health` →
`{"ok":true,...}`, login → `200`, `/api/dashboard` → `200`, `/api/inventory` →
`200` + 6 unit inventaris seed.

Cek DB langsung (tidak ada port host untuk DB — masuk lewat exec):

```powershell
docker compose exec db psql -U sewara -d sewara -c "SELECT count(*) FROM members"
docker compose exec db psql -U sewara -d sewara -c "SELECT filename FROM schema_migrations ORDER BY 1"
```

## Berhenti dan menghapus

```powershell
docker compose stop          # container berhenti, data aman
docker compose down          # container dihapus, volume pgdata tetap ada
docker compose down -v       # MENGHAPUS DATA DB — jangan dipakai kecuali disengaja
```

Larangan yang lahir dari insiden 2026-10-30 (disk C: penuh karena volume
anonim): setelah `down`, cek `docker volume ls -q | Measure-Object` kalau ada
kecurigaan volume sisa, dan jaga `docker system df` tetap wajar.

## Kenapa Postgres Debian, bukan alpine

Diuji 2026-10-30 pada kedua image:

| Image | `datcollate` | Kenyataan |
|---|---|---|
| `postgres:16-alpine` | `en_US.utf8` | log initdb: `sh: locale: not found`, `WARNING: no usable system locales were found` — musl tidak punya locale sistem, urutan/banding teks jadi byte-order walau labelnya sama |
| `postgres:16` (Debian) | `en_US.utf8` | glibc sungguhan, sama dengan Postgres produksi (Supabase) |

Dampak kalau salah pilih: `ORDER BY` nama member/barang, index unik teks, dan
`ILIKE` bisa berubah hasil tanpa error apa pun — baru terasa setelah data nyata
masuk. Karena itu staging dan produksi memakai image yang sama (`postgres:16`).

**Upgrade major (16 → 17): jangan ganti tag pada volume lama.** Jalurnya
`pg_dump -Fc` → container versi baru + volume baru → restore, atau `pg_upgrade`
di sidecar. Ganti tag pada volume lama bisa membuat data tidak terbaca.

## Backup dan restore

Backup bentuk `pg_dump` (bukan lagi REST Supabase):

```powershell
docker compose exec -T db pg_dump -U sewara -d sewara -Fc -f /tmp/sewara.dump
docker compose cp db:/tmp/sewara.dump "$env:TEMP\sewara-$(Get-Date -f yyyyMMdd-HHmm).dump"
```

Drill restore (wajib dicoba, jangan cuma percaya dump ada). DB scratch **bukan**
Supabase dan bukan DB aplikasi: role `sewara` (owner objek), `anon`,
`authenticated`, `service_role` belum ada di sana, jadi buat dulu — kalau tidak,
`pg_restore` mencatat error (`role "authenticated" does not exist`,
`role "sewara" does not exist` pada `ALTER DEFAULT PRIVILEGES`) dan hasilnya tidak
bersih. Dengan role lengkap: **0 error**.

```powershell
$dump = "$env:TEMP\sewara-20261030-1200.dump"
docker run -d --name restore-drill -e POSTGRES_PASSWORD=x -p 5434:5432 postgres:16-alpine
Start-Sleep 6
docker exec restore-drill psql -U postgres -c "CREATE ROLE sewara NOLOGIN; CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;"
docker cp $dump restore-drill:/tmp/r.dump
docker exec restore-drill createdb -U postgres r
docker exec restore-drill pg_restore -U postgres -d r --no-owner /tmp/r.dump    # tanpa error = bersih
docker exec restore-drill psql -U postgres -d r -Atc "SELECT count(*) FROM members"
docker rm -fv restore-drill       # WAJIB -v, jangan tinggalkan volume anonim
```

Angka `members` hasil restore harus sama dengan DB sumber (staging: 6). Simpan
dump di luar repo (`$env:TEMP` atau folder backup khusus) supaya tidak ikut
ter-commit — `sewara-api/.gitignore` tidak mengabaikan folder `backup/`.

Catatan: `pg_dump` tidak memuat isi R2 (foto member, bukti bayar, header
invoice). Berkas itu hidup di bucket R2 dan harus punya jalur backup sendiri
(rclone/sync) — belum dikerjakan.

**Blocker cutover:** `sewara-backup` saat ini menarik data lewat REST Supabase
(PostgREST). Setelah Go dipakai, jalur itu mati. Harus diganti `pg_dump -Fc`
terjadwal (cron 12 jam) yang menyimpan hasil ke luar host aplikasi.

## Delta produksi (belum dikerjakan)

- `docker-compose.yml` di repo ditandai **BUKAN UNTUK PRODUKSI** (password dev di
  sana). Produksi memakai file env sendiri di VPS + compose produksi terpisah;
  jangan pakai file yang sama diam-diam.
- Semua service sudah di network `internal` (bridge terpisah, tidak bergabung
  dengan container lain di host).
- `APP_ENV=production` (cookie jadi `Secure`), semua secret asli dari file env di
  VPS (bukan di repo), `EMAIL_TOKEN_SECRET`/`FRONTEND_URL`/SMTP wajib terisi,
  R2 wajib lengkap — `config.Load()` gagal cepat kalau kurang.
- Port API jangan dipublikasikan ke publik: bind `127.0.0.1:8098:4000`, nginx
  host yang jadi edge (Cloudflare Full strict + HSTS tidak diubah).
- Volume `pgdata` di disk khusus + monitoring disk; `logging` json-file sudah
  dibatasi (10m × 3) supaya tidak menelan disk VPS.
- Password DB produksi jangan lewat `environment:` compose (bisa dibaca
  `docker inspect`): pakai `POSTGRES_PASSWORD_FILE` + file mode `600` di VPS,
  dan `DATABASE_URL` di file env aplikasi (mode `600`, bukan di repo).
- Jadwal backup: `pg_dump -Fc` harian/12 jam ke luar host (R2 atau host lain),
  drill restore berkala. RPO mengikuti jadwal dump — sebelum cutover, tulis
  angkanya di runbook produksi supaya tidak diasumsikan.
- Sebaiknya tambah batas resource (`mem_limit`, `cpus`) setelah kapasitas VPS
  diketahui.
- `docker compose up -d` dijalankan oleh systemd unit saat boot (supervisi
  proses, bukan cron aplikasi — timer aplikasi tetap ticker di dalam Go).
- Rollback cutover = balikkan routing nginx per-path ke Next, bukan mengubah
  container.

## Aturan portabilitas yang tetap berlaku (§8)

- Jangan simpan state pengguna di disk container → R2.
- Sesi di tabel `auth.sessions`, bukan memori proses.
- Timer aplikasi pakai ticker Go (purge sesi, purge bukti bayar) — bukan cron OS.
- Log ke stdout (`docker logs`), bukan berkas.
- Aplikasi tidak memanggil binari shell; build tanpa CGO.
- Tidak ada path/alamat mati di kode — semuanya env.

## Sisa pekerjaan

1. Verifikasi stack compose di laptop (health, login, endpoint baca, drill pg_dump).
2. Homelab staging (Ubuntu + cloudflared) sebagai tempat gate **G1** dievaluasi.
3. Cutover frontend + nginx per-path (ditunda atas permintaan user).
4. Ganti `sewara-backup` REST → `pg_dump`; tambah backup R2.
5. Migrasi data produksi (dump dari Supabase produksi → restore ke DB produksi baru)
   dengan urutan drift-check seperti `AGENTS.md` aturan 5.
6. Jalur belum terbukti: SMTP nyata (`auth/callback`), ZIP export pembayaran,
   stream `photo`, unggah bukti bayar ke R2.
