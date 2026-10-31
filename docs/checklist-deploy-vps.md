# Checklist deploy di VPS produksi (t3.micro, 1 GB)

Ringkas dan berurutan. Detail/alasan ada di
[`docker-runbook.md`](./docker-runbook.md) — di sini hanya langkah, titik
verifikasi, dan rollback.

**Sejak 2026-10-31 pemasangan bukan lagi langkah manual.** Satu skrip idempoten
(`sewara-api/scripts/install.sh`) membangun seluruh mesin: folder, grup, rahasia
yang bisa dibangkitkan sendiri, `.env`, skema, unit systemd, deploy pertama. Yang
tetap manual hanya tiga hal, dan memang sengaja begitu:

1. kredensial pihak ketiga (R2, SMTP, rclone) — hanya kamu yang punya;
2. vhost nginx host — pemegang 80/443 + sertifikat, skrip tidak pernah menyentuhnya;
3. pemindahan data produksi (**Fase B**), yang wajib dilatih dulu.

**Batas penting:** checklist ini hanya sampai "stack hidup dan sehat di mesin".
Latihan dump/restore/migration ada di Fase B, bukan dikerjakan sambil live.

---

## Fase A — mesin + stack kosong

### A1. Prasyarat

```bash
sudo apt update && sudo apt install -y docker.io docker-compose-v2 git openssl
sudo systemctl enable --now docker
docker compose version     # harus v2.x (butuh >= 2.1.1 untuk gerbang `--wait`)
swapon --show              # WAJIB ada isinya: tanpa swap, build Go OOM
free -m | head -2
```

Repo **tidak** perlu di-clone manual — `install.sh` meng-clone sendiri (atau
menarik branch kalau `/srv/sewara/app` sudah ada). Kalau skrip dijalankan dari
luar repo git, sebutkan `--repo <url>`.

### A2. Satu perintah: install.sh

```bash
cd <repo> && sudo ./sewara-api/scripts/install.sh --prod --user "$USER"
```

Jalur dev/homelab (staging) tidak perlu opsi apa pun — default `--branch dev`,
`APP_ENV=development`, frontend static ikut dibangun:

```bash
sudo ./sewara-api/scripts/install.sh
```

Opsi lain: `--no-deploy` (pasang saja), `--root`, `--etc`, `--branch`, `--user`.
Idempoten: apa pun yang sudah ada **dibiarkan**, jadi aman dijalankan berulang.

Yang dikerjakan skrip (14 langkah):

| Langkah | Isi |
|---|---|
| prasyarat | root, user operator ada, `docker`/`git`/`openssl` + plugin compose ada, `npm` terlihat di shell login operator (peringatan saja) |
| jaringan | `precedence ::ffff:0:0/96 100` ke `/etc/gai.conf` bila belum ada, lalu restart docker |
| grup | `sewara` + `docker` untuk operator (berlaku setelah login ulang) |
| folder | `/srv/sewara/{app,www,backup,restore,schema}`, `pgdata` `0700 999:999`, `/etc/sewara` `0750 root:sewara` |
| repo | clone/pull branch, jadi milik operator |
| rahasia | `pg_password` acak (`600 root`), `api.env` lengkap (`640 root:sewara`, rahasia acak), `rclone.conf` kosong (`600`) |
| compose env | `sewara-api/.env` (`SEWARA_APP_ENV/DATA_DIR/API_IMAGE/EDGE_BIND/BRANCH/STATE_FILE/FRONTEND_STATIC/WWW_DIR/EDGE`) |
| db | `up -d --wait db`, lalu muat skema **sekali** (bootstrap → baseline → migrations, ledger diisi runner; seed hanya di jalur dev) |
| systemd | tiga unit dipasang, `sewara.service` **enable tanpa `--now`** (yang menaikkan stack adalah deploy), timer backup `enable --now` |
| deploy | prod: **tidak** otomatis (R2/SMTP masih kosong). dev: dijalankan sebagai operator kalau grup docker sudah efektif |

