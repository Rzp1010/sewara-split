# Audit Pemisahan Frontend-Backend — Sewara Apps

**Tanggal:** 2026-09-18  
**Tujuan:** Memisahkan `sewara-apps` menjadi frontend + backend terpisah untuk pengembangan paralel + self-hosted DB/auth nanti  
**Arsitektur target:** Backend = primary security layer, Supabase RLS = safety net

---

## 1. API Routes (Backend)

**Total:** 16 route files di `src/app/api/`

### Tabel Ringkasan API Routes

| Path | Method | Auth | Supabase (tabel/operasi) | Catatan |
|------|--------|------|--------------------------|---------|
| `/api/admin/data` | POST | ✅ Owner/Superadmin | `inventory`, `transactions`, `activity_logs`, `members`, `member_types`, `promo_codes`, `settings` (delete+count) | Hapus semua data tenant |
| `/api/admin/users` | POST | ✅ Owner/Superadmin | `profiles`, `auth.admin.createUser` | Buat user baru |
| `/api/admin/users` | DELETE | ✅ Owner/Superadmin | `profiles`, `auth.admin.deleteUser` | Hapus user |
| `/api/admin/users` | PATCH | ✅ Owner/Superadmin | `profiles` (unlock, approve, reject, extend subscription) | Kelola user |
| `/api/auth/login` | POST | ❌ Public | `profiles`, `login_logs`, `auth.signInWithPassword` | Login + lockout + rate limit |
| `/api/auth/logout` | POST | ✅ | `login_logs`, `auth.signOut` | Logout |
| `/api/auth/register` | POST | ❌ Public | `auth.signUp`, `profiles`, `rpc_tambah_admin_log` | Register owner baru |
| `/api/auth/resend-verification` | POST | ❌ Public | `rpc_reserve_verification_resend`, `auth.resend` | Resend email verifikasi |
| `/api/check-inventory` | GET | ✅ (dev only) | `inventory` (select limit 10) | Test inventory |
| `/api/member/photo` | GET | ✅ | `profiles`, R2 signed URL | Get signed URL dokumen member |
| `/api/member/upload` | POST | ✅ | `members.foto_jaminan`, R2 upload | Upload dokumen member |
| `/api/telegram/test` | POST | ✅ Superadmin | `settings` (telegram config) | Test notif Telegram |
| `/api/telegram/webhook` | POST | ✅ Secret header | `settings`, Telegram API | Webhook Telegram |
| `/api/test-atomic` | GET | ✅ (dev only) | `transactions`, `transaction_items`, `transaction_payments` | Test atomic save |
| `/api/test-rpc` | GET | ✅ (dev only) | `profiles`, `rpc_save_transaction`, `transactions`, `transaction_items` | Test RPC |
| `/api/webhooks/payment` | POST | ⚠️ Stub (503) | `sewara_subscription_*` (belum dipakai) | Payment webhook (belum diimplementasi) |

**Auth check patterns:**
- `requireAuth(supabase)` → `supabase.auth.getUser()` throw 401
- `requireActiveProfile(profile, userId)` → cek `is_active !== false`
- `requireRole(profile, 'owner')` → cek `profiles.role`
- `requireActiveSubscription(profile)` → cek `subscribed_until >= today`
- Webhook: `validateWebhookSecret(request, envKey)` → header `x-webhook-secret`

**Rate limiting:**
- Login: per-IP + per-email (in-memory)
- Register: per-IP (5/10 menit)
- Admin users: per `user.id`
- Member upload/photo: per user

**Temuan:**
- 3 route dev-only (`check-inventory`, `test-atomic`, `test-rpc`) masih di bundle production (404 handler)
- `/api/webhooks/payment` = stub, service-role client di top-level tanpa env check
- `/api/admin/data` tidak pakai `withErrorHandler` seperti route lain

---

## 2. Supabase Client Usage (Frontend)

### Frontend Components — Direct Supabase Query

**21 file** frontend langsung pakai `createBrowserClient` dan query Supabase:

| File | Client | Operasi Supabase | Prioritas Refactor |
|------|--------|------------------|-------------------|
| `src/lib/db.js` (1169 baris) | `createBrowserClient` factory | **SEMUA query** (inventory, transactions, transaction_items, transaction_payments, inventory_units, profiles, settings, promo_codes, members, activity_logs, RPC) | 🔴 **CRITICAL** — backbone seluruh app |
| `src/lib/db/services/inventoryService.js` | `createBrowserClient` sendiri | `.from("inventory")`, `.from("inventory_units")`, `.from("transaction_items")` | 🔴 **HIGH** — anomali bikin client sendiri |
| `src/app/dashboard/sdm/page.js` | `createBrowserClient` | `auth.getSession`, **`.from("profiles").select()`** (direct query di UI) | 🔴 **HIGH** — direct query profiles |
| `src/app/dashboard/manajemen/page.js` | `createBrowserClient` | `auth.getSession`, **`.from("profiles").select()`** (direct query di UI) | 🔴 **HIGH** — direct query profiles |
| `src/app/dashboard/page.js` | `createBrowserClient` (2x) | `auth.getSession`, `rpc("rpc_dashboard_rekap_status")`, `rpc("rpc_dashboard_pembayaran")` | 🟡 MEDIUM — dashboard RPC |
| `src/app/dashboard/layout.js` | `createBrowserClient` | `auth.getSession` (guard + redirect) | 🟡 MEDIUM — auth guard |
| `src/app/dashboard/laporan/page.js` | `createBrowserClient` | `auth.getSession` | 🟢 LOW — hanya session check |
| `src/app/dashboard/status/page.js` | `createBrowserClient` | `auth.getSession` | 🟢 LOW — hanya session check |
| `src/app/dashboard/pelanggan/page.js` | `createBrowserClient` | `auth.getSession` | 🟢 LOW — hanya session check |
| `src/app/dashboard/member/page.js` | `createBrowserClient` | `auth.getSession` | 🟢 LOW — hanya session check |
| `src/app/dashboard/pengaturan/page.js` | `createBrowserClient` | `auth.getSession` | 🟢 LOW — hanya session check |
| `src/app/dashboard/loginlog/page.js` | `createBrowserClient` | `auth.getSession` | 🟢 LOW — hanya session check |
| `src/app/dashboard/promo/page.js` | `createBrowserClient` | `auth.getSession` | 🟢 LOW — hanya session check |
| `src/lib/db/helpers/tenantHelper.js` | terima client param | `auth.getUser`, `.from("profiles").select("owner_id")` (cache 5 menit) | 🟡 MEDIUM — tenant isolation |
| `src/lib/db/services/transactionService.js` | terima client param | `.from("transactions")`, `.from("transaction_items")`, `.from("transaction_payments")`, `rpc("rpc_save_transaction")` | 🔴 HIGH — transaction logic |
| `src/lib/db/services/transactionServiceAtomic.js` | terima client param | `rpc("rpc_save_transaction")` | 🟡 MEDIUM |
| `src/lib/db/services/membersService.js` | terima client param | `.from("members")`, `.from("member_types")` | 🟡 MEDIUM |
| `src/lib/db/services/promoService.js` | terima client param | `.from("promo_codes")` (select/insert/update/delete + validasi) | 🟡 MEDIUM |
| `src/lib/db/services/settingsService.js` | terima client param | `.from("settings")` (select/upsert) | 🟡 MEDIUM |
| `src/lib/db/services/logsService.js` | terima client param | `.from("activity_logs")` | 🟡 MEDIUM |
| `src/lib/db/services/adminService.js` | terima client param | `.from("profiles")`, `rpc("rpc_list_owners")`, `rpc("rpc_list_staff")`, `rpc("rpc_list_admin_logs")` | 🟡 MEDIUM |

**Pola duplikat:**
- **11 halaman dashboard** masing-masing bikin `createBrowserClient` sendiri hanya untuk `auth.getSession()` padahal sudah ada `layout.js` yang cek session
- `inventoryService.js` anomali — satu-satunya service yang bikin factory client sendiri (L7-12), bukan terima param seperti service lain
- `lib/db.js` factory (`supabase()` L17) bikin instance baru per call, bukan singleton

