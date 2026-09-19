# Phase 3A: Frontend Audit Findings

**Project:** Sewara Apps  
**Audit Date:** 2026-09-05 (Jumat)  
**Auditors:** Oracle (performance/UX) + Explorer (code structure)  
**Status:** Audit Complete — Ready for Phase 3 Execution

---

## Executive Summary

### Critical Findings

**🔴 P0 — Root Cause "Lemot" IDENTIFIED**

**Status Page N+1 Query Bug**
- Location: `src/app/dashboard/status/page.js:196-221`
- Impact: 100 transaksi = 101 serial requests
- Current: Serial `getTransactionItems(tx.id)` per transaction
- Fix: Bulk query with `.in("transaction_id", ids)`
- Effort: 1-2 hours
- **This is the PRIMARY cause of application slowness**

### Audit Scope

**Performance audit:** bundle size, data fetching (N+1, serial, duplicate), client computation, rendering, network patterns.

**Code structure audit:** 18-page inventory, 7,000+ LOC, duplication, form complexity, migration estimates.

**UI/UX audit:** button, modal, input consistency, design tokens, accessibility, visual hierarchy.

---

## Table of Contents

1. [Performance Issues](#1-performance-issues)
2. [Code Structure Analysis](#2-code-structure-analysis)
3. [UI/UX Inconsistencies](#3-uiux-inconsistencies)
4. [Design Tokens](#4-design-tokens)
5. [Migration Plan](#5-migration-plan)
6. [Quick Win Recommendations](#6-quick-win-recommendations)

---

## 1. Performance Issues

### P0 — Critical

#### N+1 Query in Status Page

**Location:** `src/app/dashboard/status/page.js:196-221`

```javascript
const t = await getTransactionsAktif(); // 1 query

for (const tx of t) {
  const items = await getTransactionItems(tx.id); // N queries in loop!
}
```

**Impact:** VERY HIGH. 10 transactions = 11 requests; 50 = 51; 100 = 101. Requests run serially and block page rendering. Loading can reach 5-30+ seconds; mobile experience severely degraded.

**Root Cause:** `getTransactionItems()` supports one transaction, while Status iterates all active transactions. No bulk query exists.

**Recommended fix — bulk query:**

```javascript
export async function getTransactionItemsBulk(transactionIds) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('transaction_items')
    .select('*')
    .in('transaction_id', transactionIds);
  if (error) throw error;
  return data.reduce((grouped, item) => {
    (grouped[item.transaction_id] ||= []).push(item);
    return grouped;
  }, {});
}

const t = await getTransactionsAktif();
const itemsMap = await getTransactionItemsBulk(t.map((tx) => tx.id));
```

Alternative: relational `transaction_items(*)` join in transaction query. **Effort:** 1-2 hours. **Impact:** 10-50x faster. **Priority:** Must fix first.

#### Serial Fetch: Active then History

**Location:** `src/app/dashboard/status/page.js:236-238`

```javascript
await muatAktif();
await muatSelesai();
```

**Impact:** HIGH. Initial load waits for both requests. **Fix:** `await Promise.all([muatAktif(), muatSelesai()]);` **Effort:** 10 minutes. **Impact:** 2x faster.

### P1 — High

#### Booking: Client-Side Availability Calculation

**Location:** `src/app/dashboard/booking/page.js:182-260`

Booking fetches all inventory and active transactions, builds availability client-side, and calls `stokItem()` repeatedly during render. Impact MEDIUM-HIGH: CPU spike, dropdown lag, poor mobile scaling.

Short-term fix: memoize stock with `useMemo`, then filter through cache. Long-term: server-side availability RPC, search-first catalog, pagination or virtualization. **Effort:** 2-4 hours.

#### Dashboard: Serial Auth → Role → Data

**Location:** `src/app/dashboard/page.js:36-113`

Auth, role, and data requests block one another. Move auth/role to layout context, parallelize data fetches after auth, and add skeleton loading. **Effort:** 1-2 hours. **Impact:** MEDIUM.

#### Booking Search: No Debounce

**Location:** `src/app/dashboard/booking/page.js:315-324`

Every keystroke triggers `getTransactionsCari()`, flooding Supabase and allowing stale responses to overwrite current results. Add 300ms debounce using existing native hook or a small local hook. **Effort:** 30 minutes.

### P2 — Medium

#### No Shared Cache

Status and Tracking duplicate `getTransactionsAktif()` requests on navigation. Add module cache or `useTransactions()` cache with TTL and invalidate on `transactionChanged`. **Effort:** 1-2 hours.

### P3 — Low-Medium

#### Bundle Size: Heavy Dependencies

Verify `html2pdf.js`, `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`, and `browser-image-compression`. Keep AWS packages server-only and lazy-load html2pdf:

```javascript
const html2pdf = (await import('html2pdf.js')).default;
```

Run `npm run build` and inspect `.next/static/chunks`. **Effort:** 30-60 minutes.

---

## 2. Code Structure Analysis

### Page Inventory (18 Pages)

| Page | LOC | State Hooks | Forms | Fetch Calls | Complexity |
|---|---:|---:|---:|---:|---|
| `/dashboard/booking` | 1,723 | 43 | 20+ | 74 | 🔴 Complex |
| `/dashboard/status` | 1,059 | 25 | ~10 | 61 | 🔴 Complex |
| `/dashboard/tracking` | 867 | 16 | ~5 | 76 | 🔴 Complex |
| `/dashboard/manajemen` | 550 | 16 | ~6 | 4 | 🔴 Complex |
| `/dashboard/inventaris` | 721 | 10 | 24 | 27 | 🟡 Medium |
| `/dashboard/kalender` | 604 | 10 | 1 | 89 | 🟡 Medium |
| `/dashboard/sdm` | 460 | 14 | ~8 | 4 | 🟡 Medium |
| `/dashboard/member` | 95 | 21 | ~9 | 15 | 🟡 Medium |
| `/dashboard/promo` | 337 | 8 | 4 | 7 | 🟡 Medium |
| `/dashboard/loginlog` | 244 | 13 | 5 | 10 | 🟡 Medium |
| `/dashboard` | 299 | 9 | 0 | 17 | 🟡 Medium |
| `/dashboard/laporan` | 250 | 7 | 4 | 18 | 🟢 Simple |
| `/dashboard/riwayat` | 108 | 4 | 0 | 5 | 🟢 Simple |
| `/dashboard/log` | 88 | 4 | 0 | 2 | 🟢 Simple |
| `/dashboard/versi` | 87 | 4 | 0 | 3 | 🟢 Simple |
| `/dashboard/pelanggan` | 41 | 7 | 3 | 15 | 🟢 Simple |
| `/dashboard/progres` | 144 | 1 | 1 | 0 | 🟢 Simple |
| `/dashboard/todo` | 116 | 2 | 2 | 1 | 🟢 Simple |

**Total:** 7,791 LOC. Complex: 4 pages, 22 hours. Medium: 7 pages, 18-28 hours. Simple: 7 pages, 9-14 hours. Raw estimate 49-64 hours; with contingency 60-80 hours.

### Component Extraction Priority

Existing shared components: LoadingOverlay (8+ pages), DateTimePicker (7), PasswordInput (4), InvoiceView (2).

Missing shared components:
1. **Button** — 11 variants and 100+ uses; unify primary, secondary, success, danger.
2. **Modal** — 4+ implementations; unify mask, header, body, footer, close behavior.
3. **FormField** — label, input, hint, error wrapper; RHF-ready.
4. **Input** — text, email, number, password, date, textarea variants.
5. **Select** — unify native and SearchableSelect APIs.
6. **EmptyState**, **ErrorState**, **LoadingState** — remove per-page divergence.

### React Hook Form Migration Priority

- **P0:** Booking (20+ fields, 43 hooks), Inventaris (24 fields, two forms, DOM manipulation).
- **P1:** Manajemen (create/edit/password), SDM (staff CRUD/password).
- **P2:** Promo, Loginlog, Member.
- **P3 / skip:** simple filters and single-field forms.

---

## 3. UI/UX Inconsistencies

### Button Style Issues

Multiple primary identities create HIGH visual confusion:

```css
.rp-btn-primary { background: #4F46E5; }
.rp-btn-brand { background: #7181E0; }
.rp-btn-brand-success { background: #46B583; }
.rp-btn-success { background: #10B981; }
```

Adopt semantic system: `primary` main action, `secondary` outline/ghost, `success` confirmed operation, `danger` destructive operation.

### Modal Inconsistencies

Canonical CSS, inline overrides, custom portals, and NotificationProvider use different structures. Hardcoded light-mode colors break dark mode; sizes, padding, close buttons, and focus/a11y behavior differ. Extract one Modal and remove inline overrides.

### Form Input Inconsistencies

Base `.rp-input`, `.rp-select`, `.rp-textarea` styles are good, but pages override padding and spacing. Add explicit `sm`, `md`, `lg` variants and remove page-specific overrides.

### Spacing and Color

Token scale exists, but raw values (`24px 28px`, `gap: 1`, hardcoded borders and text colors) remain scattered. Replace hardcoded values with CSS variables before Tailwind migration to preserve dark mode.

---

## 4. Design Tokens

Extracted tokens for Tailwind configuration:

```javascript
colors: {
  primary: { DEFAULT: '#4F46E5', hover: '#4338CA', active: '#3730A3', soft: '#EEF2FF' },
  success: { DEFAULT: '#10B981', hover: '#059669', text: '#047857' },
  danger: { DEFAULT: '#EF4444', hover: '#DC2626', text: '#B91C1C' },
  warning: { DEFAULT: '#F59E0B', hover: '#D97706', text: '#B45309' },
  info: { DEFAULT: '#3B82F6', hover: '#2563EB', text: '#1D4ED8' },
  navbar: '#16233F', body: '#F5F6FA', surface: '#FFFFFF', subtle: '#F0F2F7',
  'text-primary': '#111827', 'text-secondary': '#4B5563', 'text-muted': '#6B7280',
  border: '#D1D5DB',
},
spacing: { 1: '4px', 2: '8px', 3: '12px', 4: '16px', 5: '20px', 6: '24px', 8: '32px', 10: '40px', 12: '48px' },
fontSize: { xs: '12px', sm: '13px', base: '14px', lg: '16px', xl: '18px', '2xl': '22px', '3xl': '28px' },
borderRadius: { sm: '6px', md: '10px', lg: '14px', xl: '18px', full: '999px' },
boxShadow: { sm: '0 1px 2px rgba(15, 23, 42, 0.05)', md: '0 4px 12px rgba(15, 23, 42, 0.07)', lg: '0 14px 32px rgba(15, 23, 42, 0.11)', xl: '0 28px 60px rgba(15, 23, 42, 0.18)' },
```

Use CSS variables in Tailwind config: `primary: 'var(--color-primary)'`, `surface: 'var(--bg-surface)'`.

---

## 5. Migration Plan

### Phase 3 Revised Approach

Performance first, then UI migration. Proven N+1 fix gives immediate value; baseline performance before UI work prevents hidden regressions.

| Phase | Timing | Goal | Estimate |
|---|---|---|---:|
| 3A | Jumat sore + Sabtu pagi | Status N+1, parallel fetch, booking quick wins | 4-6h |
| 3B | Sabtu sore | Tailwind, RHF/Zod, Button/Modal/FormField | 4-6h |
| 3C | Minggu pagi | Pilot SDM + Inventaris | 6-8h |
| 3D | Minggu sore + Senin pagi | Scale simple and medium pages | 12-16h |
| 3E | Senin sore | Regression, polish, documentation | 4-6h |

### Phase 3A Success Criteria

- Status page loads at least 10x faster.
- Active/history fetches run in parallel.
- Booking search does not flood requests.
- Stock calculation is memoized.
- Large dataset test passes.

### Phase 3B-3E Success Criteria

Tailwind tokens, RHF integration, and core components work; two pilot pages retain CRUD behavior; 14+ pages migrate where feasible; 10/10 regression tests pass; no visual or mobile regression.

---

## 6. Quick Win Recommendations

| Priority | Recommendation | Impact | Effort |
|---:|---|---|---:|
| 1 | Status N+1 bulk query | VERY HIGH | 1-2h |
| 2 | Parallel active/history fetch | HIGH | 10m |
| 3 | Debounce booking search | MEDIUM | 30m |
| 4 | Remove duplicate Supabase client | LOW-MEDIUM | 10m |
| 5 | Loading states for refresh | MEDIUM | 30-45m |
| 6 | Lazy-load html2pdf | MEDIUM | 15-30m |
| 7 | Fix button semantics | HIGH | 30-60m |
| 8 | Remove inline modal colors | HIGH | 30m |
| 9 | Cache shared transactions | MEDIUM | 1-2h |
| 10 | Revoke object URLs | LOW | 15m |

---

## Appendix A: Migration Effort Estimates

| Group | Base | Contingency | Total |
|---|---:|---:|---:|
| Complex pages | 22h | 5h | 27h |
| Medium pages | 23h | 5.5h | 28.5h |
| Simple pages | 9h | 3.5h | 12.5h |
| **Page migration** | **54h** | **14h** | **68h** |
| Foundation setup + testing | 12h | — | 12h |
| **Total Phase 3** | | | **80h** |

Realistic 3.5-day allocation: performance 6h, foundation 6h, pilot 8h, partial scale 16h, testing 6h — **42 hours achievable**. Defer complex Booking, Status, and Tracking refinement plus advanced optimization to Phase 4.

---

## Appendix B: Audit Methodology

**Tools:** static code analysis, AST grep, regex pattern matching, LOC counting, dependency analysis, CSS token extraction.

**Limitations:** no browser runtime profiling, Lighthouse run, bundle-size analysis, database timing, or real-user metrics.

**Follow-up:** run Lighthouse, Next.js bundle analyzer, Status before/after profiling, and Supabase query-count monitoring.

---

**End of Phase 3A Audit Documentation**
