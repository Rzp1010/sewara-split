#!/usr/bin/env bash
# Pasang stack Sewara (Postgres + api Go + edge nginx) di mesin Linux baru.
# Satu perintah dan idempoten: yang sudah ada dilewati, aman dijalankan ulang.
#
#   sudo ./sewara-api/scripts/install.sh              # staging/homelab (APP_ENV=development)
#   sudo ./sewara-api/scripts/install.sh --prod       # mesin produksi (APP_ENV=production)
#   sudo ./sewara-api/scripts/install.sh --no-deploy  # pasang saja, jangan build+up
#
# Opsi: --branch <nama> (default dev)       --user <operator> (default SUDO_USER)
#       --root <dir> (default /srv/sewara)  --etc <dir> (default /etc/sewara)
#       --repo <url git> (default: remote origin repo tempat skrip ini dibaca)
#
# Sengaja TIDAK dilakukan skrip ini: mengisi kredensial pihak ketiga (R2, SMTP,
# rclone) — diingatkan di ringkasan akhir. Rahasia yang bisa dibangkitkan sendiri
# (password DB, EMAIL_TOKEN_SECRET, WEBHOOK_TELEGRAM_SECRET, PURGE_SECRET)
# dibangkitkan dengan openssl, tidak pernah dicetak ke layar.
set -euo pipefail

BRANCH=dev
OPERATOR=""
PROD=0
DO_DEPLOY=1
ROOT=/srv/sewara
ETC=/etc/sewara
REPO_URL=""

while [ $# -gt 0 ]; do
  case "$1" in
    --branch) BRANCH=${2:?nama branch kosong}; shift 2 ;;
    --user)   OPERATOR=${2:?nama user kosong}; shift 2 ;;
    --prod)   PROD=1; shift ;;
    --no-deploy) DO_DEPLOY=0; shift ;;
    --root)   ROOT=${2:?path kosong}; shift 2 ;;
    --etc)    ETC=${2:?path kosong}; shift 2 ;;
    --repo)   REPO_URL=${2:?url kosong}; shift 2 ;;
    -h|--help) sed -n '2,13p' "$0"; exit 0 ;;
    *) echo "opsi tidak dikenal: $1"; exit 2 ;;
  esac
done

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
REPO_SRC=$(cd "$SCRIPT_DIR/../.." && pwd)
APP_DIR="$ROOT/app"
GRP=sewara
APP_ENV=development
EDGE_BIND=0.0.0.0
FE_STATIC=1
if [ "$PROD" = 1 ]; then APP_ENV=production; EDGE_BIND=127.0.0.1; FE_STATIC=0; fi

log() { echo "[install] $*"; }
die() { echo "[install] GAGAL: $*" >&2; exit 1; }

# --- 1. prasyarat -------------------------------------------------------------
[ "$(id -u)" = 0 ] || die "jalankan dengan sudo"
[ -n "$OPERATOR" ] || OPERATOR=${SUDO_USER:-}
if [ -z "$OPERATOR" ] || [ "$OPERATOR" = root ]; then
  die "sebutkan pemilik berkas repo: --user <nama>"
fi
id "$OPERATOR" >/dev/null 2>&1 || die "user $OPERATOR tidak ada di mesin ini"
for c in docker git openssl; do
  command -v "$c" >/dev/null ||
    die "$c belum terpasang. Contoh: sudo apt install -y docker.io docker-compose-v2 git openssl"
done
docker compose version >/dev/null 2>&1 || die "plugin 'docker compose' v2 belum ada"
if [ "$DO_DEPLOY" = 1 ] && [ "$FE_STATIC" = 1 ]; then
  # Dicek di shell login operator, bukan di PATH root: node di mesin ini sering
  # hanya terpasang di profil user.
  sudo -u "$OPERATOR" -H bash -lc 'command -v npm >/dev/null' 2>/dev/null ||
    log "PERINGATAN: npm tidak terlihat di shell login $OPERATOR; build frontend akan gagal"
fi

