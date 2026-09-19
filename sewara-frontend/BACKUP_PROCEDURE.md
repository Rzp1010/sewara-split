# Backup Procedure — Sebelum Restrukturisasi DB

**Target:** Backup lengkap semua data sebelum Phase 1  
**Tanggal:** 27 Agustus 2026  
**Project:** Sewara Apps (obhvrzholszhjnpvmnna)

---

## ✅ Backup Checklist

### 1. Database Backup (Supabase)

#### A. Via Supabase Dashboard (Recommended)

**Steps:**
1. Buka https://supabase.com/dashboard/project/obhvrzholszhjnpvmnna
2. Settings → Database → Backups
3. Klik **"Create backup"** atau tunggu daily backup selesai
4. Catat timestamp backup: `_______________`
5. Verify backup created successfully

**Backup location:** Supabase Dashboard (automatic storage)

#### B. Manual SQL Dump (Extra Safety)

```bash
# Install Supabase CLI jika belum (optional tapi recommended)
npm install -g supabase

# Link project (jika belum)
supabase link --project-ref obhvrzholszhjnpvmnna

# Dump database
supabase db dump -f backups/dump_27aug2026_pre-restructure.sql

# Atau via pg_dump langsung (butuh connection string)
# Connection string di: Supabase Dashboard → Settings → Database → Connection string
```

**Simpan di:** `E:\Aplikasi Inventory\sewara-apps\backups\`

- [ ] Backup created: `_______________ (timestamp)`
- [ ] File size reasonable: `_______________ MB`
- [ ] File bisa dibuka/verified

### 2. Repository Backup (Code)

#### A. Git Status Check

```bash
cd E:\Aplikasi Inventory\sewara-apps
git status
```

- [ ] Working directory clean ATAU changes committed
- [ ] No uncommitted critical changes
- [ ] Latest commit pushed to GitHub

#### B. Create Backup Tag

```bash
# Tag current state sebelum restructure
git tag -a pre-restructure-27aug2026 -m "Backup sebelum DB restructure Phase 1-2"
git push origin pre-restructure-27aug2026
```

- [ ] Tag created: `pre-restructure-27aug2026`
- [ ] Tag pushed to remote

#### C. Local Backup (Extra Safety)

```bash
# Backup entire folder ke lokasi aman
# Windows:
xcopy /E /I /H /Y "E:\Aplikasi Inventory\sewara-apps" "E:\Aplikasi Inventory\BACKUP_sewara-apps_27aug2026"

# Atau compress (recommended):
# Via 7zip/WinRAR atau PowerShell:
Compress-Archive -Path "E:\Aplikasi Inventory\sewara-apps" -DestinationPath "E:\Aplikasi Inventory\sewara-apps-backup-27aug2026.zip"
```

**Lokasi backup:** `E:\Aplikasi Inventory\sewara-apps-backup-27aug2026.zip`

- [ ] Backup folder/zip created
- [ ] Size: `_______________ MB`
- [ ] Contains all source files including `.env.local` (untuk restore)

**⚠️ CAUTION:** `.env.local` berisi credentials — jangan upload backup ini ke public repo!

### 3. Environment Variables Backup

```bash
# Copy .env.local ke backup
copy ".env.local" "backups\.env.local.backup.27aug2026"
```

**Atau manual:**
1. Buka `.env.local`
2. Copy semua content
3. Simpan ke file terpisah: `backups/.env.local.backup.27aug2026`
4. Store di lokasi aman (jangan commit ke Git)

- [ ] `.env.local` backed up
- [ ] Credentials verified (SUPABASE, R2, TELEGRAM)

### 4. Cloudflare R2 Backup (Document Storage)

**Bucket:** `sewara-customer-documents` (atau nama yang dipakai)

#### Option A: Via R2 Dashboard

1. Login Cloudflare Dashboard
2. R2 → Bucket sewara
3. Download semua objects (jika jumlah sedikit)

#### Option B: Rclone/S3 CLI

```bash
# List objects
aws s3 ls s3://sewara-customer-documents --endpoint-url=https://YOUR_ACCOUNT_ID.r2.cloudflarestorage.com

