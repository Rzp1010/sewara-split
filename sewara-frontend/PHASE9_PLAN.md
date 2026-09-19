# Phase 9 Plan — SaaS Infrastructure + Role & Permission System

**Date:** 30 August 2026  
**Status:** Ready for execution  
**Estimated Time:** ~2 hours (migration execution + verification)

---

## Overview

Phase 9 membangun infrastruktur SaaS dan sistem permission custom untuk mendukung:
- Multi-tier subscription (Starter, Pro, Business)
- Feature gating & usage metering
- Role-based permission dengan custom override per staff
- Payment webhook integration (skeleton, belum connect provider)

**Prinsip Phase 9:**
- Infrastruktur disiapkan lengkap
- Belum aktifkan restriction/limit (backward compatible)
- Belum connect payment gateway (skeleton webhook saja)
- Semua fitur tetap unlimited sampai rilis resmi

---

## Files Created

### 1. Migration SQL
**File:** `supabase/migrations/phase9_saas_infrastructure.sql`

**Content:**
- 3 enum types (`enum_subscription_status`, `enum_subscription_event`, `enum_permission_category`)
- 8 tabel SaaS platform (prefix `sewara_`)
- 3 tabel permission system
- RLS policies (18 policies total)
- Seed data (3 plans, 20 permissions, role defaults)
- 2 helper functions (`has_permission`, `get_feature_limit`)

### 2. Helper Libraries
**File:** `src/lib/subscription.js`

**Functions:**
- `getSubscription(ownerId)` — get subscription info
- `isSubscriptionActive(ownerId)` — check subscription status
- `getFeatureLimit(ownerId, featureCode)` — get feature limit (override > plan > unlimited)
- `hasReachedLimit(ownerId, featureCode)` — check apakah sudah limit
- `incrementUsage(ownerId, featureCode, increment)` — increment usage counter
- `decrementUsage(ownerId, featureCode, decrement)` — decrement usage (rollback)
- `canUseFeature(ownerId, featureCode)` — wrapper lengkap check subscription + limit
- `getAvailablePlans()` — list plans
- `getUsageSummary(ownerId)` — usage summary per feature

**File:** `src/lib/permission.js`

**Functions:**
- `hasPermission(userId, ownerId, permissionCode)` — check permission (override > role default)
- `hasAnyPermission(userId, ownerId, permissionCodes)` — check salah satu permission
- `hasAllPermissions(userId, ownerId, permissionCodes)` — check semua permission
- `getUserPermissions(userId, ownerId)` — get all permission codes
- `getUserPermissionsGrouped(userId, ownerId)` — get permissions grouped by category
- `grantPermission(staffUserId, ownerId, permissionCode, grantedBy)` — grant custom permission
- `revokePermission(staffUserId, ownerId, permissionCode, revokedBy)` — revoke permission
- `resetPermission(staffUserId, ownerId, permissionCode)` — reset ke default
- `getAllPermissions()` — list all permissions
- `getRoleDefaultPermissions(role)` — default permissions per role
- `requirePermission(userId, ownerId, permissionCode)` — middleware helper

### 3. Webhook Handler
**File:** `src/app/api/webhooks/payment/route.js`

**Flow:**
1. Detect provider (Midtrans/Xendit/Stripe)
2. Verify signature (TODO: implement saat connect provider)
3. Check idempotency (prevent duplicate)
4. Log event mentah ke `sewara_subscription_events`
5. Process event (update subscription, record payment)
6. Return 200 OK

**Event handlers:**
- `payment.succeeded` → activate subscription, record payment
- `payment.failed` → mark past_due, record failed payment
- `payment.refunded` → mark refunded
- `subscription.updated` → update subscription details
- `subscription.cancelled` → mark cancelled

---

## Schema Details

### Enum Types (3)

```sql
enum_subscription_status: trialing, active, past_due, grace_period, cancelled, expired, suspended
enum_subscription_event: subscription.created, subscription.updated, payment.succeeded, payment.failed, dll
enum_permission_category: inventory, transaction, member, report, setting, staff
```

### SaaS Tables (8)

| Tabel | Rows (seed) | Purpose |
|---|---|---|
| `sewara_plans` | 3 | Paket langganan (Starter, Pro, Business) |
| `sewara_plan_features` | 15 | Fitur & limit per paket |
| `sewara_subscriptions` | 0 | Langganan aktif per owner (1:1) |
| `sewara_subscription_payments` | 0 | Riwayat pembayaran |
| `sewara_subscription_events` | 0 | Webhook log |
| `sewara_usage_counters` | 0 | Tracking pemakaian bulanan |
| `sewara_feature_overrides` | 0 | Override limit khusus per owner |
| `sewara_payment_methods` | 0 | Metode pembayaran tersimpan |

### Permission Tables (3)

| Tabel | Rows (seed) | Purpose |
|---|---|---|
| `permissions` | 20 | Master list permission |
| `role_permissions` | 47 | Default permission per role |
| `staff_permissions` | 0 | Custom override per staff |

### Default Plans & Features

**Starter:**
- Harga: Rp 99.000/bulan, Rp 990.000/tahun
- Trial: 14 hari
- Limit: 50 transaksi/bulan, 20 inventori, 50 member, 2 staff, 100MB storage

