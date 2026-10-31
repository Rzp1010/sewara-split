# Runbook Docker — Sewara (staging dulu, produksi menyusul)

Lingkup saat ini: **Postgres + API Go** dalam satu `docker compose` (+ `edge`
nginx untuk homelab). Frontend/Next **belum** dipindah ke container —
cutover frontend menunggu Januari 2027 (`docs/cutover-plan.md`).

Dua perintah yang paling sering dipakai:

```bash
sudo ./sewara-api/scripts/install.sh          # pasang di mesin baru (--prod untuk VPS)
cd /srv/sewara/app && ./sewara-api/scripts/deploy-vps.sh   # deploy berikutnya
```

Rujukan aturan: `rencana-migrasi-go-2026-10-27.md` §8 (portabilitas runtime).

## Berkas

| Berkas | Isi |
|---|---|
| `sewara-api/Dockerfile` | build multi-stage; runtime alpine + ca-certificates/tzdata/wget, user non-root 10001 |
| `sewara-api/.dockerignore` | `.data/`, `.env*`, skema/seed/skrip (tidak dipakai runtime) |
| `sewara-api/docker-compose.yml` | service `db` (named volume `pgdata`), `db-init` (profil `init`), `api` |
| `sewara-api/docker-compose.prod.yml` | bentuk yang dipakai homelab/VPS: `db` (bind mount) + `api` + `edge` (profil `edge`) + `adminer`/`cloudflared` (profil `admin`/`tunnel`); knobs `SEWARA_*` |
| `sewara-api/docker/db-init/init.sh` | bootstrap → baseline dump (baris pg_net dibuang) → migrations → seed → ledger → setval |
| `sewara-api/.env.example` | daftar env lengkap; `cp` ke `.env` (gitignored) |
| `sewara-api/scripts/install.sh` | pemasangan mesin baru, satu perintah + idempoten (`--prod`, `--no-deploy`, `--branch`, `--user`, `--root`, `--etc`, `--repo`) |
| `sewara-api/scripts/deploy-vps.sh` | deploy/rollback opt-in (`auto` / `api` / `frontend` / `semua` / `--ke <commit>`) |
| `deploy/nginx.staging.conf` | nginx `edge` (container): frontend statis + `/api/` → `api:4000`, tanpa domain |

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

**Blocker cutover:** `sewara-backup` (repo lama) menarik data lewat REST Supabase
(PostgREST). Setelah Go dipakai, jalur itu mati. Penggantinya sudah ada: timer
`sewara-backup.timer` (12 jam) → `scripts/backup.sh` (`pg_dump -Fc` + verifikasi +
sha256 + rotasi) → `ExecStartPost` `scripts/backup-rclone.sh` ke R2 akun terpisah.
Yang masih menggantung: `/etc/sewara/rclone.conf` belum diisi, sementara
`install.sh` sudah meng-`enable --now` timer-nya — jadi unit akan `failed` tiap
12 jam sampai kredensial ada (atau timer dimatikan dulu).

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

Batas di t3.micro (dikoreksi 2026-10-30 setelah diukur, bukan diperkirakan):

- **Build image di VPS: BOLEH** — diukur di homelab (2 vCPU, 1,4 GB + swap 2 GB):
  build dingin **207 detik**, RAM naik **669 MB**, swap terpakai puncak **387 MB**,
  **tanpa OOM** di kernel. Ini lebih ringan dari build Next yang sudah rutin
  dijalankan di VPS yang sama. Syaratnya dua: **swap 2 GB aktif** (tanpa swap,
  build ini OOM) dan dijalankan **saat traffic kosong**. Karena itu jalur rilisnya
  cukup `git pull` → build → restart (lihat `docs/checklist-deploy-vps.md`), tanpa
  registry dan tanpa CI.
- **Jangan `pg_restore` data produksi di sana**: restore penuh dilakukan di mesin
  besar, VPS hanya menerima dump yang sudah dipindah/dimuat.

## Pasang Docker di mesin baru (homelab/VPS)

Cara ringkas sekarang — satu perintah, idempoten, aman diulang:

```bash
sudo ./sewara-api/scripts/install.sh          # dev/homelab: APP_ENV=development
sudo ./sewara-api/scripts/install.sh --prod   # produksi:    APP_ENV=production
```