# --- 2. registry lewat IPv4 ---------------------------------------------------
# Sebagian jaringan menolak registry Docker lewat IPv6 (gejala: `network is
# unreachable` saat pull). Satu baris di /etc/gai.conf menyelesaikannya.
if ! grep -q '^precedence ::ffff:0:0/96' /etc/gai.conf 2>/dev/null; then
  log "tambah precedence IPv4 di /etc/gai.conf, lalu restart docker"
  printf 'precedence ::ffff:0:0/96  100\n' >> /etc/gai.conf
  systemctl restart docker
fi

# --- 3. grup ------------------------------------------------------------------
getent group "$GRP" >/dev/null 2>&1 || { log "buat grup $GRP"; groupadd "$GRP"; }
for g in "$GRP" docker; do
  if ! id -nG "$OPERATOR" | tr ' ' '\n' | grep -qx "$g"; then
    usermod -aG "$g" "$OPERATOR"
    log "user $OPERATOR dimasukkan ke grup $g (berlaku setelah login ulang)"
  fi
done

# --- 4. folder ----------------------------------------------------------------
log "siapkan $ROOT dan $ETC"
install -d -m 0755 -o "$OPERATOR" -g "$GRP" \
  "$ROOT" "$ROOT/www" "$ROOT/backup" "$ROOT/restore" "$ROOT/schema"
install -d -m 0700 -o 999 -g 999 "$ROOT/pgdata"   # 999 = user postgres di image postgres
install -d -m 0750 -o root -g "$GRP" "$ETC"

# --- 5. repo ------------------------------------------------------------------
if [ -z "$REPO_URL" ]; then
  REPO_URL=$(git -C "$REPO_SRC" remote get-url origin 2>/dev/null || true)
fi
if [ -d "$APP_DIR/.git" ]; then
  log "repo sudah ada di $APP_DIR -> tarik $BRANCH"
  sudo -u "$OPERATOR" -H git -C "$APP_DIR" fetch --prune origin
  sudo -u "$OPERATOR" -H git -C "$APP_DIR" checkout "$BRANCH"
  sudo -u "$OPERATOR" -H git -C "$APP_DIR" pull --ff-only origin "$BRANCH"
else
  [ -n "$REPO_URL" ] ||
    die "URL repo tidak diketahui: jalankan skrip dari dalam repo git, atau tambahkan --repo <url>"
  log "clone $REPO_URL ($BRANCH) -> $APP_DIR"
  sudo -u "$OPERATOR" -H git clone --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
fi
API_DIR="$APP_DIR/sewara-api"
[ -f "$API_DIR/docker-compose.prod.yml" ] || die "tidak menemukan docker-compose.prod.yml di $API_DIR"

# --- 6. rahasia ---------------------------------------------------------------
if [ ! -s "$ETC/pg_password" ]; then
  log "bangkitkan password DB -> $ETC/pg_password"
  openssl rand -hex 24 > "$ETC/pg_password"
fi
chown root:root "$ETC/pg_password"
chmod 600 "$ETC/pg_password"
PGPW=$(cat "$ETC/pg_password")

# --- 7. api.env ---------------------------------------------------------------
if [ -s "$ETC/api.env" ]; then
  log "$ETC/api.env sudah ada -> dibiarkan"
else
  log "bangkitkan $ETC/api.env (APP_ENV=$APP_ENV; rahasia acak, tidak dicetak)"
  if [ "$APP_ENV" = production ]; then
    FRONTEND_URL=https://app.sewara.my.id
  else
    IP_LAN=$(hostname -I 2>/dev/null | awk '{print $1}')
    FRONTEND_URL="http://${IP_LAN:-localhost}:8090"
  fi
  cat > "$ETC/api.env" <<EOF
# Dibangkitkan oleh sewara-api/scripts/install.sh — jangan di-commit.
# Referensi nama kunci: sewara-api/.env.prod.example dan internal/config/config.go
APP_ENV=$APP_ENV
ADDR=0.0.0.0:4000

DATABASE_URL=postgres://sewara:$PGPW@db:5432/sewara?sslmode=disable
SESSION_TTL=720h

