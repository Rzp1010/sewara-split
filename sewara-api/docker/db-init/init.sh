#!/bin/bash
# Inisialisasi skema DB staging (dijalankan saat volume masih kosong).
# Urutannya sengaja sama dengan scripts/docker-staging.ps1:
#   bootstrap -> baseline dump (baris pg_net dibuang) -> migrations -> seed
#   -> ledger schema_migrations -> setval sequence.
# Koneksi dari env PG* (lihat service db-init di docker-compose.yml).
set -euo pipefail

psql_do() { psql -v ON_ERROR_STOP=1 -q "$@"; }

# Kalau ledger sudah ada, jangan timpa apa pun: cukup laporkan berkas yang belum
# tercatat. Sengaja keluar dengan error (bukan diam-diam dilewati) supaya migration
# baru selalu terlihat dan diterapkan secara sadar — sama seperti aturan rilis.
if [ "$(psql -Atc "SELECT to_regclass('public.schema_migrations') IS NOT NULL")" = "t" ]; then
  belum=""
  for f in /init/bootstrap/*.sql /init/migrations/*.sql; do
    nama="$(basename "$f")"
    psql -Atc "SELECT 1 FROM public.schema_migrations WHERE filename = '$nama'" | grep -q 1 || belum="$belum $nama"
  done
  if [ -z "$belum" ]; then
    echo "[db-init] ledger lengkap ($(psql -Atc "SELECT count(*) FROM public.schema_migrations") berkas) — dilewati"
    exit 0
  fi
  echo "[db-init] PERHATIAN: belum tercatat di ledger:$belum"
  echo "[db-init] skema tidak diubah. Terapkan berkas itu secara sadar:"
  echo "[db-init]   docker compose exec -T db psql -U sewara -d sewara -f - < <berkas>"
  exit 1
fi

[ -s /init/schema_prod.sql ] || { echo "[db-init] ERROR: /init/schema_prod.sql kosong atau tidak ada"; exit 1; }

echo "[db-init] bootstrap"
for f in /init/bootstrap/*.sql; do
  echo "[db-init]   $(basename "$f")"
  psql_do -f "$f"
done

echo "[db-init] baseline dump (baris pg_net dibuang)"
grep -v 'CREATE EXTENSION IF NOT EXISTS pg_net' /init/schema_prod.sql | psql_do

echo "[db-init] migrations"
for f in /init/migrations/*.sql; do
  echo "[db-init]   $(basename "$f")"
  psql_do -f "$f"
done

if [ -f /init/seeds/staging_seed.sql ]; then
  echo "[db-init] seed staging"
  psql_do -f /init/seeds/staging_seed.sql
fi

echo "[db-init] ledger schema_migrations"
for f in /init/bootstrap/*.sql /init/migrations/*.sql; do
  psql_do -c "INSERT INTO public.schema_migrations (filename) VALUES ('$(basename "$f")') ON CONFLICT DO NOTHING" >/dev/null
done

echo "[db-init] setval sequence"
psql_do -c "SELECT setval('member_types_id_seq', COALESCE((SELECT max(id) FROM member_types), 0) + 1, false)" >/dev/null
psql_do -c "SELECT setval('promo_codes_id_seq',  COALESCE((SELECT max(id) FROM promo_codes), 0) + 1, false)" >/dev/null
psql_do -c "SELECT setval('members_id_seq',      COALESCE((SELECT max(id) FROM members), 0) + 1, false)" >/dev/null

echo "[db-init] ringkasan"
psql_do -Atc "SELECT 'tabel='  || count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'"
psql_do -Atc "SELECT 'policy=' || count(*) FROM pg_policies WHERE schemaname='public'"
psql_do -Atc "SELECT 'ledger=' || count(*) FROM public.schema_migrations"
psql_do -Atc "SELECT 'members=' || count(*) FROM members"
psql_do -Atc "SELECT 'users='  || count(*) FROM auth.users"
echo "[db-init] selesai"