Yang dikerjakan skrip itu: cek prasyarat (docker, git, openssl, npm), precedence
IPv4 di `/etc/gai.conf`, grup `sewara` + `docker`, folder `/srv/sewara/*` dan
`/etc/sewara`, clone/pull repo, password DB + `api.env` + `.env` compose (rahasia
dibangkitkan sendiri, tidak dicetak), `rclone.conf` kosong, `up -d --wait db`,
muat skema sekali, unit systemd, lalu deploy pertama. Yang sudah ada dilewati.

Daftar perintah manual di bawah tetap disimpan sebagai rujukan apa yang
sebenarnya terjadi (dan untuk mesin yang docker-nya sudah ada sejak dulu).

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

## Variabel compose + berkas env (pelajaran pemasangan 2026-10-31)

`docker-compose.prod.yml` men-substitusi empat variabel. Simpan di `.env` pada
folder project (`sewara-api/.env`) supaya terbaca oleh `docker compose` manual
**dan** oleh `sewara.service`. Berkas itu sudah ada di `.gitignore` dan
`.dockerignore`, jadi aman diisi nilai lokal.

| Variabel | Fungsi | Homelab | Produksi |
|---|---|---|---|
| `SEWARA_APP_ENV` | mengisi `APP_ENV` container api | `development` | `production` (atau hapus baris; default) |
| `SEWARA_DATA_DIR` | letak `pgdata` | `/srv/sewara` | `/srv/sewara` |
| `SEWARA_API_IMAGE` | tag image api | `sewara-api:local` | diisi `deploy-vps.sh` (tag commit) |
| `SEWARA_EDGE_BIND` | alamat bind port 8090 (profil `edge`) | `0.0.0.0` | biarkan default `127.0.0.1` |

Empat jebakan yang sudah dilewati (semua memakan waktu, jadi catat):

1. `environment:` di compose **menang** atas `env_file:`. Jadi `APP_ENV` di
   `/etc/sewara/api.env` diabaikan dan yang berlaku `SEWARA_APP_ENV`. Salah nilai
   berhenti cepat dengan pesan jelas: `APP_ENV tidak dikenal` atau
   `storage wajib dikonfigurasi di produksi`.
2. Nilai sah hanya `development` dan `production` (`internal/config/config.go`).
   `dev` ditolak.
3. `env_file` dibaca user yang menjalankan compose → `/etc/sewara/api.env` butuh
   `640 root:sewara`, dan operator harus benar-benar berada di grup `sewara`
   (efektif setelah login ulang; `newgrp sewara` mengganti daftar grup sehingga
   `docker` hilang). `/etc/sewara/pg_password` tetap `600 root` karena dibaca
   daemon lewat `secrets:`.
4. Registry lewat IPv6: kalau `docker pull` gagal `network is unreachable`,
   tambahkan `precedence ::ffff:0:0/96 100` ke `/etc/gai.conf`, lalu
   `systemctl restart docker`.

Dua tambahan operasional:

- `edge` (nginx) menyelesaikan nama `api` sekali saat start. Sesudah
  `up -d --force-recreate api` (IP container berubah), edge harus di-recreate
  juga, kalau tidak nginx menembak IP lama (`host not found in upstream "api"`
  muncul kalau api memang sedang mati).
- Frontend static export memakai dasar alamat API **relatif** (origin yang sama),
  jadi ganti domain/IP tidak perlu bangun ulang, dan halaman https tidak pernah
  memanggil http. `NEXT_PUBLIC_API_URL` hanya perlu diisi kalau frontend dan API
  beda origin — dan perlu diingat: `deploy-vps.sh frontend` tidak membangun ulang
  kalau `sewara-frontend/` tidak berubah, jadi perubahan isi `.env.production.local`
  harus disusul `./sewara-api/scripts/deploy-vps.sh frontend` (mode paksa).

### Deploy jadi satu perintah (opt-in)

`sewara-api/scripts/deploy-vps.sh` membaca `sewara-api/.env`, jadi pengaturan
lokal tidak perlu diingat di shell. Di homelab, tambahkan ke `.env` itu:

```
SEWARA_BRANCH=dev
SEWARA_STATE_FILE=/srv/sewara/api-image.txt
SEWARA_FRONTEND_STATIC=1
SEWARA_WWW_DIR=/srv/sewara/www
SEWARA_EDGE=1
```

Lalu deploy = satu perintah dari akar repo:

```bash
cd /srv/sewara/app && ./sewara-api/scripts/deploy-vps.sh
```

