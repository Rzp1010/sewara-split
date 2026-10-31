#!/bin/bash
# backup.sh — dump DB Sewara (-Fc) + verifikasi + rotasi.
#
# Dijalankan dari container postgres:16 di network compose (cara yang diuji,
# lihat docs/runbook-migrasi-mesin.md), atau di host VPS yang punya psql/pg_restore.
#
# Env:
#   PGHOST PGUSER PGDATABASE   koneksi (PGDATABASE default `sewara`)
#   PGPASSWORD | PGPASSWORD_FILE
#   BACKUP_DIR                 folder tujuan (default /backup)
#   RETENSI_HARI               simpan semua dump selama ini (default 7)
#   SIMPAN_HARIAN              sisakan 1 dump per hari sampai ini (default 28)
#
# Keluar dengan error kalau dump tidak bisa dibaca ulang — backup yang tidak
# diverifikasi tidak dihitung backup.
set -euo pipefail

: "${PGHOST:?PGHOST wajib diisi}"
PGDATABASE="${PGDATABASE:-sewara}"
PGUSER="${PGUSER:-sewara}"
BACKUP_DIR="${BACKUP_DIR:-/backup}"
RETENSI_HARI="${RETENSI_HARI:-7}"
SIMPAN_HARIAN="${SIMPAN_HARIAN:-28}"

if [ -z "${PGPASSWORD:-}" ] && [ -n "${PGPASSWORD_FILE:-}" ]; then
  PGPASSWORD="$(cat "$PGPASSWORD_FILE")"
  export PGPASSWORD
fi
[ -n "${PGPASSWORD:-}" ] || { echo "[backup] ERROR: PGPASSWORD atau PGPASSWORD_FILE wajib"; exit 1; }

mkdir -p "$BACKUP_DIR"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
out="$BACKUP_DIR/sewara-$stamp.dump"

psql -Atc "SELECT 1" >/dev/null
pg_dump -Fc -f "$out"

# Verifikasi: dump harus bisa dibaca ulang dan memuat data tabel.
# `pg_restore -l` menulis entri sebagai "<nomor>; <oid> <oid> TABLE DATA ...",
# jadi yang dicari kata kuncinya, bukan awal baris.
tabel="$(pg_restore -l "$out" | grep -c 'TABLE DATA' || true)"
if [ "$tabel" -lt 20 ]; then
  echo "[backup] ERROR: verifikasi gagal — hanya $tabel TABLE DATA terbaca dari $out"
  exit 1
fi
sha256sum "$out" | awk '{print $1}' > "$out.sha256"
echo "[backup] ok dump=$out bytes=$(stat -c %s "$out") tabel_data=$tabel sha256=$(cat "$out.sha256")"

# Rotasi: buang yang lebih tua dari RETENSI_HARI, sisakan satu per hari sampai
# SIMPAN_HARIAN hari. Urut dari terbaru supaya yang disisakan = dump paling akhir
# di hari itu.
daftar="$(mktemp)"
find "$BACKUP_DIR" -name 'sewara-*.dump' -type f -mtime +"$RETENSI_HARI" -printf '%T@ %p\n' | sort -rn > "$daftar"
batas="$(date -u -d "-${SIMPAN_HARIAN} days" +%s)"
hari_terpakai=""
while read -r ts path; do
  [ -n "$ts" ] || continue
  detik="${ts%.*}"
  if [ "$detik" -lt "$batas" ]; then
    echo "[backup] hapus (lebih tua dari ${SIMPAN_HARIAN} hari): $(basename "$path")"
    rm -f "$path" "$path.sha256"
    continue
  fi
  hari="$(date -u -d "@$detik" +%Y%m%d)"
  case " $hari_terpakai " in
    *" $hari "*)
      echo "[backup] hapus (duplikat hari $hari): $(basename "$path")"
      rm -f "$path" "$path.sha256"
      ;;
    *) hari_terpakai="$hari_terpakai $hari" ;;
  esac
done < "$daftar"
rm -f "$daftar"

tersimpan="$(find "$BACKUP_DIR" -name 'sewara-*.dump' -type f | wc -l)"
total="$(du -sh "$BACKUP_DIR" | cut -f1)"
echo "[backup] selesai: $tersimpan berkas, total $total di $BACKUP_DIR"
