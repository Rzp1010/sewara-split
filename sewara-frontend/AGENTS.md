<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Supabase Migration Notes

## Environment
- Supabase URL & anon key in `.env.local`
- `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`

## Auth
- Login uses `supabase.auth.signInWithPassword({ email, password })`
- Middleware uses `proxy.js` (NOT `middleware.js` — deprecated in Next.js 16.2)
- Export from proxy: `export async function proxy(request)`
- Dashboard layout checks `supabase.auth.getSession()` for auth guard
- Logout calls `supabase.auth.signOut()`

## Database
- Tables: `inventory`, `transactions`, `activity_logs` (see `docs/database/SCHEMA.md` + `supabase/migrations/`)
- All tables have RLS enabled with policy allowing all operations for authenticated users
- `src/lib/db.js` functions are now **async** and use Supabase browser client
- `getInventory()`, `getTransactions()`, `getLogs()` → need `await`
- `setInventory()`, `setTransactions()`, `setLogs()` → need `await`
- `simpanSemua()` → need `await`
- `getStok()`, `getSetting()`, `setSetting()`, `buatIDUnik()` remain synchronous

## Supabase Client Files
- `src/lib/supabase/client.js` — browser client (for `"use client"` components)
- `src/lib/supabase/server.js` — server client (import from server components)
- `src/lib/supabase/middleware.js` — middleware helper for `src/proxy.js`
