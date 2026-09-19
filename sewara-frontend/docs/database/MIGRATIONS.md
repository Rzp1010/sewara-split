# Migration History

**Project:** Sewara Apps  
**Database:** PostgreSQL (Supabase)  
**Project ID:** obhvrzholszhjnpvmnna  
**Last Updated:** 3 September 2026

---

## Overview

Dokumentasi lengkap semua perubahan database dari Phase 1 sampai Phase 9.5, termasuk:
- Migration files yang dieksekusi
- Perubahan schema per phase
- Verification results
- Known issues & resolutions

---

## Migration Timeline

| Phase | Date | Description | Tables Affected | Status |
|-------|------|-------------|-----------------|--------|
| Phase 1 | 27 Aug 2026 | Konsolidasi kolom transactions | transactions | ✅ Completed |
| Phase 2 | 27 Aug 2026 | Rename tables | member_templates, logs | ✅ Completed |
| Phase 3 | 28 Aug 2026 | Drop legacy columns | transactions | ✅ Completed |
| Phase 4-6 | 28 Aug 2026 | JSONB normalization + RLS | +3 tables (normalized) | ✅ Completed |
| Phase 7 | 28 Aug 2026 | Foreign keys & constraints | 6 FK, 4 checks | ✅ Completed |
| Phase 8 | 28 Aug 2026 | Enum types & defaults | 6 enum types | ✅ Completed |
| Phase 9 | 30 Aug 2026 | SaaS infrastructure | +11 tables (SaaS + Permission) | ✅ Completed |
| Phase 9.5 | 3 Sep 2026 | Composite FK/RLS tenant integrity | 6 composite FKs, 4 unique indexes, 3 RLS policies | ✅ Completed |
| Promo auto-expire | 30 Aug 2026 | Expiry and quota status persistence | `promo_codes` | ✅ Applied |

**Total Schema Changes:** 9.5 phases  
**Total New Tables Created:** 14 (3 from Phase 4-6, 11 from Phase 9)  
**Total Enum Types:** 9  
**Total Foreign Keys:** 12  
**Total RLS Policies:** ~30

---

## Phase 1: Transactions Column Consolidation

**Date:** 27 August 2026  
**Migration File:** Manual consolidation (no SQL file)  
**Commit:** `9561538` (Phase 2), earlier work not tagged

### Changes

**Problem:** Duplicate columns camelCase + snake_case di `transactions` table

**Solution:** Konsolidasi ke snake_case, backfill data dari camelCase

**Columns Consolidated:**
- `noInvoice` → `no_invoice`
- `hpPenyewa` → `hp_penyewa`
- `alamatPenyewa` → `alamat_penyewa`
- `jaminanSewa` → `jaminan_sewa`
- `totalAkhir` → `total_akhir`
- `dendaTambahan` → `denda`
- `biayaDasar` → `biaya`
- `waktuAmbilRencana` → `waktu_ambil_rencana`
- `waktuKembaliRencana` → `waktu_kembali_rencana`
- `waktuAmbilAktual` → `waktu_ambil_aktual`
- `waktuKembaliAktual` → `waktu_kembali_aktual`
- `durasiTeks` → `durasi_teks`

**New Columns Added:**
- `member_id` TEXT (FK ke members.id)
- `created_by` UUID (user yang buat transaksi)
- `updated_by` UUID (user yang update transaksi)

**Indexes Added:**
- `idx_transactions_user_id`
- `idx_transactions_status`
- `idx_transactions_waktu_ambil`
- `idx_transactions_member_id`

### Verification

```sql
-- Row count before: 53
-- Row count after: 58 (new transactions added during migration)
SELECT COUNT(*) FROM transactions; -- 58

-- Verify canonical columns exist
SELECT column_name FROM information_schema.columns 
WHERE table_name = 'transactions' 
  AND column_name IN ('no_invoice', 'hp_penyewa', 'total_akhir');
-- Expected: 3 rows
```

### Code Changes

**Files Updated:**
- `src/lib/db.js` — update all queries ke snake_case
- `src/app/dashboard/status/page.js` — update field access
- `src/components/InvoiceView.jsx` — update display fields

### Deploy

**Status:** ✅ Deployed  
**Build:** Passed  
**Manual Test:** Passed

---

## Phase 2: Table Rename

**Date:** 27 August 2026  
**Migration File:** `supabase/migrations/phase2_rename_tables.sql`  
**Commit:** `9561538`

