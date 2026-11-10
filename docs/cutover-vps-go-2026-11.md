# Cutover VPS: Next → Go (November 2026)

Status: **rencana**. Ditulis 2026-11-10 berdasarkan keadaan VPS terukur, bukan asumsi.
Rencana lama ([`cutover-plan.md`](./cutover-plan.md)) menargetkan Januari 2027 dan
menganggap stack Go sudah terpasang. Dokumen ini menggantikannya untuk jendela
yang Anda pilih: **1–3 hari**.

Prinsip: **trafik produksi tidak disentuh sampai Fase C.** Fase A dan B dikerjakan
santai di hari biasa; hanya Fase C yang butuh jendela.

Lingkup: **satu VPS** (`ip-172-31-20-4`), tanpa mesin baru. Stack Go dipasang di
samping Next yang sudah jalan; Next tetap hidup sebagai jalur rollback selama
observasi.

---

## 0. Fakta mesin (terukur 2026-11-10, VPS `ip-172-31-20-4`)

| Hal | Nilai |
|---|---|
| OS / CPU / RAM | Ubuntu 24.04, 2 vCPU, **909 MB** RAM, swap 2 GB (362 MB sudah terpakai) |
| Disk | 15 GB, **7,7 GB bebas** (47% terpakai) |
| Node | v24.21.0 (`/usr/bin/node`) |
| Go | **tidak ada** (tidak dibutuhkan: image dibangun di Docker) |
| Docker | **tidak ada** |
| Stack Go | **tidak ada**: `/srv/sewara`, `/etc/sewara`, `sewara.service` semuanya belum ada |
| PM2 | `sewara-backend` (19D) dan `sewara-frontend` (13D), keduanya `npm start`, cwd `/home/ubuntu/sewara-apps-production/sewara-split/*` = **checkout Next di branch `main`** |
| Port dengar | `0.0.0.0:80`,`0.0.0.0:443` (nginx), `*:4000` (next-server), `:3002` (next frontend, tidak muncul di `ss` karena filter) |
| nginx host | `/etc/nginx/sites-enabled/sewara-apps` → `sites-available/sewara-apps`; TLS Cloudflare Origin cert; `/api/` → `localhost:4000`; `/` → `localhost:3002` |
| Kekurangan konfigurasi | `ssl_protocols TLSv1 TLSv1.1 TLSv1.2 TLSv1.3` (TLS 1.0/1.1 masih hidup) |

Konsekuensi yang mengubah rencana lama:

1. **Mesin tetap satu, tidak ada VPS baru.** Stack Go ditumpuk **di samping** Next di
   VPS yang sama (`:8090` edge, `:8098` api — dua-duanya loopback, jadi tidak
   berebut port dengan `:4000`/`:3002`). Next tetap hidup sebagai jalur rollback.
   Yang perlu dijaga justru sumber daya bersama: RAM, disk, dan dua checkout repo.
2. Go tidak perlu dipasang di host — build terjadi di dalam image
   (`golang:1.27-alpine` → `alpine:3.21`).
3. Frontend produksi masih **Next di `:3002`**, belum static export. Cutover frontend =
   `npm run build:static` → `/srv/sewara/www`, lalu `/` diarahkan ke edge.
4. RAM sempit: Postgres (limit 384m) + api + edge (64m) + cloudflared + **dua proses
   Next yang masih hidup** harus muat di 909 MB + swap 2 GB, dan build frontend static
   butuh ~1–2 GB → **build dilakukan saat frontend Next sudah berhenti**.

---

## 1. Gate yang harus dijawab sebelum Fase C

Belum dijawab per 2026-11-10. Tanpa jawaban ini, Fase C tidak boleh dijadwalkan.

| # | Gate | Kenapa mengikat |
|---|---|---|
| G1 | Dump Supabase terakhir kapan, ukurannya berapa | Menentukan durasi reload data di jendela |
| G2 | Berapa menit downtime yang boleh | Menentukan satu jendela vs dua jendela |
| G3 | Setuju **freeze tulis** (`pm2 stop sewara-backend`) sebelum salin data final | Tanpa freeze, rollback ke Supabase kehilangan data yang masuk setelah salin |
| G4 | R2 tetap bucket produksi yang sama | Berkas tidak ikut pindah; hanya kredensial di `/etc/sewara/api.env` |
| G5 | Kredensial SMTP, Telegram, R2, password DB Supabase untuk dump | Hanya Anda yang punya; jangan pernah ditempel di chat |