**Pro:**
- Harga: Rp 199.000/bulan, Rp 1.990.000/tahun
- Trial: 14 hari
- Limit: 200 transaksi/bulan, 100 inventori, 500 member, 10 staff, 1GB storage

**Business:**
- Harga: Rp 399.000/bulan, Rp 3.990.000/tahun
- Trial: 14 hari
- Limit: Unlimited semua

### Default Permissions (20)

**Inventory (4):** view, create, edit, delete  
**Transaction (4):** view, create, edit, delete  
**Member (4):** view, create, edit, delete  
**Report (2):** view, export  
**Setting (2):** view, edit  
**Staff (4):** view, create, edit, delete

### Default Role Permissions

| Role | Permissions |
|---|---|
| **owner** | Semua (20) |
| **supervisor** | Semua kecuali staff.create, staff.delete, setting.edit (17) |
| **cs** | transaction.*, member.* (8) |
| **gudang** | inventory.*, transaction.view (5) |

---

## Execution Steps

### Checkpoint A: Backup Database
```bash
# Backup via Supabase Dashboard
# Project: obhvrzholszhjnpvmnna
# Dashboard → Database → Backups → Create backup
# Tag: "before-phase9"
```

### Checkpoint B: Preflight Check
```sql
-- Check existing schema
SELECT COUNT(*) FROM information_schema.tables 
WHERE table_schema = 'public' AND table_name LIKE 'sewara_%';
-- Expected: 0

SELECT COUNT(*) FROM information_schema.tables 
WHERE table_schema = 'public' AND table_name IN ('permissions', 'role_permissions', 'staff_permissions');
-- Expected: 0

-- Check enum types
SELECT COUNT(*) FROM pg_type WHERE typname LIKE 'enum_%';
-- Expected: 6 (from Phase 8)
```

### Checkpoint C: Execute Migration
```bash
# Supabase SQL Editor
# Project: obhvrzholszhjnpvmnna
# Copy-paste content dari: supabase/migrations/phase9_saas_infrastructure.sql
# Execute
```

### Checkpoint D: Verification Queries
```sql
-- Count SaaS tables
SELECT COUNT(*) as saas_tables FROM information_schema.tables 
WHERE table_schema = 'public' AND table_name LIKE 'sewara_%';
-- Expected: 8

-- Count permission tables
SELECT COUNT(*) as permission_tables FROM information_schema.tables 
WHERE table_schema = 'public' AND table_name IN ('permissions', 'role_permissions', 'staff_permissions');
-- Expected: 3

-- Count enum types
SELECT COUNT(*) FROM pg_type WHERE typname LIKE 'enum_subscription%' OR typname LIKE 'enum_permission%';
-- Expected: 3 (new from Phase 9)

-- Verify default plans
SELECT id, name, slug, price_monthly, trial_days FROM sewara_plans ORDER BY display_order;
-- Expected: 3 rows (Starter, Pro, Business)

-- Verify plan features
SELECT p.name, COUNT(pf.id) as feature_count
FROM sewara_plans p
LEFT JOIN sewara_plan_features pf ON p.id = pf.plan_id
GROUP BY p.id, p.name
ORDER BY p.display_order;
-- Expected: Starter=5, Pro=5, Business=5

-- Verify permissions
SELECT category, COUNT(*) FROM permissions GROUP BY category ORDER BY category;
-- Expected: inventory=4, member=4, report=2, setting=2, staff=4, transaction=4

-- Verify role permissions
SELECT role, COUNT(*) FROM role_permissions GROUP BY role ORDER BY role;
-- Expected: cs=8, gudang=5, owner=20, supervisor=17

-- Verify RLS policies
SELECT tablename, COUNT(*) as policy_count
FROM pg_policies
WHERE schemaname = 'public'
  AND (tablename LIKE 'sewara_%' OR tablename IN ('permissions', 'role_permissions', 'staff_permissions'))
GROUP BY tablename
ORDER BY tablename;
-- Expected: ~18 policies total

-- Test helper functions
SELECT has_permission(
  '00000000-0000-0000-0000-000000000000'::uuid,  -- dummy user
  '00000000-0000-0000-0000-000000000000'::uuid,  -- dummy owner
  'inventory.view'
);
-- Expected: should execute without error (result may be false)

SELECT get_feature_limit(
  '00000000-0000-0000-0000-000000000000'::uuid,  -- dummy owner
  'max_transactions_monthly'
);
-- Expected: NULL (no subscription = unlimited)
```

### Checkpoint E: Test Helper Libraries
```bash
# Test import syntax
node -e "import('./src/lib/subscription.js').then(m => console.log('✓ subscription.js OK')).catch(e => console.error('✗', e))"
node -e "import('./src/lib/permission.js').then(m => console.log('✓ permission.js OK')).catch(e => console.error('✗', e))"
```

### Checkpoint F: Build Check
```bash
cd "E:\Aplikasi Inventory\sewara-apps"
npm run build
# Expected: Build success (no errors)
```

---

## Rollback Plan

