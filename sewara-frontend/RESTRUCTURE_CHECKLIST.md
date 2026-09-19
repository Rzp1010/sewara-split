# Checklist Restrukturisasi DB Sewara Apps
**Target Eksekusi:** Malam ini (27 Agustus 2026)
**Supabase Project:** obhvrzholszhjnpvmnna

---

## ⚠️ SEBELUM MULAI

### Pre-Flight Checks (WAJIB)

- [ ] **Backup database**
  ```bash
  # Via Supabase Dashboard:
  # Settings → Database → Backups → Create backup
  # Atau tunggu daily backup selesai
  ```

- [ ] **RLS smoke test**
  ```bash
  cd E:\Aplikasi Inventory\sewara-apps
  node scripts/test-rls-isolation.js
  ```
  **STOP jika test gagal! Fix dulu sebelum restructure.**

- [ ] **Record current state**
  ```sql
  -- Di Supabase SQL Editor, jalankan:
  SELECT 
    'transactions' as table_name, 
    COUNT(*) as row_count 
  FROM transactions
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
  SELECT 'profiles', COUNT(*) FROM profiles;
  ```
  **Simpan hasil ke file: `preflight-rowcount.txt`**

- [ ] **Check aktual column names**
  ```sql
  -- Cek transactions columns
  SELECT column_name, data_type 
  FROM information_schema.columns 
  WHERE table_name = 'transactions' 
  ORDER BY ordinal_position;
  
  -- Cek inventory columns
  SELECT column_name, data_type 
  FROM information_schema.columns 
  WHERE table_name = 'inventory' 
  ORDER BY ordinal_position;
  
  -- Cek members columns
  SELECT column_name, data_type 
  FROM information_schema.columns 
  WHERE table_name = 'members' 
  ORDER BY ordinal_position;
  ```
  **Simpan hasil ke: `preflight-schema.txt`**

- [ ] **Verify local .env.local**
  ```bash
  # Pastikan ada:
  # NEXT_PUBLIC_SUPABASE_URL
  # NEXT_PUBLIC_SUPABASE_ANON_KEY
  # SUPABASE_SERVICE_ROLE_KEY
  # R2 credentials
  ```

- [ ] **Git status clean**
  ```bash
  git status
  # Commit FITUR_BARU.md changes jika ada
  ```

- [ ] **Announce downtime** (jika ada user aktif)

---

## PHASE 1: Rename Transaction Columns

**Durasi:** 30-60 menit  
**Downtime:** Ya  
**Rollback:** Medium (ada ALTER COLUMN)

### Checkpoint 1A: Backup
- [ ] Backup selesai (check Supabase Dashboard)
- [ ] Preflight row count tersimpan
- [ ] Preflight schema tersimpan

### Checkpoint 1B: SQL Migration

**File:** `supabase/migrations/phase1_rename_transaction_columns.sql`

Buat file SQL berdasarkan kolom aktual dari preflight. Contoh structure:

```sql
-- Phase 1: Rename transaction columns to snake_case
-- CAUTION: Adjust column names based on preflight-schema.txt!

BEGIN;

-- 1. noInvoice → no_invoice (verify column exists!)
ALTER TABLE transactions 
RENAME COLUMN "noInvoice" TO no_invoice;

-- 2. hpPenyewa → hp_penyewa
ALTER TABLE transactions 
RENAME COLUMN "hpPenyewa" TO hp_penyewa;

-- 3. alamatPenyewa → alamat_penyewa
ALTER TABLE transactions 
RENAME COLUMN "alamatPenyewa" TO alamat_penyewa;

-- 4. totalAkhir → total_akhir
ALTER TABLE transactions 
RENAME COLUMN "totalAkhir" TO total_akhir;

-- 5. waktuAmbilRencana → waktu_ambil_rencana
ALTER TABLE transactions 
RENAME COLUMN "waktuAmbilRencana" TO waktu_ambil_rencana;

-- 6. waktuAmbil → waktu_ambil
ALTER TABLE transactions 
RENAME COLUMN "waktuAmbil" TO waktu_ambil;

-- 7. waktuKembaliRencana → waktu_kembali_rencana
ALTER TABLE transactions 
RENAME COLUMN "waktuKembaliRencana" TO waktu_kembali_rencana;

-- 8. waktuKembali → waktu_kembali
ALTER TABLE transactions 
RENAME COLUMN "waktuKembali" TO waktu_kembali;

-- 9. totalBayar → total_bayar
ALTER TABLE transactions 
RENAME COLUMN "totalBayar" TO total_bayar;

-- 10. totalDenda → total_denda
ALTER TABLE transactions 
RENAME COLUMN "totalDenda" TO total_denda;

-- 11. waktuDibuat → waktu_dibuat
ALTER TABLE transactions 
RENAME COLUMN "waktuDibuat" TO waktu_dibuat;

-- 12. waktuUpdate → waktu_update
ALTER TABLE transactions 
RENAME COLUMN "waktuUpdate" TO waktu_update;

-- 13. Add member_id (nullable untuk backward compatibility)
ALTER TABLE transactions 
ADD COLUMN IF NOT EXISTS member_id UUID REFERENCES members(id);

-- Verify row count unchanged
DO $$
DECLARE
  expected_count INTEGER := <MASUKKAN_ROW_COUNT_DARI_PREFLIGHT>;
  actual_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO actual_count FROM transactions;
  
  IF actual_count != expected_count THEN
    RAISE EXCEPTION 'Row count mismatch! Expected %, got %', expected_count, actual_count;
  END IF;
  
  RAISE NOTICE 'Row count verified: %', actual_count;
END $$;

COMMIT;
```