---

## 2. Bentuk akhir

```
Cloudflare (Full strict, HSTS)
        │  :443
   nginx host  /etc/nginx/sites-enabled/sewara-apps
        │  proxy_pass 127.0.0.1:8090   ← satu-satunya perubahan jendela
   edge (nginx:1.27-alpine, container)
        ├── /api/  → api:4000   (Go)
        └── /      → /srv/sewara/www (static export)
   api (Go) 127.0.0.1:8098 → :4000
   db (postgres:16) pgdata di host
   cloudflared, adminer (loopback)
```

Yang **tidak berubah**: Cloudflare, sertifikat origin, nama domain, berkas di R2,
nomor invoice, data pelanggan.

Vhost target (isi akhir `sites-available/sewara-apps`):

```nginx
server {
    listen 80;
    server_name app.sewara.my.id;
    location / { return 301 https://$host$request_uri; }
}

server {
    listen 443 ssl http2;
    server_name app.sewara.my.id;

    ssl_certificate     /etc/nginx/ssl/sewara-origin.crt;
    ssl_certificate_key /etc/nginx/ssl/sewara-origin.key;
    ssl_protocols       TLSv1.2 TLSv1.3;

    # Semua trafik ke edge container; edge yang memisahkan /api/ dan static.
    location / {
        proxy_pass http://127.0.0.1:8090;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffer_size 32k;
        proxy_buffers 8 32k;
        proxy_busy_buffers_size 64k;
        client_max_body_size 10m;
        proxy_read_timeout 120s;
        client_body_timeout 120s;
    }
}
```

`client_max_body_size 10m` naik ke level `location /` supaya unggahan foto (maks 5 MB +
overhead) tetap lolos untuk semua path.

---

## 3. Fase 0 — H-1 (tanpa menyentuh produksi)

| Langkah | Perintah | Kriteria PASS |
|---|---|---|
| 0.1 Batch smoke penuh 24 skrip | di laptop: `sewara-api/scripts/smoke-*.ps1` berurutan, Docker staging | semua `exit=0`, GAGAL=0, rincian per skrip dicatat |
| 0.2 Drift ledger produksi | bandingkan `SELECT filename FROM schema_migrations` (Supabase produksi) dengan daftar `sewara-backend/supabase/migrations/*.sql` | selisih = 0; kalau ada, jalankan migration itu **sebelum** jendela |
| 0.3 Dump sah + uji restore | `sewara-api/scripts/dump-produksi.ps1` (read-only ke Supabase, butuh `SEWARA_PROD_DB_URL`) → `muat-dump-ke-staging.ps1` ke Docker staging lokal → jalankan 3 skrip smoke | dump berhasil dimuat, smoke lolos di data nyata (bukan seed) |
| 0.4 Catat titik rollback | `git -C /home/ubuntu/sewara-apps-production/sewara-split rev-parse HEAD`, `pm2 list` | SHA + status PM2 tercatat di dokumen ini |
| 0.5 Kumpulkan secret | R2, SMTP, Telegram, `PURGE_SECRET` disiapkan untuk `/etc/sewara/api.env` | semua nilai tersedia tanpa perlu tempel di chat |
| 0.6 Go masuk `main` | merge `dev` → `main`, push | `sewara-api/` ada di `main` (bukan hanya `dev`) |

Catatan 0.3: image `pg_dump` harus ≥ versi server sumber (Supabase 17.6). Skrip
memakai image `postgres:17`; kalau muncul penolakan versi, naikkan tag image-nya.
Hasil dump berisi data pelanggan + hash kredensial → folder `.dump` git-ignored,
jangan dikirim ke mana pun, hapus setelah cutover stabil.

---

## 4. Fase A — pasang stack (trafik produksi **tidak** berubah)

Semua langkah di VPS, sebagai `ubuntu` (sudo bila perlu).

```bash
# A1. Docker + compose v2
sudo apt update
sudo apt install -y docker.io docker-compose-v2 git openssl
sudo systemctl enable --now docker
sudo usermod -aG docker ubuntu      # lalu logout/login sekali
docker compose version              # harus v2.x

# A2. Pasang stack Go (profil produksi)
#     Jalankan dari checkout repo yang memuat sewara-api/ di branch main.
cd /home/ubuntu/sewara-apps-production/sewara-split
sudo ./sewara-api/scripts/install.sh --prod --branch main --user ubuntu
```

