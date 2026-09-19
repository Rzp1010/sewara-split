# Handoff: Phase 3 RPC Function Fix Required

**Date:** 28 Agustus 2026, 19:16 WIB  
**Priority:** HIGH  
**Status:** ⚠️ INCOMPLETE - 1 function still has camelCase  
**Project:** Sewara Apps (obhvrzholszhjnpvmnna)

---

## Issue Summary

**Verification test results:**

| Function | Status | Issue |
|---|---|---|
| `notify_telegram_transaksi` | ✅ Clean | Fixed correctly |
| `rpc_dashboard_rekap_status` | ✅ Clean | Fixed correctly |
| `rpc_dashboard_pembayaran` | ❌ Has camelCase | **STILL BROKEN** |

**Problem:** `rpc_dashboard_pembayaran` still references camelCase column(s) despite Phase 3 migration.

**Impact:** 
- Dashboard payment reports will fail
- Production error when users access Laporan/Keuangan page
- Medium severity (feature broken, but not critical auth/data)

---

## Root Cause Analysis

### What Was Done (Phase 3)

**Migration file:** `supabase/migrations/phase3_fix_remaining_rpc.sql`

**Changes applied:**
- Line 39: `"totalAkhir"` → `total_akhir` ✅
- Lines 52-116: Payment method queries updated ✅

**Expected:** All camelCase references removed

**Actual:** Function still contains camelCase (detected by verification query)

### Possible Causes

1. **Migration didn't apply fully** — function definition not updated in DB
2. **Additional camelCase reference missed** — could be in:
   - Return statement (line 119: `'totalAkhir'` as JSON key - this is OK)
   - Variable names (lines 24-28: `v_total_akhir` - this is OK)
   - Hidden column reference we missed
3. **Function was reverted/overwritten** — another migration/change rolled it back

---

## Required Action

### Step 1: Inspect Current Function Definition

Run this in Supabase SQL Editor to see actual function code:

```sql
SELECT pg_get_functiondef(p.oid) as definition
FROM pg_proc p
WHERE p.pronamespace = 'public'::regnamespace
  AND p.proname = 'rpc_dashboard_pembayaran';
```

**Look for:**
- Any `"camelCase"` with quotes (column references)
- Any `totalAkhir` without quotes in SELECT/FROM/WHERE

**Note:** These are OK (not column references):
- `'totalAkhir'` in JSON keys (return statement)
- `v_total_akhir` variable names

### Step 2: Search for CamelCase Pattern

```sql
SELECT 
  CASE 
    WHEN pg_get_functiondef(p.oid) LIKE '%"totalAkhir"%' THEN 'Found "totalAkhir"'
    WHEN pg_get_functiondef(p.oid) LIKE '%"biayaDasar"%' THEN 'Found "biayaDasar"'
    WHEN pg_get_functiondef(p.oid) LIKE '%"dendaTambahan"%' THEN 'Found "dendaTambahan"'
    WHEN pg_get_functiondef(p.oid) LIKE '%totalAkhir%' THEN 'Found totalAkhir (no quotes)'
    ELSE 'Unknown camelCase'
  END as issue
FROM pg_proc p
WHERE p.pronamespace = 'public'::regnamespace
  AND p.proname = 'rpc_dashboard_pembayaran';
```

### Step 3: Compare Migration File vs Actual DB

**File on disk:** `supabase/migrations/phase3_fix_remaining_rpc.sql`  
**Function in DB:** (from Step 1 query)

**Check:**
- Does DB version match file version?
- Was migration file executed successfully?
- Check Supabase migration history

### Step 4: Fix Function

Once you find the camelCase reference:

**Option A: Re-run migration**
```bash
# If migration wasn't applied
psql $DATABASE_URL < supabase/migrations/phase3_fix_remaining_rpc.sql
```

**Option B: Manual fix via SQL Editor**

If you find specific camelCase reference, create hotfix SQL:

```sql
-- Example: If "totalAkhir" found in WHERE clause
CREATE OR REPLACE FUNCTION public.rpc_dashboard_pembayaran(...)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
-- [Replace entire function with corrected version]
$function$;
```

### Step 5: Verify Fix

After fixing, re-run verification:

```sql
SELECT 
  p.proname as function_name,
  CASE 
    WHEN pg_get_functiondef(p.oid) LIKE '%"waktuKembaliRencana"%' THEN '❌ Has camelCase'
    WHEN pg_get_functiondef(p.oid) LIKE '%"totalAkhir"%' THEN '❌ Has camelCase'
    WHEN pg_get_functiondef(p.oid) LIKE '%"biayaDasar"%' THEN '❌ Has camelCase'
    WHEN pg_get_functiondef(p.oid) LIKE '%"noInvoice"%' THEN '❌ Has camelCase'
    ELSE '✅ Clean'
  END as status
FROM pg_proc p
WHERE p.pronamespace = 'public'::regnamespace
  AND p.proname = 'rpc_dashboard_pembayaran';
```

**Expected:** Status = '✅ Clean'

### Step 6: Test Function Execution

```sql
-- Replace <user-id> with actual UUID from auth.users
SELECT * FROM rpc_dashboard_pembayaran(
  '<user-id>'::uuid,
  NULL,
  NULL,
  'selesai'
);
```

**Expected:** JSON with payment data, no errors

---

## Migration File Reference

**Current migration:** `supabase/migrations/phase3_fix_remaining_rpc.sql`

**Relevant section (lines 13-126):**

```sql
CREATE OR REPLACE FUNCTION public.rpc_dashboard_pembayaran(
  p_user_id uuid, 
  p_mulai timestamp with time zone DEFAULT NULL::timestamp with time zone, 
  p_akhir timestamp with time zone DEFAULT NULL::timestamp with time zone, 
  p_basis text DEFAULT 'selesai'::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_total_akhir numeric := 0;
  v_diterima numeric := 0;
  v_tunai numeric := 0;
  v_transfer numeric := 0;
  v_qris numeric := 0;
BEGIN
  -- Security check
  IF p_user_id != auth.uid() THEN
    RAISE EXCEPTION 'Unauthorized: user_id mismatch';
  END IF;

  -- Line 39: ✅ FIXED: "totalAkhir" → total_akhir
  SELECT COALESCE(SUM(total_akhir), 0) INTO v_total_akhir
  FROM transactions
  WHERE user_id = p_user_id
    AND status != 'Dibatalkan'
    AND [... filter logic ...]

  -- Lines 52-116: Payment method queries (all use snake_case)
  -- [... LATERAL jsonb_array_elements queries ...]

  -- Line 119: Return (JSON keys can be camelCase, this is OK)
  RETURN jsonb_build_object(
    'totalAkhir', v_total_akhir,  -- JSON key, not column
    'diterima', v_diterima,
    'tunai', v_tunai,
    'transfer', v_transfer,
    'qris', v_qris
  );
END;
$function$;
```

**Check:** Is this version actually in the database?

---

## Deployment Status

**Current production:** https://app-sewara-5v4z678qa-rizki12.vercel.app

**Code status:** All application code uses snake_case ✅

**DB schema:** Legacy camelCase columns dropped ✅

**RPC functions:** 2/3 fixed, 1 still broken ⚠️

**Risk:** Medium — payment reports broken until fix deployed

---

## Timeline

**Phase 3 executed:** 28 Aug 2026, ~17:30 WIB  
**Verification run:** 28 Aug 2026, ~19:15 WIB  
**Issue detected:** 28 Aug 2026, 19:16 WIB  
**Status:** Awaiting data team fix

---

## Success Criteria

- [ ] `rpc_dashboard_pembayaran` shows "✅ Clean" in verification query
- [ ] Function executes without "column does not exist" error
- [ ] Production dashboard payment page works
- [ ] All 3 RPC functions verified clean

---

## Contact

**Handoff from:** Kiro (documentation/verification)  
**Handoff to:** Data team (DB/RPC fixes)  
**Next step:** Fix `rpc_dashboard_pembayaran`, verify, redeploy if needed

**Files:**
- Migration: `supabase/migrations/phase3_fix_remaining_rpc.sql`
- Test guide: `scripts/PHASE3_TEST_GUIDE.md`
- Verification script: `scripts/test-rpc-functions.js`

---

**Please update this file with findings and resolution once fixed. Thanks!**
