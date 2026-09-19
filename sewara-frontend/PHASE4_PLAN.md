# Phase 4+ Execution Plan — Database Normalization & SaaS Architecture

**Date:** 28 Agustus 2026  
**Project:** Sewara (obhvrzholszhjnpvmnna)  
**Status:** Phase 1-3 ✅ Complete | Phase 4+ Planning

---

## 🎯 Overview

**Goal:** Transform monolithic JSONB structure into normalized relational database with 26 tables ready for SaaS multi-tenant platform.

**Current State (Post Phase 1-3):**
- ✅ All columns snake_case
- ✅ Tables renamed (`member_types`, `activity_logs`)
- ✅ 12 legacy camelCase columns dropped
- ✅ RPC functions fixed
- ❌ JSONB still denormalized (items, pembayaran, riwayatDilayani, sns, foto_jaminan)

**Target State (Phase 4-8):**
- 13 business rental tables
- 5 shared tables
- 8 SaaS platform tables (`sewara_*`)
- Normalized data with foreign keys
- Enum types for static values
- Optimized indexes

---

## 📊 Current Database Stats

**Tables:** 12  
**Total rows:** ~735 (as of 27 Aug 2026)

| Table | Rows | JSONB Columns | Status |
|---|---|---|---|
| `transactions` | 58 | `items`, `pembayaran`, `riwayatDilayani`, `diskon` | ⚠️ Needs normalization |
| `inventory` | 61 | `sns`, `komponen` | ⚠️ `sns` → normalize, `komponen` → keep |
| `members` | 4 | `foto_jaminan` | ⚠️ Needs normalization (future) |
| `member_types` | 2 | - | ✅ Clean |
| `activity_logs` | 140 | - | ✅ Clean |
| `settings` | 71 | - | ✅ Clean |
| `profiles` | 10 | - | ✅ Clean |
| `login_logs` | 373 | - | ✅ Clean |
| `admin_logs` | 16 | - | ✅ Clean |
| `app_config` | 1 | - | ✅ Clean |
| `promo_codes` | 1 | - | ✅ Clean |
| `versi_akun` | 2 | - | ✅ Clean |

---

## 🗓️ Phase Breakdown

### Phase 4: Normalize `transactions.items` → `transaction_items`
**Duration:** 1-2 days  
**Risk:** Medium  
**Complexity:** High (most critical business logic)

### Phase 5: Normalize `transactions.pembayaran` → `transaction_payments`
**Duration:** 1 day  
**Risk:** Medium  
**Complexity:** Medium

### Phase 6: Normalize `inventory.sns` → `inventory_units`
**Duration:** 1 day  
**Risk:** Low  
**Complexity:** Low

### Phase 7: Add Foreign Keys + Constraints
**Duration:** 1 day  
**Risk:** Medium (can block inserts if orphans exist)  
**Complexity:** Medium

### Phase 8: Enum Types + Optimizations
**Duration:** 1 day  
**Risk:** Low  
**Complexity:** Low

### Phase 9+: SaaS Platform Tables (Future)
**Duration:** 2-3 weeks  
**Risk:** Low (additive only)  
**Complexity:** High

**Total Time (Phase 4-8):** 5-7 days  
**Total Time (Phase 4-9):** 3-4 weeks

---

## 📋 PHASE 4: Normalize `transactions.items`

### 4A: Inspection & Planning

**Goal:** Understand current JSONB structure before normalization.

**Tasks:**

1. **Inspect sample JSONB:**
```sql
-- Get 5 sample items JSONB
SELECT 
  id,
  no_invoice,
  jsonb_pretty(items) as items_structure,
  jsonb_array_length(items) as item_count
FROM transactions
WHERE jsonb_array_length(items) > 0
ORDER BY created_at DESC
LIMIT 5;
```

2. **Count total elements:**
```sql
-- Total items across all transactions
SELECT 
  COUNT(*) as total_transactions,
  SUM(jsonb_array_length(items)) as total_items,
  AVG(jsonb_array_length(items))::numeric(10,2) as avg_items_per_transaction,
  MAX(jsonb_array_length(items)) as max_items
FROM transactions
WHERE jsonb_array_length(items) > 0;
```

3. **Analyze item structure:**
```sql
-- Flatten items to see all keys
SELECT DISTINCT jsonb_object_keys(item)
FROM transactions,
LATERAL jsonb_array_elements(items) AS item
LIMIT 50;
```