`install.sh` mengerjakan: folder `/srv/sewara/{app,www,pgdata}`, grup `sewara`,
password DB + `EMAIL_TOKEN_SECRET` + `WEBHOOK_TELEGRAM_SECRET` + `PURGE_SECRET`
(dibangkitkan sendiri, tidak dicetak), `/etc/sewara/api.env`, `/srv/sewara/.env`,
skema awal (bootstrap + migrations + `schema_prod_20260930.sql`), unit systemd,
`sewara-backup.timer`, lalu deploy pertama (image api + db + edge).

Catatan penting:

- `install.sh` **meng-clone repo sendiri** ke `/srv/sewara/app` (di disk yang sama,
  bukan mesin lain). Sisa disk 7,7 GB; perkirakan ±1 GB untuk clone + `node_modules`
  frontend saat build static. Kalau repo privat, clone akan minta kredensial: pakai
  `--repo <url>` dengan deploy key, dan pastikan token tidak tertinggal di
  `/srv/sewara/app/.git/config`.
- `--prod` menyetel `SEWARA_FRONTEND_STATIC=0` (frontend sengaja belum dibangun).
  Ini benar: build static baru dilakukan di jendela.
- Jangan jalankan `deploy-vps.sh` dulu sebelum secret diisi; api akan start tapi
  upload/email/Telegram mati.

```bash
# A3. Isi kredensial pihak ketiga (hanya Anda)
sudo nano /etc/sewara/api.env     # R2_*, SMTP_*, TELEGRAM_*, PURGE_SECRET
sudo systemctl restart sewara     # atau: sudo docker compose --env-file /srv/sewara/.env \
                                  #   -f /srv/sewara/app/sewara-api/docker-compose.prod.yml up -d api
```

**Verifikasi Fase A (semua lewat loopback, belum terlihat publik):**

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8098/api/health   # 200
curl -s -H 'Host: app.sewara.my.id' -o /dev/null -w '%{http_code}\n' \
     http://127.0.0.1:8090/api/health                                        # 200
docker compose --env-file /srv/sewara/.env \
  -f /srv/sewara/app/sewara-api/docker-compose.prod.yml ps                   # db/api/edge healthy
sudo systemctl status sewara --no-pager | head -12
free -m                                                                      # available masih > 150 MB
```

Kalau `8090/api/health` belum 200, **berhenti** — jangan lanjut ke Fase B.

---

## 5. Fase B — pindah data (trafik produksi tetap Next)

Dikerjakan di laptop (skrip dump berbasis PowerShell), target VPS lewat SSH.

```powershell
# B1. Dump data produksi (read-only terhadap Supabase)
$env:SEWARA_PROD_DB_URL = 'postgresql://postgres:<pw>@<host>:5432/postgres'
.\sewara-api\scripts\dump-produksi.ps1          # hasil: .dump\prod_public.sql, auth_users.csv, counts.txt

# B2. Muat ke Postgres VPS
.\sewara-api\scripts\muat-dump-ke-staging.ps1 -Target homelab -HomelabHost ubuntu@<ip-vps>
```

`muat-dump-ke-staging.ps1` bersifat destruktif terhadap **isi tabel** target dan
sengaja tidak menyentuh `schema_migrations` — status migrasi VPS tetap milik VPS.

**Verifikasi Fase B (wajib, jangan dilewati):**

```bash
# jumlah baris harus sama dengan counts.txt hasil dump
docker exec -e PGPASSWORD="$(sudo cat /etc/sewara/pg_password)" sewara-db-1 \
  psql -U sewara -d sewara -c "
    SELECT 'profiles' t, count(*) FROM profiles
    UNION ALL SELECT 'auth.users', count(*) FROM auth.users
    UNION ALL SELECT 'transactions', count(*) FROM transactions
    UNION ALL SELECT 'transaction_items', count(*) FROM transaction_items
    UNION ALL SELECT 'inventory', count(*) FROM inventory
    UNION ALL SELECT 'members', count(*) FROM members
    UNION ALL SELECT 'penyewa_blacklist', count(*) FROM penyewa_blacklist
    UNION ALL SELECT 'schema_migrations', count(*) FROM schema_migrations;
"
```

Lalu uji login nyata terhadap **api Go** (bukan Next), lewat loopback:

```bash
curl -s -c /tmp/go.jar -H 'Content-Type: application/json' \
  -d '{"email":"<akun-uji>","password":"<password>"}' \
  http://127.0.0.1:8098/api/auth/login -o /dev/null -w '%{http_code}\n'   # 200