**Direct query bocor ke UI:**
- `sdm/page.js:153-161` — `.from("profiles").select().eq("email").maybeSingle()` di handler `bukaEdit()`
- `manajemen/page.js:178-186` — sama, direct query profiles

**Tidak ada:**
- Supabase Storage (`.storage.*`) — pakai Cloudflare R2 via `src/lib/storage.js`
- Realtime (`.channel()`, `postgres_changes`) — nol match

---

## 3. Auth Flow

### Login Flow

```
/  (src/app/page.js)  "use client"
  ├─ input#username (email) :167
  ├─ input#password :187
  ├─ handleLogin() :49 → fetch POST /api/auth/login {email,password} :57
  └─ sukses → resetOwnerIdCache() :83 → router.replace("/dashboard") :84

POST /api/auth/login  (src/app/api/auth/login/route.js)
  ├─ service-role client → profiles lookup :26
  ├─ pre-checks (urutan):
  │    status "menunggu"      :45
  │    langganan expired      :46
  │    email belum verified   :47-50
  │    is_active === false    :51
  │    checkLockout()         :52-53
  │    checkCooldown()        :54-55
  │    checkLoginRateLimit()  :56-57
  ├─ createServerClient(anon) cookie-based :59-63
  │    cookieOptions: httpOnly=FALSE (WAJIB — SPA baca cookie) :61-62
  ├─ supabase.auth.signInWithPassword({email,password}) :64
  ├─ gagal → registerLoginFailure() :71 → 401
  └─ sukses → resetLockout() :74, logLoginEvent() :75,
              notifyLoginToTelegram() :77, successResponse :83
     ↳ cookie sb-<ref>-auth-token diset via cookieStore.set (setAll) :60
```

### Session Check (3 lapis)

**1. Edge (server-side, defense-in-depth)**
```
src/proxy.js  —  export async function proxy(request) :6
  /dashboard*  → !punyaSesi() → redirect "/" :10-17
  /api/admin*  → !punyaSesi() → 401 JSON     :20-27
  punyaSesi() :32-37 = cookie name startsWith("sb-") && includes("-auth-token")
  ⚠️ proxy cuma cek ADA cookie, tidak validasi token
```

**2. Client (guard sebenarnya)**
```
src/app/dashboard/layout.js :402-441
  createBrowserClient(...) :404
  supabase.auth.getSession() :410
  !session → resetOwnerIdCache() :412 → router.push("/") :413
  session → setUserEmail/setUserId :415-417, getRole()+getAutoLogoutMenit() :420-423
```

**3. Server Route (validasi penuh)**
```
src/lib/api/auth.js requireAuth() :24-32 → supabase.auth.getUser()
Dipakai: /api/auth/logout :23, /api/admin/*, /api/check-inventory :28, dll
RLS Supabase = pertahanan final
```

**Session storage:** Cookie (`sb-<project-ref>-auth-token`), bukan localStorage  
**httpOnly:** FALSE (SPA perlu baca cookie via `document.cookie`)  
**Auto-logout:** `layout.js:530-546` (cek tiap 60s, idle > `auto_logout_minutes`)

### Logout Flow

```
Tombol: src/app/dashboard/layout.js:722-730 (dropdown akun)
  → handleLogout() :559 → confirm() :560
  → fetch POST /api/auth/logout :563
  → window.location.href = "/" :565

POST /api/auth/logout (src/app/api/auth/logout/route.js)
  ├─ getServerClient() :20 (cookie)
  ├─ requireAuth(supabase) :23 → getUser()
  ├─ logLogoutEvent() fire-and-forget :26 (insert login_logs event:'logout')
  ├─ supabase.auth.signOut() :35  ← hapus cookie sesi
  └─ successResponse() :37
```

### Gap Keamanan (akan diperbaiki saat migrasi backend)

1. **`proxy.js` edge layer lemah** — hanya cek keberadaan cookie `sb-*-auth-token`, tidak validasi token. Cookie palsu/expired lolos edge tapi ditolak `getSession()` di layout & RLS.
2. **`httpOnly:false`** — cookie sesi bisa dibaca JS → risiko XSS exfiltration. Dikomentari sebagai keharusan arsitektur SPA.
3. **`getSession()` client** — baca cookie lokal tanpa revalidasi server, jendela kecil cookie stale sampai request data berikutnya kena RLS.
4. **`resetOwnerIdCache()`** — dipanggil di login & logout, penting untuk tenant isolation (cache TTL 5 menit bisa bocor cross-user tanpa ini).

