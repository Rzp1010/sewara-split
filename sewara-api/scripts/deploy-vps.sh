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
# Langkah tambahan (semua default MATI; nilai dibaca dari shell atau
# sewara-api/.env yang juga dipakai `docker compose`):
#   SEWARA_FRONTEND_STATIC=1  build static export frontend + salin ke SEWARA_WWW_DIR
#   SEWARA_WWW_DIR            default: /srv/sewara/www
#   SEWARA_EDGE=1             recreate container edge setelah api naik
# Unit systemd TIDAK pernah disentuh skrip ini (butuh root); kalau deploy/systemd
# ikut berubah, skrip hanya mencetak perintah salin untuk dijalankan sendiri.
#
# Build di VPS memang ~3,5 menit dan butuh ~700 MB RAM (terukur 2026-10-30) —
# jadi WAJIB ada swap 2 GB dan sebaiknya dijalankan saat traffic kosong.
# Container lama tetap melayani selama build (build tidak menyentuh proses jalan).
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
API_DIR=$(cd "$SCRIPT_DIR/.." && pwd)
REPO_DIR=${SEWARA_REPO_DIR:-$(cd "$API_DIR/.." && pwd)}

# --- env lokal (opsional) -----------------------------------------------------
# sewara-api/.env sudah dipakai `docker compose`; skrip ini ikut membacanya
# supaya pengaturan lokal (branch, penanda langkah) tidak perlu diingat di shell.
# Nilai di .env MENANG atas variabel shell dengan nama sama.
# Tidak ada langkah otomatis: semua langkah tambahan default MATI (0).
if [ -f "$API_DIR/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$API_DIR/.env"
  set +a
fi

BRANCH=${SEWARA_BRANCH:-main}
STATE=${SEWARA_STATE_FILE:-/etc/sewara/api-image.txt}
WWW=${SEWARA_WWW_DIR:-/srv/sewara/www}
COMPOSE=(docker compose -f "$API_DIR/docker-compose.prod.yml")

TARGET=""
[ "${1:-}" = "--ke" ] && TARGET=${2:?pakai: --ke <commit, mis. a3a1b58>}

log() { echo "[deploy] $*"; }

log "rencana: branch=$BRANCH frontend_static=${SEWARA_FRONTEND_STATIC:-0} edge=${SEWARA_EDGE:-0} www=$WWW"

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

# Pengingat, BUKAN aksi: unit systemd butuh root, jadi skrip ini tidak
# menyentuhnya. Kalau deploy/systemd ikut berubah di pull tadi, salin manual.
if git rev-parse 'HEAD@{1}' >/dev/null 2>&1 &&
   git diff --name-only 'HEAD@{1}' HEAD -- deploy/systemd 2>/dev/null | grep -q .; then
  log "PERHATIAN: deploy/systemd berubah. Jalankan sendiri:"
  log "  sudo cp $REPO_DIR/deploy/systemd/sewara*.service $REPO_DIR/deploy/systemd/sewara-backup.timer /etc/systemd/system/"
  log "  sudo systemctl daemon-reload"
fi

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

# --- 2b. frontend static (opsional, default MATI) ------------------------------
# Hanya untuk jalur Go yang frontend-nya disajikan nginx (homelab, dan nanti
# Fase 3). Di VPS produksi sekarang frontend masih Next/pm2, jadi biarkan 0.
# Alamat API ikut terpanggang saat build -> dibaca Next dari
# sewara-frontend/.env.production.local (gitignored).
if [ "${SEWARA_FRONTEND_STATIC:-0}" = "1" ]; then
  FE_DIR="$REPO_DIR/sewara-frontend"
  log "frontend: build static export -> $WWW (perkiraan 1-3 menit)"
  cd "$FE_DIR"
  if [ ! -d node_modules ]; then
    log "node_modules belum ada -> npm ci"
    npm ci
  fi
  npm run build:static
  if [ ! -d out ]; then echo "build frontend tidak menghasilkan out/"; exit 4; fi
  mkdir -p "$WWW"
  find "$WWW" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
  cp -a out/. "$WWW"/
  log "frontend: $(find "$WWW" -type f | wc -l) berkas di $WWW"
  cd "$REPO_DIR"
else
  log "frontend static: dilewati (SEWARA_FRONTEND_STATIC != 1)"
fi

# --- 3. naikkan + gerbang health ----------------------------------------------
prev=""
[ -f "$STATE" ] && prev=$(cat "$STATE")
log "image terpasang sebelum: ${prev:-<belum tercatat>}"

# Gerbang health memakai fasilitas resmi Compose (sejak v2.1.1): --wait menunggu
# healthcheck container api lulus dan keluar non-zero kalau lewat
# --wait-timeout, sehingga langsung masuk cabang rollback di bawah.
sehat=0
if "${COMPOSE[@]}" up -d --no-build --wait --wait-timeout 90 api; then
  sehat=1
fi

if [ "$sehat" = "1" ]; then
  # --- 4b. edge (opsional, default MATI) --------------------------------------
  # nginx menyelesaikan nama `api` sekali saat start, jadi container api yang
  # baru (IP baru) akan ditembak lewat IP lama sampai edge di-recreate.
  if [ "${SEWARA_EDGE:-0}" = "1" ]; then
    log "recreate edge (api dapat IP baru)"
    "${COMPOSE[@]}" --profile edge up -d --force-recreate edge
  fi
  printf '%s\n' "$IMG" > "$STATE" 2>/dev/null || log "catatan: $STATE tidak bisa ditulis (perlu root)"
  log "SEHAT: api lulus healthcheck (--wait)"
  "${COMPOSE[@]}" ps api
  log "rollback instan kalau perlu: SEWARA_API_IMAGE=$prev ${COMPOSE[*]} up -d --no-build api"
  log "rollback kode: ./sewara-api/scripts/deploy-vps.sh --ke <commit-lama>"
  exit 0
fi

# --- 4. gagal -> balik ke image sebelumnya (tanpa build, instan) --------------
echo "TIDAK SEHAT (--wait-timeout 90 s). Log terakhir:"
"${COMPOSE[@]}" logs --tail 40 api || true

if [ -n "$prev" ] && docker image inspect "$prev" >/dev/null 2>&1; then
  log "rollback ke $prev"
  export SEWARA_API_IMAGE="$prev"
  printf '%s\n' "$prev" > "$STATE" 2>/dev/null || true
  if "${COMPOSE[@]}" up -d --no-build --wait --wait-timeout 60 api; then
    log "rollback BERHASIL, layanan kembali ke $prev"
  else
    log "rollback GAGAL — periksa: ${COMPOSE[*]} logs api"
  fi
else
  log "tidak ada image sebelumnya (${prev:-kosong}) -> rollback manual: ./$0 --ke <commit lama>"
fi
exit 1
