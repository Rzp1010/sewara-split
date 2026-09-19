# Tambahan Fitur & Improvement — Sewara Apps

**Tanggal:** 22 Agustus 2026  
**Sumber:** Tim Tester  
**Status:** Restrukturisasi DB — Phase 1-2 scheduled for tonight (27 Aug 2026)

---

## 📋 Daftar Fitur

### 🆕 Fitur Baru

#### 1. Data Pelanggan Detail
**Deskripsi:**  
Expand data pelanggan dengan informasi lebih lengkap dari sistem member yang ada sekarang.

**Field Tambahan:**
- Nama lengkap (sudah ada)
- Nomor HP (baru)
- Email (baru)
- Alamat (baru)
- Foto jaminan (baru) — upload foto KTP/SIM/dokumen
- Catatan pelanggan (baru) — notes internal

**Lokasi:**
- Halaman: `/dashboard/member`
- Tabel database: `members` (field baru) atau tabel baru `customer_details`

**Storage Decision:** ✅ **Cloudflare R2 with SSE-C** (S3-compatible + Customer-Managed Encryption)
- Zero lock-in (portable code)
- Gratis 10GB (cukup 2-3 tahun)
- Zero egress fee
- Migration path: R2 → MinIO self-hosted (future)
- **Security:** SSE-C (Server-Side Encryption with Customer Key) — bank-grade protection
  - Foto encrypted dengan key milik kamu (bukan Cloudflare-managed)
  - Credential R2 bocor → data tetap aman (attacker butuh master key)
  - Defense-in-depth: double encryption layer

**Task Breakdown:**
- [ ] **1.1** Setup Cloudflare R2 bucket `customer-documents`
- [ ] **1.2** Generate R2 API credentials & setup env vars (including encryption master key)
- [ ] **1.3** Install `@aws-sdk/client-s3` dan setup S3 client untuk R2
- [ ] **1.4** Database migration — extend tabel `members` dengan kolom baru:
  - `hp TEXT`
  - `email TEXT`
  - `alamat TEXT`
  - `foto_jaminan JSONB` — store paths: `{"ktp": "path", "sim": "path", "lainnya": "path"}`
  - `catatan TEXT`
- [ ] **1.5** Implement storage abstraction layer (`lib/storage.js`) — support R2 SSE-C & future MinIO
- [ ] **1.6** Implement SSE-C encryption layer — customer-managed encryption key
- [ ] **1.7** Rate limiting layer — max 10 foto requests per user per minute
- [ ] **1.8** (Optional) Audit logging — track foto upload/view/delete
- [ ] **1.9** UI form member — tambah field HP, email, alamat, upload foto (max 3), catatan
- [ ] **1.10** Client-side image compression (`browser-image-compression`) — max 500KB per foto
- [ ] **1.11** API `/api/member/upload` — upload dengan SSE-C ke R2
- [ ] **1.12** API `/api/member/photo` — generate signed URL dengan SSE-C (expired 1 jam)
- [ ] **1.13** API `/api/member` — CRUD member dengan field baru
- [ ] **1.14** Display detail pelanggan di modal/drawer member dengan preview foto
- [ ] **1.15** Validasi input:
  - HP format Indonesia (08xx atau 62xxx)
  - Email valid format
  - File size max 5MB per foto (before compress)
  - File type: JPG, PNG, PDF only
- [ ] **1.16** Test CRUD member dengan upload/view/delete foto
- [ ] **1.17** Test SSE-C encryption (verify files encrypted with customer key)
- [ ] **1.18** Deploy & verify R2 + SSE-C integration

**Estimasi:** 8-9 jam (tambah SSE-C + rate limiting + audit log)  
**Prioritas:** Medium  
**Dependencies:** 
- Cloudflare account & R2 setup
- `@aws-sdk/client-s3` & `@aws-sdk/s3-request-presigner` packages
- `browser-image-compression` package
- Master encryption key (256-bit, stored in Vercel env)

---

### ✨ Improvement Fitur Existing

#### 2. Pool Pelanggan dari History Transaksi
**Deskripsi:**  
Saat ini autocomplete nama pelanggan di booking hanya ambil dari `members` yang terdaftar. Perlu ditambah pool dari semua pelanggan yang pernah transaksi (ambil dari field `penyewa` di tabel `transactions`).

**Behavior:**
- Autocomplete nama booking → gabung 2 sumber:
  1. Member terdaftar (`members.nama`)
  2. Pelanggan history (`transactions.penyewa` — distinct)
- Tetap bisa input manual (freeform) kalau nama baru
- Kalau pilih dari member → auto-fill diskon member
- Kalau pilih dari history → nama prefill, tapi nggak ada diskon

**Lokasi:**
- Halaman: `/dashboard/booking`
- Component: Form identitas penyewa
- API: Perlu endpoint baru atau extend existing

**Task Breakdown:**
- [ ] **2.1** API endpoint `/api/customers/suggestions` — return gabungan member + distinct penyewa dari transaksi
- [ ] **2.2** Update `booking/page.js` — fetch suggestions dari endpoint baru
- [ ] **2.3** Update autocomplete logic — gabung 2 sumber, dedupe
- [ ] **2.4** Tambah label/badge pembeda (member vs history) di dropdown
- [ ] **2.5** Test autocomplete dengan data campuran
- [ ] **2.6** Performance check — kalau transaksi banyak, perlu cache/index

**Estimasi:** 2-3 jam  
**Prioritas:** High (sering dipakai)  
**Dependencies:** Fitur #3 (sama-sama ubah autocomplete)

---

#### 3. Autocomplete Nama Booking dari History
**Deskripsi:**  
Sama dengan #2 (bisa digabung jadi 1 task). Autocomplete nama di form booking harus include history transaksi, bukan cuma member terdaftar.

**Merge dengan #2:**  
Fitur ini sama persis dengan #2. Implementasi langsung cover keduanya.

**Task:** Gabung dengan #2  
**Estimasi:** Sudah termasuk di #2  
**Prioritas:** High  

---

#### 4. Status Sewa — Filter & Sort
**Deskripsi:**  
Halaman Status Sewa (`/dashboard/status`) saat ini hanya menampilkan semua transaksi aktif tanpa filter/sort. Perlu tambah kontrol untuk filter dan arrange data.

**Fitur Filter:**
- Filter by status: Booking, Disewa, Mendekati, Telat, Belum Selesai
- Filter by tanggal ambil (range picker)
- Filter by tanggal kembali (range picker)
- Filter by nama penyewa (search box)

**Fitur Sort:**
- Sort by tanggal ambil (ASC/DESC)
- Sort by tanggal kembali (ASC/DESC)
- Sort by nama penyewa (A-Z / Z-A)
- Sort by total tagihan (rendah-tinggi / tinggi-rendah)

**Lokasi:**
- Halaman: `/dashboard/status`
- Component: Filter bar di atas list transaksi