---

## 4. Rencana Migrasi (Fase)

### Fase 1 — Setup Backend (1-2 hari)

**Folder:** `E:\Aplikasi Inventory\sewara-split\sewara-backend`

**Task:**
1. Scaffold Next.js baru (API routes only, `src/app/api/` saja)
2. Copy semua route dari `sewara-apps/src/app/api/` → `sewara-backend/src/app/api/`
3. Copy helper:
   - `src/lib/api/` (supabase.js, auth.js, errors.js, webhook-security.js, rate-limit.js)
   - `src/lib/services/` (telegram.js, audit.js, admin-user.js)
4. Setup auth endpoint baru (backend-native):
   - `POST /auth/login` → signIn + set HttpOnly cookie
   - `POST /auth/logout` → signOut + clear cookie
   - `GET /auth/me` → getUser (untuk frontend cek session)
5. Tambah endpoint CRUD untuk data yang sekarang di-query frontend langsung:
   - `GET /inventory`, `POST /inventory`, `PATCH /inventory/:id`, `DELETE /inventory/:id`
   - `GET /transactions`, `POST /transactions`, dll
   - `GET /members`, `POST /members`, dll
   - `GET /profiles` (untuk sdm/manajemen)
6. Config CORS: whitelist `http://localhost:3000` (dev), `https://app-sewara.com` (prod)
7. ENV: copy `.env.local` dari `sewara-apps`, tambah `FRONTEND_URL`
8. Test: `npm run dev` di port 4000

**Output:** Backend standalone jalan di `:4000`, bisa menerima request API dari frontend.

---

### Fase 2 — Refactor Frontend (2-3 hari)

**Folder:** `E:\Aplikasi Inventory\sewara-split\sewara-frontend`

**Task:**
1. Copy `sewara-apps/` → `sewara-frontend/`
2. **Hapus semua Supabase client dari frontend:**
   - Hapus `src/lib/supabase/client.js`
   - Hapus `src/lib/db.js` (1169 baris)
   - Hapus `src/lib/db/services/*.js` (semua service)
   - Hapus `src/lib/db/helpers/tenantHelper.js`
3. **Buat API client helper baru:** `src/lib/api-client.js`
   ```js
   const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'
   
   export async function apiRequest(endpoint, options = {}) {
     const res = await fetch(`${API_BASE}${endpoint}`, {
       ...options,
       credentials: 'include', // kirim HttpOnly cookie
       headers: {
         'Content-Type': 'application/json',
         ...options.headers,
       },
     })
     if (!res.ok) throw new Error(await res.text())
     return res.json()
   }
   
   export const api = {
     auth: {
       login: (email, password) => apiRequest('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
       logout: () => apiRequest('/api/auth/logout', { method: 'POST' }),
       me: () => apiRequest('/api/auth/me'),
     },
     inventory: {
       getAll: () => apiRequest('/api/inventory'),
       create: (data) => apiRequest('/api/inventory', { method: 'POST', body: JSON.stringify(data) }),
       update: (id, data) => apiRequest(`/api/inventory/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
       delete: (id) => apiRequest(`/api/inventory/${id}`, { method: 'DELETE' }),
     },
     // ... dst untuk transactions, members, profiles, dll
   }
   ```
4. **Refactor semua component:**
   - `src/app/page.js` (login) → ganti fetch `/api/auth/login` jadi `api.auth.login()`
   - `src/app/dashboard/layout.js` → ganti `supabase.auth.getSession()` jadi `api.auth.me()`
   - 11 halaman dashboard → hapus `createBrowserClient`, pakai `api.auth.me()` dari layout (via context/props)
   - `src/app/dashboard/sdm/page.js`, `manajemen/page.js` → ganti `.from("profiles")` jadi `api.profiles.getByEmail(email)`
   - Semua CRUD → ganti dari `lib/db.*` ke `api.*`
5. **Hapus `src/proxy.js`** — tidak perlu lagi, auth check sepenuhnya di backend
6. **Update ENV:** tambah `NEXT_PUBLIC_API_URL=http://localhost:4000` (dev), `https://api-sewara.com` (prod)
7. Test: `npm run dev` di port 3000, pastikan semua fetch ke `:4000` berhasil

