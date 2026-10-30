#!/bin/sh
# Kirim dump hasil backup.sh ke luar host (R2/objek-lain via rclone), lalu
# buktikan isinya sama, lalu rotasi di sisi tujuan.
#
# Sengaja POSIX sh (bukan bash): image rclone/rclone berbasis alpine dan TIDAK
# punya bash — menjalankan `bash /s/backup-rclone.sh` gagal dengan
# "bash: executable file not found". Tidak ada pipefail di sini; kegagalan
# tetap terdeteksi karena rclone sendiri keluar non-zero saat gagal.
#
# Dijalankan sebagai container (lihat ExecStartPost di
# deploy/systemd/sewara-backup.service):
#   docker run --rm --user root --entrypoint sh \
#     -e RCLONE_REMOTE=... -v /etc/sewara/rclone.conf:/etc/rclone/rclone.conf:ro \
#     -v /srv/sewara/backup:/backup:ro -v .../backup-rclone.sh:/s/backup-rclone.sh:ro \
#     rclone/rclone:1.75 /s/backup-rclone.sh
#
# Kredensial tidak pernah ada di repo: hanya di /etc/sewara/rclone.conf (600).
set -eu

: "${BACKUP_DIR:=/backup}"
: "${RCLONE_REMOTE:?RCLONE_REMOTE wajib diisi, mis. r2backup:sewara-backup/db}"
: "${RCLONE_CONFIG:=/etc/rclone/rclone.conf}"
: "${RETENSI_HARI:=28}"
: "${POLA:=*.dump}"

# --s3-no-check-bucket: token R2 yang dibatasi ke satu bucket ditolak pada
# operasi tingkat bucket (HeadBucket/CreateBucket -> 403), dan tanpa flag ini
# rclone mencoba CreateBucket lalu gagal total. Ditemukan saat uji 2026-10-30.
S3="--s3-no-check-bucket"

echo "[rclone] sumber=$BACKUP_DIR tujuan=$RCLONE_REMOTE retensi=${RETENSI_HARI}h"

# Sengaja TIDAK ada `rclone mkdir`: pada S3/R2 ia memicu CreateBucket, dan token
# yang dibatasi hanya ke satu bucket ditolak 403 -> upload gagal seluruhnya.
# `copy` membuat prefix sendiri.

# copy (tanpa --delete: tidak pernah menghapus berkas tak dikenal di tujuan).
rclone --config "$RCLONE_CONFIG" copy "$BACKUP_DIR" "$RCLONE_REMOTE" \
  --include "$POLA" --include "$POLA.sha256" $S3 \
  --transfers 2 --checkers 2 --stats-one-line

# Bukti terkirim: bandingkan hash kedua sisi (isi, bukan cuma keberadaan berkas).
# Beda -> exit != 0 -> unit FAILED, jadi kegagalan upload terlihat di
# `systemctl status`, bukan hilang diam-diam.
rclone --config "$RCLONE_CONFIG" check "$BACKUP_DIR" "$RCLONE_REMOTE" \
  --include "$POLA" --include "$POLA.sha256" $S3

# Rotasi sisi tujuan (sisi sumber sudah dirotasi backup.sh).
rclone --config "$RCLONE_CONFIG" delete "$RCLONE_REMOTE" \
  --include "$POLA" --include "$POLA.sha256" --min-age "${RETENSI_HARI}d" $S3

echo "[rclone] isi tujuan sekarang:"
rclone --config "$RCLONE_CONFIG" lsf "$RCLONE_REMOTE" --format "sp" $S3 | sort | tail -5
echo "[rclone] selesai"