Jika terjadi error di Checkpoint D atau E:

```sql
-- Drop tables (reverse order karena FK)
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

---

## Known Issues & Notes

1. **Helper functions pakai RPC:** `has_permission` dan `get_feature_limit` adalah SQL functions, tidak perlu import di JS. JS helper libraries pakai query biasa ke tabel.

2. **Backward compatibility:** Semua check di `subscription.js` dan `permission.js` return `true`/`unlimited` untuk backward compatibility. Aktivasi restriction dilakukan bertahap saat rilis.

3. **Webhook signature:** Belum implement signature verification. Harus ditambahkan saat connect payment provider untuk security.

4. **Service role key:** Webhook handler butuh `SUPABASE_SERVICE_ROLE_KEY` di `.env` untuk bypass RLS saat proses payment.

5. **Payment provider:** Belum pilih Midtrans/Xendit/Stripe. Webhook skeleton generic, adaptable untuk ketiganya.

6. **RLS tenant isolation:** Masih pakai `user_id` (bukan `owner_id`). Multi-cabang (branch_id) ditunda ke future update.

7. **Permission enforcement:** Helper sudah siap, tapi belum di-enforce di semua route. Integrasi ke middleware/route handler dilakukan bertahap.

---

## Next Steps After Phase 9

### Immediate (setelah migration berhasil)
1. Update `SESSION_PROGRESS.md` dengan status Phase 9
2. Commit files Phase 9 (migration, helpers, webhook, docs)
3. Git tag: `phase9-saas-infrastructure`

### Setelah Tester Online (September 2026)
1. Manual test subscription flow (create, activate, expire)
2. Test permission system (grant/revoke custom permission)
3. Test usage counter (increment/decrement)
4. Audit schema quality

### Setelah Rilis
1. Pilih payment provider (Midtrans recommended untuk Indonesia)
2. Implement signature verification webhook
3. Connect payment gateway (form, API integration)
4. Aktifkan restriction & limit bertahap
5. Setup monitoring & alert untuk webhook failure

---

## Integration Examples (Future)

### Example 1: Enforce Feature Limit di Route
```javascript
// src/app/api/transactions/route.js
import { canUseFeature, incrementUsage } from '@/lib/subscription';

export async function POST(request) {
  const { data: { user } } = await supabase.auth.getUser();
  
  // Check limit
  const { allowed, reason } = await canUseFeature(user.id, 'max_transactions_monthly');
  if (!allowed) {
    return NextResponse.json({ error: reason }, { status: 403 });
  }
  
  // Create transaction
  const { data, error } = await supabase.from('transactions').insert(payload);
  
  // Increment usage
  if (!error) {
    await incrementUsage(user.id, 'max_transactions_monthly', 1);
  }
  
  return NextResponse.json({ data });
}
```

### Example 2: Check Permission di Route
```javascript
// src/app/api/inventory/route.js
import { requirePermission } from '@/lib/permission';

export async function POST(request) {
  const { data: { user } } = await supabase.auth.getUser();
  const ownerId = user.id; // atau ambil dari profiles jika multi-tenant
  
  // Check permission
  const canCreate = await requirePermission(user.id, ownerId, 'inventory.create');
  if (!canCreate) {
    return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
  }
  
  // Create inventory
  const { data, error } = await supabase.from('inventory').insert(payload);
  return NextResponse.json({ data });
}
```

### Example 3: Display Usage di Dashboard
```javascript
// src/app/dashboard/settings/page.js
import { getSubscription, getUsageSummary } from '@/lib/subscription';

export default async function SettingsPage() {
  const { data: { user } } = await supabase.auth.getUser();
  
  const subscription = await getSubscription(user.id);
  const usage = await getUsageSummary(user.id);
  
  return (
    <div>
      <h2>Paket: {subscription?.plan?.name}</h2>
      <h3>Pemakaian Bulan Ini:</h3>
      <ul>
        {usage.map(u => (
          <li key={u.feature_code}>
            {u.feature_code}: {u.current_value} / {u.limit_value || '∞'}
          </li>
        ))}
      </ul>
    </div>
  );
}
```

---

## Verification Checklist

- [ ] **Checkpoint A:** Database backup created
- [ ] **Checkpoint B:** Preflight check passed (0 existing tables)
- [ ] **Checkpoint C:** Migration executed without error
- [ ] **Checkpoint D:** Verification queries all passed
  - [ ] 8 SaaS tables created
  - [ ] 3 permission tables created
  - [ ] 3 new enum types created
  - [ ] 3 default plans seeded
  - [ ] 15 plan features seeded (5 per plan)
  - [ ] 20 permissions seeded
  - [ ] 47 role permissions seeded
  - [ ] 18 RLS policies created
  - [ ] Helper functions executable
- [ ] **Checkpoint E:** Helper libraries import OK
- [ ] **Checkpoint F:** Build success
- [ ] Files committed (migration, helpers, webhook, docs)
- [ ] `SESSION_PROGRESS.md` updated

---

**Status:** Ready to execute  
**Risk Level:** Medium (new tables, no impact to existing features)  
**Reversible:** Yes (rollback script available)  
**Breaking Changes:** None (additive only)
