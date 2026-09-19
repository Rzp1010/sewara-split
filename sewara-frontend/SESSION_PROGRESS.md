# Session Progress — Sewara Apps

**Project:** `E:\Aplikasi Inventory\sewara-apps`  
**Supabase:** `obhvrzholszhjnpvmnna`  
**Production:** https://app.sewara.my.id  
**Vercel project:** `rizki12/app-sewara`  
**Date:** 30 Agustus 2026

## Current Status

Phase 1–9.5 completed and deployed:

**Phase 1–8 (Database restrukturisasi bisnis rental):** ✅ Selesai dan deployed
- Tenant isolation: `user_id = auth.uid()`
- JSONB normalization dengan dual-write
- FK, enum, RLS policies

**Phase 9 (SaaS infrastructure):** ✅ Migration executed
- 11 tabel baru (8 SaaS + 3 Permission) dibuat
- Helper libraries dan webhook skeleton sudah dibuat
- Infrastruktur saja, belum aktifkan restriction

**Intentional exceptions:**
- `inventory_units.status` remains `TEXT`; enum conversion was skipped after schema conflicts.
- BIGINT → INT optimization was skipped for safety.
- JSONB source columns remain intentionally as fallback during observation:
  - `transactions.items`
  - `transactions.pembayaran`
  - `inventory.sns`

## Completed Work

### Phase 1 — Transactions columns

- Consolidated duplicate transaction columns to snake_case.
- Added/used canonical columns:
  - `no_invoice`
  - `hp_penyewa`
  - `alamat_penyewa`
  - `jaminan_sewa`
  - `waktu_ambil_rencana`
  - `waktu_kembali_rencana`
  - `waktu_ambil_aktual`
  - `waktu_kembali_aktual`
  - `durasi_teks`
  - `biaya`
  - `denda`
  - `total_akhir`
- Added `member_id`, `created_by`, `updated_by`.
- Added transaction indexes.
- Phase 1 code/build/deploy completed.
- Initial row count was 53; later became 58 after new transactions.

### Phase 2 — Table names

Database renamed:

- `member_templates` → `member_types`
- `logs` → `activity_logs`

Sequences/index names updated where present.

Application references updated:

- `src/lib/db.js`
- `src/app/api/admin/data/route.js`
- `src/app/api/admin/users/route.js`

Manual production test passed.

Commit: `9561538`

### Phase 3 — Remove legacy transaction columns

Dropped 12 camelCase columns from `transactions`:

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

Updated `src/components/InvoiceView.jsx` to snake_case.

Fixed Supabase functions:

- `rpc_dashboard_rekap_status`
- `rpc_dashboard_pembayaran`
- `notify_telegram_transaksi`

Important: JSON output key `totalAkhir` in `rpc_dashboard_pembayaran` was intentionally retained for frontend compatibility; database column reference is `total_akhir`.

Verification:

- CamelCase columns: 0 remaining.
- Snake_case canonical columns: 13 verified.
- Transactions row count: 58 at that point.
- RPC column-reference audit: 0 remaining.
- Build passed.
- Manual local smoke test passed.
- Production deploy status: Ready.

Commit: `6524bb2`

### Phase 4–6 — Normalize JSONB with dual-write

Inspection results:

- Transactions with items: 59
- Items to normalize: 81
- Transactions with payments: 45
- Payments to normalize: 63
- Inventory with serial numbers: 46
- Serial numbers to normalize: 59
- Total normalized rows: 203
- 81 item records have missing `inventory_id`; normalized column therefore allows NULL.
- 14 transactions have NULL `pembayaran`.
- `inventory.sns` confirmed array of strings.

Created tables:

1. `transaction_items` — 81 backfilled rows
2. `transaction_payments` — 63 backfilled rows
3. `inventory_units` — 59 backfilled rows

RLS added:

- RLS enabled on all 3 tables.
- 12 policies total, 4 per table: SELECT, INSERT, UPDATE, DELETE.
- Policies isolate by `user_id = auth.uid()`.

Foreign keys added:

- `fk_transaction_items_transaction`
- `fk_transaction_items_inventory`
- `fk_transaction_payments_transaction`
- `fk_inventory_units_inventory`
- `fk_transactions_member`
- `fk_members_member_type`

Dual-write code added in `src/lib/db.js`:

- `getTransactionItems`
- `saveTransactionItems`
- `getTransactionPayments`
- `saveTransactionPayments`
- `getInventoryUnits`
- `saveInventoryUnits`
- Transaction create/update writes JSONB and normalized tables.
- Inventory update writes JSONB and normalized units.

`src/app/dashboard/status/page.js` now prefers normalized transaction items and falls back to JSONB.

Initial create test exposed missing RLS. RLS was added; retry passed.

Manual Phase 4E test passed:

- Existing transaction read
- New transaction create
- JSONB/normalized count match
- Invoice display
- PDF download
- Transaction edit
- Inventory serial number update

Commit: `e57ddbc`

Production deploy: Ready.

### Phase 7 — Foreign keys and checks

Orphan audit: all checks returned 0.

Added 6 foreign keys and 4 check constraints:

- Positive quantity
- Non-negative prices
- Positive payment amount
- Non-empty serial number

Manual FK verification returned all 6 expected constraints.

### Phase 8 — Enums and defaults

Created enum types:

- `enum_status_transaksi`
- `enum_jenis_inventory`
- `enum_metode_bayar`
- `enum_status_aktif`
- `enum_status_unit`
- `enum_kondisi_inventory`

Applied enums to:

- `transactions.status`
- `inventory.jenis`
- `inventory.kondisi`
- `transaction_payments.payment_method`
- `members.status`
- `member_types.status`

`inventory_units.status` intentionally remains TEXT because conversion encountered schema/operator conflicts and was skipped.

Added defaults and critical NOT NULL constraints:

- `transactions.penyewa`
- `transactions.status`
- `inventory.nama`
- `inventory.jenis`
- `members.nama`
- `member_types.nama`

Skipped BIGINT → INT conversion.

Build passed after Phase 8 DB changes. Local test was explicitly skipped by user because Phase 4–6 full manual tests had passed.

### Phase 9 — SaaS Infrastructure + Role & Permission System

**Status:** Migration executed; billing/payment and permission enforcement remain inactive

**Date:** 31 August 2026

Created:
- 3 enum types: `enum_subscription_status`, `enum_subscription_event`, `enum_permission_category`
- 8 SaaS tables (prefix `sewara_`):
  - `sewara_plans` — paket langganan (Starter Rp99k, Pro Rp199k, Business Rp399k)
  - `sewara_plan_features` — limit per paket (transaksi, inventory, member, staff, storage)
  - `sewara_subscriptions` — langganan aktif per owner
  - `sewara_subscription_payments` — riwayat pembayaran
  - `sewara_subscription_events` — webhook log
  - `sewara_usage_counters` — tracking pemakaian bulanan
  - `sewara_feature_overrides` — override limit khusus per owner
  - `sewara_payment_methods` — metode pembayaran tersimpan
- 3 Permission tables:
  - `permissions` — master list 20 permissions (inventory, transaction, member, report, setting, staff)
  - `role_permissions` — default permission per role (owner, supervisor, cs, gudang)
  - `staff_permissions` — custom override per staff per owner
- RLS policies: 18 policies total
- Helper functions: `has_permission()`, `get_feature_limit()`

Helper libraries:
- `src/lib/subscription.js` — feature gating, usage metering, subscription management
- `src/lib/permission.js` — permission check system dengan override support

Webhook hardening:
- `src/app/api/webhooks/payment/route.js` fail-closed. POST returns `503` with `payment_webhook_not_configured`.
- Request payload is not parsed, logged, or processed; no DB writes occur.
- `verifySignature` defaults to `false`.
- Payment gateway remains inactive until provider-specific signature verification, robust idempotency, atomic DB processing, and retry behavior exist.

Permission hardening:
- `src/lib/permission.js` fixed RPC query-builder misuse.
- Active permission UUID resolves through `permissions.code`.
- Override takes precedence over role default.
- DB/query errors deny access and log non-sensitive error code.
- Permission system is not enforced in routes.

Security preflight:
- New read-only audit: `supabase/migrations/phase9_security_preflight.sql`.
- Production results: cross-tenant mismatch `0`; orphan rows `0`.
- Parent IDs and child FKs are both actual `BIGINT`; former claimed text-ID mismatch disproven.
- Existing `transactions.member_id` has duplicate foreign keys.
- Child-table RLS uses direct `auth.uid()` and differs from parent owner/staff policy.

### Phase 9.5 — Composite FK/RLS Tenant Integrity

**Status:** ✅ Migration executed successfully and applied in production database

Verification:
- `composite_fks`: 6/6 PASS
- `composite_unique_indexes`: 4/4 PASS
- `phase9_5_rls_policies`: 3/3 PASS
- `tenant_integrity_failures`: 0 PASS

Production deployment:
- URL: `https://app-sewara-n5oseumod-rizki12.vercel.app`
- Alias: `https://app.sewara.my.id`
- Vercel status: Ready in 42s
- Manual production verification: all pass, including inventory delete protection behavior and booking/status core flows.
- No new console errors. Known font error remains.

Composite FK/RLS enforcement is applied, not deferred. Multi-branch remains future. Payment and permission enforcement remain inactive.

Build passed for Phase 9 hardening code.

Current production core works. SaaS billing/payment and custom permission enforcement remain inactive and not launch-ready.

