# Checklist deploy di VPS produksi (t3.micro, 1 GB)

Ringkas dan berurutan. Detail/alasan ada di
[`docker-runbook.md`](./docker-runbook.md) — di sini hanya langkah, titik
verifikasi, dan rollback.

**Batas penting:** checklist ini hanya sampai "stack hidup dan sehat di mesin".
**Memindahkan data produksi (Fase B) bukan bagian besok** — itu latihan terpisah,
karena urutan dump/restore/migration belum diuji (lihat bagian akhir).

---

## Fase A — mesin + stack kosong

### A1. Docker

```bash
sudo apt update && sudo apt install -y docker.io docker-compose-v2
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"     # logout/login lagi
docker compose version              # harus v2.x
free -m | head -2                   # lihat RAM; swap 2 GB harus sudah ada: swapon --show
```

### A2. Folder + berkas rahasia

```bash
sudo mkdir -p /srv/sewara/pgdata /srv/sewara/backup /srv/sewara/restore /etc/sewara/cloudflared
sudo chown -R 999:999 /srv/sewara/pgdata && sudo chmod 700 /srv/sewara/pgdata
openssl rand -hex 24 | sudo tee /etc/sewara/pg_password >/dev/null   # CATAT di kotak darurat
sudo cp .env.prod.example /etc/sewara/api.env
sudo nano /etc/sewara/api.env        # isi nilai asli
sudo chmod 600 /etc/sewara/pg_password /etc/sewara/api.env
```

Isi `/etc/sewara/api.env`:

- `DATABASE_URL`: password harus **sama** dengan `/etc/sewara/pg_password`.
- Nilai lama bisa disalin dari env Next yang sekarang ada di VPS
  (`R2_*`, `SMTP_*`, `EMAIL_TOKEN_SECRET`, `TELEGRAM_*`,
  `WEBHOOK_TELEGRAM_SECRET`, `PURGE_SECRET`). Jalankan `sudo grep -E '^(R2_|SMTP_|EMAIL_|TELEGRAM_|WEBHOOK_|PURGE_)' <path>/.env`
  dan salin manual; jangan ditempel ke chat.
- `APP_ENV=production`, `FRONTEND_URL`/`PUBLIC_API_URL` = domain aplikasi,
  `MAIL_DRIVER=smtp` + `SMTP_HOST`/`SMTP_FROM` wajib. `config.Load()` gagal cepat
  kalau kurang — jadi API tidak akan "hidup setengah jalan".

### A3. Kirim kode + image (JANGAN build di VPS)

Di laptop:

```powershell
git archive --format=tar -o sewara.tar dev          # atau clone di VPS dari repo
docker save sewara-api:prod -o sewara-api-image.tar
```

Salin keduanya ke VPS (scp/rsync), lalu di VPS:

```bash
tar -xf sewara.tar -C ~/sewara && cd ~/sewara/sewara-api
docker load -i ~/sewara-api-image.tar && docker images | grep sewara-api
```

### A4. Hidupkan DB (kosong), tanpa seed staging

```bash
cd ~/sewara/sewara-api
docker compose -f docker-compose.prod.yml up -d db
docker compose -f docker-compose.prod.yml ps          # health: healthy
docker inspect -f '{{range .Mounts}}{{.Type}} {{.Source}} -> {{.Destination}}{{"\n"}}{{end}}' \
  $(docker compose -f docker-compose.prod.yml ps -q db) | grep pgdata   # harus `bind`
```

**Jangan** pakai profil `init` (`db-init`) di produksi: itu memuat
`schema_prod_20260930.sql` + **seed staging** (6 member palsu, 5 akun uji) — jalur
itu khusus latihan. Produksi: skema dari bootstrap + dump data asli (Fase B).

### A5. Hidupkan API

```bash
docker compose -f docker-compose.prod.yml up -d api
docker compose -f docker-compose.prod.yml logs --tail 20 api
curl -s -o /dev/null -w "health=%{http_code}\n" http://127.0.0.1:8098/api/health   # 200
```