# Sync to local
aws s3 sync s3://sewara-customer-documents ./backups/r2-backup-27aug2026 --endpoint-url=https://YOUR_ACCOUNT_ID.r2.cloudflarestorage.com
```

**Lokasi backup:** `E:\Aplikasi Inventory\sewara-apps\backups\r2-backup-27aug2026\`

- [ ] R2 objects backed up (jika ada)
- [ ] Count files: `_______________`
- [ ] Total size: `_______________ MB`

**Note:** Jika belum ada upload dokumen member, skip ini.

### 5. Vercel Deployment Snapshot

**Current production:**
- URL: https://app-sewara.vercel.app/
- Deployment: `https://app-sewara-rclgnetq5-rizki12.vercel.app` (atau latest)

```bash
# Check current deployment
npx vercel ls

# Note deployment URL dan Git SHA
```

- [ ] Production URL accessible: `_______________`
- [ ] Git commit: `_______________`
- [ ] Deployment works (test login)

**Rollback plan:** Vercel bisa rollback ke deployment sebelumnya via Dashboard.

### 6. Supabase Settings Backup

**Manual record penting:**

#### A. RLS Policies

Di Supabase SQL Editor:

```sql
-- Backup RLS policies
SELECT 
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;
```

Simpan hasil ke: `backups/rls-policies-27aug2026.txt`

- [ ] RLS policies recorded

#### B. Database Functions (RPC)

```sql
-- List all functions
SELECT 
  routine_name,
  routine_type,
  routine_definition
FROM information_schema.routines
WHERE routine_schema = 'public'
ORDER BY routine_name;
```

Simpan hasil ke: `backups/db-functions-27aug2026.txt`

- [ ] DB functions recorded

#### C. Triggers

```sql
-- List triggers
SELECT 
  trigger_name,
  event_object_table,
  action_statement
FROM information_schema.triggers
WHERE trigger_schema = 'public'
ORDER BY event_object_table, trigger_name;
```

Simpan hasil ke: `backups/db-triggers-27aug2026.txt`

- [ ] Triggers recorded (jika ada)

---

## 📦 Backup Inventory

Setelah semua selesai, kamu punya:

1. **Database:**
   - [ ] Supabase Dashboard backup
   - [ ] SQL dump file (optional)
   - [ ] RLS policies documented
   - [ ] Functions documented
   - [ ] Triggers documented

2. **Code Repository:**
   - [ ] Git tag `pre-restructure-27aug2026`
   - [ ] Local zip backup
   - [ ] GitHub remote up-to-date

3. **Environment:**
   - [ ] `.env.local` backed up

4. **Storage:**
   - [ ] R2 objects backed up (if any)

5. **Production State:**
   - [ ] Deployment URL recorded
   - [ ] Current Git SHA noted

---

## 🔄 Restore Procedures (Just in Case)

### Restore Database

#### Via Supabase Dashboard:
1. Settings → Database → Backups
2. Select backup timestamp
3. Click "Restore"

#### Via SQL Dump:
```bash
psql "postgresql://postgres:[PASSWORD]@[HOST]:5432/postgres" < backups/dump_27aug2026_pre-restructure.sql
```

### Restore Code

```bash
# Option 1: Git revert
git reset --hard pre-restructure-27aug2026
git push origin main --force

# Option 2: Extract backup zip
cd "E:\Aplikasi Inventory"
Expand-Archive -Path "sewara-apps-backup-27aug2026.zip" -DestinationPath "sewara-apps-restored"
```

### Restore Vercel Deployment

1. Vercel Dashboard → sewara-apps
2. Deployments tab
3. Find pre-restructure deployment
4. Click "..." → "Promote to Production"

### Restore R2

```bash
aws s3 sync ./backups/r2-backup-27aug2026 s3://sewara-customer-documents --endpoint-url=https://YOUR_ACCOUNT_ID.r2.cloudflarestorage.com
```

---

## ⏱️ Estimated Time

- Database backup: 5-10 menit
- Git tag + local backup: 5 menit
- Environment backup: 2 menit
- R2 backup: 5-10 menit (jika ada data)
- Settings documentation: 10-15 menit

**Total: 30-45 menit**

---

## ✅ Pre-Flight Approval

Before proceeding with Phase 1:

- [ ] All backups completed
- [ ] Backup files verified accessible
- [ ] Restore procedure understood
- [ ] Team notified (if applicable)
- [ ] Downtime window confirmed
- [ ] RLS smoke test passed

**Backup completed by:** `_______________ (name)`  
**Timestamp:** `_______________ (date/time)`  
**Approved to proceed:** [ ] YES / [ ] NO

---

**Next:** Run `scripts/test-rls-isolation.js` → Execute `RESTRUCTURE_CHECKLIST.md`