Lingkup kerja dipilih skrip kalau tidak disebut:

| Perintah | Yang dikerjakan |
|---|---|
| `./sewara-api/scripts/deploy-vps.sh` (default `auto`) | hanya folder yang berubah dibanding commit di `SEWARA_STATE_FILE` |
| `… api` | paksa api saja |
| `… frontend` | paksa frontend saja |
| `… semua` | paksa api + frontend |
| `… --ke <commit>` | rollback api ke tag/commit itu |

Di `auto`, kalau `sewara-api/` tidak berubah, container api **tidak disentuh** —
tanpa restart, tanpa downtime. Kalau `sewara-frontend/` tidak berubah, build
frontend dilewati. Perubahan di luar kedua folder itu (mis. `docs/`) tidak memicu
pekerjaan apa pun. State kosong atau commit lama tidak terjangkau → bangun keduanya
(fail-safe).

Urutan menang nilai penyetelan: **shell > `sewara-api/.env` > default di skrip**,
jadi penyimpangan sesaat tidak perlu mengedit berkas:

```bash
SEWARA_FRONTEND_STATIC=0 ./sewara-api/scripts/deploy-vps.sh api
```

Sifatnya sengaja tidak otomatis: tidak ada timer/CI, semua langkah tambahan
default MATI, dan unit systemd tidak pernah disentuh skrip (kalau `deploy/systemd`
ikut berubah, skrip hanya mencetak perintah salin). Rollback tetap dua cara:
otomatis kalau health gagal, atau manual `--ke <commit-lama>`.

Sesudah deploy berhasil (atau sesudah rollback), skrip menulis tag yang benar-benar
jalan ke `SEWARA_API_IMAGE` di `sewara-api/.env`. Alasannya: `sewara.service`
menjalankan `up -d` tanpa env itu, jadi reboot memakai nilai di `.env` — kalau
dibiarkan menunjuk tag lama yang sudah tak ada, unit gagal saat boot.

Dasar "build di server" itu sah, bukan jalan buntu: dokumen Docker sendiri
menyuruh begitu untuk compose satu server —
<https://docs.docker.com/compose/how-tos/production/> ("The easiest way to deploy
an application is to run it on a single server"; "Deploying changes":
`docker compose build web` lalu `docker compose up --no-deps -d web`). Gerbang
health-nya memakai `--wait` / `--wait-timeout` (Compose v2.1.1+), bukan loop curl
buatan sendiri. Pola `docker compose pull` hanya berlaku kalau image diambil dari
registry, dan proyek ini sengaja tidak memakai registry/CI.

## nginx host: dua tahap cutover (produksi)

Ada **dua** nginx dan pemiliknya beda:

| Lapis | Berkas | Domain? | Siapa mengurus |
|---|---|---|---|
| nginx host (VPS) | `/etc/nginx/sites-enabled/<vhost>` | ya (`server_name`, sertifikat) | **kamu** — skrip deploy tidak pernah menyentuhnya |
| nginx `edge` (container) | `deploy/nginx.staging.conf` | tidak (`server_name _;`, `Host $host`) | kode — ikut compose |

Karena `edge` tidak memuat domain, ganti domain/typo tidak menuntut perubahan
container; yang berubah hanya DNS, vhost host, dan `api.env`
(`FRONTEND_URL`/`PUBLIC_API_URL`). Sama polanya dengan unit systemd: skrip hanya
mengingatkan, tidak mengeksekusi.

Vhost produksi sekarang: 80 → redirect 443, 443 TLS origin cert,
`/api/` → `localhost:4000` (API Next), `/` → `localhost:3002` (Next).

| Tahap | `location /api/` | `location /` | Yang jalan |
|---|---|---|---|
| sekarang | `localhost:4000` | `localhost:3002` | Next API + Next UI |
| 1. hybrid | `127.0.0.1:8098` | `localhost:3002` | Go API + Next UI |
| 2. penuh | *(dihapus)* | `127.0.0.1:8090` | `edge` menyajikan frontend statis + `/api` |

Tahap 1 cuma satu baris `proxy_pass`; frontend Next tetap hidup dan rollback =
kembalikan barisnya (instan, tanpa build). Tahap 2 memindahkan pembagian path ke
`edge`, jadi host nginx turun pangkat jadi pintu TLS:

```nginx
server {
    listen 80;
    server_name app.sewara.my.id;
    location / { return 301 https://$host$request_uri; }
}

server {
    listen 443 ssl;
    http2 on;                                  # nginx >= 1.25: `listen 443 ssl http2` usang
    server_name app.sewara.my.id;

    ssl_certificate     /etc/nginx/ssl/sewara-origin.crt;
    ssl_certificate_key /etc/nginx/ssl/sewara-origin.key;

    # proxy_* di level server diwarisi location (beda dengan add_header)
    client_max_body_size 10m;
    proxy_read_timeout 120s;
    proxy_send_timeout 120s;
    proxy_buffer_size 32k;
    proxy_buffers 8 32k;
    proxy_busy_buffers_size 64k;

    location / {
        proxy_pass http://127.0.0.1:8090;       # edge: statis + /api -> api:4000
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

`127.0.0.1:8090` tidak perlu dibuka ke publik (`SEWARA_EDGE_BIND=127.0.0.1` di
prod), jadi hanya 80/443 yang mendengarkan — sama seperti sekarang. Kalau lebih
suka pemisahan eksplisit (log per path, penyangga khusus API), tahap 2 boleh tetap
dua blok: `/api/` → `127.0.0.1:8098`, `/` → `127.0.0.1:8090`. Dua-duanya sah; satu
upstream lebih sedikit tempat untuk salah.

Tiga hal yang harus cocok di tahap 1, kalau tidak login "gagal" tanpa pesan jelas:
`APP_ENV=production` (cookie `Secure`), `FRONTEND_URL`/`PUBLIC_API_URL` = domain
aplikasi, dan `X-Forwarded-Proto $scheme` terkirim (backend memakainya untuk tahu
aslinya https). Pakai `127.0.0.1:8098`, bukan `localhost`, supaya tidak menembak
`::1`.

Sesudah tiap tahap: `curl -s https://app.sewara.my.id/api/health` → 200 dan halaman
login tampil.

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

## Backup ke luar host (rclone → R2 akun terpisah)

Tujuan backup **sebaiknya akun R2 terpisah** dari bucket aplikasi (produksi):
kunci produksi tidak boleh bisa menghapus backup, dan `.env` produksi tidak perlu
memuat kunci yang tidak dipakai aplikasi.

Alur: `scripts/backup.sh` (dump -Fc + verifikasi + sha256 + rotasi lokal) →
`ExecStartPost` di `deploy/systemd/sewara-backup.service` menjalankan
`scripts/backup-rclone.sh` (copy → check hash → rotasi remote).

### Isi kredensial (kamu sendiri; jangan pernah dikirim ke chat)

`/etc/sewara/rclone.conf`, mode 600:

```ini
[r2backup]
type = s3
provider = Cloudflare
access_key_id = <dari akun backup>
secret_access_key = <dari akun backup>
endpoint = https://<account-id-akun-backup>.r2.cloudflarestorage.com
acl = private
```

- Buat token R2 khusus bucket backup (idealnya hanya bucket itu) — bukan token
  akun. Bucket dump terpisah, mis. `sewara-backup`, prefix `db`. Token cukup
  **Object Read & Write pada bucket itu**; izin tingkat bucket tidak diperlukan
  (dan kalau tidak ada, skrip tetap jalan asalkan `--s3-no-check-bucket` dipakai
  dan `rclone mkdir` tidak dipanggil — lihat §Hasil uji).
- Nama remote (`r2backup`) bebas; samakan dengan `RCLONE_REMOTE` di unit.
- Supaya backup tahan hapus: aktifkan Object Lock/retention **di dashboard
  Cloudflare** (token objek tidak bisa mengaturnya) — `--min-age` hanya rotasi
  normal, bukan proteksi dari penghapusan.

### Verifikasi jalur (sebelum diandalkan)

```bash
sudo systemctl start sewara-backup.service
systemctl status sewara-backup.service --no-pager
journalctl -u sewara-backup.service -n 30 --no-pager
```

Harus terlihat `[backup] ok dump=...` lalu `[rclone] ... 0 differences found`
beserta daftar isi tujuan. Upload gagal atau hash beda → unit FAILED.

### Unduh balik (drill restore dari tujuan)

```bash
rclone --config /etc/sewara/rclone.conf copy r2backup:sewara-backup/db/<berkas>.dump /srv/sewara/restore/
rclone --config /etc/sewara/rclone.conf check /srv/sewara/restore r2backup:sewara-backup/db
```