Catatan: tanpa data produksi, login masih akan gagal (belum ada akun) — health 200
sudah cukup sebagai bukti stack hidup.

### A6. Unit systemd

```bash
sudo cp deploy/systemd/sewara.service deploy/systemd/sewara-backup.service deploy/systemd/sewara-backup.timer /etc/systemd/system/
systemd-analyze verify /etc/systemd/system/sewara.service /etc/systemd/system/sewara-backup.service /etc/systemd/system/sewara-backup.timer
sudo systemctl daemon-reload
sudo systemctl enable --now sewara.service
systemctl status sewara.service --no-pager
```

`WorkingDirectory` di unit harus sesuai folder repo di VPS — periksa dulu.

### A7. Backup ke R2 (akun terpisah)

```bash
sudo nano /etc/sewara/rclone.conf      # [r2backup] type=s3 provider=Cloudflare + kunci akun backup
sudo chmod 600 /etc/sewara/rclone.conf
sudo systemctl start sewara-backup.service
journalctl -u sewara-backup.service -n 30 --no-pager
```

Harus terlihat `[backup] ok dump=...` lalu `[rclone] ... 0 differences found`.
Kalau `GetBucketVersioning 403` muncul: wajar. Kalau `CreateBucket 403`: skrip versi
lama (tanpa `--s3-no-check-bucket`) — perbarui.

```bash
sudo systemctl enable --now sewara-backup.timer
systemctl list-timers sewara-backup.timer
```

### A8. nginx per-path (cutover)

Baru di sini routing dialihkan, dan **per-path** — bukan sekaligus:

1. Simpan vhost sekarang sebagai cadangan: `sudo cp <vhost> <vhost>.bak`
2. Tambahkan `location /api/` → `proxy_pass http://127.0.0.1:8098;` (lihat
   `deploy/nginx.staging.conf` untuk bentuk final + header keamanan).
3. `sudo nginx -t` → `sudo systemctl reload nginx`.
4. Verifikasi: `health`, login, 3 endpoint baca lewat domain.
5. Rollback = kembalikan blok `location` dari `.bak` lalu reload. Container tidak
   perlu disentuh.

### A9. Setelah selesai

- Catat di runbook: RPO nyata = 12 jam (timer), lokasi dump, dan tanggal drill
  restore terakhir.
- `docker stats` + `free -m` sekali lagi; catat angka nyata (bukan perkiraan).
- Matikan `sewara-backup` lama (jalur REST/PostgREST) supaya tidak ada dua sumber
  backup yang berbeda isi.
- Belum diaktifkan sampai diminta: Adminer (`--profile admin`) dan Cloudflare
  Access (`--profile tunnel`).

---

## Fase B — memindahkan data produksi (LATIH DULU, jangan dadakan)

Urutan yang harus diuji sebelum menyentuh produksi:

1. `bootstrap/` → skema baseline (`schema_prod_20260930.sql` tanpa baris `pg_net`)
   → dump **data** dari Supabase produksi → `migrations/` → isi ledger.
2. `pg_dump --data-only` dari Supabase (atau dump penuh, dengan baris ekstensi yang
   bermasalah dibuang) supaya tidak menabrak objek yang sudah ada.
3. Karena `20261002_penyewa_blacklist.sql` **sudah** dijalankan di Supabase
   produksi, tabelnya ikut ada di dump → migration itu bisa gagal "already exists".
   Ini yang harus dipastikan dulu (idempoten atau di-skip dengan alasan yang
   tercatat), bukan ditebak saat produksi.
4. Cocokkan `members`, `users`, dan `schema_migrations` produksi lama vs baru,
   lalu jalankan drill restore dari dump yang sudah naik ke R2.

Kesimpulan: Fase B perlu satu sesi latihan sendiri di homelab dengan dump
percobaan, sebelum jadwal cutover.