FRONTEND_URL=$FRONTEND_URL
PUBLIC_API_URL=$FRONTEND_URL
EMAIL_TOKEN_SECRET=$(openssl rand -hex 32)
EMAIL_TOKEN_TTL=24h

# Email verifikasi akun: di APP_ENV=production kunci ini WAJIB terisi.
MAIL_DRIVER=smtp
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_FROM=

WEBHOOK_TELEGRAM_SECRET=$(openssl rand -hex 24)
TELEGRAM_CHAT_ID=
TELEGRAM_API_BASE=https://api.telegram.org
TELEGRAM_TIMEOUT=10s

PURGE_SECRET=$(openssl rand -hex 24)

# Cloudflare R2: di APP_ENV=production wajib lengkap (unggah foto/dokumen).
R2_ENDPOINT=
R2_REGION=auto
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=
EOF
fi
chown root:"$GRP" "$ETC/api.env"
chmod 640 "$ETC/api.env"

# --- 8. .env untuk docker compose ---------------------------------------------
if [ -s "$API_DIR/.env" ]; then
  log "$API_DIR/.env sudah ada -> dibiarkan"
else
  log "tulis $API_DIR/.env (variabel compose + penyetelan deploy)"
  cat > "$API_DIR/.env" <<EOF
# Dibangkitkan oleh sewara-api/scripts/install.sh. Berkhasiat untuk
# \`docker compose\` maupun sewara-api/scripts/deploy-vps.sh. Jangan di-commit.
SEWARA_APP_ENV=$APP_ENV
SEWARA_DATA_DIR=$ROOT
SEWARA_API_IMAGE=sewara-api:local
SEWARA_EDGE_BIND=$EDGE_BIND
SEWARA_BRANCH=$BRANCH
SEWARA_STATE_FILE=$ROOT/api-image.txt
SEWARA_FRONTEND_STATIC=$FE_STATIC
SEWARA_WWW_DIR=$ROOT/www
SEWARA_EDGE=1
EOF
fi
chown "$OPERATOR":"$GRP" "$API_DIR/.env"
chmod 0640 "$API_DIR/.env"

# --- 8b. alamat API frontend --------------------------------------------------
# Tidak ada yang perlu ditulis: bundel memakai origin yang sama (relatif) sejak
# src/lib/api-client.js dikosongkan dasarnya. Isi NEXT_PUBLIC_API_URL di
# sewara-frontend/.env.production.local HANYA kalau frontend dan API beda origin.
if [ -s "$APP_DIR/sewara-frontend/.env.production.local" ]; then
  log "CATATAN: $APP_DIR/sewara-frontend/.env.production.local ada; isinya menimpa dasar relatif"
fi

# --- 9. rclone.conf -----------------------------------------------------------
if [ ! -s "$ETC/rclone.conf" ]; then
  install -m 0600 -o root -g root /dev/null "$ETC/rclone.conf"
  log "$ETC/rclone.conf dibuat kosong (isi kredensial akun backup nanti)"
fi

# --- 10. db naik + skema sekali -----------------------------------------------
COMPOSE=(docker compose)
if [ -f "$API_DIR/.env" ]; then COMPOSE+=(--env-file "$API_DIR/.env"); fi
COMPOSE+=(-f "$API_DIR/docker-compose.prod.yml")

log "naikkan db"
"${COMPOSE[@]}" up -d --wait --wait-timeout 120 db

ada=$("${COMPOSE[@]}" exec -T -e PGPASSWORD="$PGPW" db psql -U sewara -d sewara -Atc \
  "SELECT to_regclass('public.schema_migrations') IS NOT NULL" 2>/dev/null | tr -d '\r' || true)
if [ "$ada" = "t" ]; then
  jumlah=$("${COMPOSE[@]}" exec -T -e PGPASSWORD="$PGPW" db psql -U sewara -d sewara -Atc \
    "SELECT count(*) FROM schema_migrations" | tr -d '\r')
  log "skema sudah ada (ledger $jumlah berkas) -> dilewati"