### Changes

**Tables Renamed:**
- `member_templates` → `member_types`
- `logs` → `activity_logs`

**Sequences Renamed:**
- `member_templates_id_seq` → `member_types_id_seq` (if existed)
- `logs_id_seq` → `activity_logs_id_seq`

**Indexes Renamed:**
- All indexes updated to match new table names

### SQL Script

```sql
-- Rename member_templates to member_types
ALTER TABLE member_templates RENAME TO member_types;
ALTER SEQUENCE IF EXISTS member_templates_id_seq RENAME TO member_types_id_seq;

-- Rename logs to activity_logs
ALTER TABLE logs RENAME TO activity_logs;
ALTER SEQUENCE IF EXISTS logs_id_seq RENAME TO activity_logs_id_seq;

-- RLS policies automatically follow table rename
```

### Verification

```sql
-- Verify tables renamed
SELECT table_name FROM information_schema.tables 
WHERE table_schema = 'public' 
  AND table_name IN ('member_types', 'activity_logs');
-- Expected: 2 rows

-- Verify old tables gone
SELECT table_name FROM information_schema.tables 
WHERE table_schema = 'public' 
  AND table_name IN ('member_templates', 'logs');
-- Expected: 0 rows
```

### Code Changes

**Files Updated:**
- `src/lib/db.js` — update `.from('member_templates')` → `.from('member_types')`
- `src/lib/db.js` — update `.from('logs')` → `.from('activity_logs')`
- `src/app/api/admin/data/route.js` — update table references
- `src/app/api/admin/users/route.js` — update table references

### Deploy

**Status:** ✅ Deployed  
**Vercel URL:** `https://app-sewara-pfrv0rv8z-rizki12.vercel.app`  
**Manual Test:** Passed

---

## Phase 3: Drop Legacy Columns

**Date:** 28 August 2026  
**Migration Files:**
- `supabase/migrations/phase3_drop_legacy_columns.sql`
- `supabase/migrations/phase3_fix_rpc_functions.sql`
- `supabase/migrations/phase3_fix_remaining_rpc.sql`

**Commit:** `6524bb2`

### Changes

**Columns Dropped from `transactions`:**
- `noInvoice`
- `hpPenyewa`
- `alamatPenyewa`
- `jaminanSewa`
- `waktuAmbilRencana`
- `waktuKembaliRencana`
- `waktuAmbilAktual`
- `waktuKembaliAktual`
- `durasiTeks`
- `biayaDasar`
- `dendaTambahan`
- `totalAkhir`

**RPC Functions Fixed:**
- `rpc_dashboard_rekap_status` — update column references
- `rpc_dashboard_pembayaran` — update column references (JSON output key `totalAkhir` retained for frontend compatibility)
- `notify_telegram_transaksi` — update column references

### SQL Script

```sql
-- Drop legacy camelCase columns
ALTER TABLE transactions DROP COLUMN IF EXISTS "noInvoice";
ALTER TABLE transactions DROP COLUMN IF EXISTS "hpPenyewa";
ALTER TABLE transactions DROP COLUMN IF EXISTS "alamatPenyewa";
ALTER TABLE transactions DROP COLUMN IF EXISTS "jaminanSewa";
ALTER TABLE transactions DROP COLUMN IF EXISTS "waktuAmbilRencana";
ALTER TABLE transactions DROP COLUMN IF EXISTS "waktuKembaliRencana";
ALTER TABLE transactions DROP COLUMN IF EXISTS "waktuAmbilAktual";
ALTER TABLE transactions DROP COLUMN IF EXISTS "waktuKembaliAktual";
ALTER TABLE transactions DROP COLUMN IF EXISTS "durasiTeks";
ALTER TABLE transactions DROP COLUMN IF EXISTS "biayaDasar";
ALTER TABLE transactions DROP COLUMN IF EXISTS "dendaTambahan";
ALTER TABLE transactions DROP COLUMN IF EXISTS "totalAkhir";
```

### Verification

```sql
-- Verify camelCase columns dropped
SELECT COUNT(*) FROM information_schema.columns 
WHERE table_name = 'transactions' 
  AND column_name IN ('noInvoice', 'hpPenyewa', 'totalAkhir');
-- Expected: 0

-- Verify snake_case columns exist
SELECT COUNT(*) FROM information_schema.columns 
WHERE table_name = 'transactions' 
  AND column_name IN ('no_invoice', 'hp_penyewa', 'total_akhir');
-- Expected: 3

-- Verify RPC functions
SELECT proname FROM pg_proc 
WHERE proname IN ('rpc_dashboard_rekap_status', 'rpc_dashboard_pembayaran', 'notify_telegram_transaksi');
-- Expected: 3 rows
```