**Output:** Frontend jalan di `:3000`, tidak sentuh Supabase sama sekali, semua via backend API.

---

### Fase 3 — Deploy EC2 + Nginx (1 hari)

**Setup:**
1. **Folder structure di EC2:**
   ```
   /var/www/
   ├── sewara-frontend/
   └── sewara-backend/
   ```
2. **PM2 ecosystem.config.js:**
   ```js
   module.exports = {
     apps: [
       {
         name: 'sewara-fe',
         script: 'npm',
         args: 'start',
         cwd: '/var/www/sewara-frontend',
         env: { PORT: 3000, NEXT_PUBLIC_API_URL: 'https://app-sewara.com' }
       },
       {
         name: 'sewara-be',
         script: 'npm',
         args: 'start',
         cwd: '/var/www/sewara-backend',
         env: { PORT: 4000, FRONTEND_URL: 'https://app-sewara.com' }
       }
     ]
   }
   ```
3. **Nginx config:** `/etc/nginx/sites-available/sewara`
   ```nginx
   server {
     listen 80;
     server_name app-sewara.com;
   
     # Backend API
     location /api/ {
       proxy_pass http://localhost:4000;
       proxy_set_header Host $host;
       proxy_set_header X-Real-IP $remote_addr;
       proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
       proxy_set_header X-Forwarded-Proto $scheme;
     }
   
     # Frontend
     location / {
       proxy_pass http://localhost:3000;
       proxy_set_header Host $host;
       proxy_set_header X-Real-IP $remote_addr;
       proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
       proxy_set_header X-Forwarded-Proto $scheme;
     }
   }
   ```
4. SSL: `certbot --nginx -d app-sewara.com`
5. Deploy: `git pull` → `npm install` → `npm run build` → `pm2 reload ecosystem.config.js`

**Output:** 1 EC2, 1 domain (`app-sewara.com`), 2 PM2 process (fe:3000, be:4000), Nginx reverse proxy, HttpOnly cookie jalan normal (same-origin).

---

## 5. Estimasi Waktu & Risiko

| Fase | Durasi | Risiko | Mitigasi |
|------|--------|--------|----------|
| Fase 1: Setup backend | 1-2 hari | MEDIUM — API endpoints baru perlu design consistent | Reuse existing route pattern, test incremental |
| Fase 2: Refactor frontend | 2-3 hari | HIGH — banyak file, rawan miss import | Compile error catch most, test manual tiap halaman |
| Fase 3: Deploy EC2 + Nginx | 1 hari | LOW — infrastruktur standar | Test CORS + cookie di staging dulu |

**Total:** 1.5-2 minggu (kerja serius, tidak ada blocker)

**Keuntungan setelah pemisahan:**
- ✅ Tim frontend & backend bisa kerja paralel
- ✅ Backend jadi single source of truth security
- ✅ Migrasi self-hosted DB/auth nanti cukup sentuh backend
- ✅ Frontend tidak exposed Supabase credentials
- ✅ HttpOnly cookie → XSS safe
- ✅ Backend rate limiting & validation terpusat
- ✅ Supabase RLS jadi safety net, bukan primary defense

**Risiko tetap:**
- Frontend refactor besar → test manual intensif wajib
- CORS + cookie domain harus pas (dev vs prod ENV)
- Deploy downtime brief saat cutover production

---

## 6. Next Steps (Tidak Dieksekusi Sekarang)

Audit selesai. Menunggu approval investor / keputusan untuk mulai Fase 1.

**Action items:**
- [ ] Review audit ini dengan tim
- [ ] Approval go/no-go dari investor
- [ ] Setup repo Git untuk `sewara-frontend` + `sewara-backend`
- [ ] Mulai Fase 1 (setup backend skeleton)