Catatan jalur dev: `SEWARA_FRONTEND_STATIC=1` dan port edge `0.0.0.0:8090`.
Jalur prod: `SEWARA_FRONTEND_STATIC=0` (frontend masih Next/pm2) dan edge bind
`127.0.0.1`.

### A3. Kredensial di `/etc/sewara/api.env`

```bash
sudo nano /etc/sewara/api.env
```

Yang sudah diisi skrip: `APP_ENV`, `ADDR`, `DATABASE_URL` (password sama dengan
`/etc/sewara/pg_password`), `SESSION_TTL`, `FRONTEND_URL` + `PUBLIC_API_URL`
(`https://app.sewara.my.id` di prod), `EMAIL_TOKEN_SECRET`,
`WEBHOOK_TELEGRAM_SECRET`, `PURGE_SECRET`, nama kunci SMTP/R2/Telegram (kosong).

Yang perlu kamu isi:

- `R2_*` (endpoint, key, secret, bucket) — wajib di prod, kalau tidak API menolak start.
- `SMTP_*` — Resend lewat **port 587 STARTTLS** (`smtp.resend.com`, user `resend`,
  `SMTP_PASS` = API key). **Jangan 465**: `smtp.SendMail` Go
  (`internal/mail/mail.go:78`) tidak bisa TLS implisit.
- `TELEGRAM_*` kalau notifikasi Telegram dipakai.
- Jangan diubah sendiri: pemilik `640 root:sewara` dan mode `pg_password` `600 root`
  sudah benar (operator membaca lewat grup `sewara`, daemon lewat `secrets:`).
  Jangan tulis `DATABASE_URL` dengan password berbeda dari `pg_password`.

Nilai lama (R2, SMTP, Telegram, secret) bisa disalin dari env Next yang sekarang
jalan di VPS — jangan ditempel ke chat:

```bash
sudo grep -E '^(R2_|SMTP_|EMAIL_|TELEGRAM_|WEBHOOK_|PURGE_)' <path>/.env
```

Referensi nama kunci: `sewara-api/.env.prod.example` + `internal/config/config.go`.

Deploy pertama (build ~3-5 menit, butuh swap):

```bash
cd /srv/sewara/app
./sewara-api/scripts/deploy-vps.sh           # auto: bangun yang berubah
```

Skrip berhenti sendiri kalau ada berkas migration belum tercatat di ledger
(**drift ≠ 0**), dan balik ke image sebelumnya kalau `/api/health` tidak lulus
dalam 90 detik. Tanpa data produksi, login masih gagal (belum ada akun) — health
200 sudah cukup sebagai bukti stack hidup.

### A4. Backup ke R2 (akun terpisah)

```bash
sudo nano /etc/sewara/rclone.conf         # mode 600 sudah diset skrip
sudo systemctl start sewara-backup.service
journalctl -u sewara-backup.service -n 30 --no-pager
```

Harus terlihat `[backup] ok dump=...` lalu `[rclone] ... 0 differences found`.
`GetBucketVersioning 403` wajar; `CreateBucket 403` = skrip rclone versi lama.

**Penting:** `install.sh` meng-`enable --now` timer-nya. Selama `rclone.conf`
masih kosong, unit akan `failed` tiap 12 jam — jadi isi segera, atau matikan dulu:

```bash
sudo systemctl disable --now sewara-backup.timer   # kalau kredensial belum siap
sudo systemctl enable --now sewara-backup.timer    # sesudah rclone.conf terisi
```

### A5. nginx host per-path (tahap 1 → tahap 2)

Yang **tidak** disentuh skrip: vhost host. `deploy/nginx.staging.conf` (container
`edge`) tidak memuat domain sama sekali (`server_name _;`,
`root /usr/share/nginx/html`, `/api/` → `api:4000`), jadi domain hanya hidup di
DNS, vhost host, dan `api.env`.

Tahap 1 — hybrid (Go API, frontend Next tetap disajikan):