Seed data:
- 3 plans dengan trial 14 hari
- 15 plan features (5 per plan)
- 20 permissions grouped by category
- 50 default role permissions (owner=20, supervisor=17, cs=8, gudang=5)

**Design decisions:**
- Backward compatible: semua check return unlimited/granted untuk compatibility
- Payment provider belum dipilih (skeleton adaptable untuk Midtrans/Xendit/Stripe)
- Restriction belum aktif (akan diaktifkan bertahap saat rilis)
- Service role webhook (bypass RLS untuk process payment)

**Not included in Phase 9:**
- Payment gateway integration (ditunda sampai rilis)
- Signature verification webhook (TODO saat connect provider)
- Multi-cabang / branch_id isolation (ditunda ke future update)

## Recent Production Fixes

- `d7f39b8` — booking, status, member prefill, promo display initial fixes
- `822b6cc` — KartuTrx normalized item mapping
- `99a8d9f` — correct `transaction_items` actual column names
- `ab11140` — promo discount for non-member bookings
- `08e08b1` — promo auto-expire

## Promo Auto-Expire

Migration `supabase/migrations/promo_auto_expire.sql` applied successfully. Status values: `aktif`, `nonaktif`, `expired`. Promo expires when `now() >= berlaku_sampai` or `terpakai >= kuota` when quota is set. Persistence runs on promo list load, promo validation/application, and immediately after final quota use; request-triggered, not clock-scheduled. Booking rejects invalid/expired promo; UI displays `Expired` and blocks edit. `ULTRAPREMIUM` expired by quota; `TEST` expired by time. Quota update uses compare-and-set; no RPC/database transaction.

## Deployment Notes

Vercel is not GitHub-connected. Deploy manually from `E:\Aplikasi Inventory\sewara-apps` with `npx vercel --prod --yes`. R2 document routes require Vercel Production variables `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`; production 500 was fixed after variables were added and redeploy completed.

## Commits

- `9561538` — Phase 2 table rename
- `6524bb2` — Phase 3 legacy columns/RPC fix
- `e57ddbc` — Phase 4–6 dual-write code/RLS-related code changes
- `d0801b2` — Phase 7–8 migration/documentation files

## Production Deployments

Successful Vercel deployments:

- Phase 2: `https://app-sewara-pfrv0rv8z-rizki12.vercel.app`
- Phase 3: `https://app-sewara-5v4z678qa-rizki12.vercel.app`
- Phase 4–6: `https://app-sewara-68ly9aa80-rizki12.vercel.app`
- Phase 7–8 latest: `https://app-sewara-5p65j42a5-rizki12.vercel.app`
- Canonical domain: https://app.sewara.my.id

## Files Created

**Phase 4–8:**
- `PHASE4_PLAN.md`
- `supabase/migrations/phase4a_inspection_queries.sql`
- `supabase/migrations/phase4b_create_tables.sql`
- `supabase/migrations/phase4c_backfill_data.sql`
- `supabase/migrations/phase4e_fix_rls_policies.sql`
- `supabase/migrations/phase7a_orphan_check.sql`
- `supabase/migrations/phase7b_add_foreign_keys.sql`
- `supabase/migrations/phase8_cleanup_enums.sql`
- `supabase/migrations/phase8_enums_optimizations.sql`
- `supabase/migrations/phase8_step1_create_enums.sql`
- `supabase/migrations/phase8_step2_apply_enums.sql`
- `supabase/migrations/phase8_step3_defaults.sql`
- `backup/phase2_preflight.md`
- `backup/phase2_verification.sql`
- `backup/phase3_verification.sql`
- `backup/check_rpc_functions.sql`
- `backup/get_remaining_rpc.sql`

**Phase 9:**
- `supabase/migrations/phase9_saas_infrastructure.sql` — 11 tabel + enum + RLS + seed
- `src/lib/subscription.js` — feature gating & usage metering
- `src/lib/permission.js` — permission check system
- `src/app/api/webhooks/payment/route.js` — webhook skeleton
- `PHASE9_PLAN.md` — execution guide & verification checklist
- `FUTURE_UPDATES.md` — roadmap fitur mendatang

## Current Frontend Refactor Progress — Phase 3A/3B

**Last updated:** 6 September 2026

### Phase 3A — Performance

- ✅ Status N+1 query replaced with bulk transaction-item fetch.
- ✅ Booking stock calculation memoized.
- ✅ Shared active-transaction cache added with TTL and in-flight deduplication.
- ✅ Status refresh loop fixed: stable `refetch`, single `dataChanged` ownership, cloned cached transactions.
- ✅ `InvoiceView` dynamically loaded on Booking and Riwayat pages; PDF dependencies deferred.
- ✅ Bundle analyzer configured; no AWS SDK or Upstash client leak found.