**Task Breakdown:**
- [ ] **4.1** UI design filter bar — dropdown status, date picker, search box
- [ ] **4.2** UI design sort controls — dropdown atau button group
- [ ] **4.3** State management — simpan filter/sort di state (atau query params)
- [ ] **4.4** Filter logic client-side — apply filter ke data transaksi
- [ ] **4.5** Sort logic client-side — apply sort ke data transaksi
- [ ] **4.6** (Optional) Move filter/sort ke server-side kalau data banyak
- [ ] **4.7** Persist filter/sort di localStorage (user preference)
- [ ] **4.8** Test filter + sort kombinasi
- [ ] **4.9** Responsive design — filter bar di mobile

**Estimasi:** 3-4 jam  
**Prioritas:** Medium  
**Dependencies:** None

---

## 📊 Summary

| # | Fitur | Type | Prioritas | Estimasi | Status |
|---|-------|------|-----------|----------|--------|
| 1 | Data Pelanggan Detail + SSE-C | Baru | Medium | 8-9 jam | Planning |
| 2 | Pool Pelanggan History | Improvement | High | 2-3 jam | ✅ Deployed (23 Aug 2026) |
| 3 | Autocomplete Booking History | Improvement | High | (merge #2) | ✅ Deployed (23 Aug 2026) |
| 4 | Status Sewa Filter & Sort | Improvement | Medium | 3-4 jam | ✅ Deployed (23 Aug 2026) |

**Total Estimasi Tersisa:** 8-9 jam (Fitur #1 saja)

---

## 🎯 Rekomendasi Urutan Implementasi

### ✅ Sprint 1 — SELESAI (23 Aug 2026)
**Fitur #2 & #3:** Pool Pelanggan & Autocomplete History
- Autocomplete gabung member + history transaksi
- Badge pembeda "Member" hijau
- Auto-apply diskon member

### ✅ Sprint 2 — SELESAI (23 Aug 2026)
**Fitur #4:** Status Sewa Filter & Sort
- Filter rentang tanggal, waktu ambil, sort, search
- localStorage persist (setting tetap setelah reload)
- Reset filter button
- Kanban navigation arrows (desktop only, hidden mobile)
- Mobile responsive

### 🔄 Sprint 3 — NEXT (Estimasi 8-9 jam)
**Fitur #1:** Data Pelanggan Detail + SSE-C Encryption
- Setup Cloudflare R2 + SSE-C (customer-managed encryption)
- Database migration (HP, email, alamat, foto_jaminan, catatan)
- Storage abstraction layer with encryption
- Rate limiting (10 requests/minute)
- (Optional) Audit logging
- UI form member dengan upload foto (max 3: KTP, SIM, Lainnya)
- Client-side image compression (5MB → 500KB)
- Signed URL expired 1 jam
- Bank-grade security untuk data sensitif

---

## 🔧 Technical Notes

### 🔐 Security Architecture (SSE-C Encryption)

**Decision:** Server-Side Encryption with Customer Key (SSE-C)

**Why SSE-C:**
- ✅ Customer-managed encryption key (bukan Cloudflare-managed)
- ✅ R2 credential leak → data tetap aman (attacker butuh master key)
- ✅ Defense-in-depth: double encryption (R2 default + SSE-C)
- ✅ Bank-grade security untuk data sensitif KTP/SIM
- ✅ No client-side complexity (encryption di server)

**Trade-offs:**
- ⚠️ Master key lost = data lost forever (mitigasi: backup key di 2+ tempat)
- ⚠️ Key rotation butuh re-encrypt files (jarang dilakukan)
- ⚠️ +1 jam dev time vs default encryption

**Security Layers:**
1. **Storage:** R2 private bucket (no public access)
2. **Access Control:** Signed URL expired 1 jam
3. **Encryption:** SSE-C with 256-bit customer key
4. **Ownership:** Per-user folder isolation (`user_id/member_id_type.ext`)
5. **Auth:** Supabase JWT required
6. **Rate Limiting:** Max 10 foto requests per user per minute
7. **Audit:** (Optional) Log all upload/view/delete actions

**Environment Variables:**
```env
# .env.local (ADD THESE)
R2_ENDPOINT=https://your-account-id.r2.cloudflarestorage.com
R2_ACCESS_KEY_ID=your-access-key
R2_SECRET_ACCESS_KEY=your-secret-key
R2_BUCKET_NAME=customer-documents
R2_ENCRYPTION_MASTER_KEY=generated-256-bit-hex-key  # ← NEW for SSE-C
```

**Generate Master Key:**
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

**⚠️ CRITICAL: Backup Master Key:**
- Store in Vercel environment variables (primary)
- Store in password manager (backup #1)
- Store in secure note/vault (backup #2)
- **NEVER commit to Git**

---

### Storage Architecture (Cloudflare R2)

**Setup R2:**
1. Login Cloudflare dashboard → R2 → Create bucket `customer-documents`
2. Generate API credentials (Access Key ID + Secret Access Key)
3. Get R2 endpoint URL: `https://<account-id>.r2.cloudflarestorage.com`

**Environment Variables:**
```env
# .env.local
R2_ENDPOINT=https://your-account-id.r2.cloudflarestorage.com
R2_ACCESS_KEY_ID=your-access-key
R2_SECRET_ACCESS_KEY=your-secret-key
R2_BUCKET_NAME=customer-documents
R2_ENCRYPTION_MASTER_KEY=your-generated-256-bit-hex-key  # ← For SSE-C
```

**Storage Structure:**
```
customer-documents/
  ├── {user_id}/
  │   ├── {member_id}_ktp.jpg
  │   ├── {member_id}_sim.jpg
  │   └── {member_id}_jaminan.jpg
```

**File Naming Convention:**
- Format: `{user_id}/{member_id}_{type}.{ext}`
- Type: `ktp`, `sim`, `lainnya`
- Example: `abc-123-def/member-001_ktp.jpg`

---

### Database Schema

**Migration SQL:**
```sql
-- Extend tabel members
ALTER TABLE members ADD COLUMN hp TEXT;
ALTER TABLE members ADD COLUMN email TEXT;
ALTER TABLE members ADD COLUMN alamat TEXT;
ALTER TABLE members ADD COLUMN foto_jaminan JSONB DEFAULT '{}';
ALTER TABLE members ADD COLUMN catatan TEXT;

-- Index untuk search
CREATE INDEX idx_members_hp ON members(hp) WHERE hp IS NOT NULL;
CREATE INDEX idx_members_email ON members(email) WHERE email IS NOT NULL;

-- Sample foto_jaminan structure:
-- {
--   "ktp": "abc-123/member-001_ktp.jpg",
--   "sim": "abc-123/member-001_sim.jpg",
--   "lainnya": "abc-123/member-001_jaminan.jpg"
-- }
```

**Apply Migration:**
```bash
# Run in Supabase SQL Editor (project obhvrzholszhjnpvmnna)
# Or save to: sewara-apps/supabase/migration_member_details.sql
```

---

### Storage Abstraction Layer

**File: `lib/storage.js`**

```javascript
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import crypto from 'crypto';

// Storage abstraction untuk future-proof migration
class StorageProvider {
  async upload(key, file, contentType) { throw new Error('Not implemented'); }
  async getSignedURL(key, expiresIn = 3600) { throw new Error('Not implemented'); }
  async delete(key) { throw new Error('Not implemented'); }
}

// R2 implementation with SSE-C (S3-compatible + Customer-Managed Encryption)
class R2StorageSSE extends StorageProvider {
  constructor() {
    super();
    this.client = new S3Client({
      region: 'auto',
      endpoint: process.env.R2_ENDPOINT,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
      },
    });
    this.bucket = process.env.R2_BUCKET_NAME;
    
    // Generate encryption key from master key
    this.encryptionKey = crypto
      .createHash('sha256')
      .update(process.env.R2_ENCRYPTION_MASTER_KEY)
      .digest();
    
    this.encryptionKeyMD5 = crypto
      .createHash('md5')
      .update(this.encryptionKey)
      .digest('base64');
  }

  async upload(key, file, contentType) {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: file,
      ContentType: contentType,
      // SSE-C headers
      SSECustomerAlgorithm: 'AES256',
      SSECustomerKey: this.encryptionKey.toString('base64'),
      SSECustomerKeyMD5: this.encryptionKeyMD5,
    });
    return await this.client.send(command);
  }

  async getSignedURL(key, expiresIn = 3600) {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
      // SSE-C headers (required for encrypted files)
      SSECustomerAlgorithm: 'AES256',
      SSECustomerKey: this.encryptionKey.toString('base64'),
      SSECustomerKeyMD5: this.encryptionKeyMD5,
    });
    return await getSignedUrl(this.client, command, { expiresIn });
  }

  async delete(key) {
    const command = new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });
    return await this.client.send(command);
  }
}

// Factory: export instance
export const storage = new R2StorageSSE();

// Helper functions
export function buildStorageKey(userId, memberId, type, ext) {
  return `${userId}/${memberId}_${type}.${ext}`;
}

export function parseStorageKey(key) {
  // Parse: "abc-123/member-001_ktp.jpg" -> { userId, memberId, type, ext }
  const [userId, filename] = key.split('/');
  const [memberWithType, ext] = filename.split('.');
  const lastUnderscoreIndex = memberWithType.lastIndexOf('_');
  const memberId = memberWithType.substring(0, lastUnderscoreIndex);
  const type = memberWithType.substring(lastUnderscoreIndex + 1);
  return { userId, memberId, type, ext };
}
```

---

### Client-Side Image Compression

**Install:**
```bash
npm install browser-image-compression
```

**Usage in Component:**
```javascript
import imageCompression from 'browser-image-compression';

async function handleFileUpload(file, memberId, type) {
  // Validate
  const maxSize = 5 * 1024 * 1024; // 5MB before compress
  const allowedTypes = ['image/jpeg', 'image/png', 'application/pdf'];
  
  if (file.size > maxSize) {
    return notify('Ukuran file maksimal 5MB', 'error');
  }
  
  if (!allowedTypes.includes(file.type)) {
    return notify('Format file harus JPG, PNG, atau PDF', 'error');
  }
  
  // Compress (skip PDF)
  let uploadFile = file;
  if (file.type.startsWith('image/')) {
    const options = {
      maxSizeMB: 0.5,        // target 500KB
      maxWidthOrHeight: 1920,
      useWebWorker: true,
    };
    uploadFile = await imageCompression(file, options);
    console.log(`Compressed: ${(file.size / 1024 / 1024).toFixed(2)}MB → ${(uploadFile.size / 1024 / 1024).toFixed(2)}MB`);
  }
  
  // Upload via API
  const formData = new FormData();
  formData.append('file', uploadFile);
  formData.append('memberId', memberId);
  formData.append('type', type); // ktp, sim, lainnya
  
  const response = await fetch('/api/member/upload', {
    method: 'POST',
    body: formData,
  });
  
  const result = await response.json();
  if (!result.ok) {
    return notify(`Upload gagal: ${result.error}`, 'error');
  }
  
  notify('Foto berhasil diupload', 'success');
  return result.path;
}
```

---

### API Handler

**File: `src/app/api/member/upload/route.js`**

```javascript
import { NextResponse } from 'next/server';
import { createBrowserClient } from '@supabase/ssr';
import { storage, buildStorageKey } from '@/lib/storage';

export async function POST(request) {
  try {
    // Auth check
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    );
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }
    
    const formData = await request.formData();
    const file = formData.get('file');
    const memberId = formData.get('memberId');
    const type = formData.get('type'); // ktp, sim, lainnya
    
    if (!file || !memberId || !type) {
      return NextResponse.json({ ok: false, error: 'Missing required fields' }, { status: 400 });
    }
    
    // Validate type
    const validTypes = ['ktp', 'sim', 'lainnya'];
    if (!validTypes.includes(type)) {
      return NextResponse.json({ ok: false, error: 'Invalid type' }, { status: 400 });
    }
    
    // Build storage key
    const ext = file.name.split('.').pop();
    const key = buildStorageKey(user.id, memberId, type, ext);
    
    // Upload to R2
    const buffer = Buffer.from(await file.arrayBuffer());
    await storage.upload(key, buffer, file.type);
    
    // Update database
    const { data: member } = await supabase
      .from('members')
      .select('foto_jaminan')
      .eq('id', memberId)
      .eq('user_id', user.id)
      .single();
    
    if (!member) {
      return NextResponse.json({ ok: false, error: 'Member not found' }, { status: 404 });
    }
    
    const fotoJaminan = member.foto_jaminan || {};
    fotoJaminan[type] = key;
    
    await supabase
      .from('members')
      .update({ foto_jaminan: fotoJaminan })
      .eq('id', memberId)
      .eq('user_id', user.id);
    
    return NextResponse.json({ ok: true, path: key });
  } catch (e) {
    console.error('Upload error:', e);
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
```

**File: `src/app/api/member/photo/route.js`** (Get Signed URL)

```javascript
import { NextResponse } from 'next/server';
import { createBrowserClient } from '@supabase/ssr';
import { storage } from '@/lib/storage';

export async function GET(request) {
  try {
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    );
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }
    
    const { searchParams } = new URL(request.url);
    const key = searchParams.get('key');
    
    if (!key) {
      return NextResponse.json({ ok: false, error: 'Missing key' }, { status: 400 });
    }
    
    // Verify ownership (key starts with user.id)
    if (!key.startsWith(user.id + '/')) {
      return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });
    }
    
    // Generate signed URL (expired 1 jam)
    const signedUrl = await storage.getSignedURL(key, 3600);
    
    return NextResponse.json({ ok: true, url: signedUrl });
  } catch (e) {
    console.error('Get photo URL error:', e);
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
```

---

### Rate Limiting (Security Layer)

**File: `lib/rate-limit.js`**

```javascript
// Simple in-memory rate limiter (or use Redis for multi-instance)
const rateLimits = new Map(); // userId → { count, resetTime }

export function checkRateLimit(userId, maxRequests = 10, windowMs = 60000) {
  const now = Date.now();
  const userLimit = rateLimits.get(userId) || { count: 0, resetTime: now + windowMs };
  
  // Reset window if expired
  if (now > userLimit.resetTime) {
    userLimit.count = 0;
    userLimit.resetTime = now + windowMs;
  }
  
  // Check limit
  if (userLimit.count >= maxRequests) {
    throw new Error(`Rate limit exceeded. Max ${maxRequests} requests per ${windowMs/1000} seconds.`);
  }
  
  // Increment counter
  userLimit.count++;
  rateLimits.set(userId, userLimit);
  
  return true;
}
```

**Usage in API:**
```javascript
import { checkRateLimit } from '@/lib/rate-limit';

export async function GET(request) {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    
    // Rate limit: max 10 foto requests per minute
    checkRateLimit(user.id, 10, 60000);
    
    // ... rest of handler
  } catch (e) {
    if (e.message.includes('Rate limit')) {
      return NextResponse.json({ ok: false, error: e.message }, { status: 429 });
    }
    // ... other errors
  }
}
```

**Benefits:**
- ✅ Prevent mass download (even with valid credentials)
- ✅ Protect from credential leak abuse
- ✅ DoS protection

---

### Audit Logging (Optional - Compliance)

**Database Schema:**
```sql
CREATE TABLE photo_access_logs (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  member_id TEXT NOT NULL,
  photo_type TEXT NOT NULL,  -- 'ktp', 'sim', 'lainnya'
  action TEXT NOT NULL,       -- 'upload', 'view', 'delete'
  ip_address TEXT,
  user_agent TEXT,
  timestamp TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_photo_logs_user ON photo_access_logs(user_id, timestamp DESC);
CREATE INDEX idx_photo_logs_member ON photo_access_logs(member_id);
```

**Usage in API:**
```javascript
// After successful photo view
await supabase.from('photo_access_logs').insert({
  user_id: user.id,
  member_id: memberId,
  photo_type: type,
  action: 'view',
  ip_address: request.headers.get('x-forwarded-for'),
  user_agent: request.headers.get('user-agent'),
});
```

**Benefits:**
- ✅ Track who accessed what photo when
- ✅ Forensic trail for breach investigation
- ✅ GDPR Article 30 compliance (processing records)
- ✅ Detect anomaly (user viewing 100 photos in 5 minutes)

---

### UI Component Sample

**Upload Button with Preview:**

```jsx
import { useState } from 'react';
import imageCompression from 'browser-image-compression';

function FotoJaminanUpload({ memberId, type, existingPath, onUploadSuccess }) {
  const [uploading, setUploading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState(null);
  
  async function handleFileChange(e) {
    const file = e.target.files[0];
    if (!file) return;
    
    // Validate
    const maxSize = 5 * 1024 * 1024;
    const allowedTypes = ['image/jpeg', 'image/png', 'application/pdf'];
    
    if (file.size > maxSize) {
      return alert('Ukuran file maksimal 5MB');
    }
    
    if (!allowedTypes.includes(file.type)) {
      return alert('Format file harus JPG, PNG, atau PDF');
    }
    
    // Preview
    if (file.type.startsWith('image/')) {
      setPreviewUrl(URL.createObjectURL(file));
    }
    
    // Compress & Upload
    setUploading(true);
    try {
      let uploadFile = file;
      if (file.type.startsWith('image/')) {
        uploadFile = await imageCompression(file, {
          maxSizeMB: 0.5,
          maxWidthOrHeight: 1920,
          useWebWorker: true,
        });
      }
      
      const formData = new FormData();
      formData.append('file', uploadFile);
      formData.append('memberId', memberId);
      formData.append('type', type);
      
      const res = await fetch('/api/member/upload', { method: 'POST', body: formData });
      const data = await res.json();
      
      if (!data.ok) throw new Error(data.error);
      
      onUploadSuccess(data.path);
      alert('Foto berhasil diupload');
    } catch (err) {
      alert('Upload gagal: ' + err.message);
    } finally {
      setUploading(false);
    }
  }
  
  return (
    <div className="rp-form-group">
      <label>Foto {type.toUpperCase()}</label>
      {previewUrl && (
        <img src={previewUrl} alt="Preview" style={{ maxWidth: 200, marginBottom: 8 }} />
      )}
      {existingPath && !previewUrl && (
        <p className="rp-text-sm rp-text-muted">✓ Foto sudah terupload</p>
      )}
      <input
        type="file"
        accept="image/jpeg,image/png,application/pdf"
        onChange={handleFileChange}
        disabled={uploading}
        className="rp-input"
      />
      {uploading && <p className="rp-text-sm">Uploading...</p>}
    </div>
  );
}
```

---

### Database Changes Needed
- **Fitur #1:** Extend tabel `members` + setup R2 bucket + (optional) audit log table
- **Fitur #2/3:** ✅ SELESAI (deployed 23 Aug 2026)
- **Fitur #4:** ✅ SELESAI (deployed 23 Aug 2026)

### API Changes Needed
- **Fitur #1:** 
  - POST `/api/member/upload` — upload foto ke R2 dengan SSE-C
  - GET `/api/member/photo?key=...` — get signed URL dengan SSE-C
  - Extend PUT `/api/member` — CRUD field baru (hp, email, alamat, catatan)
- **Fitur #2/3:** ✅ SELESAI
- **Fitur #4:** ✅ SELESAI

### NPM Packages Needed
```bash
npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner browser-image-compression
```

### Storage Cost Estimation

**Scenario: 1000 pelanggan, 3 foto each, 500KB average (compressed)**
```
Storage: 1000 × 3 × 0.5MB = 1,500 MB = 1.5 GB
R2 Cost: (1.5GB - 1GB free) × $0.021 = $0.0105/bulan = Rp 165/bulan
Yearly: Rp 1,980/tahun
```

**Scenario: 5000 pelanggan (5 years growth)**
```
Storage: 5000 × 3 × 0.5MB = 7,500 MB = 7.5 GB
R2 Cost: (7.5GB - 10GB free) = GRATIS (masih dalam free tier)
```

**Break-even Point:** Gratis sampai 10GB (~6,500 pelanggan)

### Performance Considerations
- **Fitur #1:** Image compression reduce 70% bandwidth (1.5MB → 500KB)
- **Fitur #2/3:** Index `transactions(penyewa)` untuk query distinct names
- **Fitur #4:** Client-side filter OK sampai 500 transaksi, server-side kalau > 1000

### Security Checklist
- ✅ R2 credentials di `.env` (never commit)
- ✅ Signed URL expired 1 jam (nggak bisa akses permanent)
- ✅ Ownership check — user cuma bisa akses foto sendiri
- ✅ File validation — size, type, extension di client & server
- ✅ Path validation — prevent directory traversal (`../`)
- ✅ HTTPS only — R2 endpoint enforce HTTPS

---

## Migration Path (Future-Proof)

### Phase 1: R2 (Now - 2+ years)
```javascript
// .env
STORAGE_PROVIDER=r2
R2_ENDPOINT=https://xxx.r2.cloudflarestorage.com
R2_ACCESS_KEY_ID=xxx
R2_SECRET_ACCESS_KEY=xxx
```

### Phase 2: MinIO Self-Hosted (When VPS Available)
```javascript
// .env
STORAGE_PROVIDER=minio
R2_ENDPOINT=https://minio.yourdomain.com  // same var name, different endpoint
R2_ACCESS_KEY_ID=minio-access-key
R2_SECRET_ACCESS_KEY=minio-secret-key
```

**Code:** ZERO CHANGE (same S3 API)  
**Migration:** Download from R2 → Upload to MinIO (or rsync server-to-server)

---

## ✅ Acceptance Criteria

### Fitur #1 (Data Pelanggan Detail)
- [ ] Bisa tambah/edit member dengan field HP, email, alamat
- [ ] Bisa upload foto jaminan (max 5MB, format jpg/png/pdf)
- [ ] Foto tersimpan di Supabase Storage dengan access control
- [ ] Bisa lihat detail lengkap member di modal/drawer
- [ ] Form validasi HP (format Indonesia), email (valid format)
- [ ] Mobile responsive

### Fitur #2/3 (Pool History & Autocomplete)
- [ ] Autocomplete nama booking munculin member + history transaksi
- [ ] Ada badge/label pembeda antara "Member" dan "Pelanggan"
- [ ] Pilih member → auto-apply diskon member
- [ ] Pilih history → nama prefill, diskon manual
- [ ] Tetap bisa input manual nama baru
- [ ] Autocomplete perform < 300ms

### Fitur #4 (Filter & Sort Status)
- [ ] Filter by status (multi-select atau single)
- [ ] Filter by tanggal ambil/kembali (range picker)
- [ ] Filter by nama penyewa (search/contains)
- [ ] Sort by tanggal ambil, kembali, nama, total
- [ ] Filter + sort bisa kombinasi
- [ ] Filter/sort tersimpan di localStorage (persist antar session)
- [ ] Clear all filter button
- [ ] Mobile responsive (filter collapse/expand)

---

## 📝 Next Steps

### Persiapan Sebelum Implementasi (30 menit)
1. **Setup Cloudflare R2:**
   - [ ] Login Cloudflare dashboard
   - [ ] Navigate ke R2 → Create bucket `customer-documents`
   - [ ] Generate API credentials (API token dengan R2 write permission)
   - [ ] Catat: Account ID, Access Key ID, Secret Access Key
   - [ ] Test access via AWS CLI atau Postman

2. **Environment Setup:**
   - [ ] Update `.env.local` dengan R2 credentials
   - [ ] Install dependencies: `npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner browser-image-compression`
   - [ ] Test import di code (verify package installed)

3. **Database Preparation:**
   - [ ] Review migration SQL `migration_member_details.sql`
   - [ ] Backup database (export via Supabase dashboard)
   - [ ] Run migration di Supabase SQL Editor
   - [ ] Verify kolom baru exist: `SELECT hp, email, alamat, foto_jaminan, catatan FROM members LIMIT 1`

### Urutan Implementasi (Prioritized)

#### Sprint 1: Autocomplete History (2-3 jam) — HIGH PRIORITY
**Fitur #2 & #3**
- [ ] Buat API `/api/customers/suggestions`
- [ ] Update `booking/page.js` autocomplete
- [ ] Test dengan data dummy
- [ ] Deploy & verify

**Why First:** Paling sering dipakai, impact langsung ke UX, nggak butuh R2 setup

---

#### Sprint 2: Status Filter & Sort (3-4 jam) — MEDIUM PRIORITY
**Fitur #4**
- [ ] UI filter bar component
- [ ] State management filter/sort
- [ ] Apply filter logic client-side
- [ ] Test kombinasi filter + sort
- [ ] Deploy & verify

**Why Second:** Improve productivity tracking, pure frontend

---

#### Sprint 3: Data Pelanggan Detail (5-7 jam) — MEDIUM PRIORITY
**Fitur #1**
- [ ] Setup R2 & test upload (1 jam)
- [ ] Implement storage abstraction (1 jam)
- [ ] Database migration (15 menit)
- [ ] API upload/photo endpoints (1.5 jam)
- [ ] UI form member update (1.5 jam)
- [ ] Integration test full flow (1 jam)
- [ ] Deploy & verify (30 menit)

**Why Last:** Butuh R2 setup, paling kompleks, nggak urgent untuk daily operation

---

### Checklist Sebelum Deploy (Per Fitur)
- [ ] Code review (check security, validation)
- [ ] Local test (dev server)
- [ ] Build check (`npm run build`)
- [ ] Test di browser (Chrome, Safari, mobile)
- [ ] Verify data persistence (reload page, check DB)
- [ ] Performance check (load time, bundle size)
- [ ] Deploy production (`npx vercel --prod --yes`)
- [ ] Smoke test production URL
- [ ] Update dokumentasi (FITUR_BARU.md status)

---

### R2 Setup Guide (Step-by-Step)

#### 1. Create R2 Bucket
1. Login Cloudflare: https://dash.cloudflare.com
2. Sidebar → R2 Object Storage
3. Click "Create bucket"
4. Bucket name: `customer-documents`
5. Location: Automatic (closest to your users)
6. Click "Create bucket"

#### 2. Generate API Token
1. R2 dashboard → Manage R2 API Tokens
2. Click "Create API token"
3. Token name: `sewara-r2-access`
4. Permissions: 
   - ✅ Object Read & Write
   - ✅ Bucket List
5. TTL: No expiry
6. Click "Create API token"
7. **Catat credentials** (hanya muncul sekali):
   - Access Key ID: `xxxxxxxxxxxxxx`
   - Secret Access Key: `yyyyyyyyyyyyyyyy`
   - Endpoint URL: `https://<account-id>.r2.cloudflarestorage.com`

#### 3. Update Environment Variables
```env
# .env.local (ADD THESE)
R2_ENDPOINT=https://your-account-id.r2.cloudflarestorage.com
R2_ACCESS_KEY_ID=your-access-key-id-here
R2_SECRET_ACCESS_KEY=your-secret-access-key-here
R2_BUCKET_NAME=customer-documents
```

#### 4. Test Connection
```javascript
// Test script: test-r2.js
import { S3Client, ListBucketsCommand } from '@aws-sdk/client-s3';

const client = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

const { Buckets } = await client.send(new ListBucketsCommand({}));
console.log('✅ R2 Connected! Buckets:', Buckets.map(b => b.Name));
```

Run: `node test-r2.js` (should show `customer-documents`)

---

### Troubleshooting Common Issues

#### Issue: "SignatureDoesNotMatch" error
**Cause:** Wrong Secret Access Key atau endpoint URL  
**Fix:** Double-check credentials, regenerate token kalau perlu

#### Issue: "NoSuchBucket" error
**Cause:** Bucket name typo atau belum dibuat  
**Fix:** Verify bucket name exact match (case-sensitive)

#### Issue: "AccessDenied" error
**Cause:** API token nggak punya permission write  
**Fix:** Regenerate token dengan permission "Object Read & Write"

#### Issue: Upload berhasil tapi file size 0 bytes
**Cause:** Body dikirim sebagai string bukan Buffer  
**Fix:** Convert ke Buffer: `Buffer.from(await file.arrayBuffer())`

#### Issue: Signed URL 403 Forbidden
**Cause:** Bucket private tapi signed URL expired atau salah signature  
**Fix:** Verify `getSignedUrl` implementation, check expiresIn param

---

## 📊 Implementation Progress Tracker

### Fitur #1: Data Pelanggan Detail
- [ ] **Setup** (1 jam)
  - [ ] R2 bucket created
  - [ ] API credentials saved
  - [ ] Environment variables configured
  - [ ] Dependencies installed
  - [ ] Test connection successful
- [ ] **Backend** (2.5 jam)
  - [ ] Storage abstraction layer (`lib/storage.js`)
  - [ ] Database migration executed
  - [ ] API `/api/member/upload` implemented
  - [ ] API `/api/member/photo` implemented
  - [ ] API `/api/member` extended (PUT with new fields)
- [ ] **Frontend** (2 jam)
  - [ ] Form member update UI (HP, email, alamat, catatan)
  - [ ] Upload component dengan preview
  - [ ] Image compression integrated
  - [ ] Validation client-side
  - [ ] Display foto di modal/drawer
- [ ] **Testing** (1 jam)
  - [ ] Upload foto test (KTP, SIM, Lainnya)
  - [ ] View foto via signed URL
  - [ ] Delete foto test
  - [ ] Update member with new fields
  - [ ] Mobile responsive check
- [ ] **Deployment**
  - [ ] Build check passed
  - [ ] Production deploy
  - [ ] Smoke test production
  - [ ] Documentation updated

### Fitur #2/3: Pool Pelanggan & Autocomplete History
- [ ] **Backend** (1 jam)
  - [ ] API `/api/customers/suggestions` implemented
  - [ ] Query distinct penyewa from transactions
  - [ ] Merge with members data
  - [ ] Add label/badge (member vs history)
- [ ] **Frontend** (1.5 jam)
  - [ ] Update `booking/page.js` autocomplete
  - [ ] Fetch suggestions from new endpoint
  - [ ] Display badge pembeda
  - [ ] Handle member selection (auto-discount)
  - [ ] Handle history selection (no discount)
- [ ] **Testing** (30 menit)
  - [ ] Test autocomplete dengan member
  - [ ] Test autocomplete dengan history
  - [ ] Test input manual nama baru
  - [ ] Performance check (> 1000 transactions)
- [ ] **Deployment**
  - [ ] Build check passed
  - [ ] Production deploy
  - [ ] Smoke test production

### Fitur #4: Status Filter & Sort
- [ ] **Frontend** (3 jam)
  - [ ] UI filter bar component
  - [ ] Filter by status (multi-select)
  - [ ] Filter by tanggal (range picker)
  - [ ] Filter by nama (search)
  - [ ] Sort by tanggal/nama/total
  - [ ] State management (localStorage persist)
  - [ ] Clear all filter button
- [ ] **Testing** (1 jam)
  - [ ] Test single filter
  - [ ] Test kombinasi filter
  - [ ] Test sort kombinasi
  - [ ] Test persist filter (reload page)
  - [ ] Mobile responsive check
- [ ] **Deployment**
  - [ ] Build check passed
  - [ ] Production deploy
  - [ ] Smoke test production

---

## 🎯 Success Metrics

### Fitur #1 (Data Pelanggan Detail)
- ✅ Upload foto < 3 detik (after compress)
- ✅ Foto compressed < 500KB (from 1.5MB avg)
- ✅ Signed URL generate < 500ms
- ✅ Form validation 100% (no invalid data saved)
- ✅ Mobile upload works (iOS Safari, Android Chrome)

### Fitur #2/3 (Autocomplete History)
- ✅ Autocomplete response < 300ms
- ✅ Suggestion list shows member + history (dedupe)
- ✅ Badge pembeda clear (Member vs Pelanggan)
- ✅ Member selection auto-apply discount
- ✅ History selection no discount applied

### Fitur #4 (Filter & Sort)
- ✅ Filter apply < 100ms (client-side)
- ✅ Multiple filter kombinasi works
- ✅ Sort stable (tidak random order)
- ✅ Filter persist across reload
- ✅ Clear filter reset to initial state

---

**Status Update:** Planning Complete ✅  
**Ready to Implement:** Besok (23 Agustus 2026)  
**Estimated Completion:** 2-3 hari kerja (Sprint 1 → Sprint 2 → Sprint 3)

---

## Catatan Roadmap SaaS, Paket, dan Pembayaran Otomatis

### Arsitektur DB

- **Opsi 2 (prefix di `public`)** — semua tabel tetap di schema `public`.
- Prefix `sewara_` untuk tabel fungsional/SaaS platform.
- Tabel bisnis rental tanpa prefix.
- Skalabilitas: bisa dipindah ke beda schema (`SET SCHEMA`), beda provider, atau self-hosting tanpa effort besar.

### Struktur Tabel

**Bisnis rental (tanpa prefix):**

```
inventory
inventory_rates
inventory_units
transactions
transaction_items
transaction_payments
transaction_logs
members
member_types
member_documents
promo_codes
activity_logs
settings
```

**Platform SaaS (prefix `sewara_`):**

```
sewara_plans
sewara_plan_features
sewara_subscriptions
sewara_subscription_payments
sewara_subscription_events
sewara_usage_counters
sewara_feature_overrides
sewara_payment_methods
```

**Shared / tetap:**

```
profiles
profile_security
login_logs
admin_logs
app_config
```

### Restrukturisasi DB

- Database canonical pakai `snake_case`.
- Tenant key pakai `owner_id` untuk data bisnis.
- `transactions.items` JSONB → pindah ke `transaction_items`.
- `transactions.pembayaran` JSONB → pindah ke `transaction_payments`.
- `members.foto_jaminan` JSONB → pindah ke `member_documents`.
- `member_templates` → rename jadi `member_types`.
- `logs` → diganti `activity_logs` (struktur universal).
- JSONB dipertahankan hanya untuk data fleksibel: `komponen`, `jaminan_sewa`, `customer_snapshot`, metadata.
- Kolom duplikat di `transactions` (snake_case + camelCase) harus dikonsolidasi ke snake_case.

### Model Penjualan

- Satu codebase, feature variants per paket.
- Kombinasi feature gating + usage metering.
- Contoh paket: Starter, Pro, Business (detail limit belum ditetapkan).
- Batas per periode bulanan: transaksi, barang, pelanggan, staf, storage.

### Pembayaran Otomatis

- Provider undecided: Midtrans, Xendit, atau Stripe.
- Endpoint webhook: `/api/webhooks/payment`; wajib signature verification dan idempotency.
- Auto-renewal subscription.
- Upgrade berlaku segera setelah webhook pembayaran berhasil.
- Downgrade berlaku pada akhir periode berjalan.
- Polling 1-5 menit cukup untuk halaman admin subscriber (tidak perlu Realtime).

### Status Subscription

`trialing`, `active`, `past_due`, `grace_period`, `cancelled`, `expired`, `suspended`.

### Keamanan

- Jangan simpan data kartu.
- Secrets hanya di server.
- Enforce akses paket dan limit melalui server/RPC, bukan client.

### Urutan Kerja Restrukturisasi

1. Sepakati struktur dan nama canonical per tabel.
2. Buat tabel baru (additive) tanpa menghapus data lama.
3. Backfill data lama ke struktur baru.
4. Ubah aplikasi membaca struktur baru.
5. Test data, RLS, transaksi, pembayaran, upload.
6. Hapus kolom/tabel lama setelah aman.

### Optimasi DB

- **Enum type** untuk kolom pilihan tetap: status transaksi, jenis inventory, role, event login, metode bayar, jenis dokumen, status aktif.
- **`int4`** ganti `int8` untuk semua ID (cukup sampai 2 miliar row).
- **`integer`** untuk harga/biaya jika selalu bulat (lebih cepat dari `numeric`).
- **`varchar(n)`** untuk validasi panjang (email, hp, kode promo, dll), bukan untuk hemat storage.
- **`inet`** untuk kolom IP address.
- **`NOT NULL` + default** di semua kolom yang wajib terisi.
- **Partial index** untuk query yang sering (transaksi aktif, member aktif).
- **Composite index** untuk kombinasi kolom yang sering di-query bersama.
- **Foreign key** untuk integritas data antar tabel.
- **Retensi otomatis** untuk log (login_logs 30 hari, activity_logs 90 hari, admin_logs 180 hari).
- **Hapus index tidak terpakai** (cek `pg_stat_user_indexes.idx_scan = 0`).
- `text` dan `varchar` tanpa (n) secara storage sama di PostgreSQL — perbedaannya hanya validasi panjang.

### Enum Types

```sql
enum_jenis_inventory  → 'satuan', 'bundling'
enum_status_transaksi → 'Booking', 'Disewa', 'Selesai', 'Belum Selesai', 'Dibatalkan'
enum_status_aktif     → 'aktif', 'nonaktif'
enum_role             → 'superadmin', 'owner', 'cs', 'gudang'
enum_login_event      → 'login_sukses', 'login_gagal', 'logout'
enum_metode_bayar     → 'Tunai', 'Transfer', 'QRIS'
enum_jenis_dokumen    → 'ktp', 'sim', 'lainnya'
```

### Diagram Relasi

```
╔══════════════════════════════════════════════════════════════╗
║                        PROFILES                              ║
║                    (pusat semua data)                         ║
║                      user_id [PK]                            ║
╚══════════════╤═══════════╤═══════════╤═══════════════════════╝
               │           │           │
    ┌──────────┴──┐   ┌────┴────┐   ┌──┴──────────────┐
    │  BISNIS     │   │ SHARED  │   │  PLATFORM       │
    │  RENTAL     │   │         │   │  (sewara_*)      │
    └──────┬──────┘   └────┬────┘   └──────┬──────────┘
           │               │               │
           ▼               ▼               ▼
```

**Bisnis Rental (13 tabel):**

```
inventory
  ├── inventory_rates      (1 barang → banyak tarif)
  └── inventory_units      (1 barang → banyak unit/SN)

members
  ├── member_types         (banyak member → 1 tipe)
  └── member_documents     (1 member → banyak dokumen)

promo_codes

transactions
  ├── transaction_items    (1 transaksi → banyak barang)
  ├── transaction_payments (1 transaksi → banyak pembayaran)
  ├── transaction_logs     (1 transaksi → banyak log)
  └── members              (1 transaksi → 1 member, opsional)

activity_logs
settings
```

**Shared (5 tabel):**

```
profiles
  ├── profile_security     (1:1, data keamanan login)
  ├── login_logs           (1 owner → banyak log login)
  └── admin_logs           (log aksi superadmin/owner)

app_config                 (global, tidak per owner)
```

**Platform SaaS (8 tabel):**

```
sewara_plans
  └── sewara_plan_features    (1 plan → banyak fitur)

owner ──→ sewara_subscriptions    (1 owner → 1 subscription aktif)
              ├── sewara_subscription_payments (riwayat bayar)
              └── sewara_subscription_events   (webhook log)

owner ──→ sewara_payment_methods  (metode bayar tersimpan)
owner ──→ sewara_usage_counters   (pemakaian per bulan)
owner ──→ sewara_feature_overrides (bonus/override khusus)
```

**Koneksi antar tabel bisnis:**

```
transactions.member_id ──→ members.id
transaction_items.inventory_id ──→ inventory.id
members.member_type_id ──→ member_types.id
member_documents.member_id ──→ members.id
inventory_rates.inventory_id ──→ inventory.id
inventory_units.inventory_id ──→ inventory.id
```

**Koneksi antar tabel platform:**

```
sewara_subscriptions.plan_id ──→ sewara_plans.id
sewara_subscriptions.owner_id ──→ profiles.user_id
sewara_plan_features.plan_id ──→ sewara_plans.id
sewara_subscription_payments.subscription_id ──→ sewara_subscriptions.id
sewara_subscription_events.subscription_id ──→ sewara_subscriptions.id
sewara_payment_methods.owner_id ──→ profiles.user_id
sewara_usage_counters.owner_id ──→ profiles.user_id
sewara_feature_overrides.owner_id ──→ profiles.user_id
```

### Alur Koneksi Aplikasi

```
User login
  → profiles → cek role + is_active
  → sewara_subscriptions → cek status langganan
  → sewara_plan_features → fitur apa yang boleh?
  → sewara_usage_counters → sudah pakai berapa?
  → sewara_feature_overrides → ada bonus khusus?
  → BOLEH / TOLAK
  → Akses data bisnis (RLS filter: owner_id = auth.uid())
```

### Alur Pembayaran Langganan

```
User pilih paket → sewara_plans
  → Payment gateway (Midtrans/Xendit/Stripe)
  → Webhook masuk → /api/webhooks/payment
  → sewara_subscription_events (simpan event mentah)
  → sewara_subscription_payments (catat pembayaran)
  → sewara_subscriptions (update status + periode)
```

### Alur Cek Fitur

```
User mau aksi (misal bikin transaksi)
  1. Cek sewara_feature_overrides → ada override?
  2. Cek sewara_plan_features → limit plan berapa?
  3. Cek sewara_usage_counters → sudah pakai berapa bulan ini?
  → di bawah limit → BOLEH
  → sudah limit → TOLAK ("Upgrade plan")
```

### Total Tabel: 26

| Grup | Jumlah |
|---|---:|
| Bisnis rental | 13 |
| Shared | 5 |
| Platform (sewara_*) | 8 |

### Keputusan Saat Ini

- Hanya siapkan arsitektur DB.
- Jangan tetapkan limit final atau aktifkan restriction dulu.
- Detail pembatasan fitur/transaksi ditentukan nanti.
- Detail kolom per tabel sudah dibahas, implementasi migration belum dimulai.

---

## Flow Eksekusi Restrukturisasi DB

**Status:** Planning. Belum boleh eksekusi sebelum user memberi perintah eksplisit.

### Aturan Umum

1. Backup database sebelum Phase 1.
2. User menjalankan SQL migration di Supabase SQL Editor.
3. Kode aplikasi diubah setelah user mengonfirmasi migration berhasil.
4. Setiap phase diverifikasi sebelum lanjut phase berikutnya.
5. Struktur lama tidak boleh dihapus sebelum data baru dan aplikasi teruji.
6. Downtime diperbolehkan saat migration dan deploy.
7. Semua perubahan kode harus melalui build dan smoke test.
8. Jangan commit secret, `.env.local`, atau credential.

### Urutan Phase

#### Phase 1 — Rename Kolom Transactions

**Target:**

```text
noInvoice           → no_invoice
hpPenyewa           → hp_penyewa
alamatPenyewa       → alamat_penyewa
jaminanSewa         → jaminan_sewa
totalAkhir          → total_akhir
dendaTambahan       → denda_tambahan
waktuAmbilRencana   → waktu_ambil_rencana
waktuKembaliRencana → waktu_kembali_rencana
waktuKembaliAktual  → waktu_kembali_aktual
durasiTeks          → durasi_teks
riwayatDilayani     → riwayat_dilayani
biayaDasar          → biaya_dasar
```

Tetap simpan snapshot pelanggan di `transactions`:

```text
penyewa
hp_penyewa
alamat_penyewa
```

Tambah kolom nullable:

```text
transactions.member_id → members.id
```

**Flow:**

1. User backup database.
2. User menjalankan preflight query dan mencatat jumlah rows.
3. User menjalankan SQL rename dan `ADD COLUMN member_id`.
4. User menjalankan verification query.
5. User mengirim hasil verification.
6. Sesi coding mengubah `db.js`, halaman dashboard, API, dan RPC terkait.
7. Jalankan `npm run build` dan `git diff --check`.
8. Deploy dan smoke test booking, status, kalender, tracking, laporan, pelanggan, riwayat.
9. Hanya setelah Phase 1 stabil, lanjut Phase 2.

**Catatan:** FK `member_id` ditunda ke Phase 4 setelah orphan check.

#### Phase 2 — Rename Tabel

```text
member_templates → member_types
logs             → activity_logs
```

**Flow:**

1. User mencatat jumlah rows dan RLS policy tabel lama.
2. User menjalankan `ALTER TABLE ... RENAME TO ...`.
3. User memverifikasi jumlah rows, RLS, policy, dan RPC.
4. Sesi coding mengganti semua `.from(...)` dan referensi tabel.
5. Jalankan build dan smoke test tier member serta activity log.
6. Deploy dan verifikasi.

#### Phase 3 — Normalisasi JSONB

Buat tabel baru tanpa menghapus kolom lama:

```text
transactions.items       → transaction_items
transactions.pembayaran  → transaction_payments
members.foto_jaminan     → member_documents
inventory.sns            → inventory_units
```

`inventory.komponen` tetap JSONB karena merupakan data fleksibel.

**Flow:**

1. User inspect sample JSON dan `jsonb_typeof()` setiap sumber.
2. User membuat tabel baru.
3. User backfill data lama ke tabel baru.
4. User membandingkan jumlah source element dan normalized rows.
5. User memeriksa orphan rows dan duplicate rows.
6. Sesi coding mengubah `db.js`, booking, status, kalender, tracking, laporan, member, dan API.
7. Semua write baru diarahkan ke tabel normalized.
8. Kolom JSONB lama tetap disimpan sebagai fallback.
9. Jalankan full flow test dan build.
10. Deploy.
11. Drop kolom lama hanya setelah periode observasi dan konfirmasi user.

#### Phase 4 — Optimization dan Integrity

Dijalankan setelah Phase 1–3 stabil:

- Enum status transaksi, role, status aktif, metode pembayaran, jenis dokumen, jenis inventory.
- Foreign key dan `ON DELETE` behavior.
- Partial dan composite index.
- Check constraint untuk qty, jumlah, path, dan panjang field.
- `NOT NULL` dan default setelah null audit.
- Retention policy untuk `activity_logs`.
- Audit index yang tidak terpakai.

**Flow:**

1. User menjalankan data-quality preflight.
2. Sesi coding menyiapkan SQL berdasarkan nilai aktual DB.
3. User menjalankan migration constraint/index.
4. User memverifikasi orphan, invalid enum, dan null values.
5. Jalankan full regression test.
6. Deploy.

### Pembagian Tugas Antar Sesi

**Sesi DB/server:**

- Backup database.
- Menjalankan SQL migration.
- Memeriksa row count, schema, RLS, policy, RPC, orphan, dan duplicate.
- Mengirim hasil verification ke sesi coding.

**Sesi coding:**

- Tidak menjalankan migration destructive tanpa konfirmasi user.
- Mengubah query Supabase dan property access setelah schema dikonfirmasi.
- Mengubah RPC SQL bila dibutuhkan.
- Menjalankan build, lint/parser check, dan smoke test.
- Menyiapkan commit, tag, dan deploy hanya setelah user meminta.

**Sesi review:**

- Memeriksa mapping kolom lama → canonical snake_case.
- Memeriksa semua query wildcard dan dynamic payload.
- Memeriksa RLS dan ownership tenant.
- Memeriksa rollback plan sebelum migration dijalankan.

### Checkpoint Wajib

Setiap phase memiliki checkpoint berikut:

```text
CHECKPOINT A — Backup selesai
CHECKPOINT B — Preflight cocok
CHECKPOINT C — SQL migration selesai
CHECKPOINT D — Verification DB cocok
CHECKPOINT E — Kode selesai dan build berhasil
CHECKPOINT F — Smoke test selesai
CHECKPOINT G — User menyetujui lanjut phase berikutnya
```

Tidak boleh melewati checkpoint. Jika verification gagal, hentikan phase, jangan lanjut, dan gunakan rollback plan.

### Rollback Rules

- Phase 1: rename kolom kembali ke nama lama dan drop `member_id` jika belum dipakai.
- Phase 2: rename tabel kembali ke nama lama.
- Phase 3: hentikan write normalized, kembali baca JSONB, jangan drop tabel baru jika berisi data baru.
- Phase 4: drop constraint/index/enum yang baru dibuat hanya setelah dependency diperiksa.
- Jangan rollback sebagian tanpa memeriksa dependency RPC, RLS, view, trigger, dan kode aplikasi.

### Target Canonical Schema

```text
public
├── inventory
├── inventory_units
├── transactions
├── transaction_items
├── transaction_payments
├── transaction_logs
├── members
├── member_types
├── member_documents
├── promo_codes
├── activity_logs
└── settings
```

Platform SaaS dibuat belakangan bersama tabel `sewara_*`. Restriction paket dan usage limit belum diaktifkan.

### Instruksi untuk Sesi Berikutnya

Sebelum mengubah kode atau DB, baca bagian **Flow Eksekusi Restrukturisasi DB** ini. Tanyakan checkpoint terakhir kepada user. Jika belum ada perintah eksplisit, lakukan audit atau persiapan saja. Jangan menjalankan migration, rename, drop, commit, push, atau deploy tanpa perintah user.

---

**Status Restrukturisasi:** Ready for execution — Phase 1-2 scheduled tonight (27 Aug 2026).

**Checkpoint saat ini:** Belum mulai Phase 1.

**Sequence Decision:** Restructure first approach
- P0 minimal RLS smoke test → Phase 1-2 → Quick security fixes → Phase 3-4 → P2 → P1
- Prioritas: canonical schema dulu, atomic RPC dan pagination setelah schema stabil
- Risk acceptance: race condition dan pagination akan diperbaiki setelah restructure
- Known risks documented in RESTRUCTURE_CHECKLIST.md

**Related Files:**
- `RESTRUCTURE_CHECKLIST.md` — Step-by-step execution checklist for tonight
- `scripts/test-rls-isolation.js` — RLS smoke test before migration
- Preflight checks mandatory before Phase 1
