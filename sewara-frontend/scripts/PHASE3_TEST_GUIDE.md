# Phase 3 RPC Function Verification Guide

## Automated Test Script

### Option 1: With User Credentials (Recommended)

```bash
# Set your credentials as environment variables
$env:TEST_EMAIL="your-email@example.com"
$env:TEST_PASSWORD="your-password"
node scripts/test-rpc-functions.js
```

### Option 2: Direct SQL Testing (Most Reliable)

Buka **Supabase Dashboard** → **SQL Editor**:

https://supabase.com/dashboard/project/obhvrzholszhjnpvmnna/sql

Copy-paste queries berikut satu per satu:

---

## Test 1: Get Your User ID

```sql
-- Get your user ID first
SELECT id, email FROM auth.users 
WHERE email = 'your-email@example.com';
-- Copy the ID for next tests
```

---

## Test 2: rpc_dashboard_rekap_status

```sql
-- Replace '<your-user-id>' with actual UUID from Test 1
SELECT * FROM rpc_dashboard_rekap_status(
  '<your-user-id>'::uuid,
  NULL,
  NULL
);

-- Expected result (example):
-- {
--   "booking": 5,
--   "disewa": 3,
--   "mendekati": 1,
--   "telat": 0,
--   "belumSelesai": 2,
--   "selesai": 42
-- }
```

**✅ PASS if:** Returns JSON object with counts  
**❌ FAIL if:** Error "column waktuKembaliRencana does not exist"

---

## Test 3: rpc_dashboard_pembayaran

```sql
-- Test with basis 'selesai'
SELECT * FROM rpc_dashboard_pembayaran(
  '<your-user-id>'::uuid,
  NULL,
  NULL,
  'selesai'
);

-- Test with basis 'aktif'
SELECT * FROM rpc_dashboard_pembayaran(
  '<your-user-id>'::uuid,
  NULL,
  NULL,
  'aktif'
);

-- Expected result (example):
-- {
--   "totalAkhir": 5000000,
--   "diterima": 4500000,
--   "tunai": 2000000,
--   "transfer": 2000000,
--   "qris": 500000
-- }
```

**✅ PASS if:** Returns JSON object with payment totals  
**❌ FAIL if:** Error "column totalAkhir does not exist"

---

## Test 4: Verify Schema Cleanup

```sql
-- Check camelCase columns are dropped
SELECT column_name 
FROM information_schema.columns
WHERE table_name = 'transactions'
  AND column_name IN (
    'noInvoice', 'hpPenyewa', 'alamatPenyewa', 'jaminanSewa',
    'waktuAmbilRencana', 'waktuKembaliRencana', 'waktuAmbilAktual', 
    'waktuKembaliAktual', 'durasiTeks', 'biayaDasar', 
    'dendaTambahan', 'totalAkhir'
  );

-- Expected result: 0 rows (empty)
```

**✅ PASS if:** Returns 0 rows  
**❌ FAIL if:** Returns any column names

---

## Test 5: Verify Snake_case Columns Exist

```sql
-- Check snake_case columns exist and have data
SELECT 
  no_invoice,
  hp_penyewa,
  total_akhir,
  waktu_kembali_rencana,
  biaya,
  denda
FROM transactions
LIMIT 5;
```

**✅ PASS if:** Returns rows with data  
**❌ FAIL if:** Error "column does not exist"

---

## Test 6: Check RPC Function Definitions

```sql
-- Verify RPC functions don't reference camelCase columns
SELECT 
  p.proname as function_name,
  CASE 
    WHEN pg_get_functiondef(p.oid) LIKE '%waktuKembaliRencana%' THEN '❌ Has waktuKembaliRencana'
    WHEN pg_get_functiondef(p.oid) LIKE '%totalAkhir%' THEN '❌ Has totalAkhir'
    WHEN pg_get_functiondef(p.oid) LIKE '%biayaDasar%' THEN '❌ Has biayaDasar'
    WHEN pg_get_functiondef(p.oid) LIKE '%noInvoice%' THEN '❌ Has noInvoice'
    ELSE '✅ Clean'
  END as status
FROM pg_proc p
WHERE p.pronamespace = 'public'::regnamespace
  AND p.proname IN (
    'rpc_dashboard_rekap_status',
    'rpc_dashboard_pembayaran',
    'notify_telegram_transaksi'
  );

-- Expected result: All rows show '✅ Clean'
```

**✅ PASS if:** All functions show "✅ Clean"  
**❌ FAIL if:** Any function shows "❌ Has ..."

---

## Test 7: Telegram Trigger (Optional)

```sql
-- Get a test transaction
SELECT id, status, total_akhir 
FROM transactions 
LIMIT 1;

-- Update it (this will trigger notify_telegram_transaksi)
-- Replace <transaction-id> with actual ID from above
UPDATE transactions 
SET status = status  -- No actual change, just trigger
WHERE id = '<transaction-id>'::uuid;

-- Check if update succeeded without errors
```

**✅ PASS if:** Update completes without error  
**❌ FAIL if:** Error "column does not exist" in trigger  
**Note:** Check Telegram for webhook notification (if enabled)

---

## Quick Production Website Test

### Dashboard Stats (Test rpc_dashboard_rekap_status)

1. Open: https://app-sewara-5v4z678qa-rizki12.vercel.app
2. Login with your credentials
3. Look at dashboard cards showing counts:
   - Booking: X
   - Disewa: X
   - Telat: X
   - Selesai: X

**✅ PASS if:** Numbers display correctly  
**❌ FAIL if:** Loading forever or error message

### Dashboard Payments (Test rpc_dashboard_pembayaran)

1. Go to Dashboard → Laporan/Keuangan page (if exists)
2. Look for payment summary:
   - Total Akhir: Rp X
   - Diterima: Rp X
   - Tunai / Transfer / QRIS breakdowns

**✅ PASS if:** Payment amounts display  
**❌ FAIL if:** Error or empty

### Browser Console Check

1. Open browser DevTools (F12)
2. Go to Console tab
3. Look for any red errors mentioning:
   - "column does not exist"
   - "waktuKembaliRencana"
   - "totalAkhir"
   - "biayaDasar"

**✅ PASS if:** No column errors  
**❌ FAIL if:** Column errors appear

---

## Summary Checklist

After running all tests, fill this out:

- [ ] **Test 1:** User ID retrieved ✅
- [ ] **Test 2:** rpc_dashboard_rekap_status works ✅/❌
- [ ] **Test 3:** rpc_dashboard_pembayaran works ✅/❌
- [ ] **Test 4:** CamelCase columns dropped (0 rows) ✅/❌
- [ ] **Test 5:** Snake_case columns exist ✅/❌
- [ ] **Test 6:** RPC definitions clean ✅/❌
- [ ] **Test 7:** Telegram trigger works ✅/❌
- [ ] **Website:** Dashboard displays correctly ✅/❌
- [ ] **Website:** No console errors ✅/❌

**Overall Status:** ___________

---

## If Tests Fail

### Common Issues

**Error: "column X does not exist"**
- RPC function still references old camelCase column
- Check function definition in Test 6
- Re-run Phase 3 migration

**Error: "permission denied for function"**
- User doesn't have RLS access
- Check `user_id` parameter matches authenticated user
- Verify RLS policies on transactions table

**Numbers all zero**
- Correct! If no transactions match filters
- Try different date ranges or user_id

**Update failed on Test 7**
- Trigger function still broken
- Check Supabase logs for detailed error

---

## Contact

If all tests pass: 🎉 **Phase 3 VERIFIED!**

If any test fails: Share the error message and which test failed.
