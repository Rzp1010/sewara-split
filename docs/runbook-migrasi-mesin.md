# Runbook — backup & migrasi mesin (Sewara)

Pelengkap `docs/docker-runbook.md`. Isinya: apa yang harus ada di luar VPS, cara
memindahkan semuanya ke mesin baru, dan cara backup yang sudah diuji.

## Pembagian data (kenapa migrasi mesin tidak seram)

| Data | Tinggal di mana | Kalau VPS mati |
|---|---|---|
| Skema + data relasional | Postgres (volume/bind mount di VPS) | **harus punya dump** — satu-satunya bagian yang perlu diselamatkan |
| Berkas pengguna (foto member, bukti bayar, header invoice) | Cloudflare R2 | aman, tidak di VPS |
| Kode | Git repo | aman |
| Config nginx | repo | aman |
| Secret/env (`DATABASE_URL`, R2, SMTP, `EMAIL_TOKEN_SECRET`, Telegram) | file env di VPS | **harus punya salinan terenkripsi** — tanpa ini mesin baru gagal start |
| DNS / TLS | Cloudflare | perlu akses akun dari perangkat lain |

Aturan portabilitas §8 (tidak menyimpan state pengguna di disk server) membuat
bagian tersulit migrasi mesin — memindahkan berkas biner — memang tidak ada.

## Kotak darurat (siapkan sebelum dibutuhkan)

- [ ] Akses Git repo (SSH key / token) tersedia dari perangkat lain, bukan hanya VPS.
- [ ] Salinan **terenkripsi** file env produksi (password DB, kredensial R2, SMTP, `EMAIL_TOKEN_SECRET`, `WEBHOOK_TELEGRAM_SECRET`, `PURGE_SECRET`, `TELEGRAM_CHAT_ID`).
- [ ] Akses akun Cloudflare + tahu TTL record aplikasi.
- [ ] Dump terbaru sudah keluar dari host (lihat bagian Backup).
- [ ] Kredensial R2 untuk akses objek (dipakai aplikasi; aman kalau ada salinan).
- [ ] Angka RPO/RTO yang disepakati (lihat bawah).

## RPO / RTO

| Angka | Arti | Nilai sekarang |
|---|---|---|
| RPO | banyak data yang boleh hilang | mengikuti jadwal dump — target 12 jam |
| RTO | lama layanan boleh mati | target ±1 jam (restore + up + DNS) |

Tulis nilainya setelah jadwal backup benar-benar berjalan. Jangan diasumsikan.

## Backup: cara menjalankan

`scripts/backup.sh`: `pg_dump -Fc` → **verifikasi dump bisa dibaca ulang** →
`sha256` → rotasi (simpan semua 7 hari, lalu 1 per hari sampai 28 hari). Keluar
`exit 1` kalau dump tidak lolos verifikasi — backup yang tidak diverifikasi tidak
dihitung backup.

Uji nyata di laptop (dijalankan dari container `postgres:16` di network compose,
sehingga VPS tidak perlu memasang klien psql di host):

```powershell
docker run --rm --network sewara-staging_internal `
  -e PGHOST=db -e PGUSER=sewara -e PGPASSWORD=sewara_dev -e PGDATABASE=sewara -e BACKUP_DIR=/backup `
  -v "E:\Aplikasi Inventory\sewara-split\sewara-api\scripts\backup.sh:/s/backup.sh:ro" `
  -v "E:\sewara-backup:/backup" `
  postgres:16 bash /s/backup.sh
```

Di VPS bentuknya sama; yang berbeda hanya `PGHOST=db` (nama service compose) dan
folder tujuan. Penjadwalan sudah disiapkan sebagai unit systemd:
`deploy/systemd/sewara-backup.service` + `sewara-backup.timer` (12 jam sekali,
`Persistent=true`). Timer aplikasi lain tetap ticker Go di dalam API — ini
penjadwalan operasional, bukan logika aplikasi.

Periksa unit dulu sebelum mengaktifkan (belum diuji di Linux):
```bash
systemd-analyze verify /etc/systemd/system/sewara-backup.service /etc/systemd/system/sewara-backup.timer
```


Hasil uji 2026-10-30: dump 170.504 byte, `tabel_data=31`, sha256 tertulis; rotasi
menghapus duplikat hari yang sama dan yang lebih tua dari 28 hari; jalan dua kali
berturut-turut `exit 0` (dump hari ini tidak dihapus). Unit systemd-nya sudah lolos
`systemd-analyze verify` di homelab (bersih).