curl -s -b /tmp/go.jar http://127.0.0.1:8098/api/transactions?limit=1 | head -c 200
rm -f /tmp/go.jar
```

PASS = login 200 dan transaksi milik tenant terbaca. Kalau login gagal, penyebab
tersering: `auth_users.csv` tidak termuat (hash kredensial) — perbaiki di Fase B,
jangan di jendela.

---

## 6. Fase C — jendela produksi (±20–30 menit)

Prasyarat: Fase 0, A, B semuanya PASS; G1–G5 dijawab; jam sepi.

```bash
# C1. Titik kembali (sekali lagi, segar)
cd /home/ubuntu/sewara-apps-production/sewara-split
git rev-parse HEAD | tee /tmp/rollback-sha.txt
sudo cp /etc/nginx/sites-available/sewara-apps /etc/nginx/sites-available/sewara-apps.bak-$(date +%Y%m%d-%H%M)
cat /etc/sewara/api-image.txt

# C2. Bekukan tulisan + hentikan frontend (bebaskan RAM untuk build)
pm2 stop sewara-backend sewara-frontend
free -m

# C3. Sinkronkan data terakhir (Supabase → VPS) — ulangi B1 + B2 penuh
#     (dump + load ulang, bukan delta: DB kecil, ulang penuh lebih aman)

# C4. Build frontend static ke /srv/sewara/www lalu recreate edge
cd /srv/sewara/app
SEWARA_REPO_DIR=/srv/sewara/app SEWARA_BRANCH=main SEWARA_FRONTEND_STATIC=1 \
  ./sewara-api/scripts/deploy-vps.sh frontend

# C5. Verifikasi lewat loopback SEBELUM menyentuh produksi
curl -s -H 'Host: app.sewara.my.id' -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8090/          # 200
curl -s -H 'Host: app.sewara.my.id' http://127.0.0.1:8090/ | head -c 120                              # berisi <html
curl -s -H 'Host: app.sewara.my.id' -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8090/api/health # 200

# C6. Tukar vhost (simpan salinan sudah dibuat di C1), lalu uji konfigurasi
sudo nano /etc/nginx/sites-available/sewara-apps     # pakai isi §2
sudo nginx -t && sudo systemctl reload nginx

# C7. Smoke produksi (https, jalur nyata)
curl -s -o /dev/null -w '%{http_code}\n' https://app.sewara.my.id/api/health
curl -s -o /dev/null -w '%{http_code}\n' https://app.sewara.my.id/
```

Smoke tulis: login di UI, buka satu halaman data, lalu **satu transaksi uji** di
tenant uji (bukan tenant pelanggan), hapus sesudahnya. Kalau tidak ada tenant uji,
cukup verifikasi baca + unggah foto kecil.

**Kriteria berhenti (stop & rollback) sebelum unfreeze:** health ≠ 200, halaman
kosong/404, login gagal, atau `docker logs api` menampilkan panic/`ERROR` berulang.

**Unfreeze:** biarkan `pm2 stop` (standby rollback) selama observasi. Jangan
`pm2 start` — itu akan menghidupkan job/notif Telegram ganda.

---

## 7. Fase D — observasi 1–3 hari

| Cek | Perintah | Ambang |
|---|---|---|
| API hidup | `curl -s https://app.sewara.my.id/api/health` | 200 `ok` |
| Error Go | `sudo docker compose --env-file /srv/sewara/.env -f /srv/sewara/app/sewara-api/docker-compose.prod.yml logs --since 1h api \| grep -c level=ERROR` | tidak ada lonjakan; tidak ada `panic` |
| RAM | `free -m`, `docker stats --no-stream` | available > 100 MB, tanpa OOM (`dmesg | grep -i oom`) |
| Tidak ada trafik ke Next | `sudo grep -c 'localhost:4000' /var/log/nginx/access.log` (setelah reload) | 0 |
| Backup jalan | `systemctl status sewara-backup.timer --no-pager`, `journalctl -u sewara-backup -n 30` | timer aktif, dump terbaru ada |
| Notif Telegram | transaksi uji / login uji | masuk sekali, bukan dua kali |

Setelah 3 hari tanpa insiden:

```bash
pm2 delete sewara-backend sewara-frontend
pm2 save
# opsional: arsipkan checkout Next lama
sudo mv /home/ubuntu/sewara-apps-production/sewara-split /home/ubuntu/arsip-next-202611
```

