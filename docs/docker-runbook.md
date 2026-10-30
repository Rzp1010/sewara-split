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

## Anggaran sumber daya (t3.micro: 2 vCPU / 1 GB RAM)

Mesin produksi = AWS EC2 **t3.micro** (1 GB), lebih kecil dari homelab (1,4 GB).
Kode Go sudah mengasumsikan ini (`internal/db/db.go:40` → `MaxConns = 10`); yang
belum ada batas untuk sisi Postgres, dan itu yang ditambahkan di compose.

| Komponen | Perkiraan |
|---|---|
| OS + nginx host + sshd (+ cloudflared kalau dipakai) | ~180 MB |
| dockerd + containerd | ~150 MB |
| container `db` (`mem_limit: 384m`) | **terukur 18,6-22,7 MB** (23,8 MB saat `pg_dump`); langit-langit ~96 MB shared_buffers + ~10 MB × koneksi |
| container `api` (`mem_limit: 192m`) | **terukur 4,8 MB** (laptop) / **14,5 MB** (homelab, `APP_ENV=production`)|
| **Total** | **~560-640 MB** dari ~950 MB efektif |

Terukur 2026-10-30 di staging (DB kecil, 6 member): seluruh stack **~24 MB** RSS —
jadi batas 384m/192m itu bantalan lebar, bukan target. Angka "langit-langit"
penting untuk nanti kalau DB membesar: RSS Postgres naik sampai ~96 MB saat
`shared_buffers` benar-benar tersentuh. Swap 2 GB tetap jadi lapis terakhir,
bukan alasan menghapus batas.

- `shm_size` diturunkan 256m → 128m: 256 MB itu 26% dari total RAM.
- Tuning Postgres (`command: postgres -c ...`): `shared_buffers=96MB`,
  `effective_cache_size=384MB`, `work_mem=4MB`, `maintenance_work_mem=48MB`,
  `max_connections=30` (pool Go 10 + admin).
- Swap host 2 GB sudah tersedia di semua mesin (produksi + homelab). Docker
  memberi `memory-swap` default = 2 × `mem_limit`, jadi `db` masih boleh tumpah
  sampai ~768 MB sebelum OOM killer — jaring pengaman, bukan pengganti tuning.
- `cpus: 1.0` per container dipasang di produksi saja: t3.micro punya CPU credit
  (baseline 10%/vCPU). Staging sengaja tidak dibatasi CPU — membatasi di sana
  hanya memperlambat suite smoke tanpa mengubah kebenaran hasil.

Dua larangan di t3.micro:

- **Jangan build image di produksi** (`go build` butuh ~1 GB dan menembus CPU
  credit): kirim image siap pakai (`docker save` + scp, atau registry GHCR).
- **Jangan `pg_restore` data produksi di sana**: restore penuh dilakukan di mesin
  besar, VPS hanya menerima dump yang sudah dipindah/dimuat.

## Pasang Docker di mesin baru (homelab/VPS)

Sudah dijalankan di homelab 2026-10-30 oleh user: Docker 29.1.3 + Compose
2.40.3 dari paket Ubuntu, user masuk grup `docker`, `systemd-analyze verify`
pada ketiga unit **bersih tanpa keluaran** setelah Docker ada.

```bash
sudo apt update
sudo apt install -y docker.io docker-compose-v2
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"   # berlaku setelah login ulang
newgrp docker                     # jalan pintas untuk sesi sekarang
docker run --rm hello-world
docker compose version            # harus v2.x
```

Kalau paket Ubuntu terlalu tua, alternatif repo resmi:
`curl -fsSL https://get.docker.com | sudo sh` (menambah apt repo pihak ketiga +
kunci GPG — satu dependensi eksternal lebih banyak).

Periksa setelah pasang:

```bash
systemctl is-active docker
docker info --format '{{.ServerVersion}} cgroup={{.CgroupVersion}}'
free -m | head -2   # daemon ~100-150 MB; stack db+api terukur ~37 MB (lihat §Anggaran)
```

Mesin homelab: Ubuntu 26.04, 2 vCPU, RAM 1,4 GB (631 MB available sebelum
hermes dimatikan), disk 49 GB sisa. Jangan jalankan backup bersamaan dengan
build image di mesin sekecil ini.

## Hasil uji homelab 2026-10-30 (bentuk produksi di Linux)

Yang diuji: `docker-compose.prod.yml` apa adanya, di `~/sewara-test` (bukan
`/srv`, supaya tidak perlu sudo), image dikirim lewat `docker save`/pscp.

| Yang diperiksa | Hasil |
|---|---|
| `docker compose config` di Linux | valid; `mem_limit` 384m/192m, `shm_size` 128m, `cpus: 1` terbaca |
| Folder data | `bind /home/rizki/sewara-test/run/pgdata -> /var/lib/postgresql/data` |
| Postgres boleh nulis (uid 999) | ya; `chown 999:999` + `chmod 700` di folder uji |
| Init skema lewat `db-init` | `tabel=29 policy=27 ledger=5 members=6 users=5` |
| API `APP_ENV=production` | healthy; `health=200 login=200 members=200 dashboard=200` |
| Memori nyata | `db 22,7 MiB / 384 MiB`, `api 14,5 MiB / 192 MiB` → stack ~37 MiB |
| `backup.sh` pola unit systemd | dump 170.585 byte + `.sha256`, rotasi jalan |
| `down -v` | network dihapus, **0 volume Docker bernama sewara**; `PG_VERSION` (mtime 13:00:34) utuh sesudahnya |
| `systemd-analyze verify` | ketiga unit bersih |

Catatan operasional dari uji ini:

- `pgdata` itu `700 root:999` — user biasa (rizki/sewara) tidak bisa membacanya,
  itu memang benar. Untuk memeriksa isinya, baca lewat container:
  `docker run --rm -v /srv/sewara/pgdata:/d:ro alpine sh -c 'du -sh /d; ls /d | head'`.
- `psql` tidak mengenal `PGPASSWORD_FILE` (hanya `backup.sh` yang mendukungnya).
  Kalau menjalankan init/psql manual, isi `PGPASSWORD` dari berkas:
  `-e PGPASSWORD="$(cat /etc/sewara/pg_password)"`.

## Deploy produksi (urutan, belum dijalankan)

Berkas: `docker-compose.prod.yml`, `.env.prod.example` (jadi `/etc/sewara/api.env`),
`deploy/systemd/*`, `deploy/nginx.staging.conf` (bentuk cutover; versi produksi
menyusul saat cutover).

1. `sudo mkdir -p /srv/sewara/pgdata /srv/sewara/backup /etc/sewara`
2. `sudo chown -R 999:999 /srv/sewara/pgdata && sudo chmod 700 /srv/sewara/pgdata`
3. `printf '%s' '<password-kuat>' | sudo tee /etc/sewara/pg_password >/dev/null`
4. `sudo cp .env.prod.example /etc/sewara/api.env` → isi nilai asli (boleh disalin
   dari env Next produksi yang sudah ada di VPS) → `sudo chmod 600 /etc/sewara/pg_password /etc/sewara/api.env`
5. `docker compose -f docker-compose.prod.yml up -d db` → buat role
   (`anon`, `authenticated`, `service_role`) → restore dump data produksi
6. `docker compose -f docker-compose.prod.yml up -d api` → cek `/api/health` + login
7. `sudo cp deploy/systemd/*.service deploy/systemd/*.timer /etc/systemd/system/` →
   `systemd-analyze verify` → `systemctl enable --now sewara.service sewara-backup.timer`
8. nginx: tanam vhost produksi (per-path) → `nginx -t` → reload

Urutannya mengikat: container hidup dulu, lalu routing dialihkan per-path.
Rollback = balikkan blok `location` ke Next, tanpa menyentuh container.

**Sudah diverifikasi di Linux 2026-10-30** (lihat §Hasil uji homelab): unit systemd
lewat `systemd-analyze verify`, bind mount + uid 999, init skema, API
`APP_ENV=production`, backup, dan ketahanan `down -v`. Yang masih menunggu: langkah
yang butuh sudo di mesin tujuan (`/srv/sewara`, `/etc/sewara`, pasang unit) dan
salinan dump ke luar host.

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
- `pgdata` di **bind mount folder host** (`/srv/sewara/pgdata`, uid 999) +
  monitoring disk; `logging` json-file dibatasi (10m × 3) supaya tidak menelan disk VPS.
  Bind mount inilah yang membuat data kebal `down -v`, `volume prune`, dan
  `system prune --volumes` (terbukti di homelab).
- Password DB produksi jangan lewat `environment:` compose (bisa dibaca
  `docker inspect`): pakai `POSTGRES_PASSWORD_FILE` + file mode `600` di VPS,
  dan `DATABASE_URL` di file env aplikasi (mode `600`, bukan di repo).
- Jadwal backup: `pg_dump -Fc` harian/12 jam ke luar host (R2 atau host lain),
  drill restore berkala. RPO mengikuti jadwal dump — sebelum cutover, tulis
  angkanya di runbook produksi supaya tidak diasumsikan.
- Batas resource sudah dipasang setelah kapasitas VPS diketahui (t3.micro 1 GB):
  `mem_limit` 384m/192m + `cpus: 1` — lihat §Anggaran sumber daya.
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

1. ~~Verifikasi stack compose di laptop (health, login, endpoint baca, drill
   pg_dump)~~ — selesai 2026-10-30.
2. Homelab staging: **Docker sudah terpasang** (29.1.3 + Compose 2.40.3) dan
   bentuk produksi sudah diuji di sana (§Hasil uji homelab 2026-10-30). Sisa:
   pindahkan uji ke lokasi sungguhan (`/srv/sewara`, `/etc/sewara`, unit systemd
   butuh sudo) dan pastikan cloudflared mengarah ke stack ini kalau mau dipakai
   sebagai staging ber-URL.
   Kondisi mesin: `rizkiserver`, Ubuntu 26.04, 2 vCPU, RAM 1,4 GB, disk 49 GB
   sisa; `~/sewara-split` salinan lama tanpa `.git` dan tanpa `sewara-api`
   (kode uji ditaruh di `~/sewara-test`). Sudah jalan di sana: nginx,
   `postgresql@18` host, cloudflared, tailscaled, samba, hermes (RSS 310 MB).
3. Cutover frontend + nginx per-path (ditunda atas permintaan user) — butuh
   vhost produksi sekarang (`nginx -T`) supaya per-path flip menyalin perilaku,
   bukan menebak.
4. Ganti `sewara-backup` REST → `pg_dump`; tambah backup R2 (rclone, matikan
   `ExecStartPost` di `deploy/systemd/sewara-backup.service` saat sudah siap).
5. Migrasi data produksi (dump dari Supabase produksi → restore ke DB produksi baru)
   dengan urutan drift-check seperti `AGENTS.md` aturan 5; restore dilakukan di
   mesin besar, bukan di t3.micro.
6. Jalur belum terbukti: SMTP nyata (`auth/callback`), ZIP export pembayaran,
   stream `photo`, unggah bukti bayar ke R2.
7. Ukuran root volume EBS produksi belum diketahui — perlu dicek sebelum
   menetapkan lokasi `/srv/sewara/pgdata` + rotasi dump.