4. **Identify edge cases:**
```sql
-- Empty items array
SELECT COUNT(*) FROM transactions WHERE items = '[]'::jsonb;

-- NULL items
SELECT COUNT(*) FROM transactions WHERE items IS NULL;

-- Items with missing inventory_id
SELECT 
  id, no_invoice, item
FROM transactions,
LATERAL jsonb_array_elements(items) AS item
WHERE item->>'inventory_id' IS NULL
LIMIT 10;
```

**Deliverable:** Document with:
- Sample JSONB structure
- Total item count
- All JSONB keys found
- Edge cases count

---

### 4B: Create Target Table

**Schema:**

```sql
-- Phase 4B: Create transaction_items table
-- Date: 2026-08-28

BEGIN;

CREATE TABLE IF NOT EXISTS transaction_items (
  id SERIAL PRIMARY KEY,
  transaction_id BIGINT NOT NULL,  -- FK to transactions(id)
  inventory_id BIGINT NOT NULL,    -- FK to inventory(id)
  item_name TEXT NOT NULL,         -- snapshot dari inventory.nama
  item_type TEXT NOT NULL,         -- 'satuan' or 'bundling'
  qty INTEGER NOT NULL CHECK (qty > 0),
  duration_hours INTEGER,          -- durasi sewa dalam jam
  rate_type TEXT,                  -- 'h6', 'h12', 'h24', custom
  unit_price NUMERIC(12,2) NOT NULL CHECK (unit_price >= 0),
  subtotal NUMERIC(12,2) NOT NULL CHECK (subtotal >= 0),
  
  -- For satuan items
  serial_number TEXT,              -- SN yang disewa
  
  -- For bundling items
  assigned_components JSONB DEFAULT '[]'::jsonb,  -- [{nama, sns: []}]
  
  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id UUID NOT NULL            -- owner/tenant
);

-- Indexes
CREATE INDEX idx_transaction_items_transaction_id 
  ON transaction_items(transaction_id);

CREATE INDEX idx_transaction_items_inventory_id 
  ON transaction_items(inventory_id);

CREATE INDEX idx_transaction_items_user_id 
  ON transaction_items(user_id);

-- Partial index for active rentals
CREATE INDEX idx_transaction_items_active 
  ON transaction_items(transaction_id, inventory_id)
  WHERE serial_number IS NOT NULL;

-- Verification
DO $$
BEGIN
  RAISE NOTICE '✅ transaction_items table created';
  RAISE NOTICE '✅ 4 indexes created';
END $$;

COMMIT;
```

**Execute:**
- [ ] Run SQL in Supabase SQL Editor
- [ ] Verify table created: `\d transaction_items`
- [ ] Verify 0 rows: `SELECT COUNT(*) FROM transaction_items`

---

### 4C: Backfill Data

**Backfill Script:**

```sql
-- Phase 4C: Backfill transaction_items from transactions.items JSONB
-- Date: 2026-08-28

BEGIN;

-- Insert normalized items
INSERT INTO transaction_items (
  transaction_id,
  inventory_id,
  item_name,
  item_type,
  qty,
  duration_hours,
  rate_type,
  unit_price,
  subtotal,
  serial_number,
  assigned_components,
  user_id,
  created_at
)
SELECT 
  t.id as transaction_id,
  (item->>'inventory_id')::BIGINT as inventory_id,
  COALESCE(item->>'nama', item->'ref'->>'nama', 'Unknown') as item_name,
  COALESCE(item->>'jenis', item->'ref'->>'jenis', 'satuan') as item_type,
  COALESCE((item->>'qty')::INTEGER, 1) as qty,
  
  -- Duration (extract from durasi_teks or calculate)
  NULL as duration_hours,  -- TODO: parse dari t.durasi_teks
  
  -- Rate type (h6, h12, h24)
  item->>'tarif' as rate_type,
  
  -- Pricing
  COALESCE((item->>'harga')::NUMERIC, 0) as unit_price,
  COALESCE((item->>'subtotal')::NUMERIC, 0) as subtotal,
  
  -- Serial number (for satuan)
  item->>'sn' as serial_number,
  
  -- Components (for bundling)
  COALESCE(item->'assignedSNs', '[]'::jsonb) as assigned_components,
  
  -- Metadata
  t.user_id,
  t.created_at
FROM transactions t,
LATERAL jsonb_array_elements(t.items) AS item
WHERE t.items IS NOT NULL 
  AND jsonb_array_length(t.items) > 0;

-- Verification
DO $$
DECLARE
  v_source_count INTEGER;
  v_target_count INTEGER;
BEGIN
  -- Count source elements
  SELECT SUM(jsonb_array_length(items)) INTO v_source_count
  FROM transactions
  WHERE items IS NOT NULL AND jsonb_array_length(items) > 0;
  
  -- Count target rows
  SELECT COUNT(*) INTO v_target_count FROM transaction_items;
  
  IF v_source_count != v_target_count THEN
    RAISE WARNING 'Row count mismatch! Source: %, Target: %', v_source_count, v_target_count;
  ELSE
    RAISE NOTICE '✅ Backfill successful: % items', v_target_count;
  END IF;
  
  -- Check for NULL inventory_id (should be 0)
  SELECT COUNT(*) INTO v_source_count 
  FROM transaction_items 
  WHERE inventory_id IS NULL;
  
  IF v_source_count > 0 THEN
    RAISE WARNING 'Found % items with NULL inventory_id', v_source_count;
  END IF;
END $$;

COMMIT;
```