**Eksekusi:**
- [ ] Buka Supabase SQL Editor
- [ ] Copy-paste SQL (setelah adjust column names!)
- [ ] Jalankan
- [ ] **JIKA ERROR:** Catat error, ROLLBACK manual jika perlu
- [ ] **JIKA SUCCESS:** Screenshot result

### Checkpoint 1C: Verification DB

```sql
-- Check columns renamed
SELECT column_name 
FROM information_schema.columns 
WHERE table_name = 'transactions' 
  AND column_name IN (
    'no_invoice', 'hp_penyewa', 'alamat_penyewa', 
    'total_akhir', 'waktu_ambil_rencana', 'waktu_ambil',
    'waktu_kembali_rencana', 'waktu_kembali',
    'total_bayar', 'total_denda', 'waktu_dibuat', 'waktu_update',
    'member_id'
  )
ORDER BY column_name;

-- Should return 13 rows

-- Check row count unchanged
SELECT COUNT(*) FROM transactions;

-- Check no NULL created accidentally
SELECT COUNT(*) as null_no_invoice FROM transactions WHERE no_invoice IS NULL;
-- Should be 0 if noInvoice was NOT NULL before

-- Check sample data
SELECT id, no_invoice, penyewa, waktu_ambil_rencana, status 
FROM transactions 
LIMIT 5;
```

- [ ] 13 kolom baru ada
- [ ] Row count sama dengan preflight
- [ ] Sample data terlihat benar
- [ ] Tidak ada NULL di kolom wajib

### Checkpoint 1D: Update Kode

**Delegasi ke @fixer** — update `src/lib/db.js` dan 8 halaman dashboard.

Mapping kolom:
```
noInvoice          → no_invoice
hpPenyewa          → hp_penyewa
alamatPenyewa      → alamat_penyewa
totalAkhir         → total_akhir
waktuAmbilRencana  → waktu_ambil_rencana
waktuAmbil         → waktu_ambil
waktuKembaliRencana→ waktu_kembali_rencana
waktuKembali       → waktu_kembali
totalBayar         → total_bayar
totalDenda         → total_denda
waktuDibuat        → waktu_dibuat
waktuUpdate        → waktu_update
```

- [ ] `src/lib/db.js` updated
- [ ] `src/app/dashboard/booking/page.js` updated
- [ ] `src/app/dashboard/status/page.js` updated
- [ ] `src/app/dashboard/kalender/page.js` updated
- [ ] `src/app/dashboard/riwayat/page.js` updated
- [ ] `src/app/dashboard/laporan/page.js` updated
- [ ] `src/app/dashboard/tracking/page.js` updated
- [ ] `src/app/dashboard/pelanggan/page.js` updated
- [ ] Other files using transaction fields

### Checkpoint 1E: Build

```bash
npm run build
```

- [ ] Build berhasil tanpa error
- [ ] Tidak ada TypeScript/ESLint error
- [ ] Tidak ada undefined property warning

### Checkpoint 1F: Local Test

```bash
npm run dev
```

Test manual:
- [ ] Login berhasil
- [ ] Dashboard load
- [ ] Status transaksi tampil benar
- [ ] Booking form bisa dibuka
- [ ] Kalender load
- [ ] Laporan bisa diakses
- [ ] Data pelanggan tampil
- [ ] No console errors

### Checkpoint 1G: Deploy & Smoke Test

```bash
git add .
git commit -m "Phase 1: Rename transaction columns to snake_case"
git push origin main
npx vercel --prod --yes
```