### Code Changes

**Files Updated:**
- `src/components/InvoiceView.jsx` — update all field access to snake_case

### Deploy

**Status:** ✅ Deployed  
**Vercel URL:** `https://app-sewara-5v4z678qa-rizki12.vercel.app`  
**Build:** Passed  
**Local Smoke Test:** Passed

---

## Phase 4-6: JSONB Normalization

**Date:** 28 August 2026  
**Migration Files:**
- `supabase/migrations/phase4a_inspection_queries.sql`
- `supabase/migrations/phase4b_create_tables.sql`
- `supabase/migrations/phase4c_backfill_data.sql`
- `supabase/migrations/phase4e_fix_rls_policies.sql`

**Commit:** `e57ddbc`

### Changes

**New Tables Created:**
1. `transaction_items` — normalized dari `transactions.items` (JSONB)
2. `transaction_payments` — normalized dari `transactions.pembayaran` (JSONB)
3. `inventory_units` — normalized dari `inventory.sns` (JSONB)

**Data Backfilled:**
- 81 rows → `transaction_items`
- 63 rows → `transaction_payments`
- 59 rows → `inventory_units`
- **Total: 203 rows**

**RLS Policies Added:**
- 12 policies total (4 per table: SELECT, INSERT, UPDATE, DELETE)
- Pattern: `user_id = auth.uid()`

**Foreign Keys Added:**
- `fk_transaction_items_transaction` → `transactions(id)` ON DELETE CASCADE
- `fk_transaction_items_inventory` → `inventory(id)` ON DELETE SET NULL
- `fk_transaction_payments_transaction` → `transactions(id)` ON DELETE CASCADE
- `fk_inventory_units_inventory` → `inventory(id)` ON DELETE CASCADE

### Inspection Results

```sql
-- Transactions with items
SELECT COUNT(*) FROM transactions WHERE items IS NOT NULL AND jsonb_typeof(items) = 'array';
-- Result: 59

-- Total items to normalize
SELECT SUM(jsonb_array_length(items)) FROM transactions WHERE items IS NOT NULL;
-- Result: 81

-- Transactions with payments
SELECT COUNT(*) FROM transactions WHERE pembayaran IS NOT NULL AND jsonb_typeof(pembayaran) = 'array';
-- Result: 45

-- Total payments to normalize
SELECT SUM(jsonb_array_length(pembayaran)) FROM transactions WHERE pembayaran IS NOT NULL;
-- Result: 63

-- Inventory with serial numbers
SELECT COUNT(*) FROM inventory WHERE sns IS NOT NULL AND jsonb_typeof(sns) = 'array';
-- Result: 46

-- Total serial numbers to normalize
SELECT SUM(jsonb_array_length(sns)) FROM inventory WHERE sns IS NOT NULL;
-- Result: 59
```

### Code Changes

**Dual-Write Implementation:**

Added to `src/lib/db.js`:
- `getTransactionItems(transactionId)` — read normalized or fallback JSONB
- `saveTransactionItems(transactionId, items)` — dual-write (JSONB + normalized)
- `getTransactionPayments(transactionId)` — read normalized or fallback JSONB
- `saveTransactionPayments(transactionId, payments)` — dual-write
- `getInventoryUnits(inventoryId)` — read normalized or fallback JSONB
- `saveInventoryUnits(inventoryId, units)` — dual-write

**Updated Functions:**
- `tambahTransactions()` — dual-write items & payments
- `updateTransactions()` — dual-write items & payments
- `updateInventory()` — dual-write units

Updated `src/app/dashboard/status/page.js`:
- Read from `transaction_items` with fallback to `transactions.items`

### Manual Tests Passed

- ✅ Read existing transactions (JSONB fallback works)
- ✅ Create new transaction (dual-write works)
- ✅ Verify normalized count matches JSONB count
- ✅ Invoice display (PDF generation works)
- ✅ Edit transaction (dual-write update works)
- ✅ Update inventory serial numbers (dual-write works)

### Known Issues

