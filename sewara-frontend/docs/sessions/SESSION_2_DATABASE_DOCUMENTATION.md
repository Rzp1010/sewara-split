# Session 2: Database Layer Documentation

**Project:** Sewara Apps  
**Session Date:** 2026-09-04  
**Final Checkpoint:** `6515b21` — already pushed to `origin/master`  
**Status:** COMPLETE (Phase 2A-2C)  
**Deployment:** Not performed; GitHub push only

---

## Table of Contents

1. [Overview](#1-overview)
2. [Tech Stack](#2-tech-stack)
3. [File Inventory & Responsibilities](#3-file-inventory--responsibilities)
4. [Architecture Changes](#4-architecture-changes)
5. [Security Improvements](#5-security-improvements)
6. [Breaking Changes](#6-breaking-changes)
7. [Testing Coverage](#7-testing-coverage)
8. [Known Issues & Deferred Items](#8-known-issues--deferred-items)
9. [Next Steps](#9-next-steps)

---

## 1. Overview

### Objectives

Session 2 focused on auditing and restructuring database access code without changing existing consumer contracts:
- Separate repeated database, pagination, fetch, query, reporting, inventory, and transaction responsibilities.
- Improve readability and maintainability through focused helper and service modules.
- Preserve existing imports and function signatures through compatibility wrappers in `src/lib/db.js`.
- Review tenant scoping and transaction-write atomicity without overstating unresolved security or consistency risks.

### Scope

**In Scope:**
- Audit of `src/lib/db.js`.
- Phase 2A database helpers.
- Phase 2B reporting and inventory services.
- Phase 2C transaction service and compatibility integration.
- Manual regression checks for dashboard, inventory, transactions, roles, and persistence.

**Out of Scope:**
- Atomic transaction writes.
- Database schema or RLS policy redesign.
- SECURITY INVOKER RPC creation and rollout.
- New libraries, deployment, or frontend redesign.

### Initial Audit

`src/lib/db.js` was approximately 1,373 LOC with 73 exported functions. Five mixed responsibilities were identified:
1. Supabase client creation and direct database access.
2. Pagination and repeated fetch behavior.
3. Query filters and aggregate calculations.
4. Reporting and dashboard calculations.
5. Inventory and transaction CRUD, including normalized child records.

### Key Results

- Added 3 focused helper modules.
- Added reporting, inventory, and transaction services.
- Extracted 17 transaction functions into `transactionService.js`.
- Kept `db.js` compatibility wrappers; functions were not removed from public compatibility surface.
- No new libraries added.
- Manual regression coverage passed.
- Final checkpoint `6515b21` pushed to `origin/master`.

---

## 2. Tech Stack

### Framework & Runtime

| Technology | Purpose |
|------------|---------|
| **Next.js** | Application framework and client component runtime |
| **Native JavaScript** | Helper and service implementation |
| **Node.js** | Syntax validation and development tooling |

### Database Libraries

| Library | Purpose | Usage |
|---------|---------|-------|
| **Supabase** | PostgreSQL database, Auth, and RLS | Inventory, transactions, profiles, child records |
| **@supabase/ssr** | Supabase browser client creation | `createBrowserClient` in `db.js` and extracted services |
| **@supabase/supabase-js** | Supabase client API dependency | Query, insert, update, delete, Auth operations |

### Project Code

- `src/lib/db.js` remains compatibility entry point.
- `src/lib/db/helpers/` contains reusable pagination, HTTP JSON, and query helpers.
- `src/lib/db/services/` contains domain-oriented reporting, inventory, and transaction functions.
- No dependency installation or package change occurred.

---

## 3. File Inventory & Responsibilities

### 3.1 Compatibility Entry Point

#### `src/lib/db.js` (~1,373 LOC at audit; 73 exported functions)

**Purpose:** Preserve existing database API consumed by dashboard pages and shared features while delegating extracted responsibilities to services.

**Responsibilities:**
- Maintain existing named exports, imports, and call signatures.
- Create browser Supabase client where legacy functions still need it.
- Delegate reporting functions to `reportingService`, inventory functions to `inventoryService`, and transaction functions to `transactionService`.
- Preserve synchronous local-setting and utility behavior where existing callers depend on it.

**Consumers:** `src/app/dashboard/page.js`, `booking/page.js`, `inventaris/page.js`, `status/page.js`, `laporan/page.js`, `pelanggan/page.js`, `kalender/page.js`, `riwayat/page.js`, `tracking/page.js`, `member/page.js`, `promo/page.js`, `log/page.js`, `loginlog/page.js`, `sdm/page.js`, `manajemen/page.js`, `layout.js`, and `src/lib/features.js`.

**Important:** `db.js` exports remain compatibility wrappers. Session 2 did not claim removal of functions from `db.js`.

### 3.2 Phase 2A Helpers (`src/lib/db/helpers/`)

#### `paginationHelper.js`

**Exports:**
- `fetchAllPages(supabase, table, columns, queryModifier)` — fetches ordered rows in 1,000-row pages, applies optional query modifier, throws on query failure.
- `fetchOne(supabase, table, id, columns)` — fetches one row by ID with `maybeSingle()`.

**Used by:** `reportingService.js`, `inventoryService.js`; same pagination pattern remains available to transaction service integration.

#### `fetchHelper.js`

**Exports:**
- `fetchJson(url, options)` — performs fetch, parses JSON or text fallback, returns normalized `{ ok, status, data/error }`.
- `postJson(url, body)` — JSON POST wrapper.
- `patchJson(url, body)` — JSON PATCH wrapper.
- `deleteJson(url, body)` — JSON DELETE wrapper with optional body.

**Responsibility:** Consistent client-side API request and response parsing. No new external HTTP dependency.

#### `queryHelpers.js`

**Exports:**
- `applyDateRange(query, rentang, startColumn, endColumn)` — applies `gte`/`lte` date filters.
- `applyTenantScope(query, userId)` — requires tenant ID and applies `user_id` equality filter.
- `sumColumn(rows, column)` — numeric sum with invalid/missing values treated as zero.
- `countRows(rows)` — row count helper.

**Used by:** `reportingService.js` and future database-service queries requiring shared filters or aggregates.

### 3.3 Phase 2B Services (`src/lib/db/services/`)

#### `reportingService.js` (115 LOC)

**Exports:**
- `getDashboardStatistik(rentang)` — inventory count, active transaction count, completed count, revenue.
- `getRekapStatus(rentang)` — booking, rented, soon-due, overdue, incomplete, and completed status counts.
- `getPembayaranRentang(rentang)` — completed-transaction payment calculation for date range.
- `getDashboardManajemen()` — owner/staff totals and active/inactive counts.

**Dependencies:** `@supabase/ssr`, `@/lib/utils`, `paginationHelper.js`, `queryHelpers.js`.

**Consumers:** Dashboard and reporting-facing compatibility exports in `db.js`.

#### `inventoryService.js` (149 LOC)

**Exports:**
- `getInventory()` — paginated inventory retrieval.
- `getInventoryByIds(ids)` — selected inventory retrieval.
- `getInventoryRingkas()` — inventory ID list.
- `getInventoryUnits(inventoryId)` — serialised unit retrieval.
- `saveInventoryUnits(inventoryId, serialNumbers, userId)` — replace and upsert normalized units.
- `updateInventory(rows)` — tenant-aware inventory upsert and unit persistence.
- `hapusInventory(ids)` — preflight transaction-reference check, scoped delete, and result reporting.
- `getStok(item, inventory)` — stock calculation for single-unit and bundling items.

**Dependencies:** `@supabase/ssr`, `paginationHelper.js`.

**Consumers:** Inventory page and booking/status compatibility callers through `db.js`.

#### `transactionService.js`

**17 exports:**
- `getTransactionItems`
- `saveTransactionItems`
- `getTransactionPayments`
- `saveTransactionPayments`
- `tambahTransactions`
- `updateTransactions`
- `getTransactions`
- `getTransactionsRange`
- `getTransactionsRangeRingkas`
- `getTransactionsOverlapAktif`
- `getTransactionsCari`
- `getTransactionsStatistik`
- `getTransactionsLaporan`
- `getTransactionsLaporanRange`
- `getTransactionsAktif`
- `getTransactionsSelesai`
- `getTransactionsBelumSelesai`

**Responsibilities:** Transaction reads, date/status/search reports, parent transaction insert/upsert, normalized `transaction_items` writes, normalized `transaction_payments` writes, and transaction-related event/error signaling.

**Dependencies:** `@supabase/ssr`; native JavaScript. Service keeps existing column projections and tenant-ID derivation behavior.

**Consumers:** Booking, status, history, calendar, tracking, customer, and report pages through `db.js` compatibility wrappers.

---

## 4. Architecture Changes

### Before

`src/lib/db.js` held approximately 1,373 LOC and 73 exports in one mixed module. Repeated pagination loops, fetch handling, date filtering, aggregates, dashboard reporting, inventory/unit operations, and transaction/child-record persistence lived beside compatibility-facing functions. Consumers imported directly from one large module.

### After

The public import boundary remains `src/lib/db.js`, but domain work is delegated:

```text
Dashboard/report pages ─┐
Inventory/booking pages ├─> src/lib/db.js compatibility wrappers
Transaction/status pages ┘              │
                 ┌─────────────────────┼─────────────────────┐
                 v                     v                     v
        reportingService.js    inventoryService.js   transactionService.js
                 │                     │                     │
                 └────── helpers: pagination, fetch, query ──┘
                                      │
                              Supabase browser client
```

**Architecture gains:**
- Smaller responsibility boundaries.
- Reusable pagination and query primitives.
- Reporting, inventory, and transaction changes can be reasoned about independently.
- Existing imports and signatures stay stable.
- Readability improves through named domain modules; maintainability improves through reduced duplication and localized changes.

**Performance impact:** No measured performance numbers claimed. Pagination behavior remains bounded in 1,000-row pages; extracted helpers do not inherently change query count or database indexing. Manual checks showed expected dashboard, inventory, and transaction behavior.

---

## 5. Security Improvements

- `applyTenantScope` rejects missing tenant IDs instead of silently building an unscoped query.
- Inventory and transaction services preserve owner/staff tenant behavior by deriving active owner ID from authenticated user profile: owner uses own ID; staff uses profile `owner_id`; fallback is authenticated user ID when profile lookup fails.
- Inventory deletion performs tenant-scoped reference preflight against `transaction_items` before delete.
- Normalized item and payment rows receive tenant `user_id`.
- No service-role bypass or new security dependency was added.

### Tenant and Atomicity Review

Owner/staff tenant ID handling remains application-side and depends on the authenticated browser session plus profile lookup. This is useful scoping, not proof that every multi-step operation is isolated under all future policy changes.

Parent transaction writes and normalized child item/payment writes are **not atomic**. `tambahTransactions` and `updateTransactions` can successfully write parent data before child writes fail. This high-risk issue was reviewed and deliberately not changed in Session 2.

Empty-array semantics remain important: `saveTransactionItems` and `saveTransactionPayments` return without deleting existing child rows when arrays are empty. This preserves current behavior but means an empty replacement does not necessarily mean “clear all children.”

Future fix needs tested **SECURITY INVOKER RPC** covering parent transaction, child items, child payments, stock effects, tenant checks, rollback, and empty-array semantics. Do not treat untested RPC as safe replacement.

---

## 6. Breaking Changes

### Application API

No intentional breaking changes. Existing `db.js` imports and function signatures remain available through compatibility wrappers. Consumers were not required to import service files directly.

### Data and Database

No schema migration, RLS policy change, or atomic-write fix was shipped. No new library or deployment was performed.

### Behavioral Caveat

Service extraction preserves existing empty-array child-write semantics and multi-step transaction behavior. These are known limitations, not completed fixes.

---

## 7. Testing Coverage

### Manual Tests Passed

- Login.
- Dashboard load.
- Dashboard statistics, cards, and date ranges.
- Inventory list.
- Transaction creation with item and payment.
- Editing item, payment, and status.
- Reload persistence.
- Inventory stock decreases and restores.
- Owner operations.
- Staff operations.
- No browser console or development console errors.

### Static Validation

`node --check` was run against all new helper and service files:
- `src/lib/db/helpers/paginationHelper.js`
- `src/lib/db/helpers/fetchHelper.js`
- `src/lib/db/helpers/queryHelpers.js`
- `src/lib/db/services/reportingService.js`
- `src/lib/db/services/inventoryService.js`
- `src/lib/db/services/transactionService.js`

Result: passed, with no syntax errors.

### Not Covered

No automated integration test proves rollback across parent and normalized child writes. No tested RPC exists for atomic transaction persistence.

---

## 8. Known Issues & Deferred Items

1. **Non-atomic transaction persistence — high risk.** Parent, item, and payment writes remain separate operations. Partial persistence remains possible.
2. **Empty child arrays do not clear rows.** Save helpers return early for empty arrays. Define and test replacement semantics before changing behavior.
3. **Tenant scope depends on client-side owner resolution.** Owner/staff ID derivation is preserved, but future server-side operations need explicit RLS/RPC verification.
4. **Repeated Supabase client creation remains.** Extracted services retain existing `createBrowserClient` pattern; no measured performance regression or improvement is claimed.
5. **Error handling is not uniformly strict.** Some legacy reads return empty arrays or defaults on errors while helper pagination throws. Caller expectations need review before standardization.
6. **No automated database-layer regression suite.** Manual coverage passed; child-write failure and rollback paths remain untested.
7. **No deployment performed.** Checkpoint was pushed to GitHub only.

---

## 9. Next Steps

1. Design SECURITY INVOKER RPC for atomic parent transaction, child items, child payments, and stock operations.
2. Define empty-array semantics explicitly: preserve children, clear children, or reject invalid payload.
3. Add integration tests for success, child-write failure, rollback, tenant isolation, owner/staff access, and stock restoration.
4. Verify RPC behavior under actual RLS policies before replacing client-side multi-step writes.
5. Review remaining `db.js` compatibility wrappers and extract further only when behavior and consumer contracts are covered.
6. Deploy separately after review and verification; Session 2 performed no deployment.