Restore ke DB scratch dulu (prosedur di `runbook-migrasi-mesin.md`), jangan
langsung ke DB produksi.

### Hasil uji 2026-10-30 (kredensial asli, akun R2 backup terpisah)

Ujung-ke-ujung dibuktikan di homelab: dump + `.sha256` naik ke bucket
(`2 matching files`), `rclone check` → `0 differences found`, **diunduh balik ke
folder lain dan `sha256sum -c` lulus**, rotasi retensi 0 hari mengosongkan tujuan,
berkas sumber tetap utuh. Semua RC=0.

Dua hal yang WAJIB diingat dari uji ini (kalau dilupakan, backup gagal total):

- **Jangan `rclone mkdir`** di tujuan S3/R2: token yang dibatasi hanya ke satu
  bucket akan ditolak `CreateBucket` 403 dan seluruh upload batal. `copy` sudah
  membuat prefix sendiri.
- **Pakai `--s3-no-check-bucket`** (sudah ada di skrip): tanpa itu rclone menyentuh
  `HeadBucket`/`CreateBucket` yang ditolak token objek.

Yang wajar muncul di log: `GetBucketVersioning ... 403 AccessDenied` saat hapus —
rclone lanjut "assuming unversioned" dan penghapusan tetap berhasil (RC=0).
Konsekuensinya: **Object Lock/retention hanya bisa diatur di dashboard Cloudflare**,
bukan lewat rclone. Rotasi juga bisa diserahkan ke lifecycle rule bucket kalau mau.

Catatan teknis lain: image `rclone/rclone` berbasis **alpine tanpa bash** → skrip
ditulis POSIX `sh` dan unit memakai `--entrypoint sh` (kalau tidak:
`bash: executable file not found`). `--user root` perlu untuk membaca kunci mode
600; folder backup di-mount **read-only**.

Lapis ketiga (menarik dari R2 → artifact 90 hari) bersifat opsional dan
**ditunda**: jalur backup resmi sekarang tetap manual/sederhana (dump → R2 akun
terpisah), tanpa CI.

## Konsol DB (Adminer)

Adminer = padanan phpMyAdmin untuk Postgres (lihat tabel, jalankan SQL,
import/export). Ini **bukan** dashboard aplikasi — dashboard bisnis tetap
frontend + API Go. Adminer setara akses root DB, jadi perlakuannya sama seperti
kunci SSH.

**Keputusan 2026-10-30: sementara cukup lewat SSH tunnel** (Cloudflare Access
ditunda, jalur & langkahnya tetap dicatat di bagian bawah supaya tidak perlu
dirancang ulang). Adminer tetap di profil `admin` supaya tidak ikut jalan di
mesin 1 GB:

```bash
# di VPS: jalankan Adminer (loopback saja, tidak ada port publik)
docker compose -f docker-compose.prod.yml --profile admin up -d adminer
# matikan setelah selesai (hemat memori)
docker compose -f docker-compose.prod.yml --profile admin stop
```

Dari laptop:

```bash
ssh -L 8081:127.0.0.1:8081 <user>@<vps>    # lalu buka http://localhost:8081
```

Login Adminer: server `db`, user `sewara`, database `sewara`, password dari
`/etc/sewara/pg_password`.

Verifikasi: `curl -sI http://127.0.0.1:8081 | head -1` → `200`. Port 8081
**hanya** loopback; kalau perlu diakses dari HP tanpa SSH, pilihannya jalur
Cloudflare di bawah — jangan pernah membuka 8081 ke publik.

### Nanti: Cloudflare Access (kalau mau dari HP tanpa SSH)

Sudah disiapkan di compose sebagai profil `tunnel`; tinggal dihidupkan bersama
Adminer:

```bash
docker compose -f docker-compose.prod.yml --profile admin --profile tunnel up -d
```

Langkah dashboard Cloudflare (sekali saja):

1. Zero Trust → Networks → Tunnels → **Create tunnel** (Cloudflared), mode
   remotely managed. Salin token ke VPS:
   `sudo mkdir -p /etc/sewara/cloudflared && sudo install -m 600 /dev/stdin /etc/sewara/cloudflared/token`
   (tempel token, Enter, Ctrl-D). **Jangan pernah menempel token ke chat.**
2. Di tunnel yang sama → Public hostname → tambah `dbadmin.sewara.my.id` →
   service `http://adminer:8080` (`adminer` = nama service di network
   `sewara_internal`). Pakai hostname terpisah dari `app.sewara.my.id` supaya
   tidak mengganggu vhost aplikasi.