else
  BASELINE="$APP_DIR/sewara-backend/supabase/schema_prod_20260930.sql"
  [ -f "$BASELINE" ] || die "baseline skema tidak ada: $BASELINE"
  seed=()
  if [ "$PROD" = 0 ] && [ -f "$API_DIR/seeds/staging_seed.sql" ]; then
    seed=(-v "$API_DIR/seeds:/init/seeds:ro")
    log "muat skema + seed staging (sekali)"
  else
    log "muat skema tanpa seed (sekali)"
  fi
  docker run --rm --network sewara_internal --user root \
    -e PGHOST=db -e PGUSER=sewara -e PGDATABASE=sewara -e PGPASSWORD="$PGPW" \
    -v "$API_DIR/docker/db-init:/init-src:ro" \
    -v "$API_DIR/bootstrap:/init/bootstrap:ro" \
    -v "$API_DIR/migrations:/init/migrations:ro" \
    -v "$BASELINE:/init/schema_prod.sql:ro" \
    "${seed[@]}" postgres:16 bash /init-src/init.sh
fi

# --- 11. unit systemd ---------------------------------------------------------
if [ "$ROOT" = /srv/sewara ] && [ "$ETC" = /etc/sewara ]; then
  log "pasang unit systemd (sewara.service + sewara-backup.timer)"
  install -m 0644 \
    "$APP_DIR/deploy/systemd/sewara.service" \
    "$APP_DIR/deploy/systemd/sewara-backup.service" \
    "$APP_DIR/deploy/systemd/sewara-backup.timer" \
    /etc/systemd/system/
  systemctl daemon-reload
  # Sengaja `enable` tanpa `--now`. `up -d` di sini akan memakai SEWARA_API_IMAGE
  # dari .env, yang pada mesin lama bisa menunjuk image lama (build manual) —
  # artinya api turun versi tanpa disadari. Yang menaikkan stack adalah deploy.
  systemctl enable sewara.service
  systemctl enable --now sewara-backup.timer
else
  log "unit systemd dilewati (isinya mengasumsikan /srv/sewara + /etc/sewara)"
fi

# --- 12. deploy pertama -------------------------------------------------------
if [ "$DO_DEPLOY" = 0 ]; then
  log "deploy dilewati (--no-deploy). Jalankan sendiri: cd $APP_DIR && ./sewara-api/scripts/deploy-vps.sh"
elif [ "$PROD" = 1 ]; then
  log "deploy produksi sengaja TIDAK dijalankan otomatis: lengkapi R2_* dan SMTP_* di $ETC/api.env dulu"
  log "  lalu: cd $APP_DIR && ./sewara-api/scripts/deploy-vps.sh"
elif sudo -u "$OPERATOR" -H docker info >/dev/null 2>&1 &&
     sudo -u "$OPERATOR" -H test -r "$ETC/api.env"; then
  log "deploy pertama sebagai $OPERATOR (mode auto)"
  sudo -u "$OPERATOR" -H bash -lc "cd '$APP_DIR' && ./sewara-api/scripts/deploy-vps.sh"
else
  log "deploy belum bisa dijalankan sebagai $OPERATOR (grup docker/$GRP belum aktif di sesi sekarang)"
  log "  logout lalu login lagi, kemudian: cd $APP_DIR && ./sewara-api/scripts/deploy-vps.sh"
fi

# --- 13. ringkasan ------------------------------------------------------------
cat <<EOF

[install] Pemasangan selesai. Sisa yang manual (sengaja, karena rahasia pihak ketiga):
  1. $ETC/rclone.conf   isi kredensial R2 akun backup (mode 600 sudah diset), lalu:
                        sudo systemctl start sewara-backup.service
  2. $ETC/api.env       isi SMTP_* (email) dan R2_* (unggah foto) kalau perlu.
                        Di APP_ENV=production api menolak start sebelum keduanya lengkap.
  3. Akses: http://<ip-mesin>:8090  (dev) — kalau kosong:
                        cd $API_DIR && docker compose --env-file .env -f docker-compose.prod.yml logs -f edge api
  4. Deploy berikutnya cukup: cd $APP_DIR && ./sewara-api/scripts/deploy-vps.sh
EOF