**Execute:**
- [ ] Run backfill SQL
- [ ] Verify row counts match
- [ ] Check for NULL inventory_id
- [ ] Sample check: `SELECT * FROM transaction_items LIMIT 10`

---

### 4D: Update Application Code

**Files to Update:**

1. **`src/lib/db.js`**
   - Add `getTransactionItems(transactionId)`
   - Add `setTransactionItems(transactionId, items[])`
   - Update `setTransactions()` to write to both JSONB + normalized (dual-write period)

2. **`src/app/dashboard/booking/page.js`**
   - Read items from `transaction_items` table (fallback to JSONB)
   - Write items to both structures

3. **`src/app/dashboard/status/page.js`**
   - Display items from normalized table

4. **`src/app/dashboard/riwayat/page.js`**
   - Display items from normalized table

5. **`src/components/InvoiceView.jsx`**
   - Read items from normalized table (with fallback)

**Dual-write Strategy:**

```javascript
// lib/db.js
export async function saveTransaction(txData) {
  const { items, ...txFields } = txData;
  
  // 1. Save transaction (with JSONB items for backward compat)
  const tx = await supabase()
    .from('transactions')
    .upsert({
      ...txFields,
      items: items  // Keep JSONB during transition
    })
    .select()
    .single();
  
  // 2. Save normalized items
  if (items && items.length > 0) {
    const normalizedItems = items.map(item => ({
      transaction_id: tx.data.id,
      inventory_id: item.inventory_id,
      item_name: item.ref?.nama || item.nama,
      item_type: item.ref?.jenis || item.jenis,
      qty: item.qty || 1,
      unit_price: item.harga || 0,
      subtotal: item.subtotal || 0,
      serial_number: item.sn || null,
      assigned_components: item.assignedSNs || [],
      user_id: tx.data.user_id
    }));
    
    await supabase()
      .from('transaction_items')
      .upsert(normalizedItems);
  }
  
  return tx;
}
```

**Delegate to @fixer:**
- Update db.js functions
- Update all pages reading items
- Implement dual-write

---

### 4E: Testing & Verification

**Test Cases:**

1. **Read existing transactions:**
   - [ ] Old transactions show items correctly (from normalized table)
   - [ ] JSONB fallback works if normalized missing

2. **Create new transaction:**
   - [ ] Items written to both JSONB + normalized
   - [ ] Row count matches

3. **Edit transaction:**
   - [ ] Items updated in both places

4. **Delete transaction:**
   - [ ] Cascade delete items (or orphan check)

5. **Invoice generation:**
   - [ ] Items display correctly with SN/components

**SQL Verification:**

```sql
-- Compare JSONB vs normalized counts
SELECT 
  t.id,
  t.no_invoice,
  jsonb_array_length(t.items) as jsonb_count,
  COUNT(ti.id) as normalized_count
FROM transactions t
LEFT JOIN transaction_items ti ON ti.transaction_id = t.id
GROUP BY t.id, t.no_invoice, t.items
HAVING jsonb_array_length(t.items) != COUNT(ti.id)
LIMIT 10;

-- Should return 0 rows after dual-write
```

