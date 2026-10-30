#!/usr/bin/env bash
# Deploy API Sewara di VPS — MANUAL, pola sama dengan Next: git pull -> build -> restart.
# Tidak ada registry, tidak ada CI, laptop tidak ikut build.
#
# Pakai (dari akar repo):
#   ./sewara-api/scripts/deploy-vps.sh                 # commit terbaru branch main
#   ./sewara-api/scripts/deploy-vps.sh --ke a3a1b58    # ROLLBACK ke commit itu
#
# Env:
#   SEWARA_REPO_DIR      default: akar repo (dua tingkat di atas skrip)
#   SEWARA_BRANCH        default: main
#   SEWARA_STATE_FILE    default: /etc/sewara/api-image.txt (tag terpasang sekarang)
#   SEWARA_SKIP_DRIFT=1  lewati cek drift ledger (WAJIB dicatat alasannya di runbook)
#
# Build di VPS memang ~3,5 menit dan butuh ~700 MB RAM (terukur 2026-10-30) —
# jadi WAJIB ada swap 2 GB dan sebaiknya dijalankan saat traffic kosong.
# Container lama tetap melayani selama build (build tidak menyentuh proses jalan).
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
API_DIR=$(cd "$SCRIPT_DIR/.." && pwd)
REPO_DIR=${SEWARA_REPO_DIR:-$(cd "$API_DIR/.." && pwd)}
BRANCH=${SEWARA_BRANCH:-main}
STATE=${SEWARA_STATE_FILE:-/etc/sewara/api-image.txt}
COMPOSE=(docker compose -f "$API_DIR/docker-compose.prod.yml")
HEALTH_URL=http://127.0.0.1:8098/api/health

TARGET=""
[ "${1:-}" = "--ke" ] && TARGET=${2:?pakai: --ke <commit, mis. a3a1b58>}

log() { echo "[deploy] $*"; }

# --- 0. prasyarat -------------------------------------------------------------
if ! swapon --show | grep -q .; then
  log "PERINGATAN: tidak ada swap aktif. Build ~700 MB bisa memicu OOM killer."
fi

# --- 1. kode -----------------------------------------------------------------
cd "$REPO_DIR"
[ -d .git ] || { echo "BUKAN repo git: $REPO_DIR"; exit 2; }
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "ADA perubahan lokal — commit atau discard dulu."; exit 2
fi
git fetch --prune origin
if [ -n "$TARGET" ]; then
  log "ROLLBACK ke commit $TARGET"
  git checkout "$BRANCH"
  git reset --hard "$TARGET"
else
  git checkout "$BRANCH"
  git pull --ff-only origin "$BRANCH"
fi
SHA=$(git rev-parse --short=7 HEAD)
log "kode: $SHA ($(git log -1 --format=%s))"

# Cek drift wallet vs berkas migration (aturan AGENTS 5). Saat rollback dilewati:
# skema memang sudah versi baru, yang mundur hanya kode.
if [ "${SEWARA_SKIP_DRIFT:-0}" = "1" ]; then
  log "cek drift DILEWATI (SEWARA_SKIP_DRIFT=1)"
elif [ -n "$TARGET" ]; then
  log "cek drift dilewati (rollback kode, bukan deploy skema)"
elif [ -z "$("${COMPOSE[@]}" ps -q db 2>/dev/null)" ]; then
  log "db belum jalan -> cek drift dilewati (deploy pertama)"
else
  berkas=$(ls "$API_DIR"/bootstrap/*.sql "$API_DIR"/migrations/*.sql 2>/dev/null | xargs -n1 basename | sort)
  ledger=$("${COMPOSE[@]}" exec -T db psql -U sewara -d sewara -Atc \
    "SELECT filename FROM schema_migrations" | tr -d '\r' | sort)
  belum=$(comm -23 <(echo "$berkas") <(echo "$ledger"))
  if [ -n "$belum" ]; then
    echo "DRIFT: berkas migration ada tapi belum tercatat di ledger:"
    echo "$belum" | sed 's/^/  - /'
    echo "Jalankan migration itu dulu (dan isi ledger), baru deploy."
    exit 3
  fi
  log "drift ledger: 0"
fi

# --- 2. build (dulu; container lama tetap melayani) ---------------------------
IMG="sewara-api:$SHA"
log "build $IMG (perkiraan 3-5 menit)"
export SEWARA_API_IMAGE="$IMG"
"${COMPOSE[@]}" build api

# --- 3. naikkan ---------------------------------------------------------------
prev=""
[ -f "$STATE" ] && prev=$(cat "$STATE")
log "image terpasang sebelum: ${prev:-<belum tercatat>}"
"${COMPOSE[@]}" up -d --no-build api

# --- 4. uji sehat -------------------------------------------------------------
sehat=0
for i in $(seq 1 30); do
  # Tanpa -S: pesan galat curl disembunyikan, karena 30 percobaan gagal itu normal
  # dan cuma membanjiri log.
  if curl -fs -o /dev/null --max-time 3 "$HEALTH_URL" 2>/dev/null; then sehat=1; break; fi
  sleep 2
done

if [ "$sehat" = "1" ]; then
  printf '%s\n' "$IMG" > "$STATE" 2>/dev/null || log "catatan: $STATE tidak bisa ditulis (perlu root)"
  log "SEHAT: $HEALTH_URL 200"
  "${COMPOSE[@]}" ps api
  log "rollback instan kalau perlu: SEWARA_API_IMAGE=$prev ${COMPOSE[*]} up -d --no-build api"
  log "rollback kode: ./sewara-api/scripts/deploy-vps.sh --ke <commit-lama>"
  exit 0
fi

# --- 5. gagal -> balik ke image sebelumnya (tanpa build, instan) --------------
echo "TIDAK SEHAT setelah 60 detik. Log terakhir:"
"${COMPOSE[@]}" logs --tail 40 api || true

if [ -n "$prev" ] && docker image inspect "$prev" >/dev/null 2>&1; then
  log "rollback ke $prev"
  export SEWARA_API_IMAGE="$prev"
  "${COMPOSE[@]}" up -d --no-build api
  printf '%s\n' "$prev" > "$STATE" 2>/dev/null || true
  sleep 10
  if curl -fsS -o /dev/null --max-time 3 "$HEALTH_URL"; then
    log "rollback BERHASIL, layanan kembali ke $prev"
  else
    log "rollback GAGAL — periksa: ${COMPOSE[*]} logs api"
  fi
else
  log "tidak ada image sebelumnya (${prev:-kosong}) -> rollback manual: ./$0 --ke <commit lama>"
fi
exit 1