- [ ] Deploy berhasil
- [ ] Production site accessible
- [ ] Login production berhasil
- [ ] Buka 1-2 transaksi existing
- [ ] Create test booking (optional)
- [ ] No critical errors

**DECISION POINT:** Phase 1 selesai. Stop atau lanjut Phase 2?

---

## PHASE 2: Rename Tables

**Durasi:** 20-40 menit  
**Downtime:** Ya  
**Rollback:** Easy (ALTER TABLE RENAME)

### Checkpoint 2A: Pre-Flight

- [ ] Phase 1 verified stable
- [ ] No production issues reported
- [ ] Row counts still match

### Checkpoint 2B: SQL Migration

```sql
-- Phase 2: Rename tables to canonical names

BEGIN;

-- 1. member_templates → member_types
ALTER TABLE member_templates RENAME TO member_types;

-- 2. logs → activity_logs
ALTER TABLE logs RENAME TO activity_logs;

-- Update sequences if they exist
ALTER SEQUENCE IF EXISTS member_templates_id_seq 
RENAME TO member_types_id_seq;

ALTER SEQUENCE IF EXISTS logs_id_seq 
RENAME TO activity_logs_id_seq;

-- Verify row counts
DO $$
DECLARE
  mt_count INTEGER;
  log_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO mt_count FROM member_types;
  SELECT COUNT(*) INTO log_count FROM activity_logs;
  
  RAISE NOTICE 'member_types: %', mt_count;
  RAISE NOTICE 'activity_logs: %', log_count;
END $$;

COMMIT;
```

- [ ] SQL executed
- [ ] No errors
- [ ] Row counts verified

### Checkpoint 2C: Verification DB

```sql
-- Check tables renamed
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
  AND table_name IN ('member_types', 'activity_logs');

-- Should return 2 rows

-- Check old names gone
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
  AND table_name IN ('member_templates', 'logs');

-- Should return 0 rows

-- Sample data
SELECT * FROM member_types LIMIT 3;
SELECT * FROM activity_logs ORDER BY created_at DESC LIMIT 5;
```

- [ ] New table names exist
- [ ] Old table names gone
- [ ] Data intact

### Checkpoint 2D: Update Kode

Replace all occurrences:
- `member_templates` → `member_types`
- `logs` → `activity_logs`

- [ ] `src/lib/db.js` updated
- [ ] All dashboard pages checked
- [ ] API routes checked

### Checkpoint 2E: Build & Test

```bash
npm run build
npm run dev
```

- [ ] Build success
- [ ] Member page works
- [ ] Activity logs display
- [ ] Settings tier management works

### Checkpoint 2F: Deploy

```bash
git add .
git commit -m "Phase 2: Rename tables (member_types, activity_logs)"
git push origin main
npx vercel --prod --yes
```

- [ ] Deploy success
- [ ] Production smoke test

**DECISION POINT:** Phase 1-2 selesai. **STOP HERE for tonight** atau lanjut Phase 3?

---

## PHASE 3: Normalize JSONB (HEAVY)

**Durasi:** 2-3 minggu  
**Risk:** High  
**Rekomendasi:** Jangan eksekusi malam ini. Planning dulu.

**Defer to next session.**

---

## ROLLBACK PROCEDURES

### Rollback Phase 1 (if needed)

```sql
-- Jika masih di tengah transaction: ROLLBACK;

-- Jika sudah COMMIT, manual rename back:
BEGIN;

ALTER TABLE transactions RENAME COLUMN no_invoice TO "noInvoice";
ALTER TABLE transactions RENAME COLUMN hp_penyewa TO "hpPenyewa";
-- ... dst untuk 12 kolom

ALTER TABLE transactions DROP COLUMN IF EXISTS member_id;

COMMIT;
```

### Rollback Phase 2

```sql
BEGIN;

ALTER TABLE member_types RENAME TO member_templates;
ALTER TABLE activity_logs RENAME TO logs;

COMMIT;
```

### Rollback Kode

```bash
git log --oneline -5
git revert <commit-hash>
git push origin main
npx vercel --prod --yes
```

---

## NOTES

- **Jangan skip preflight checks**
- **Jangan rush Phase 3 malam ini** — Phase 3 perlu planning matang dan sample JSONB inspection
- **Stop setelah Phase 2 adalah safe milestone**
- **Phase 1-2 adalah foundation, Phase 3-4 adalah enhancement**

---

## Contact/Support

Jika stuck:
- Check Supabase logs: Dashboard → Logs
- Check Vercel logs: Deployment → Function Logs
- Restore from backup jika critical

**Good luck!** 🚀