**Initial RLS Error (Fixed):**
- Error: `42501: new row violates row-level security policy for table "transaction_items"`
- Cause: Missing RLS policies on new tables
- Fix: Added 12 RLS policies via `phase4e_fix_rls_policies.sql`

### Deploy

**Status:** ✅ Deployed  
**Vercel URL:** `https://app-sewara-68ly9aa80-rizki12.vercel.app`  
**Production:** Ready

**Important Note:** JSONB columns (`transactions.items`, `transactions.pembayaran`, `inventory.sns`) **belum di-drop**. Tetap dipertahankan sebagai fallback selama observasi.

---

## Phase 7: Foreign Keys & Constraints

**Date:** 28 August 2026  
**Migration Files:**
- `supabase/migrations/phase7a_orphan_check.sql`
- `supabase/migrations/phase7b_add_foreign_keys.sql`

**Commit:** `d0801b2` (bundled with Phase 8)

### Changes

**Orphan Audit Results:** All 0 (no orphan data)

**Foreign Keys Added:**
1. `fk_transaction_items_transaction` → `transactions(id)` ON DELETE CASCADE
2. `fk_transaction_items_inventory` → `inventory(id)` ON DELETE SET NULL
3. `fk_transaction_payments_transaction` → `transactions(id)` ON DELETE CASCADE
4. `fk_inventory_units_inventory` → `inventory(id)` ON DELETE CASCADE
5. `fk_transactions_member` → `members(id)` ON DELETE SET NULL
6. `fk_members_member_type` → `member_types(id)` ON DELETE SET NULL

**Check Constraints Added:**
1. `transaction_items.qty > 0`
2. `transaction_items.harga >= 0`
3. `transaction_payments.amount > 0`
4. `inventory_units.serial_number <> ''`

### SQL Script

```sql
-- Add FK with proper ON DELETE behavior
ALTER TABLE transaction_items
  ADD CONSTRAINT fk_transaction_items_transaction
  FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE CASCADE;

ALTER TABLE transaction_items
  ADD CONSTRAINT fk_transaction_items_inventory
  FOREIGN KEY (inventory_id) REFERENCES inventory(id) ON DELETE SET NULL;

-- Add check constraints
ALTER TABLE transaction_items
  ADD CONSTRAINT check_qty_positive CHECK (qty > 0);

ALTER TABLE transaction_items
  ADD CONSTRAINT check_harga_nonnegative CHECK (harga >= 0);

ALTER TABLE transaction_payments
  ADD CONSTRAINT check_amount_positive CHECK (amount > 0);

ALTER TABLE inventory_units
  ADD CONSTRAINT check_serial_not_empty CHECK (serial_number <> '');
```

### Verification

```sql
-- Verify FK created
SELECT 
  tc.constraint_name, 
  tc.table_name, 
  kcu.column_name, 
  ccu.table_name AS foreign_table_name,
  ccu.column_name AS foreign_column_name 
FROM information_schema.table_constraints AS tc 
JOIN information_schema.key_column_usage AS kcu
  ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.constraint_column_usage AS ccu
  ON ccu.constraint_name = tc.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY' 
  AND tc.table_schema = 'public'
  AND tc.constraint_name LIKE 'fk_%'
ORDER BY tc.table_name;
-- Expected: 6 FK

-- Verify check constraints
SELECT constraint_name, table_name 
FROM information_schema.table_constraints 
WHERE constraint_type = 'CHECK' 
  AND table_schema = 'public'
  AND constraint_name LIKE 'check_%';
-- Expected: 4 checks
```

---

## Phase 8: Enum Types & Defaults

