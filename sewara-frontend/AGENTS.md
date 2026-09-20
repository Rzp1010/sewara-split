<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Frontend Architecture (post-split — pure API client)

## Rules
- **NO `@supabase` imports in `src/`** — all data goes through `src/lib/db.js` → `src/lib/api-client.js` → backend REST `/api/*`
- `api-client.js` is the ONLY HTTP entry point (`API_BASE` = `NEXT_PUBLIC_API_URL`)
- Auth = cookie session (`credentials: 'include'`), no tokens in JS

## Environment
- `.env.local` (dev) / `.env.production` (prod, gitignored) — see `.env.production.example`
- Key vars: `NEXT_PUBLIC_API_URL`, `PORT=3002`, `NODE_ENV`
- `NEXT_PUBLIC_API_URL` is baked at **build time** — changing it requires `npm run build`

## Auth Flow
- Login: `src/app/page.js` → `api.auth.login()` → backend sets session cookie → redirect `/dashboard`
- Guard: client-side in `src/app/dashboard/layout.js` — `api.auth.me()` on mount, 401/!user → redirect `/`
- After guard: `await initSettings()` hydrates localStorage settings from tenant settings (only call site, ~line 401)
- Logout: `api.auth.logout()` + hard redirect `/`
- Auto-logout: idle tracking in `rentalpro_last_activity`, interval check, setting `auto_logout_minutes` (default 15)

## Data Layer (`src/lib/db.js`)
- Async (API-backed): inventory, transactions, items/payments, members, promo, logs, dashboard, admin/account management
- **SYNC (localStorage)**: `getSetting(key, fallback)`, `setSetting(key, value)` — key `rentalpro_settings`. Do NOT convert to async; pages rely on sync access
- **SYNC (pure calc)**: `getStok()`, `getAturanDpHangus()`, `hitungDpHangus()`, `promoSudahKadaluarsa()`
- Mutations fire `window` CustomEvent `dataChanged` → pages/hooks refresh; `dataError` → error toast

## API Response Conventions
- `apiRequest` returns `data.data` (unwrapped): `{ inventory: [...] }`, `{ transactions: [...] }`, `{ settings: [...] }`, `{ user }`, etc — callers destructure
- Errors: thrown `Error` with `.status`, `.code`, `.retryAfterMs`

## State & UI
- No Redux/React Query: React Context (`NotificationProvider`, `ThemeProvider`) + `window` CustomEvents + localStorage
- Custom UI kit in `src/components/ui/` (Button, Modal, FormField, LoadingSpinner, EmptyState, ErrorState) — NOT shadcn
- Tailwind `corePlugins.preflight: false`; font Plus Jakarta Sans
- Pages gate first render with `useSyncExternalStore` to avoid hydration mismatch

## Misc
- Role guard: `src/lib/role.js` `roleBolehAkses(role, href)` — fail-closed; `HAK_MENU` = source of truth
- Feature flags: `src/lib/features.js` `getFITUR()` (currently all on)
- R2 uploads (member photos): `src/lib/storage.js` (server-side, env `R2_*`)
- Dev-only test scripts in `scripts/` still use `@supabase/supabase-js` directly (pre-split, DB verification) — that is why the dep exists