3. Zero Trust → Access → Applications → **Add self-hosted** untuk hostname itu,
   policy `Allow`, selector `Emails` = emailmu, metode One-time PIN, durasi sesi
   pendek (mis. 8 jam).

Cek: `docker compose -f docker-compose.prod.yml logs --tail 20 cloudflared | grep -i registered`,
dan dari luar tanpa login Access `curl -sI https://dbadmin.sewara.my.id` harus
302 ke `*.cloudflareaccess.com` — kalau 200, berarti konsol DB terbuka untuk umum.

Catatan: `--token-file` berarti container harus bisa membaca berkas 600 itu; image
`cloudflare/cloudflared` standar berjalan sebagai root sehingga aman — kalau nanti
ganti varian `-nonroot`, ubah pemilik ke uid 65532.

## Deploy produksi (urutan)

Berkas: `docker-compose.prod.yml`, `deploy/systemd/*`, `deploy/nginx.staging.conf`
(`edge`), dan `sewara-api/scripts/install.sh` (pemasangan) +
`deploy-vps.sh` (deploy/rollback).

Rangkaiannya sekarang tiga langkah, bukan delapan:

1. `cd <repo> && sudo ./sewara-api/scripts/install.sh --prod --user "$USER"` —
   mengerjakan folder, grup, `pg_password`, `api.env`, `.env` compose, skema
   (tanpa seed di prod), dan tiga unit systemd. Idempoten.
2. Lengkapi `R2_*` + `SMTP_*` di `/etc/sewara/api.env`, lalu
   `cd /srv/sewara/app && ./sewara-api/scripts/deploy-vps.sh` (build ~3-5 menit,
   wajib swap; gerbang `--wait` 90 s; gagal → balik ke image lama sendiri).
3. nginx host per-path: tahap 1 `/api/` → `127.0.0.1:8098`, nanti tahap 2 `/` →
   `127.0.0.1:8090` (§nginx host). `nginx -t` → reload.

Data produksi (dump → restore) bukan bagian pemasangan: urutannya di
`checklist-deploy-vps.md` Fase B. Setelah DB berisi data asli, urutan mengikatnya
tetap: **container hidup dulu, baru routing dialihkan per-path**; rollback =
balikkan blok `location` ke Next, tanpa menyentuh container.

**Sudah diverifikasi di Linux 2026-10-30/31** (lihat §Hasil uji homelab): unit
systemd lewat `systemd-analyze verify`, bind mount + uid 999, init skema, API
`APP_ENV=production`, backup, ketahanan `down -v`, jalur rilis (deploy normal hijau
`drift 0` → health 200; deploy sengaja dirusak → rollback otomatis hijau), dan
pemasangan `install.sh` (idempoten; jalan ulang = semua "sudah ada → dibiarkan").
Yang masih menunggu di VPS: pemindahan data (Fase B) + vhost host.

## Delta produksi (belum dikerjakan)

- `docker-compose.yml` di repo ditandai **BUKAN UNTUK PRODUKSI** (password dev di
  sana). Produksi memakai file env sendiri di VPS + compose produksi terpisah;
  jangan pakai file yang sama diam-diam.
- Semua service sudah di network `internal` (bridge terpisah, tidak bergabung
  dengan container lain di host).
- `APP_ENV=production` (cookie jadi `Secure`), semua secret asli dari file env di
  VPS (bukan di repo), `EMAIL_TOKEN_SECRET`/`FRONTEND_URL`/SMTP wajib terisi,
  R2 wajib lengkap — `config.Load()` gagal cepat kalau kurang.
- Port API jangan dipublikasikan ke publik: bind `127.0.0.1:8098:4000`, `edge`
  `SEWARA_EDGE_BIND=127.0.0.1:8090` di prod; nginx host yang jadi edge
  (Cloudflare Full strict + HSTS tidak diubah).
- `pgdata` di **bind mount folder host** (`/srv/sewara/pgdata`, uid 999) +
  monitoring disk; `logging` json-file dibatasi (10m × 3) supaya tidak menelan disk VPS.
  Bind mount inilah yang membuat data kebal `down -v`, `volume prune`, dan
  `system prune --volumes` (terbukti di homelab).