**Date:** 28 August 2026  
**Migration Files:**
- `supabase/migrations/phase8_step1_create_enums.sql`
- `supabase/migrations/phase8_step2_apply_enums.sql`
- `supabase/migrations/phase8_step3_defaults.sql`
- `supabase/migrations/phase8_cleanup_enums.sql` (destructive, don't rerun)

**Commit:** `d0801b2`

### Changes

**Enum Types Created:**
1. `enum_status_transaksi` — Booking/Disewa/Selesai/Belum Selesai/Dibatalkan
2. `enum_jenis_inventory` — satuan/bundling
3. `enum_metode_bayar` — Tunai/Transfer/QRIS
4. `enum_status_aktif` — aktif/nonaktif
5. `enum_kondisi_inventory` — baik/rusak/hilang
6. `enum_status_unit` — available/rented/damaged/maintenance (NOT USED YET)

**Columns Converted to Enum:**
- `transactions.status` → enum_status_transaksi (DEFAULT 'Booking')
- `inventory.jenis` → enum_jenis_inventory (DEFAULT 'satuan')
- `inventory.kondisi` → enum_kondisi_inventory
- `transaction_payments.payment_method` → enum_metode_bayar
- `members.status` → enum_status_aktif (DEFAULT 'aktif')
- `member_types.status` → enum_status_aktif (DEFAULT 'aktif')

**NOT NULL & Defaults Added:**
- `transactions.penyewa` NOT NULL
- `transactions.status` NOT NULL DEFAULT 'Booking'
- `inventory.nama` NOT NULL
- `inventory.jenis` NOT NULL DEFAULT 'satuan'
- `members.nama` NOT NULL
- `member_types.nama` NOT NULL

### Known Issues

**`inventory_units.status` Not Converted:**
- Reason: Enum conversion failed with error `operator does not exist: enum_status_unit = text`
- Status: Intentionally skipped, remains TEXT
- Future: Will evaluate conversion separately

**BIGINT → INT Skipped:**
- Reason: IDs are timestamp-based, risk of overflow
- Status: Intentionally skipped for safety

### SQL Script (Summary)

```sql
-- Create enum types
CREATE TYPE enum_status_transaksi AS ENUM ('Booking', 'Disewa', 'Selesai', 'Belum Selesai', 'Dibatalkan');
CREATE TYPE enum_jenis_inventory AS ENUM ('satuan', 'bundling');
CREATE TYPE enum_metode_bayar AS ENUM ('Tunai', 'Transfer', 'QRIS');
CREATE TYPE enum_status_aktif AS ENUM ('aktif', 'nonaktif');
CREATE TYPE enum_kondisi_inventory AS ENUM ('baik', 'rusak', 'hilang');

-- Convert columns (using ALTER TABLE ... ALTER COLUMN ... TYPE)
ALTER TABLE transactions 
  ALTER COLUMN status TYPE enum_status_transaksi USING status::enum_status_transaksi;

ALTER TABLE inventory 
  ALTER COLUMN jenis TYPE enum_jenis_inventory USING jenis::enum_jenis_inventory;

-- Add defaults
ALTER TABLE transactions ALTER COLUMN status SET DEFAULT 'Booking'::enum_status_transaksi;
ALTER TABLE inventory ALTER COLUMN jenis SET DEFAULT 'satuan'::enum_jenis_inventory;

-- Add NOT NULL
ALTER TABLE transactions ALTER COLUMN penyewa SET NOT NULL;
ALTER TABLE inventory ALTER COLUMN nama SET NOT NULL;
```

### Verification

```sql
-- Verify enum types created
SELECT typname FROM pg_type WHERE typtype = 'e' ORDER BY typname;
-- Expected: 9 enum types (6 from Phase 8 + 3 from Phase 9)

-- Verify columns converted
SELECT column_name, data_type, udt_name 
FROM information_schema.columns 
WHERE table_name = 'transactions' AND column_name = 'status';
-- Expected: data_type = USER-DEFINED, udt_name = enum_status_transaksi

-- Verify defaults
SELECT column_name, column_default 
FROM information_schema.columns 
WHERE table_name = 'transactions' AND column_name IN ('status', 'penyewa');
-- Expected: status has default, penyewa is NOT NULL
```

### Build & Deploy

**Build:** ✅ Passed  
**Local Test:** Skipped by user (Phase 4-6 tests already comprehensive)  
**Deploy:** Ready  
**Vercel URL:** `https://app-sewara-5p65j42a5-rizki12.vercel.app`

---

## Phase 9: SaaS Infrastructure

**Date:** 30 August 2026  
**Migration Files:**
- `supabase/migrations/phase9_saas_infrastructure.sql`
- `supabase/migrations/phase9_verification.sql`

**Commit:** `42af5b0`  
**Tag:** `phase9-saas-infrastructure`

### Changes

**New Enum Types (3):**
1. `enum_subscription_status` — trialing/active/past_due/grace_period/cancelled/expired/suspended
2. `enum_subscription_event` — subscription.*/payment.* events
3. `enum_permission_category` — inventory/transaction/member/report/setting/staff

**New SaaS Tables (8):**
1. `sewara_plans` — Paket langganan (Starter/Pro/Business)
2. `sewara_plan_features` — Fitur & limit per paket
3. `sewara_subscriptions` — Langganan aktif per owner
4. `sewara_subscription_payments` — Riwayat pembayaran
5. `sewara_subscription_events` — Webhook log
6. `sewara_usage_counters` — Tracking usage bulanan
7. `sewara_feature_overrides` — Override limit khusus
8. `sewara_payment_methods` — Metode bayar tersimpan

**New Permission Tables (3):**
9. `permissions` — Master list 20 permissions
10. `role_permissions` — Default permission per role
11. `staff_permissions` — Custom override per staff

**RLS Policies Added:** 18 policies
- SaaS tables: owner isolation via `owner_id = auth.uid()`
- Permission tables: public read + owner write
- Plans/features: public read only

**Helper Functions Added:**
1. `has_permission(user_id, owner_id, permission_code)` — Check permission
2. `get_feature_limit(owner_id, feature_code)` — Get feature limit

**Seed Data:**
- 3 plans: Starter (Rp99k), Pro (Rp199k), Business (Rp399k)
- 15 plan features (5 per plan)
- 20 permissions (grouped by 6 categories)
- 50 role permissions (owner=20, supervisor=17, cs=8, gudang=5)

### Verification Results

**Summary Check (30 Aug 2026):**

| Check | Actual | Expected | Status |
|-------|--------|----------|--------|
| SaaS Tables | 8 | 8 | ✅ PASS |
| Permission Tables | 3 | 3 | ✅ PASS |
| New Enum Types | 3 | 3 | ✅ PASS |
| Default Plans | 3 | 3 | ✅ PASS |
| Default Permissions | 20 | 20 | ✅ PASS |
| Helper Functions | 2 | 2 | ✅ PASS |

**All checks passed 6/6 ✅**

### Code Changes

**New Libraries:**
- `src/lib/subscription.js` (362 lines) — Feature gating, usage metering
- `src/lib/permission.js` (372 lines) — Permission check system
- `src/app/api/webhooks/payment/route.js` (382 lines) — Webhook skeleton

**Design Principles:**
- Backward compatible (all checks return unlimited/granted)
- Payment provider agnostic (skeleton supports Midtrans/Xendit/Stripe)
- RLS tenant isolation via `owner_id`
- Idempotency support for webhooks
- Dual-path permission check (override > role default)

### Phase 9 Security Hardening (31 August 2026)

Build passed for hardening code.

**Payment webhook:**
- `src/app/api/webhooks/payment/route.js` is fail-closed.
- POST returns `503` with `payment_webhook_not_configured`.
- Request payload is not parsed, logged, or processed; no DB writes occur.
- `verifySignature` defaults to `false`.
- Payment gateway remains inactive until provider-specific signature verification, robust idempotency, atomic DB processing, and retry behavior are implemented.

**Permissions:**
- `src/lib/permission.js` no longer misuses RPC query builders.
- Active permission UUID resolves through `permissions.code`.
- Override takes precedence over role default.
- DB/query errors deny access and log non-sensitive error code.
- Permission checks remain unenforced in routes.

**Read-only production preflight:**
- Audit migration: `supabase/migrations/phase9_security_preflight.sql`.
- Cross-tenant mismatch: `0`.
- Orphan rows: `0`.
- Parent IDs and child FKs are both actual `BIGINT`; former claimed text-ID mismatch disproven.
- Existing `transactions.member_id` has duplicate foreign keys.
- Child-table RLS uses direct `auth.uid()` and differs from parent owner/staff policy.

### Phase 9.5 — Composite FK/RLS Tenant Integrity

**Date:** 3 September 2026  
**Status:** ✅ Migration executed successfully and applied

Verification results:

| Check | Result |
|-------|--------|
| `composite_fks` | 6/6 PASS |
| `composite_unique_indexes` | 4/4 PASS |
| `phase9_5_rls_policies` | 3/3 PASS |
| `tenant_integrity_failures` | 0 PASS |

Composite FK/RLS enforcement is applied, not deferred. Multi-branch remains future work. Payment and permission enforcement remain inactive.

### Phase 9.5 Production Verification

- Deployment: `https://app-sewara-n5oseumod-rizki12.vercel.app`
- Alias: `https://app.sewara.my.id`
- Vercel status: Ready in 42s
- Manual production verification: all pass, including inventory delete protection behavior and booking/status core flows.
- No new console errors. Known font error remains.

Current production core works. SaaS billing/payment and custom permission enforcement remain inactive and not launch-ready.

### Deploy

**Build:** ✅ Passed
**Git Push:** ✅ Success
**Tag:** `phase9-saas-infrastructure`
**Commit:** `42af5b0`

**Files Added:** 10 files, 3338 insertions(+)

**Production Status:** Ready for current core only; Phase 9 billing/payment and custom permission enforcement are not launch-ready.

---


## Promo Auto-Expire

**Migration:** `supabase/migrations/promo_auto_expire.sql`  
**Status:** ✅ Applied successfully

- Permitted status values: `aktif`, `nonaktif`, `expired`.
- Expiry rule: `now() >= berlaku_sampai`, or `terpakai >= kuota` when quota is set.
- Persistence runs when promo list loads, promo is validated/applied, and immediately after final quota use. Request-triggered; no clock scheduler.
- Booking rejects invalid/expired promo. UI displays `Expired` and blocks editing.
- Applied verification: `ULTRAPREMIUM` expired by quota; `TEST` expired by time.
- Quota update uses compare-and-set concurrency control. No RPC or database transaction.

## Production Deployment Notes

Vercel is not GitHub-connected. Deploy manually from `E:\Aplikasi Inventory\sewara-apps`:

```bash
npx vercel --prod --yes
```

R2 document routes require Vercel Production environment variables: `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`. Production HTTP 500 was fixed after adding variables and redeploying.

## Recent Production Fix Commits

- `d7f39b8` — booking, status, member prefill, promo display initial fixes
- `822b6cc` — KartuTrx normalized item mapping
- `99a8d9f` — correct `transaction_items` actual column names
- `ab11140` — promo discount for non-member bookings
- `08e08b1` — promo auto-expire

## Rollback Procedures

### Phase 9 Rollback (if needed)

```sql
-- Drop tables (reverse order due to FK)
DROP TABLE IF EXISTS staff_permissions CASCADE;
DROP TABLE IF EXISTS role_permissions CASCADE;
DROP TABLE IF EXISTS permissions CASCADE;

DROP TABLE IF EXISTS sewara_payment_methods CASCADE;
DROP TABLE IF EXISTS sewara_feature_overrides CASCADE;
DROP TABLE IF EXISTS sewara_usage_counters CASCADE;
DROP TABLE IF EXISTS sewara_subscription_events CASCADE;
DROP TABLE IF EXISTS sewara_subscription_payments CASCADE;
DROP TABLE IF EXISTS sewara_subscriptions CASCADE;
DROP TABLE IF EXISTS sewara_plan_features CASCADE;
DROP TABLE IF EXISTS sewara_plans CASCADE;

-- Drop enum types
DROP TYPE IF EXISTS enum_permission_category CASCADE;
DROP TYPE IF EXISTS enum_subscription_event CASCADE;
DROP TYPE IF EXISTS enum_subscription_status CASCADE;

-- Drop functions
DROP FUNCTION IF EXISTS has_permission CASCADE;
DROP FUNCTION IF EXISTS get_feature_limit CASCADE;
```

### Phase 8 Rollback (NOT RECOMMENDED)

Enum rollback is destructive and risky. Only if critical issue:

```sql
-- Convert back to TEXT (data loss on invalid enum values)
ALTER TABLE transactions ALTER COLUMN status TYPE TEXT;
ALTER TABLE inventory ALTER COLUMN jenis TYPE TEXT;
-- ... (etc for other enum columns)

-- Drop enum types
DROP TYPE enum_status_transaksi CASCADE;
DROP TYPE enum_jenis_inventory CASCADE;
-- ... (etc)
```

### Phase 4-6 Rollback (NOT RECOMMENDED)

Would lose normalized data:

```sql
-- Drop tables
DROP TABLE transaction_items CASCADE;
DROP TABLE transaction_payments CASCADE;
DROP TABLE inventory_units CASCADE;
```

**Note:** JSONB fallback still intact, app would work but dual-write broken.

---

## Migration Best Practices

### Pre-Migration Checklist

- [ ] Backup database (or document current state if Pro account unavailable)
- [ ] Run preflight verification queries
- [ ] Document current row counts
- [ ] Check for orphan data
- [ ] Review migration SQL for syntax errors
- [ ] Test migration in development/staging first (if available)

### During Migration

- [ ] Execute migration in Supabase SQL Editor
- [ ] Monitor execution time
- [ ] Check for errors in output
- [ ] Don't interrupt long-running migrations

### Post-Migration Checklist

- [ ] Run verification queries
- [ ] Compare row counts (before vs after)
- [ ] Test critical user flows manually
- [ ] Check RLS policies applied correctly
- [ ] Verify foreign keys created
- [ ] Run `npm run build` (check for code errors)
- [ ] Deploy to production
- [ ] Smoke test production
- [ ] Update documentation
- [ ] Commit code changes
- [ ] Tag release

---

## Known Issues & Resolutions

### Issue 1: RLS Policy Missing (Phase 4-6)
**Error:** `42501: new row violates row-level security policy for table "transaction_items"`  
**Cause:** Forgot to add RLS policies on new normalized tables  
**Resolution:** Added `phase4e_fix_rls_policies.sql` with 12 policies  
**Status:** ✅ Fixed

### Issue 2: Enum Conversion Failed (Phase 8)
**Error:** `operator does not exist: enum_status_unit = text`  
**Cause:** Schema conflict when converting `inventory_units.status`  
**Resolution:** Skip conversion, leave as TEXT  
**Status:** ⏸️ Deferred (evaluate separately)

### Issue 3: Git Email Blocked Vercel
**Error:** Vercel deploy rejected due to unverified email  
**Cause:** Git config using `Rzp1010@users.noreply.github.com`  
**Resolution:** Amend commit with verified email, force push  
**Status:** ✅ Fixed

### Issue 4: Webhook 404 (Phase 9)
**Error:** `/api/webhooks/payment` returns 404  
**Cause:** New file not yet deployed  
**Resolution:** Expected behavior, will work after deploy  
**Status:** ✅ Normal (not an issue)

### Issue 5: Role Permissions Count Discrepancy
**Expected:** 50 role permissions  
**Actual:** 50 role permissions  
**Cause:** Documentation typo (should be 50)  
**Resolution:** Update docs, actual count is correct  
**Status:** ✅ Fixed (documentation)

---

## Future Migration Plans

### Pending Work

1. **`inventory_units.status` Enum Conversion**
   - Status: Deferred
   - Difficulty: Medium
   - Requires: Schema analysis & operator resolution

2. **Drop JSONB Fallback Columns**
   - Status: Observation period
   - Risk: Medium
   - Requires: 24-48 hour stable production + approval
   - Columns: `transactions.items`, `transactions.pembayaran`, `inventory.sns`

3. **Payment Gateway Integration**
   - Status: Planned (post-rilis)
   - Difficulty: Medium
   - Requires: Provider selection (Midtrans/Xendit/Stripe)

4. **Multi-Branch Support**
   - Status: Future update
   - Difficulty: High (~30 hours)
   - Requires: RLS rewrite (`user_id` → `branch_id`)

5. **Auth Migration (Supabase → Custom)**
   - Status: Long-term
   - Difficulty: High (~20-30 hours)
   - Requires: Vendor-agnostic auth strategy

---

## Documentation Files

**Current Documentation:**
- `docs/database/SCHEMA.md` — Detailed schema documentation (28 tables)
- `docs/database/ERD.md` — Entity relationship diagrams
- `docs/database/MIGRATIONS.md` — This file (migration history)
- `SESSION_PROGRESS.md` — Session progress notes
- `PHASE9_PLAN.md` — Phase 9 execution guide
- `FUTURE_UPDATES.md` — Roadmap future features

**Migration Files:**
- `supabase/migrations/phase2_rename_tables.sql`
- `supabase/migrations/phase3_drop_legacy_columns.sql`
- `supabase/migrations/phase3_fix_rpc_functions.sql`
- `supabase/migrations/phase4b_create_tables.sql`
- `supabase/migrations/phase4c_backfill_data.sql`
- `supabase/migrations/phase4e_fix_rls_policies.sql`
- `supabase/migrations/phase7a_orphan_check.sql`
- `supabase/migrations/phase7b_add_foreign_keys.sql`
- `supabase/migrations/phase8_step1_create_enums.sql`
- `supabase/migrations/phase8_step2_apply_enums.sql`
- `supabase/migrations/phase8_step3_defaults.sql`
- `supabase/migrations/phase9_saas_infrastructure.sql`
- `supabase/migrations/phase9_verification.sql`

---

**Last Updated:** 3 September 2026
**Maintained by:** Development Team  
**For questions:** Refer to commit history or `SESSION_PROGRESS.md`