---

### 4F: Deploy & Monitor

**Deploy Steps:**

1. **Build test:**
```bash
npm run build
```

2. **Git commit:**
```bash
git add .
git commit -m "Phase 4: Normalize transactions.items → transaction_items (dual-write)"
git push origin master
```

3. **Deploy:**
```bash
npx vercel --prod --yes
```

4. **Smoke test production:**
   - [ ] Create test booking
   - [ ] Verify items in both structures
   - [ ] Check invoice display
   - [ ] Edit items
   - [ ] Delete transaction

**Monitor (24-48 hours):**
- [ ] No errors in Vercel logs
- [ ] Row counts stay in sync
- [ ] No NULL inventory_id
- [ ] Performance acceptable

---

### 4G: Drop JSONB Column (After Stable Period)

**CAUTION:** Only after 48 hours stable + user confirmation.

```sql
-- Phase 4G: Drop transactions.items JSONB column
-- IRREVERSIBLE! Backup first!

BEGIN;

-- Verify normalized table has more recent data
SELECT 
  MAX(created_at) as jsonb_last,
  (SELECT MAX(created_at) FROM transaction_items) as normalized_last;
-- normalized_last should be >= jsonb_last

-- Drop column
ALTER TABLE transactions DROP COLUMN items;

-- Verification
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'transactions' AND column_name = 'items'
  ) THEN
    RAISE EXCEPTION 'Column items still exists!';
  END IF;
  
  RAISE NOTICE '✅ transactions.items JSONB column dropped';
END $$;

COMMIT;
```

**Execute only after:**
- [ ] 48+ hours stable
- [ ] No errors in logs
- [ ] User confirms ready
- [ ] Backup created

---

## 📋 PHASE 5: Normalize `transactions.pembayaran`

**Similar flow to Phase 4:**

### Target Table: `transaction_payments`

```sql
CREATE TABLE transaction_payments (
  id SERIAL PRIMARY KEY,
  transaction_id BIGINT NOT NULL,
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  payment_method TEXT NOT NULL,  -- 'Tunai', 'Transfer', 'QRIS'
  payment_date TIMESTAMPTZ NOT NULL,
  notes TEXT,
  user_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**Source:** `transactions.pembayaran->>'riwayatBayar'` (JSONB array)

**Steps:** Same as Phase 4 (A-G)

---

## 📋 PHASE 6: Normalize `inventory.sns`

**Target Table: `inventory_units`**

```sql
CREATE TABLE inventory_units (
  id SERIAL PRIMARY KEY,
  inventory_id BIGINT NOT NULL,  -- FK to inventory(id)
  serial_number TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'available',  -- 'available', 'rented', 'maintenance'
  notes TEXT,
  user_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  UNIQUE(inventory_id, serial_number)
);
```

**Source:** `inventory.sns` (JSONB array of strings)

**Steps:** Same as Phase 4 (A-G)

---

## 📋 PHASE 7: Foreign Keys + Constraints

**After Phase 4-6 stable, add referential integrity:**

```sql
-- Phase 7: Add Foreign Keys

BEGIN;

-- transaction_items → transactions
ALTER TABLE transaction_items
ADD CONSTRAINT fk_transaction_items_transaction
FOREIGN KEY (transaction_id) 
REFERENCES transactions(id) 
ON DELETE CASCADE;

-- transaction_items → inventory
ALTER TABLE transaction_items
ADD CONSTRAINT fk_transaction_items_inventory
FOREIGN KEY (inventory_id) 
REFERENCES inventory(id) 
ON DELETE RESTRICT;  -- Cannot delete inventory if in active transactions

-- transaction_payments → transactions
ALTER TABLE transaction_payments
ADD CONSTRAINT fk_transaction_payments_transaction
FOREIGN KEY (transaction_id) 
REFERENCES transactions(id) 
ON DELETE CASCADE;

-- inventory_units → inventory
ALTER TABLE inventory_units
ADD CONSTRAINT fk_inventory_units_inventory
FOREIGN KEY (inventory_id) 
REFERENCES inventory(id) 
ON DELETE CASCADE;

-- members.member_type_id → member_types
ALTER TABLE members
ADD CONSTRAINT fk_members_member_type
FOREIGN KEY (tipe_id) 
REFERENCES member_types(id) 
ON DELETE SET NULL;  -- Soft reference