- Password DB produksi jangan lewat `environment:` compose (bisa dibaca
  `docker inspect`): pakai `POSTGRES_PASSWORD_FILE` + file mode `600` di VPS,
  dan `DATABASE_URL` di `/etc/sewara/api.env` (mode `640 root:sewara`, bukan di repo).
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
2. Homelab staging: **selesai dipasang permanen 2026-10-31** di `/srv/sewara`
   (`app` = clone GitHub branch `dev`, `www` = static export frontend, `pgdata`,
   `backup`, `schema`) + `/etc/sewara` (api.env, pg_password, rclone kosong),
   tiga unit systemd aktif, `edge` menyajikan `http://10.1.1.121:8090`.
   Terverifikasi: `tabel=29 policy=27 ledger=5 members=6 users=5`, tiga container
   Up (api & db healthy), `login: 200`. Yang belum: `deploy-vps.sh frontend` sekali
   setelah dasar alamat API jadi relatif (`bb6a840`; bundel lama masih memuat
   `localhost:4000`/`10.1.1.121`), lalu `deploy-vps.sh` mode auto untuk memastikan
   `/srv/sewara/api-image.txt` tertulis; isi `rclone.conf` + jalankan
   `sewara-backup.service` sekali; dan arahkan cloudflared ke stack ini kalau mau
   dipakai sebagai staging ber-URL.
   Kondisi mesin: `rizkiserver`, Ubuntu 26.04, 2 vCPU, RAM 1,4 GB, disk 46 GB
   sisa; yang sudah jalan: nginx, `postgresql@18` host, cloudflared, tailscaled,
   samba, hermes (RSS ±310 MB). Node untuk build frontend: `/usr/bin/node` →
   `/www/server/nodejs/v24.20.0/bin/node`.
3. Cutover frontend + nginx per-path (Januari 2027). Vhost produksi sudah dibaca
   2026-10-31 (`/api/` → `localhost:4000`, `/` → `localhost:3002`), jadi flip
   tahap 1 menyalin perilaku, bukan menebak. Bentuk lengkapnya di §nginx host,
   jendelanya di `cutover-plan.md` §7/§8.
4. ~~Ganti `sewara-backup` REST → `pg_dump`; tambah backup R2 (rclone)~~ — selesai
   2026-10-30: dump + `.sha256` + rotasi lokal, copy ke R2 **akun terpisah** dengan
   verifikasi hash dan unduh-balik terbukti. Sisa: isi `rclone.conf` (di VPS belum
   ada, di homelab masih kosong) dan matikan jalur REST lama supaya tidak ada dua
   isi backup. Ingat: timer sudah `enable --now` dari `install.sh`, jadi unit akan
   `failed` tiap 12 jam selama `rclone.conf` kosong.
5. Migrasi data produksi (dump dari Supabase produksi → restore ke DB produksi baru)
   dengan urutan drift-check seperti `AGENTS.md` aturan 5; restore dilakukan di
   mesin besar, bukan di t3.micro.
6. Jalur belum terbukti: SMTP nyata (`auth/callback`) — **keputusan 2026-10-30:
   pakai Resend lewat SMTP port 587**, nilai diambil dari produksi sekarang (tanpa
   perubahan kode); juga belum terbukti: ZIP export pembayaran, stream `photo`,
   unggah bukti bayar ke R2.
7. Ukuran root volume EBS produksi belum diketahui — perlu dicek sebelum
   menetapkan lokasi `/srv/sewara/pgdata` + rotasi dump.
8. Jalur rilis sudah ditetapkan dan dilatih: `git pull` → build **di VPS** →
   `deploy-vps.sh` (cek drift ledger, health, rollback otomatis). CI/GHCR **tidak
   dipakai** — berkas `.github/workflows/build-image.yml` dihapus 2026-10-30 atas
   keputusan user (manual, hindari otomatisasi). Build di VPS terukur 207 detik /
   669 MB / swap 387 MB, tanpa OOM.
9. **Utang data 2026-10-31 (temuan real use homelab):** elemen `transactions.items`
   tanpa `ref` menjatuhkan `/dashboard/booking` (Next 16 menampilkan "This page
   couldn't load"; `booking/page.js:2825` membaca `i.ref.nama`).
   Perbaikan disetujui: normalisasi di `lib/db.js` (batas baca) — **ditunda sampai
   dekat rilis**, karena produksi Next masih dipakai untuk maintenance.
   Rincian lengkap + daftar baris yang ikut pola sama: `cutover-plan.md` §11.