**Menyalin dump keluar host — sudah ada skripnya:** `sewara-api/scripts/backup-rclone.sh`
dipanggil sebagai `ExecStartPost` di `deploy/systemd/sewara-backup.service`
(image `rclone/rclone:1.75`, konfigurasi dari `/etc/sewara/rclone.conf`).
Alur: `copy` → `check` (bandingkan hash, bukan cuma keberadaan berkas) → rotasi di
sisi tujuan. Detail + cara mengisi kredensial: `docs/docker-runbook.md`
§Backup ke luar host. Ini juga pengganti `sewara-backup` yang sekarang masih
memakai REST Supabase/PostgREST dan akan mati setelah Go menjadi edge.

Catatan penempatan: folder backup jangan satu disk dengan `pgdata` kalau bisa.

## Migrasi ke mesin baru — jalur darurat (disk/VPS hilang)

Dibuktikan 2026-10-30 di laptop dengan project compose terpisah dan volume kosong:
dari **satu berkas dump** → DB utuh → API jalan → login berhasil.

1. Mesin baru: pasang Docker + git, buat folder data.
2. `git clone` repo, siapkan file env produksi (dari kotak darurat).
3. `docker compose up -d db` (volume kosong).
4. Buat role yang dirujuk policy — dump tidak memuat definisi role:
   ```powershell
   docker compose exec -T db psql -U sewara -d sewara -c "CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;"
   ```
   (Di VPS, `sewara` sudah dibuat oleh `POSTGRES_USER`.)
5. Restore dump terbaru:
   ```powershell
   docker compose cp dump-terbaru.dump db:/tmp/r.dump
   docker compose exec -T db pg_restore -U sewara -d sewara --no-owner /tmp/r.dump
   ```
   Harus **0 error**. Tanpa langkah 4 akan muncul
   `role "authenticated" does not exist` / `role "sewara" does not exist`.
6. `docker compose up -d api` → cek `/api/health`, login satu akun.
7. Cocokkan ledger dengan repo (aturan rilis `AGENTS.md`):
   ```powershell
   docker compose exec -T db psql -U sewara -d sewara -c "SELECT filename FROM schema_migrations ORDER BY 1"
   ```
8. Arahkan DNS Cloudflare ke IP baru; pasang nginx host dari config repo.
9. Jalankan `scripts/backup.sh` sekali di mesin baru (pastikan jalur dump hidup lagi).

Yang **tidak** dibutuhkan: menyalin folder `pgdata`, berkas R2, atau mengubah kode.

## Migrasi terencana (pindah/ganti disk, OS install ulang)

Hanya kalau disk lama masih hidup dan versi Postgres sama — tidak berlaku untuk
kasus darurat:

```powershell
docker compose stop db                       # shutdown bersih, wajib
rsync -a /srv/sewara/pgdata/ barumesin:/srv/sewara/pgdata/
# di mesin baru:
chown -R 999:999 /srv/sewara/pgdata          # uid postgres image Debian
docker compose up -d
```

Lebih cepat (tanpa restore) tapi lebih rapuh: salah versi major atau salinan tidak
konsisten = DB tidak mau start. Kalau ragu, pakai jalur dump — hasilnya sama dan
sudah terbukti.

## Sisa pekerjaan (jujur, belum selesai)

1. Salin dump ke luar host (rclone ke R2) + buktikan bisa diunduh kembali —
   langkahnya sudah dicontohkan di `deploy/systemd/sewara-backup.service`
   (`ExecStartPost`, masih dimatikan).
2. Deploy unit systemd di VPS (berkas sudah ada di `deploy/systemd/`, belum
   dipasang) + tetapkan RPO nyatanya.
3. Salinan terenkripsi env produksi + isi kotak darurat di atas.
4. `docker-compose.prod.yml`: bind mount `pgdata`, `POSTGRES_PASSWORD_FILE`, port
   API hanya `127.0.0.1`, network internal.
5. Latihan migrasi ulang di mesin sungguhan (homelab) — laptop sudah membuktikan
   prosedurnya, homelab membuktikan lingkungannya.
6. Backup berkas R2 (foto/bukti bayar) — R2 tahan mesin mati, tapi bukan jaminan
   terhadap salah hapus; butuh snapshot/versioning sendiri.