-- transactions.member_id → members
ALTER TABLE transactions
ADD CONSTRAINT fk_transactions_member
FOREIGN KEY (member_id) 
REFERENCES members(id) 
ON DELETE SET NULL;  -- Soft reference

COMMIT;
```

**Verify orphans first:**

```sql
-- Check orphan transaction_items (should be 0)
SELECT COUNT(*) 
FROM transaction_items ti
WHERE NOT EXISTS (SELECT 1 FROM transactions t WHERE t.id = ti.transaction_id);

-- Check orphan inventory references (should be 0)
SELECT COUNT(*) 
FROM transaction_items ti
WHERE NOT EXISTS (SELECT 1 FROM inventory i WHERE i.id = ti.inventory_id);
```

---

## 📋 PHASE 8: Enum Types + Optimizations

### Create Enum Types

```sql
-- Phase 8: Enum Types

BEGIN;

-- Transaction status
CREATE TYPE enum_status_transaksi AS ENUM (
  'Booking', 'Disewa', 'Selesai', 'Belum Selesai', 'Dibatalkan'
);

-- Inventory type
CREATE TYPE enum_jenis_inventory AS ENUM (
  'satuan', 'bundling'
);

-- Payment method
CREATE TYPE enum_metode_bayar AS ENUM (
  'Tunai', 'Transfer', 'QRIS'
);

-- Active status
CREATE TYPE enum_status_aktif AS ENUM (
  'aktif', 'nonaktif'
);

-- Apply to tables
ALTER TABLE transactions 
ALTER COLUMN status TYPE enum_status_transaksi 
USING status::enum_status_transaksi;

ALTER TABLE inventory 
ALTER COLUMN jenis TYPE enum_jenis_inventory 
USING jenis::enum_jenis_inventory;

ALTER TABLE transaction_payments 
ALTER COLUMN payment_method TYPE enum_metode_bayar 
USING payment_method::enum_metode_bayar;

ALTER TABLE members 
ALTER COLUMN status TYPE enum_status_aktif 
USING status::enum_status_aktif;

COMMIT;
```

### Optimize Data Types

```sql
-- Change BIGINT to INT4 (2B limit sufficient)
ALTER TABLE transactions ALTER COLUMN id TYPE INT4;
ALTER TABLE inventory ALTER COLUMN id TYPE INT4;
ALTER TABLE members ALTER COLUMN id TYPE INT4;
-- etc...

-- Add NOT NULL where appropriate
ALTER TABLE transactions ALTER COLUMN penyewa SET NOT NULL;
ALTER TABLE transactions ALTER COLUMN status SET NOT NULL;
-- etc...
```

---

## 🎯 Success Criteria

**Phase 4-8 Complete When:**

✅ All JSONB normalized (items, pembayaran, sns)  
✅ Foreign keys enforced  
✅ Enum types applied  
✅ No orphan rows  
✅ No NULL in required fields  
✅ All tests passing  
✅ Production stable 48+ hours  
✅ Performance acceptable (<500ms queries)  
✅ Documentation updated

---

## 📦 Deliverables

1. ✅ `supabase/migrations/phase4_normalize_items.sql`
2. ✅ `supabase/migrations/phase5_normalize_payments.sql`
3. ✅ `supabase/migrations/phase6_normalize_units.sql`
4. ✅ `supabase/migrations/phase7_foreign_keys.sql`
5. ✅ `supabase/migrations/phase8_enums_optimizations.sql`
6. ✅ `PHASE4_REPORT.md` - execution report
7. ✅ Updated `DATABASE_CURRENT_STATE.md`

---

## ⏭️ Next: Phase 9+ (SaaS Platform)

**After Phase 4-8 stable, add 8 SaaS tables:**

- `sewara_plans`
- `sewara_plan_features`
- `sewara_subscriptions`
- `sewara_subscription_payments`
- `sewara_subscription_events`
- `sewara_usage_counters`
- `sewara_feature_overrides`
- `sewara_payment_methods`

**Timeline:** 2-3 minggu additional (additive only, low risk)

---

**Phase 4+ Planning Complete!** 🎯  
**Ready to execute:** Phase 4A (Inspection) when user gives go-ahead  
**Estimated total time Phase 4-8:** 5-7 hari kerja