```bash
sudo cp /etc/nginx/sites-enabled/appsewara /etc/nginx/sites-enabled/appsewara.bak
# ubah: location /api/ { proxy_pass http://localhost:4000; }  ->  http://127.0.0.1:8098;
sudo nginx -t && sudo systemctl reload nginx
```

Tahap 2 — penuh (sesudah tahap 1 stabil; frontend static disajikan `edge`):

```nginx
# blok `location /api/` dihapus, sisanya diteruskan ke edge (8090)
location / {
    proxy_pass http://127.0.0.1:8090;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

Dua hal kecil di vhost yang ada sekarang:

- `listen 443 ssl http2;` usang sejak nginx 1.25 → `listen 443 ssl;` + `http2 on;`.
- `proxy_pass http://localhost:4000` untuk Go sebaiknya `127.0.0.1:8098` (hindari
  `::1`, dan port 4000 di host itu milik Next API).

Rollback tiap tahap = kembalikan blok `location` dari `.bak` lalu
`nginx -t && systemctl reload nginx`. Container tidak perlu disentuh.

### A6. Verifikasi

```bash
curl -s -o /dev/null -w 'health=%{http_code}\n' http://127.0.0.1:8098/api/health   # 200
curl -s -o /dev/null -w 'domain=%{http_code}\n' https://app.sewara.my.id/api/health
docker stats --no-stream | head -5
free -m | head -2
```

Uji berurutan sesudah flip: login, dashboard, members, transactions, unggah bukti
bayar, export ZIP, cetak invoice.

### A7. Setelah selesai

- Catat di runbook: RPO nyata = 12 jam (timer), lokasi dump, tanggal drill restore
  terakhir.
- `systemctl list-timers sewara-backup.timer` + `journalctl` sekali lagi; catat
  angka nyata (bukan perkiraan).
- Matikan `sewara-backup` lama (jalur REST/PostgREST) supaya tidak ada dua sumber
  backup yang berbeda isi.
- Belum diaktifkan sampai diminta: Adminer (`--profile admin`) dan Cloudflare
  Access (`--profile tunnel`).

---

## Fase B — memindahkan data produksi (LATIH DULU, jangan dadakan)

Urutan yang harus diuji sebelum menyentuh produksi:

1. `bootstrap/` → skema baseline (`schema_prod_20260930.sql` tanpa baris `pg_net`)
   → dump **data** dari Supabase produksi → `migrations/` → isi ledger.
   (Jalur `install.sh` memuat skema tanpa seed di prod, jadi langkah pertama sama —
   yang ditambahkan hanya impor data.)
2. `pg_dump --data-only` dari Supabase (atau dump penuh, dengan baris ekstensi yang
   bermasalah dibuang) supaya tidak menabrak objek yang sudah ada.
3. Karena `20261002_penyewa_blacklist.sql` **sudah** dijalankan di Supabase
   produksi, tabelnya ikut ada di dump → migration itu bisa gagal "already exists".
   Ini yang harus dipastikan dulu (idempoten atau di-skip dengan alasan yang
   tercatat), bukan ditebak saat produksi.
4. Cocokkan `members`, `users`, dan `schema_migrations` produksi lama vs baru,
   lalu jalankan drill restore dari dump yang sudah naik ke R2.
5. **Audit bentuk `items` sebelum rilis** (utang 2026-10-31: item tanpa `ref`
   menjatuhkan halaman booking — rincian di `cutover-plan.md` §11):

   ```sql
   SELECT count(*) FROM transactions t
    WHERE jsonb_typeof(t.items) = 'array'
      AND EXISTS (SELECT 1 FROM jsonb_array_elements(t.items) e WHERE e->'ref' IS NULL);
   ```

   Hasil ≠ 0 → tanam normalisasi di `sewara-frontend/src/lib/db.js` (batas baca)
   lebih dulu, lalu bangun ulang frontend. Jangan menambal di DB produksi.

Kesimpulan: Fase B perlu satu sesi latihan sendiri di homelab dengan dump
percobaan, sebelum jadwal cutover. Rencana jendelanya di
[`cutover-plan.md`](./cutover-plan.md) §7.
