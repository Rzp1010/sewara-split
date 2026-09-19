# Aplikasi Sewara – Architecture Overview

**Dokumen ini memberikan gambaran lengkap tentang arsitektur sistem Sewara, data flow utama, komponen yang terlibat, serta rencana migrasi di masa depan.**

---

## 📖 Daftar Isi

1. [Ringkasan Umum](#ringkasan-umum)
2. [Diagram Arsitektur (Interaktif)](#diagram-arsitektur-interaktif)
3. [Komponen Utama](#komponen-utama)
   - [Frontend (Next.js)](#frontend-nextjs)
   - [API Routes (Next.js Server Actions)](#api-routes-nextjs)
   - [Supabase (PostgreSQL, Auth, RLS)](#supabase)
   - [Cloudflare R2 (Object Storage)](#cloudflare-r2)
   - [Vercel (Deploy & Edge Runtime)](#vercel)
4. [Alur Data (Data Flow)](#alur-data)
5. [Keamanan & Kebijakan Akses (Security)](#keamanan)
6. [Strategi Migrasi Storage](#strategi-migrasi-storage)
7. [Deployment & CI/CD](#deployment)
8. [Catatan & Referensi](#catatan)

---

## <a id="ringkasan-umum"></a>1. Ringkasan Umum

Sewara adalah aplikasi **rental & inventory management** berbasis **Next.js (App Router)** yang memanfaatkan **Supabase** sebagai backend (PostgreSQL, Auth, RLS) dan **Cloudflare R2** untuk penyimpanan foto jaminan. Aplikasi di‑host di **Vercel** (Edge Functions). Semua komponen berkomunikasi via **HTTPS** dan menggunakan **JSON API**.

---

## <a id="diagram-arsitektur-interaktif"></a>2. Diagram Arsitektur (Interaktif)

📄 **Lihat diagram interaktif:** [`architecture.html`](./architecture.html)

---

## <a id="komponen-utama"></a>3. Komponen Utama

### <a id="frontend-nextjs"></a>Frontend – Next.js (App Router)
- **Pages**: `/dashboard/*`, `/login`, `/register`, dll.
- **State Management**: React `useState`, `useEffect` + custom hooks (`useNotify`).
- **API Calls**: `fetch` ke endpoint `/api/*` (auth, booking, member, webhook, dll.)
- **Client‑Side Utilities**: `browser-image-compression` untuk kompres foto sebelum upload.

### <a id="api-routes-nextjs"></a>API Routes – Next.js Server Actions
- **Auth**: `/api/auth/login`, `/api/auth/logout`, `/api/auth/register`
- **Member CRUD**: `/api/member/*` – membaca / mengubah data member, upload foto jaminan.
- **Booking**: `/api/booking/*` – membuat, mengedit, menggabungkan transaksi.
- **Suggestion**: `/api/customers/suggestions` – gabungkan nama member + history transaksi untuk autocomplete.
- **Telegram Webhook**: `/api/telegram/webhook` – notifikasi ke grup Telegram.
- **Dashboard RPC**: `rpc_dashboard_rekap_status`, `rpc_dashboard_pembayaran` – aggregasi statistik.
- **Supabase Server‑Side Client**: `createBrowserClient` (SSR) untuk akses DB & Auth.

### <a id="supabase"></a>Supabase (PostgreSQL, Auth, RLS)
- **Database**: `members`, `transactions`, `inventory`, `settings`, `profiles`, dll.
- **Auth**: JWT‑based, session cookie (`httpOnly: false` – dibahas di audit).
- **Row‑Level Security (RLS)**: kebijakan per‑user pada tiap tabel (owner, CS, gudang).
- **Functions / RPC**: `rpc_dashboard_rekap_status`, `rpc_dashboard_pembayaran`, `increment_invoice_counter`.
- **Realtime**: notifikasi via `supabase.realtime` (opsional).

### <a id="cloudflare-r2"></a>Cloudflare R2 (Object Storage)
- **Bucket**: `customer-documents`
- **Akses**: S3‑compatible API via `@aws-sdk/client-s3`
- **Keamanan**: RLS‑style policy tidak ada, melainkan **Signed URLs** (exp 1 h) dan **prefix‑based access** (`userId/…`).
- **Penggunaan**: upload foto jaminan (KTP, SIM, dokumen lain) dan serve preview di UI.

### <a id="vercel"></a>Vercel (Deploy & Edge Runtime)
- **Hosting**: Vercel serverless functions (Edge Runtime) untuk API routes.
- **Build**: `npm run build` → Next.js produces static + server bundles.
- **Preview & Production**: tiap branch preview URL, production URL (`https://app-sewara.vercel.app`).
- **Environment Variables**: `.env.local` (Supabase URL, anon key, R2 credentials, etc.)

---

## <a id="alur-data"></a>4. Alur Data (Data Flow)

```mermaid
flowchart LR
    subgraph Browser
        A[User Interaction] --> B[Next.js Frontend]
        B -->|Fetch API| C[API Routes (Edge)]
    end

    subgraph Vercel
        C -->|Supabase client| D[Supabase Auth]
        C -->|Supabase client| E[Supabase DB (PostgreSQL)]
        C -->|S3 SDK| F[Cloudflare R2]
    end

    D -->|Validate token| G[JWT Cookie]
    E -->|SQL Queries| H[Tables: members, transactions, inventory, settings]
    F -->|Upload/Download| I[Foto Jaminan]

    %% Data flow for member detail
    B -->|GET /api/member/:id| C
    C -->|SELECT * FROM members| H
    C -->|GET signed URL for foto| F
    F -->|Signed URL (1h) -> Browser| B

    %% Booking flow
    B -->|POST /api/booking| C
    C -->|INSERT transaction| H
    C -->|CALL RPC dashboard_*| E
    
    %% Autocomplete history flow
    B -->|GET /api/customers/suggestions| C
    C -->|SELECT DISTINCT penyewa FROM transactions| H
    C -->|UNION SELECT name FROM members| H
    
    %% Telegram webhook flow
    D -->|Event INSERT transaction| J[Supabase Webhook]
    J -->|POST JSON| K[Telegram Webhook Route]
    K -->|POST to Telegram API| L[Telegram Bot]
    L -->|Message to group| M[Telegram Group]

    style Browser fill:#f9f9f9,stroke:#333,stroke-width:2px
    style Vercel fill:#e0f7fa,stroke:#006064,stroke-width:2px
    style R2 fill:#fff3e0,stroke:#e65100,stroke-width:2px
```

**Penjelasan singkat alur utama:**
1. **User → Frontend** – interaksi UI memicu fetch ke API.
2. **API → Supabase Auth** – memvalidasi sesi via JWT cookie.
3. **API → DB** – query/insert data (members, transactions, dll.).
4. **API → R2** – upload foto, menghasilkan signed URL untuk preview.
5. **Frontend ← Signed URL** – menampilkan foto dalam modal.
6. **Supabase → Webhook → Telegram** – notifikasi transaksi penting ke grup.

---

## <a id="keamanan"></a>5. Keamanan & Kebijakan Akses

| Komponen | Mekanisme Keamanan | Catatan |
|----------|-------------------|---------|
| **Auth (Supabase)** | JWT cookie (`httpOnly: false`), RLS pada tabel | Pastikan token tidak bocor ke client script.
| **RLS (PostgreSQL)** | Kebijakan per‑user (`owner`, `cs`, `gudang`) | Semua query otomatis dibatasi pada `user_id`.
| **R2 (Object Storage)** | Signed URL (exp 1 h) & path prefix (`userId/…`) | Tidak ada public read, hanya akses ter‑sign.
| **API Routes** | Server‑side validation + try/catch, rate limiting (login) | `console.error` diganti `notify` untuk user feedback.
| **Vercel** | Environment variable protection, HTTPS‑only | Semua env (R2 keys) stored di Vercel dashboard.
| **Telegram Webhook** | Header `x-webhook-secret` dibandingkan dengan env `WEBHOOK_TELEGRAM_SECRET` | Jika secret tidak ada, request otomatis **ditolak**.

---

## <a id="strategi-migrasi-storage"></a>6. Strategi Migrasi Storage

1. **Phase 1 – Cloudflare R2 (Sekarang)**
   - Gratis hingga 10 GB (cukup untuk ~6 000 pelanggan).
   - API S3‑compatible → kode tetap portable.
2. **Phase 2 – AWS S3 (Jika kebutuhan >10 GB atau integrasi AWS)**
   - Ganti hanya `R2_ENDPOINT` menjadi `https://s3.amazonaws.com` dan update credential.
   - Data migration via `rclone`/`aws s3 sync` (few jam).
3. **Phase 3 – MinIO (Self‑hosted, ketika memiliki VPS)**
   - Deploy MinIO di server, ubah endpoint ke `http://<host>:9000`.
   - Semua kode tetap sama (S3 SDK).
   - Data migration: `rclone copy r2:customer-documents minio:customer-documents`.

**Keuntungan strategi:**
- **Zero code change** antara fase.
- **Biaya bertahap** – mulai gratis, skalabel, hingga self‑hosted bila diperlukan.

---

## <a id="deployment"></a>7. Deployment & CI/CD

1. **Push ke GitHub** → Vercel meng‑detect perubahan.
2. **Build Step**: `npm run build` → menghasilkan static + server bundles.
3. **Preview Deploy** untuk tiap PR (URL: `https://<branch>--sewara-apps.vercel.app`).
4. **Production Deploy**: `npx vercel --prod --yes` (atau merge ke `main`).
5. **Env Management**: Vercel environment variables (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`).
6. **Monitoring**: Vercel Analytics + Supabase Logs + Cloudflare R2 usage dashboard.

---

## <a id="catatan"></a>8. Catatan & Referensi
- **Repo**: `E:/Aplikasi Inventory/sewara-apps`
- **File penting**: `src/app/dashboard/*`, `src/lib/db.js`, `src/lib/storage.js`, `src/app/api/member/upload/route.js`.
- **Dokumen lain**: `FITUR_BARU.md` (rencana fitur tambahan), `AGENTS.md` (agent config), `opencode.jsonc` (model config).
- **Link diagram interaktif**: [`architecture.html`](./architecture.html)

---

*Dokumen ini akan diperbarui seiring implementasi dan perubahan arsitektur.*