Jangan biarkan PM2 "standby" berminggu-minggu: kode Next jadi usang, skema bisa
bergeser, dan kalau sewaktu-waktu dihidupkan malah memunculkan bug lama.

---

## 8. Rollback

| Skenario | Tindakan | Kehilangan data |
|---|---|---|
| **R1** — gagal sebelum ada tulisan baru di Go (dalam jendela) | `sudo cp /etc/nginx/sites-available/sewara-apps.bak-<stamp> /etc/nginx/sites-available/sewara-apps` → `sudo nginx -t && sudo systemctl reload nginx` → `pm2 start sewara-backend sewara-frontend` | **nol** |
| **R2** — gagal setelah ada tulisan nyata di Go | Perbaiki di tempat (lihat R3), **jangan** balik ke Next: tulisan baru hanya ada di Postgres Go | — |
| **R3** — api Go error karena versi kode | `cd /srv/sewara/app && ./sewara-api/scripts/deploy-vps.sh --ke <sha>` (gerbang drift + build aman; container lama tetap melayani selama build) | nol |

Batas keputusan: begitu ada transaksi pelanggan nyata yang masuk lewat Go,
opsi rollback ke Next **hilang** (kecuali menyusun delta balik secara manual).
Karena itu keputusan "lanjut atau balik" diambil **sebelum unfreeze**, bukan
setelahnya.

---

## 9. Risiko spesifik mesin ini

| Risiko | Ukuran | Mitigasi |
|---|---|---|
| RAM 909 MB, swap sudah 362 MB terpakai | Postgres 384m + api + edge 64m + cloudflared | build static dilakukan setelah Next berhenti; pantau `free -m`; jangan jalankan `npm ci` di dua checkout bersamaan |
| Build di VPS ~3,5 menit, butuh ~700 MB | build api/frontend di jendela | swap 2 GB sudah ada; jangan build sambil layanan lain sibuk |
| `:4000` dan `:3002` dengar di semua interface | Next bisa dihubungi langsung bila SG membuka port itu | tutup 4000/3002 di security group AWS **sekarang**, tidak perlu menunggu cutover |
| `ssl_protocols` masih TLS 1.0/1.1 | lemah, sudah deprecated | diperbaiki di vhost baru (§2) |
| Dua checkout repo di satu mesin | bingung "yang mana produksi" | Next: `/home/ubuntu/sewara-apps-production/...`; Go: `/srv/sewara/app`. Jangan jalankan `git pull` di checkout lama setelah cutover |
| Repo privat saat `install.sh` meng-clone | token bisa tertinggal di `.git/config` | pakai deploy key; periksa `grep -i token /srv/sewara/app/.git/config` setelah install |
| Ledger drift | deploy-vps.sh menolak jalan | selesaikan drift di Fase 0.2, jangan pakai `SEWARA_SKIP_DRIFT=1` |

---

## 10. Lampiran

**Env wajib di `/etc/sewara/api.env`** (config gagal start bila kosong):
`DATABASE_URL`, `SESSION_TTL`, `FRONTEND_URL`, `EMAIL_TOKEN_SECRET`, `SMTP_*`
(bila `MAIL_DRIVER=smtp`), `R2_ENDPOINT/REGION/ACCESS_KEY_ID/SECRET_ACCESS_KEY/BUCKET`.
Opsional: `PUBLIC_API_URL`, `TELEGRAM_*` (kosong = notif mati), `PURGE_SECRET`
(kosong = purge nonaktif, ada warning saat start), `CORS_ORIGINS` (kosong =
same-origin), `WEBHOOK_TELEGRAM_SECRET` (kosong = webhook fail-closed 403).

**Diagnosa cepat:**

```bash
cd /srv/sewara/app
D="--env-file /srv/sewara/.env -f sewara-api/docker-compose.prod.yml"
sudo docker compose $D ps
sudo docker compose $D logs --tail=100 api
sudo docker compose $D logs --tail=50 edge
docker stats --no-stream
free -m; df -h /
```

**Urutan ringkas yang harus dipegang:**

```
Fase 0 (H-1, tanpa risiko)  →  Fase A (pasang, tanpa risiko)
   →  Fase B (data, tanpa risiko)  →  Fase C (jendela 20–30 mnt)
   →  Fase D (observasi 1–3 hari)  →  pensiun Next
```

Semua langkah di Fase 0/A/B dapat dibatalkan tanpa konsekuensi produksi
(`docker compose down` + hapus `/srv/sewara`), karena trafik masih 100% Next.