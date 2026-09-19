# Manual Backup via pg_dump (Free Tier)

**Tanggal:** 27 Agustus 2026
**Project:** obhvrzholszhjnpvmnna

---

## Cara 1: Via Supabase CLI

```bash
# Pastikan sudah install Supabase CLI
# https://supabase.com/docs/guides/cli

cd "E:\Aplikasi Inventory\sewara-apps"

# Login (jika belum)
npx supabase login

# Link ke project
npx supabase link --project-ref obhvrzholszhjnpvmnna

# Dump database
npx supabase db dump -f backup/backup_$(date +%Y%m%d_%H%M%S).sql

# Atau dump schema only
npx supabase db dump --schema-only -f backup/schema_$(date +%Y%m%d_%H%M%S).sql
```

---

## Cara 2: Via pg_dump langsung (jika punya PostgreSQL client)

### Connection string dari Supabase

1. Buka https://supabase.com/dashboard/project/obhvrzholszhjnpvmnna
2. Settings → Database → Connection string
3. Copy **Connection pooling** atau **Direct connection**

Format:
```
postgresql://postgres.obhvrzholszhjnpvmnna:[PASSWORD]@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres
```

### Jalankan pg_dump

```bash
# Ganti [PASSWORD] dengan password database Supabase
# Bisa ditemukan di Settings → Database → Database password

pg_dump "postgresql://postgres.obhvrzholszhjnpvmnna:[PASSWORD]@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres" > backup/backup_20260827_manual.sql

# Atau schema only
pg_dump --schema-only "postgresql://postgres.obhvrzholszhjnpvmnna:[PASSWORD]@..." > backup/schema_20260827.sql
```

---

## Cara 3: Export via Supabase Dashboard (manual, table by table)

Tidak praktis untuk 12 tabel. Skip cara ini.

---

## Cara 4: Backup ringan tanpa pg_dump

Jika sulit install CLI/pg_dump, backup minimal:

### A. Export row count + schema

Jalankan di Supabase SQL Editor, save output:

```sql
-- File: backup/preflight_schema_20260827.txt

-- 1. Row counts
SELECT 'transactions' AS table_name, COUNT(*) AS row_count FROM transactions
UNION ALL
SELECT 'inventory', COUNT(*) FROM inventory
UNION ALL
SELECT 'members', COUNT(*) FROM members
UNION ALL
SELECT 'member_templates', COUNT(*) FROM member_templates
UNION ALL
SELECT 'logs', COUNT(*) FROM logs
UNION ALL
SELECT 'promo_codes', COUNT(*) FROM promo_codes
UNION ALL
SELECT 'settings', COUNT(*) FROM settings
UNION ALL
SELECT 'profiles', COUNT(*) FROM profiles
UNION ALL
SELECT 'login_logs', COUNT(*) FROM login_logs
UNION ALL
SELECT 'admin_logs', COUNT(*) FROM admin_logs
UNION ALL
SELECT 'app_config', COUNT(*) FROM app_config
UNION ALL
SELECT 'versi_akun', COUNT(*) FROM versi_akun
ORDER BY table_name;

-- 2. Column definitions all tables
SELECT 
  table_name,
  column_name, 
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns 
WHERE table_schema = 'public'
  AND table_name IN (
    'transactions', 'inventory', 'members', 'member_templates',
    'logs', 'promo_codes', 'settings', 'profiles',
    'login_logs', 'admin_logs', 'app_config', 'versi_akun'
  )
ORDER BY table_name, ordinal_position;

-- 3. Constraints
SELECT 
  tc.table_name,
  tc.constraint_name,
  tc.constraint_type,
  kcu.column_name
FROM information_schema.table_constraints tc
LEFT JOIN information_schema.key_column_usage kcu
  ON tc.constraint_name = kcu.constraint_name
WHERE tc.table_schema = 'public'
  AND tc.table_name IN (
    'transactions', 'inventory', 'members', 'member_templates',
    'logs', 'promo_codes', 'settings', 'profiles',
    'login_logs', 'admin_logs', 'app_config', 'versi_akun'
  )
ORDER BY tc.table_name, tc.constraint_type, kcu.column_name;

-- 4. Indexes
SELECT
  schemaname,
  tablename,
  indexname,
  indexdef
FROM pg_indexes
WHERE schemaname = 'public'
ORDER BY tablename, indexname;

-- 5. RLS Policies
SELECT
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;
```

Copy semua output → save ke `backup/preflight_full_20260827.txt`

### B. Backup critical data (CSV)

Export tabel terpenting via Supabase Table Editor:

1. Buka Table Editor
2. Pilih tabel `transactions`
3. Klik **Export** → **CSV**
4. Simpan `backup/transactions_20260827.csv`
5. Ulangi untuk `inventory`, `members`, `settings`

---

## Rekomendasi untuk free tier

**Opsi terbaik: Cara 4A + 4B**

- Query SQL untuk schema/structure (5 menit)
- Export CSV 4 tabel penting (10 menit)
- Total: 15 menit, tanpa install tool tambahan

Setelah selesai, lanjut preflight checks lainnya (row count, RLS test, build test).

---

## Catatan Penting

Free tier Supabase **tidak punya auto backup** dan **tidak bisa restore** via dashboard.

Jika Phase 1 gagal dan data corrupt:

1. **Rollback via SQL** (jika masih bisa akses DB)
2. **Manual restore dari CSV** (tabel per tabel)
3. **Recreate project** (worst case, import CSV ke project baru)

**Risiko:** Phase 1 rename kolom relatif aman, tapi tetap butuh backup minimal.