Key commits:

- `33b33d9` — Status N+1 fix
- `bfb4e8b` — Booking stock memoization
- `36f4542` — Shared transaction cache
- `ad006d5` — Infinite refresh loop fixes
- `ab4a9fc` — Dynamic InvoiceView loading and bundle analyzer

### Phase 3B — Tailwind and UI Migration

Foundation completed:

- ✅ Tailwind CSS v3, PostCSS, and Autoprefixer installed.
- ✅ Design tokens mapped in `tailwind.config.js`.
- ✅ Tailwind preflight disabled to preserve existing CSS behavior.
- ✅ Shared UI components added under `src/components/ui/`.
- ✅ Migration and component documentation added under `docs/`.
- ✅ Undefined Tailwind color tokens removed; `text-13` added for existing 13px typography.

Pages with partial Tailwind migration:

- ✅ Inventaris — pilot
- ✅ Tracking
- ✅ Riwayat
- ✅ Log
- ✅ Progres
- ✅ Todo
- ✅ Pelanggan
- ✅ Versi
- ✅ Laporan
- ✅ Loginlog
- ✅ Promo
- ✅ SDM
- ✅ Kalender

Important: These pages still retain approved `.rp-*` classes. “Migrated” currently means partial migration, not CSS-clean completion.

### Next Work

- Run manual smoke tests for Tier 1 and Tier 2 pages.
- Continue with Tier 3 pages: dashboard home, manajemen, and member.
- Migrate Status only in phases; protect transaction hooks, refresh effects, Kanban, drag-and-drop, and payment logic.
- Migrate Booking last and in separate sections.
- Remove legacy `.rp-*` utilities only after consumer and visual verification.

## Known Issues / Notes

1. Git email initially blocked Vercel:
   - Old: `Rzp1010@users.noreply.github.com`
   - User amended commit with verified email and force-pushed.
2. Several SQL scripts initially had standalone `RAISE NOTICE` or invalid verification loops; final executed SQL was corrected manually.
3. Phase 8 enum scripts contain experimental/failed-attempt cleanup files. Do not rerun destructive cleanup scripts blindly.
4. `test_manual_migration.txt` remains untracked and was intentionally not committed.
5. Font console error existed before this work and was not part of current changes.
6. No Phase 4–6 JSONB columns have been dropped. Keep them until observation confirms stability and explicit approval is given.
7. Phase 9 SaaS tables sudah dibuat di database dan migration berhasil dieksekusi.
8. Phase 9 helper libraries belum di-enforce di route (backward compatible, return unlimited/granted).
9. Webhook signature verification belum diimplementasi (TODO saat connect payment provider).

## Next Safe Step

**For Phase 1–8:**
- Monitor production 24–48 hours.
- Do not drop JSONB columns yet.
- Do not rerun enum migration scripts; database changes are already applied.
- If continuing, first run read-only schema/data-quality audit.

**For Phase 9:**
- Review `PHASE9_PLAN.md` untuk execution steps
- Backup database sebelum eksekusi migration
- Eksekusi `phase9_saas_infrastructure.sql` di Supabase SQL Editor
- Run verification queries (checklist di `PHASE9_PLAN.md`)
- Commit files Phase 9 setelah migration berhasil

**Future work:**
- Validate `inventory_units.status` conversion separately
- Pilih payment provider (Midtrans/Xendit/Stripe) saat rilis
- Aktifkan restriction & usage limit bertahap
- Implement signature verification webhook
- Multi-cabang isolation (future update, high difficulty)

## Next Dev Session — Code Readability & Efficiency

Planned refactor only; preserve production behavior and database contracts:

- Split `src/lib/db.js` by domain where practical.
- Keep actual normalized column names consistent with schema (`item_name`, `unit_price`, etc.).
- Reduce repeated Supabase queries and unnecessary fetches.
- Standardize Supabase error handling without hiding actionable failures.
- Add focused tests for promo calculation, normalized item mapping, permission lookup, and delete protection.
- Run syntax checks, `npm run build`, and core regression tests after changes.
- Do not activate payment, webhook processing, usage restrictions, or multi-branch behavior.

Uncommitted local files to review separately:
- `verify-c7-fix.js`
- `supabase/migrations/test_manual_migration.txt`

## Current Todo State

- Phase 1–8: completed and deployed.
- Phase 9: migration executed; tables and seed data applied.
- Phase 9.5: composite FK/RLS applied and production manual verification passed.
- Next: dev-session code cleanup and readability refactor.
- No active background tasks.
- Latest production deployment: `https://app-sewara-n5oseumod-rizki12.vercel.app`
- Canonical domain: https://app.sewara.my.id
- Phase 9.5 composite FK/RLS applied and production manual verification passed.
