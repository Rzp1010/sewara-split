# 🚀 Sewara Apps - Code Refactoring & Optimization Plan

**Project:** Sewara Apps (Rental Management System)  
**Start Date:** 3 September 2026  
**Status:** 🟡 In Progress  
**Current Phase:** Planning Complete, Ready to Execute

---

## 📋 Table of Contents

1. [Overview](#overview)
2. [Goals & Principles](#goals--principles)
3. [Session Breakdown](#session-breakdown)
4. [Session 1: Backend API Routes](#session-1-backend-api-routes)
5. [Session 2: Database Layer](#session-2-database-layer)
6. [Session 3: Frontend Components](#session-3-frontend-components)
7. [Session 4: Utilities & Helpers](#session-4-utilities--helpers)
8. [Session 5: Testing & Quality](#session-5-testing--quality)
9. [Session 6: Documentation](#session-6-documentation)
10. [Progress Tracking](#progress-tracking)

---

## 🎯 Overview

**Mission:** Transform Sewara Apps codebase into a clean, maintainable, efficient, and well-documented system through systematic refactoring.

**Scope:** Full-stack refactoring covering:
- ✅ Backend API Routes (11 files, 1,875 LOC) - **AUDITED**
- ⏳ Database Layer (`src/lib/db.js` + helpers) - **TO BE AUDITED**
- ⏳ Frontend Components (`src/app/dashboard/*`, `src/components/*`) - **TO BE AUDITED**
- ⏳ Utilities & Helpers (`src/lib/*`) - **TO BE AUDITED**
- ⏳ Testing & Quality Assurance - **TO BE PLANNED**
- ⏳ Documentation - **TO BE PLANNED**

**Approach:** Incremental, session-based refactoring with verification after each phase.

---

## 🎯 Goals & Principles

### Primary Goals

1. **Code Efficiency**
   - Reduce code duplication by 40-60%
   - Optimize database queries
   - Implement proper caching strategies

2. **Readability & Maintainability**
   - Clear naming conventions
   - Consistent patterns across codebase
   - Well-structured file organization
   - Comprehensive comments for complex logic

3. **Reusability**
   - Extract shared components
   - Create utility libraries
   - Build service layers
   - Standardize API patterns

4. **Performance**
   - No performance degradation
   - Optimize where possible
   - Implement lazy loading
   - Reduce bundle size

5. **Documentation**
   - API documentation
   - Component documentation
   - Architecture documentation
   - Developer onboarding guide

### Core Principles

- ✅ **Incremental Changes** - Refactor per module, verify, commit
- ✅ **Backward Compatible** - No breaking changes to existing features
- ✅ **Test Before/After** - Verify functionality preserved
- ✅ **Industry Standards** - Use proven patterns and libraries
- ✅ **Zero Regression** - Existing features must continue working

---

## 📅 Session Breakdown

| Session | Focus Area | Status | Est. Effort | Start Date | End Date |
|---------|-----------|--------|-------------|------------|----------|
| **1** | Backend API Routes | 🟡 In Progress | 14-19 hours | 3 Sep 2026 | TBD |
| **2** | Database Layer | ⏳ Planned | TBD | TBD | TBD |
| **3** | Frontend Components | ⏳ Planned | TBD | TBD | TBD |
| **4** | Utilities & Helpers | ⏳ Planned | TBD | TBD | TBD |
| **5** | Testing & Quality | ⏳ Planned | TBD | TBD | TBD |
| **6** | Documentation | ⏳ Planned | TBD | TBD | TBD |

**Legend:**
- ✅ Complete
- 🟡 In Progress
- ⏳ Planned
- 🔴 Blocked

---

## 📦 Session 1: Backend API Routes

**Status:** 🟡 **In Progress** (Phase 1A: Setup)  
**Audit Completed:** 3 September 2026  
**Estimated Total Effort:** 14-19 hours

### Current State (Audit Results)

**Scale:**
- 📁 11 route files
- 🔢 13 HTTP handlers
- 📝 1,875 lines of code
- 📂 5 categories: Auth (4), Admin (2), Member (2), Telegram (2), Webhooks (1)

**Key Issues Identified:**
1. 🔴 **Code Duplication: HIGH** (8+ repeated patterns)
2. 🔴 **Inconsistent Patterns** (8+ variations)
3. 🔴 **Complex Logic** (4 files >150 lines)
4. 🔴 **Missing Error Handling** (6+ routes)
5. 🔴 **Security Concerns** (payment webhook, rate limiting)

**Detailed Audit:** See `BACKEND_AUDIT_RESULTS.md` (generated from Session 1 audit)

---

### Phase Breakdown

#### **Phase 1A: Shared Infrastructure** ⭐ CURRENT PHASE

**Goal:** Create foundation utilities to eliminate duplication

**Status:** 🟡 Ready to Execute

**Tasks:**
- [ ] 1A.1 - Install dependencies (`zod`, `@upstash/ratelimit`, `@upstash/redis`)
- [ ] 1A.2 - Setup Upstash Redis (if not exists) or Vercel KV
- [ ] 1A.3 - Create `src/lib/api/supabase.js` (client factories)
- [ ] 1A.4 - Create `src/lib/api/auth.js` (authentication helpers)
- [ ] 1A.5 - Create `src/lib/api/response.js` (standard response format)
- [ ] 1A.6 - Create `src/lib/api/errors.js` (error handling & logging)
- [ ] 1A.7 - Create `src/lib/api/validation.js` (Zod schemas)
- [ ] 1A.8 - Create `src/lib/api/constants.js` (rate limits, durations)
- [ ] 1A.9 - Create `src/lib/api/rate-limit.js` (unified rate limiter)

**Deliverables:**
```
src/lib/api/
  ├── supabase.js         # Supabase client factories
  ├── auth.js             # requireAuth, requireRole, etc
  ├── response.js         # successResponse, errorResponse
  ├── errors.js           # Error classes, logging
  ├── validation.js       # Zod schemas
  ├── constants.js        # Configuration constants
  └── rate-limit.js       # Rate limiting utilities
```

**Impact:** Foundation for all subsequent refactoring

**Estimated Effort:** 2-3 hours

---

#### **Phase 1B: Refactor Small Routes**

**Goal:** Apply new patterns to simple routes (proof of concept)

**Status:** ⏳ Planned

**Targets:**
- [ ] 1B.1 - `auth/logout/route.js` (65 lines → ~20 lines)
- [ ] 1B.2 - `auth/resend-verification/route.js` (59 lines → ~30 lines)
- [ ] 1B.3 - `member/photo/route.js` (51 lines → ~25 lines)
- [ ] 1B.4 - `telegram/test/route.js` (96 lines → ~40 lines)

**Success Criteria:**
- ✅ All routes use shared infrastructure
- ✅ Consistent error handling
- ✅ Zod validation
- ✅ Code reduction: 50%+
- ✅ Existing functionality preserved
- ✅ Tests pass

**Estimated Effort:** 2-3 hours

---

#### **Phase 1C: Split Giant Routes**

**Goal:** Break down complex files into manageable pieces

**Status:** ⏳ Planned

**Targets:**

**1C.1 - Admin Users Route** (496 lines → 3 files + services)
- [ ] Extract POST handler → `admin/users/create/route.js`
- [ ] Extract DELETE handler → `admin/users/delete/route.js`
- [ ] Extract PATCH handler → `admin/users/update/route.js`
- [ ] Create `src/lib/services/admin-user.js` (business logic)
- [ ] Create `src/lib/services/admin-log.js` (audit logging)

**1C.2 - Auth Login Route** (252 lines → route + services)
- [ ] Keep route handler in `auth/login/route.js` (~50 lines)
- [ ] Extract account gates → `src/lib/services/login-gates.js`
- [ ] Extract rate limiting → use shared `rate-limit.js`
- [ ] Extract state machine → `src/lib/services/login-state.js`
- [ ] Extract Telegram notification → `src/lib/services/telegram.js`

**Success Criteria:**
- ✅ Route handlers < 100 lines
- ✅ Business logic in service layer
- ✅ Reduced cyclomatic complexity
- ✅ All features work
- ✅ Better testability

**Estimated Effort:** 3-4 hours

---

#### **Phase 1D: Service Layer Extraction**

**Goal:** Centralize business logic and database queries

**Status:** ⏳ Planned

**Tasks:**
- [ ] 1D.1 - Create `src/lib/services/profile.js` (profile CRUD)
- [ ] 1D.2 - Create `src/lib/services/settings.js` (settings CRUD)
- [ ] 1D.3 - Create `src/lib/services/telegram.js` (Telegram integration)
- [ ] 1D.4 - Create `src/lib/services/audit.js` (logging service)
- [ ] 1D.5 - Create `src/lib/services/subscription.js` (subscription checks)
- [ ] 1D.6 - Refactor remaining routes to use services

**Deliverables:**
```
src/lib/services/
  ├── profile.js          # Profile queries and business logic
  ├── settings.js         # Settings management
  ├── telegram.js         # Telegram integration
  ├── audit.js            # Audit logging
  ├── subscription.js     # Subscription management
  ├── admin-user.js       # Admin user operations
  └── login-state.js      # Login state machine
```

**Impact:** DRY principles, testable business logic, query optimization

**Estimated Effort:** 2-3 hours

---

#### **Phase 1E: Error Handling & Validation**

**Goal:** Bulletproof error handling, consistent validation

**Status:** ⏳ Planned

**Tasks:**
- [ ] 1E.1 - Add explicit error checks for all database queries
- [ ] 1E.2 - Standardize validation errors (Zod integration)
- [ ] 1E.3 - Add request correlation IDs
- [ ] 1E.4 - Improve error logging (structured logs)
- [ ] 1E.5 - Add input sanitization for user content
- [ ] 1E.6 - Fix ignored database errors (6+ locations)
- [ ] 1E.7 - Remove error swallowing (try-catch with empty catch)

**Success Criteria:**
- ✅ Zero ignored database errors
- ✅ All validation uses Zod
- ✅ Consistent error response format
- ✅ Correlation IDs in logs
- ✅ Better production debugging

**Estimated Effort:** 2-3 hours

---

#### **Phase 1F: Security Hardening**

**Goal:** Fix security concerns identified in audit

**Status:** ⏳ Planned

**Tasks:**
- [ ] 1F.1 - Replace in-memory rate limiter with Upstash
- [ ] 1F.2 - Strengthen member storage ownership checks
- [ ] 1F.3 - Add request body size limits
- [ ] 1F.4 - Add file upload size/type validation
- [ ] 1F.5 - Review and improve webhook payload escaping
- [ ] 1F.6 - Centralize service-role client usage
- [ ] 1F.7 - Add security headers

**Success Criteria:**
- ✅ Rate limiting works across deployments
- ✅ No unauthorized file access
- ✅ Protected against large payloads
- ✅ Webhook XSS prevention

**Estimated Effort:** 2-3 hours

---

#### **Phase 1G: Documentation & Testing**

**Goal:** Document patterns and add basic tests

**Status:** ⏳ Planned

**Tasks:**
- [ ] 1G.1 - Document API response format standard
- [ ] 1G.2 - Document error codes and meanings
- [ ] 1G.3 - Add JSDoc comments to shared utilities
- [ ] 1G.4 - Create API route testing guide
- [ ] 1G.5 - Add integration tests for critical routes (login, register)
- [ ] 1G.6 - Create `BACKEND_PATTERNS.md` guide

**Deliverables:**
- `docs/api/RESPONSE_FORMAT.md`
- `docs/api/ERROR_CODES.md`
- `docs/api/TESTING_GUIDE.md`
- `docs/api/BACKEND_PATTERNS.md`

**Estimated Effort:** 2-3 hours

---

### Session 1 Summary

**Total Phases:** 7 (1A - 1G)  
**Total Estimated Effort:** 14-19 hours  
**Expected Outcomes:**
- 40-60% code reduction
- 80%+ consistency improvement
- Zero regressions
- Production-ready backend API layer

**Current Status:** Phase 1A ready to start

---

## 📦 Session 2: Database Layer

**Status:** ⏳ **Planned** (Audit Not Started)  
**Estimated Total Effort:** TBD

### Scope (Preliminary)

**Files to Audit:**
- `src/lib/db.js` (main database helper)
- `src/lib/supabase/client.js`
- `src/lib/supabase/server.js`
- `src/lib/supabase/middleware.js`
- Database query patterns in components
- RLS policy usage patterns

**Expected Issues:**
- Query duplication
- Missing indexes usage
- N+1 query problems
- Inconsistent transaction handling
- Cache opportunities

**Planned Phases:**
- Phase 2A: Audit database layer
- Phase 2B: Create query builder/helpers
- Phase 2C: Optimize common queries
- Phase 2D: Implement caching strategy
- Phase 2E: Transaction management
- Phase 2F: Documentation

**Detailed plan will be created after audit.**

---

## 📦 Session 3: Frontend Components

**Status:** ⏳ **Planned** (Audit Not Started)  
**Estimated Total Effort:** TBD

### Scope (Preliminary)

**Files to Audit:**
- `src/app/dashboard/**/*.js` (dashboard pages)
- `src/components/**/*.js` (shared components)
- Component patterns and duplication
- State management patterns
- Performance bottlenecks

**Expected Issues:**
- Duplicated UI components
- Inconsistent styling
- Missing component library
- Props drilling
- Unnecessary re-renders

**Planned Phases:**
- Phase 3A: Audit frontend components
- Phase 3B: Create component library
- Phase 3C: Extract shared components
- Phase 3D: State management refactor
- Phase 3E: Performance optimization
- Phase 3F: Documentation

**Detailed plan will be created after audit.**

---

## 📦 Session 4: Utilities & Helpers

**Status:** ⏳ **Planned** (Audit Not Started)  
**Estimated Total Effort:** TBD

### Scope (Preliminary)

**Files to Audit:**
- `src/lib/*.js` (all utility files)
- Helper function patterns
- Constants management
- Type definitions

**Expected Issues:**
- Scattered utility functions
- Duplicate helpers
- Missing utilities
- Inconsistent patterns

**Planned Phases:**
- Phase 4A: Audit utilities
- Phase 4B: Consolidate common functions
- Phase 4C: Create constants library
- Phase 4D: Type safety improvements
- Phase 4E: Documentation

**Detailed plan will be created after audit.**

---

## 📦 Session 5: Testing & Quality

**Status:** ⏳ **Planned**  
**Estimated Total Effort:** TBD

### Scope (Preliminary)

**Goals:**
- Establish testing infrastructure
- Add unit tests for critical paths
- Add integration tests
- Add E2E tests for key flows
- Setup CI/CD testing

**Planned Phases:**
- Phase 5A: Setup testing framework (Jest, React Testing Library)
- Phase 5B: Unit tests for services/utilities
- Phase 5C: Integration tests for API routes
- Phase 5D: Component tests
- Phase 5E: E2E tests (login, transaction flow)
- Phase 5F: CI/CD integration

**Detailed plan will be created later.**

---

## 📦 Session 6: Documentation

**Status:** ⏳ **Planned**  
**Estimated Total Effort:** TBD

### Scope (Preliminary)

**Goals:**
- Complete API documentation
- Architecture documentation
- Component documentation
- Developer onboarding guide
- Deployment guide

**Planned Documentation:**

1. **Architecture Documentation**
   - `docs/ARCHITECTURE.md` - System architecture overview
   - `docs/database/OVERVIEW.md` - Database architecture
   - `docs/api/OVERVIEW.md` - API architecture

2. **API Documentation**
   - `docs/api/ENDPOINTS.md` - All API endpoints
   - `docs/api/AUTHENTICATION.md` - Auth flow
   - `docs/api/WEBHOOKS.md` - Webhook integrations

3. **Component Documentation**
   - `docs/frontend/COMPONENTS.md` - Component library
   - `docs/frontend/PATTERNS.md` - Frontend patterns
   - `docs/frontend/STYLING.md` - Styling guide

4. **Developer Guide**
   - `docs/GETTING_STARTED.md` - Setup guide
   - `docs/DEVELOPMENT.md` - Development workflow
   - `docs/TESTING.md` - Testing guide
   - `docs/DEPLOYMENT.md` - Deployment guide

5. **Business Documentation**
   - `docs/FEATURES.md` - Feature list
   - `docs/USER_FLOWS.md` - User journeys
   - `docs/INTEGRATIONS.md` - Third-party integrations

**Detailed plan will be created later.**

---

## 📊 Progress Tracking

### Overall Progress

| Session | Status | Progress | Started | Completed |
|---------|--------|----------|---------|-----------|
| 1. Backend API | 🟡 In Progress | 29% (2/7 phases) | 3 Sep 2026 10:30 | - |
| 2. Database Layer | ⏳ Planned | 0% | - | - |
| 3. Frontend | ⏳ Planned | 0% | - | - |
| 4. Utilities | ⏳ Planned | 0% | - | - |
| 5. Testing | ⏳ Planned | 0% | - | - |
| 6. Documentation | ⏳ Planned | 0% | - | - |

**Total Project Progress:** 🟡 **5%** (Session 1: 2/7 phases complete)

**Last Updated:** 3 September 2026, 14:21 WIB

---

### Session 1 Progress (Backend API)

| Phase | Status | Progress | Tasks Complete | Started | Completed |
|-------|--------|----------|----------------|---------|-----------|
| 1A. Infrastructure | ✅ Complete | 100% | 9/9 | 3 Sep 10:30 | 3 Sep 11:45 |
| 1B. Small Routes | ✅ Complete | 100% | 4/4 | 3 Sep 11:45 | 3 Sep 13:10 |
| 1C. Giant Routes | 🟡 In Progress | 0% | 0/2 | 3 Sep 13:10 | - |
| 1D. Service Layer | ⏳ Planned | 0% | 0/6 | - | - |
| 1E. Error Handling | ⏳ Planned | 0% | 0/7 | - | - |
| 1F. Security | ⏳ Planned | 0% | 0/7 | - | - |
| 1G. Documentation | ⏳ Planned | 0% | 0/6 | - | - |

**Session 1 Progress:** 🟡 **29%** (2/7 phases complete)

**Completed Work:**
- ✅ Phase 1A: 7 infrastructure files (1,167 LOC) - Commit `fa5cf77`
- ✅ Phase 1B: 4 routes refactored (logout, resend-verification, member/photo, telegram/test) - Commit `96dfa3b`

**Current Work:**
- 🟡 Phase 1C: Analyzing admin/users route (496 lines, 3 handlers)
  - Analysis complete via explorer
  - Ready for service extraction on next session

**Time Spent:** ~4 hours (10:30 - 14:21 WIB)

---

## 🎯 Next Actions

### Immediate (Next Session)
1. ✅ Phase 1A Complete - Infrastructure files created
2. ✅ Phase 1B Complete - 4 small routes refactored
3. 🟡 **Phase 1C:** Refactor admin/users route
   - Extract business logic to services
   - Keep route handlers thin
   - Analysis already complete
4. ⏳ Continue Phase 1C: Refactor auth/login route

### Short-term (This Week)
1. Complete Phase 1C-1D (giant routes + service layer)
2. Verify functionality preserved
3. Commit and push changes

### Medium-term (This Month)
1. Complete Phase 1E-1G (error handling, security, docs)
2. Start Session 2 (database audit)
3. Begin Session 3 planning

### Long-term (Next Month)
1. Complete Sessions 2-4
2. Start Session 5 (testing)
3. Begin comprehensive documentation

---

## 📝 Notes & Decisions

### Technology Stack Additions

**Approved Libraries:**
- ✅ **Zod** - Schema validation (industry standard, 10M+ weekly downloads)
- ✅ **@upstash/ratelimit** - Distributed rate limiting (Vercel recommended)
- ✅ **@upstash/redis** - Redis client for rate limiting

**Rejected Libraries:**
- ❌ **neverthrow** - Result type pattern (not industry standard yet)

### Conventions & Standards

**Code Style:**
- Error messages: Indonesian language
- Response format: `{ ok: true/false, data/error }`
- Route splitting: Keep URLs same, extract logic to services

**Naming Conventions:**
- Services: `src/lib/services/`
- API utilities: `src/lib/api/`
- Shared components: `src/components/`
- Documentation: `docs/`

**File Organization:**
- Services: `src/lib/services/`
- API utilities: `src/lib/api/`
- Shared components: `src/components/`
- Documentation: `docs/`

---

## 📅 Changelog

### 3 September 2026

**Session 1 - Day 1 (10:30 - 14:21 WIB, 4 hours)**

**Phase 1A: Shared Infrastructure** ✅ Complete
- Created 7 infrastructure files (1,167 LOC)
- Installed dependencies: zod, @upstash/ratelimit, @upstash/redis
- Files created:
  - `src/lib/api/constants.js` - Rate limits, validation rules, error codes
  - `src/lib/api/response.js` - Standard response helpers
  - `src/lib/api/supabase.js` - Supabase client factories
  - `src/lib/api/auth.js` - Authentication & authorization helpers
  - `src/lib/api/validation.js` - Zod schemas
  - `src/lib/api/errors.js` - Error handling & logging
  - `src/lib/api/rate-limit.js` - Rate limiting (Upstash + fallback)
- Commit: `fa5cf77`

**Phase 1B: Small Routes Refactor** ✅ Complete
- Refactored 4 API routes with shared infrastructure:
  - `auth/logout/route.js` - Clean logout with proper logging
  - `auth/resend-verification/route.js` - Rate-limited resend with Zod validation
  - `member/photo/route.js` - Signed URL generation with access control
  - `telegram/test/route.js` - Superadmin telegram notification test
- All routes now use:
  - Shared Supabase client factories
  - Standard auth helpers (requireAuth, requireRole)
  - Consistent response format
  - Zod validation schemas
  - Centralized error handling (withErrorHandler)
  - Proper rate limiting
  - Better logging with context
- Commit: `96dfa3b`

**Phase 1C: Giant Routes Analysis** 🟡 In Progress
- Analyzed `admin/users/route.js` structure (496 lines, 3 handlers)
- Identified extraction patterns:
  - POST: Create user (132 lines)
  - DELETE: Delete user + tenant data (119 lines)
  - PATCH: Multiple update actions (245 lines)
- Ready for service extraction on next session

**Commits:**
- `fa5cf77` - refactor(phase-1a): add shared API infrastructure
- `96dfa3b` - refactor(phase-1b): refactor 4 small API routes
- `f3ffa90` - docs: add comprehensive refactoring plan for all sessions (earlier)

---

## 📚 Related Documents

- `REVIEW_SUMMARY_PHASE1-9.md` - Database restructure review
- `FUTURE_UPDATES.md` - Feature roadmap
- `AGENTS.md` - Project naming conventions
- `docs/features/EMAIL_VERIFICATION.md` - Email verification feature docs
- `docs/database/SCHEMA.md` - Database schema documentation

---

## 🤝 Contributors

- **Planning & Architecture:** AI Assistant (Kiro)
- **Execution:** Development Team
- **Review:** Technical Lead

---

**Last Updated:** 3 September 2026, 11:15 WIB  
**Next Review:** After Phase 1A completion

---

## 🧪 Manual Test Log — Phase 1C.1

**Test scope:** `src/app/api/admin/users/route.js` refactor  
**Environment:** Local development  
**Date:** 3 September 2026

| Test | Result | Notes |
|------|--------|-------|
| POST Superadmin creates Owner | ✅ PASS | Account, list entry, profile, and audit flow verified |
| POST Owner creates CS/Gudang | ✅ PASS | `owner_id` verified manually in Supabase |
| POST negative validation | ✅ PASS | Invalid role, short password, empty email rejected |
| DELETE Owner staff | ✅ PASS | Profile removed, login disabled, audit log recorded |
| DELETE Owner by Superadmin | ✅ PASS | Tenant data, staff, Auth users, and audit log verified |
| PATCH approve registration | ✅ PASS | Durations 1/3/6/12, status, subscription, self `owner_id` verified |
| PATCH reject registration | ✅ PASS | `status = diblokir`, `is_active = false`, audit log verified |
| PATCH extend subscription | ✅ PASS | Active and expired account behavior verified |
| Rate limit protection | ✅ PASS | Wrong-password attempts triggered password/IP rate limits |
| PATCH unlock account | ⏳ NOT TESTED | Blocked by active device/IP rate limit; run later from clean IP or after cooldown |
| PATCH edit password | ✅ PASS | Password update and login verified |
| PATCH edit nama_lengkap | ✅ PASS | Verified manually in Supabase |
| PATCH edit username | ✅ PASS | Verified manually in Supabase |
| PATCH edit nama_invoice | ✅ PASS | Verified manually in Supabase |

**Known issue fixed during testing:**
- `rpc_hapus_data_user` referenced removed table `logs`; production RPC patched to use `activity_logs`.
- Dashboard RPC failed on JSON-quoted `notif_jam` value (`"1"`); production RPC patched to parse safely.

**Current manual test status:** 9/10 tested items pass; unlock account remains pending.

**Next test:** PATCH profile fields (password, nama lengkap, username, nama invoice), then run unlock test from clean IP/cooldown.

### Future Rate-Limit Improvement

- Keep IP-based protection for security.
- Add account-aware limits so legitimate Superadmin access is not blocked solely by shared device/IP activity.
- Use separate counters for IP, email, and account role without allowing role-based bypass of core protection.
- Add audited admin-only rate-limit reset for operational recovery.
- Show cooldown information in login UI.
- Keep current behavior unchanged until design, security review, and tests are complete.

---

## 📚 Documentation Requirement (End-of-Phase)

**Policy:** Setiap akhir phase session (Session 1, 2, 3, 4, 5, 6), wajib membuat dokumentasi comprehensive yang mencakup:

### Required Documentation Per Session

**Format:** `docs/sessions/SESSION_X_DOCUMENTATION.md`

**Content Structure:**

1. **File Inventory**
   - List semua file yang dibuat/dimodifikasi
   - Path lengkap
   - Ukuran (lines of code)
   - Status (new/modified/refactored)

2. **File Purpose & Responsibilities**
   - Setiap file: deskripsi tujuan utama
   - Apa yang dikerjakan file tersebut
   - Dependencies (file apa yang dipakai)
   - Used by (file apa yang memakainya)

3. **Function/Export Mapping**
   - Semua exported functions
   - Parameter & return type
   - Purpose singkat
   - Usage examples (jika kompleks)

4. **Architecture Changes**
   - Sebelum vs sesudah refactor
   - Patterns yang digunakan
   - Trade-offs decisions

5. **Breaking Changes & Migration**
   - Apakah ada breaking changes
   - Migration steps (jika ada)
   - Backward compatibility notes

6. **Testing Coverage**
   - Manual tests performed
   - Test results
   - Known issues/pending tests

7. **Performance Impact**
   - Before/after metrics (jika ada)
   - Optimization notes

### Example Structure

```markdown
# Session 1 Backend API Routes — Documentation

## 1. File Inventory

### New Files Created
- `src/lib/api/constants.js` (45 lines) — Shared constants
- `src/lib/api/response.js` (58 lines) — Response helpers
- ...

### Modified Files
- `src/app/api/auth/login/route.js` (252 → 70 lines) — Login route refactor
- ...

## 2. File Responsibilities

### `src/lib/api/constants.js`
**Purpose:** Centralized constants untuk rate limits, validation rules, error codes, Telegram config, dan storage config.

**Exports:**
- `RATE_LIMITS` — Rate limit thresholds
- `LOCKOUT_THRESHOLDS` — Lockout configuration
- ...

**Used by:**
- `src/lib/api/rate-limit.js`
- `src/lib/api/login-lockout.js`
- ...

## 3. Function Mapping

### `src/lib/api/response.js`

#### `successResponse(data, message)`
- **Purpose:** Generate standardized success response
- **Parameters:** 
  - `data` (any) — Response payload
  - `message` (string, optional) — Success message
- **Returns:** `{ ok: true, data, message? }`
- **Used in:** All API routes

...
```

### When to Create

- **Session 1:** After Phase 1G completion
- **Session 2:** After database layer completion
- **Session 3:** After frontend components completion
- **Session 4:** After utilities completion
- **Session 5:** After testing phase
- **Session 6:** Aggregate all + final app documentation

### Deliverable

Di akhir Session 6, semua dokumentasi digabung menjadi:
- `docs/SEWARA_APP_DOCUMENTATION.md` — Complete application documentation
- `docs/ARCHITECTURE.md` — System architecture
- `docs/API_REFERENCE.md` — API endpoints reference
- `docs/DEVELOPER_GUIDE.md` — Developer onboarding

**Status:** Documentation policy added. Will be executed after each phase session completion.
