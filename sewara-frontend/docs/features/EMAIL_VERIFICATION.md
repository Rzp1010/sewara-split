# Email Verification — Sewara Apps

**Feature:** Email verification untuk pendaftaran akun  
**Status:** Production — Verified  
**Start Date:** 1 September 2026  
**Verified:** 1 September 2026  
**Type:** Link aktivasi email (Supabase Auth + Resend SMTP)

---

## Tujuan

Memastikan alamat email user valid sebelum akun dapat digunakan, dengan tetap memisahkan verifikasi email dari approval admin.

---

## User Flow

### 1. Pendaftaran

```
User → /daftar
→ isi form (email, password, nama lengkap, nama bisnis)
→ klik "Daftar"
→ akun dibuat dengan status:
  - email_confirmed_at: NULL (belum terverifikasi)
  - profiles.status: "menunggu" (belum diapprove admin)
→ email verifikasi dikirim ke inbox user
→ redirect ke /verifikasi-email
```

### 2. Verifikasi Email

```
User → cek inbox email
→ klik link verifikasi
→ redirect ke /auth/callback?code=xxx
→ sistem exchange code untuk session
→ email_confirmed_at: diisi timestamp
→ tampilkan pesan sukses
→ redirect ke /login
```

### 3. Login

```
User → /login (atau /)
→ isi email + password
→ sistem validasi:
  1. Password benar?
  2. Email sudah verified? ← GATE BARU
  3. Akun sudah approved admin?
  4. Akun masih aktif?
→ jika semua pass: login berhasil
→ jika gagal: tampilkan pesan sesuai kondisi
```

---

## Status Akun

Akun punya **dua gate terpisah**:

| Gate | Field | Sumber | Penanggung Jawab |
|---|---|---|---|
| Email verified | `auth.users.email_confirmed_at` | Supabase Auth | User (klik link) |
| Akun approved | `profiles.status` | Application | Admin/Superadmin |

**Kombinasi status:**

| Email Verified | Status Profile | Login | Keterangan |
|---|---|---|---|
| ❌ NULL | `menunggu` | ❌ Ditolak | Belum klik link verifikasi |
| ✅ Timestamp | `menunggu` | ❌ Ditolak | Sudah verified, menunggu approval admin |
| ✅ Timestamp | `disetujui` | ✅ Berhasil | Fully active |
| ✅ Timestamp | `nonaktif` | ❌ Ditolak | Akun dinonaktifkan admin |

**Prinsip:**
- Email verification = bukti user memiliki akses ke email tersebut
- Approval admin = kebijakan bisnis akses aplikasi
- Keduanya independen dan wajib dipenuhi untuk login

---

## Pesan Error Login

| Kondisi | Pesan User |
|---|---|
| Email belum verified | `Email belum diverifikasi. Cek inbox atau kirim ulang link verifikasi.` |
| Email verified, belum approved | `Akun Anda masih menunggu persetujuan admin.` |
| Akun nonaktif | `Akun Anda tidak aktif.` (pesan generik seperti sebelumnya) |
| Password salah / email tidak terdaftar | `Email atau password salah.` (pesan generik anti-enumeration) |

---

## Resend Verification

**Endpoint:** `/api/auth/resend-verification`

**Rate Limit:**
- Maksimal **3 email verifikasi per alamat email per jam** (rolling window)
- Cooldown **60 detik** antar resend
- Rate limit juga per IP untuk mencegah abuse dengan rotasi email

**Alur:**
```
User → klik "Kirim ulang email"
→ POST /api/auth/resend-verification { email }
→ sistem cek:
  1. Email terdaftar dan belum verified?
  2. Sudah kirim < 3 kali dalam 1 jam terakhir?
  3. Sudah lewat 60 detik sejak resend terakhir?
→ jika pass: kirim ulang email
→ jika limit: tolak dengan 429
→ respons selalu seragam (jangan bocorkan status email)
```

**Respons:**
```json
{
  "ok": true,
  "message": "Jika email terdaftar, link verifikasi akan dikirim."
}
```

Respons selalu sama untuk mencegah email enumeration.

**Database tracking:**
```
Tabel: email_verification_attempts
Kolom: email, sent_at, ip
TTL: 1 jam
```

Setiap resend:
1. Count attempts dalam 1 jam terakhir untuk email tersebut
2. Jika >= 3: tolak
3. Jika < 60 detik sejak terakhir: tolak
4. Insert record baru dengan timestamp
5. Kirim email via Supabase Auth

---

## Technical Stack

### Email Provider

**Resend SMTP** via Supabase Auth Custom SMTP

Kredensial:
```
Host: smtp.resend.com
Port: 587 (STARTTLS)
Username: resend
Password: <RESEND_API_KEY>
```

Sender:
```
Sewara <accounts@sewara.id>
```

Domain `sewara.id` sudah verified di Resend dengan SPF/DKIM aktif.

### Supabase Configuration

**Authentication Settings:**
- Enable email confirmations: `true`
- Custom SMTP: aktif
- SMTP host: `smtp.resend.com`
- SMTP port: `587`
- SMTP username: `resend`
- SMTP password: Resend API key
- Sender email: `accounts@sewara.id`
- Sender name: `Sewara`

**URL Configuration:**
- Site URL: `https://app.sewara.my.id`
- Redirect URLs (allowlist):
  - `https://app.sewara.my.id/auth/callback`
  - `http://localhost:3000/auth/callback` (development)

**Security:**
- `mailer_autoconfirm`: `false` (wajib verifikasi)
- Link expiry: default Supabase (24 jam)
- Single-use token: ya (otomatis Supabase)

---

## Routes

### 1. `/daftar` (existing, modified)

**File:** `src/app/daftar/page.js`

**Perubahan:**
- Setelah register sukses, redirect ke `/verifikasi-email?email=xxx`
- Tampilkan pesan bahwa email verifikasi sudah dikirim

---

### 2. `/verifikasi-email` (new)

**File:** `src/app/verifikasi-email/page.js`

**Tampilan:**
```
✉️ Email Verifikasi Terkirim

Kami sudah mengirim link verifikasi ke:
[email user, disamarkan: r***@example.com]

Cek inbox dan klik link untuk mengaktifkan email Anda.

[Kirim Ulang Email] (cooldown 60 detik)

Sudah verifikasi? [Kembali ke Login]
```

**Fitur:**
- Tombol resend dengan countdown 60 detik
- Pesan rate limit jika sudah 3 kali
- Link ke login

---

### 3. `/auth/callback` (new)

**File:** `src/app/auth/callback/route.js`

**Tugas:**
1. Ambil `code` dari query parameter
2. Exchange code untuk session via Supabase
3. Validasi user dan email_confirmed_at
4. Redirect ke `/auth/callback/success`

**Error handling:**
- Token expired: redirect `/auth/callback/error?reason=expired`
- Token invalid: redirect `/auth/callback/error?reason=invalid`
- Already used: redirect `/auth/callback/error?reason=used`

---

### 4. `/auth/callback/success` (new)

**File:** `src/app/auth/callback/success/page.js`

**Tampilan:**
```
✅ Email Berhasil Diverifikasi

Email Anda sudah berhasil diverifikasi.
Akun Anda masih menunggu persetujuan admin.

Anda akan dihubungi setelah akun disetujui.

[Kembali ke Login]
```

Auto-redirect ke login setelah 5 detik.

---

### 5. `/auth/callback/error` (new)

**File:** `src/app/auth/callback/error/page.js`

**Tampilan dinamis berdasarkan `reason`:**

**Link expired:**
```
⏰ Link Sudah Kadaluarsa

Link verifikasi sudah tidak berlaku.

[Kirim Ulang Email Verifikasi]
```

**Link invalid/used:**
```
❌ Link Tidak Valid

Link verifikasi tidak valid atau sudah digunakan.

[Kembali ke Login]
```

---

### 6. `/` atau `/login` (existing, modified)

**File:** `src/app/page.js` (root login)

**Perubahan:**
- Tambah validasi `email_confirmed_at` setelah `signInWithPassword`
- Tampilkan pesan error spesifik jika belum verified
- Tambah link ke halaman resend verification

---

## API Routes

### 1. `/api/auth/register` (existing, modified)

**File:** `src/app/api/auth/register/route.js`

**Perubahan:**
```diff
- email_confirm: true,
+ email_confirm: false,
```

Akun dibuat dengan email belum terverifikasi. Supabase Auth otomatis kirim email verifikasi.

---

### 2. `/api/auth/resend-verification` (new)

**File:** `src/app/api/auth/resend-verification/route.js`

**Method:** `POST`

**Body:**
```json
{
  "email": "user@example.com"
}
```

**Logic:**
1. Validasi email format
2. Rate limit check (3/email/jam + cooldown 60s + IP limit)
3. Ambil user dari Supabase Auth admin
4. Cek `email_confirmed_at`:
   - Jika sudah confirmed: skip kirim (tapi respons tetap ok)
   - Jika belum: kirim ulang via `admin.auth.resend()`
5. Insert attempt log
6. Return respons seragam

**Rate limit implementation:**
```js
// Check attempts dalam 1 jam terakhir
const oneHourAgo = Date.now() - 3600000;
const attempts = await db
  .from('email_verification_attempts')
  .select('*')
  .eq('email', normalizedEmail)
  .gte('sent_at', new Date(oneHourAgo).toISOString());

if (attempts.length >= 3) {
  return NextResponse.json(
    { error: 'Terlalu banyak permintaan. Coba lagi nanti.' },
    { status: 429 }
  );
}

// Check cooldown 60 detik
const lastAttempt = attempts.sort((a, b) => 
  new Date(b.sent_at) - new Date(a.sent_at)
)[0];

if (lastAttempt) {
  const elapsed = Date.now() - new Date(lastAttempt.sent_at).getTime();
  if (elapsed < 60000) {
    return NextResponse.json(
      { error: 'Tunggu 60 detik sebelum mengirim ulang.' },
      { status: 429 }
    );
  }
}

// Send email
await admin.auth.resend({
  type: 'signup',
  email: normalizedEmail,
  options: {
    emailRedirectTo: 'https://app.sewara.my.id/auth/callback'
  }
});

// Log attempt
await db.from('email_verification_attempts').insert({
  email: normalizedEmail,
  sent_at: new Date().toISOString(),
  ip: getClientIP(request)
});
```

**Respons:**
- Success: `{ ok: true, message: "Jika email terdaftar, link verifikasi akan dikirim." }`
- Rate limit: `{ error: "Terlalu banyak permintaan. Coba lagi nanti." }` (429)
- Cooldown: `{ error: "Tunggu 60 detik sebelum mengirim ulang." }` (429)

**Anti-enumeration:** Respons sukses tidak membedakan email terdaftar atau tidak.

---

### 3. `/api/auth/login` (existing, modified)

**File:** `src/app/api/auth/login/route.js`

**Perubahan:**

Tambahkan pengecekan setelah `signInWithPassword` sukses:

```js
const { data: sess, error: signErr } = await supabase.auth.signInWithPassword({ 
  email, 
  password 
});

if (signErr || !sess?.session) {
  // existing error handling
}

// NEW: Check email verification
if (!sess.user.email_confirmed_at) {
  await catatLoginLog(admin, { 
    email, 
    ownerId: profil?.owner_id, 
    event: "login_gagal", 
    detail: "email belum diverifikasi", 
    headers: request.headers 
  });
  
  return NextResponse.json({ 
    error: "Email belum diverifikasi. Cek inbox atau kirim ulang link verifikasi.",
    needsVerification: true
  }, { status: 401 });
}

// Continue existing approval, active, subscription checks
```

**Frontend handling:**

Jika respons mengandung `needsVerification: true`, tampilkan link ke halaman resend verification.

---

## Database Schema

### New Table: `email_verification_attempts`

```sql
CREATE TABLE email_verification_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ip TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_email_verification_email_sent 
  ON email_verification_attempts(email, sent_at DESC);

-- TTL cleanup (opsional, via pg_cron atau manual)
-- Hapus row > 1 jam otomatis
```

**Catatan:** Tabel ini bisa diganti dengan Redis/Upstash untuk performa lebih baik, tapi Supabase DB cukup untuk awal.

---

## Security Considerations

### 1. Anti-Enumeration

**Prinsip:** Respons API tidak membocorkan apakah email terdaftar atau tidak.

**Implementasi:**
- Resend API selalu return `ok: true` dengan pesan generik
- Login error selalu `"Email atau password salah."`
- Jangan return error berbeda untuk "email tidak ada" vs "password salah"

### 2. Rate Limiting

**Layer 1: Application (per email)**
- 3 verification email per alamat per jam
- 60 detik cooldown antar-resend

**Layer 2: IP-based**
- Maksimal 10 resend request per IP per jam
- Mencegah rotasi email untuk abuse

**Layer 3: Supabase Project**
- Default limit 30 email per jam (custom SMTP)
- Shared across semua email types

### 3. Token Security

**Supabase Auth menangani:**
- Token expiry (default 24 jam)
- Single-use enforcement
- Signature validation

**Aplikasi:**
- Tidak simpan token di database
- Tidak log token di console/file
- Hapus token dari URL setelah diproses
- Validasi redirect URL terhadap allowlist

### 4. SMTP Credentials

**Secret management:**
- `RESEND_API_KEY` simpan di Supabase Secrets (atau Vercel env)
- Jangan commit ke Git
- Jangan expose ke client/browser
- Rotasi key jika leak

### 5. Email Delivery

**Validasi domain:**
- SPF record valid
- DKIM signature aktif
- DMARC policy configured
- Return-Path sesuai sender

**Monitoring:**
- Track bounce rate
- Track complaint/spam reports
- Alert jika delivery rate < 95%

---

## Testing Checklist

### Unit Tests (opsional)

- [ ] Resend rate limit logic (3/jam)
- [ ] Cooldown validation (60s)
- [ ] Email normalization (lowercase, trim)
- [ ] IP extraction dari headers

### Manual Tests (wajib)

#### Registration Flow
- [ ] Register akun baru dengan email valid
- [ ] Email verifikasi masuk ke inbox (bukan spam)
- [ ] Email body dan sender sesuai branding
- [ ] Link di email bisa diklik

#### Verification Flow
- [ ] Klik link → redirect ke callback
- [ ] Callback exchange code berhasil
- [ ] `email_confirmed_at` terisi di database
- [ ] Tampil halaman sukses
- [ ] Redirect ke login setelah 5 detik

#### Error Scenarios
- [ ] Link expired (tunggu > 24 jam atau force expire)
- [ ] Link sudah digunakan (klik ulang)
- [ ] Link invalid (ubah token manual)
- [ ] Tampilan error sesuai reason

#### Login Gate
- [ ] Login dengan email belum verified → ditolak
- [ ] Pesan error: "Email belum diverifikasi..."
- [ ] Login dengan email verified + belum approved → ditolak
- [ ] Pesan error: "Akun masih menunggu persetujuan..."
- [ ] Login dengan email verified + approved → berhasil

#### Resend Verification
- [ ] Klik resend pertama kali → berhasil
- [ ] Email kedua masuk
- [ ] Klik resend < 60 detik → ditolak (cooldown)
- [ ] Klik resend ke-4 dalam 1 jam → ditolak (rate limit 3/jam)
- [ ] Tunggu 1 jam → bisa resend lagi
- [ ] Resend untuk email sudah verified → respons ok tapi tidak kirim email

#### Edge Cases
- [ ] Register email sudah terdaftar → respons ok, tidak kirim email
- [ ] Resend untuk email tidak terdaftar → respons ok (anti-enumeration)
- [ ] Callback tanpa code parameter → error
- [ ] Callback dengan code random → error invalid
- [ ] Multiple tabs klik link bersamaan → salah satu sukses

#### Cross-Browser
- [ ] Chrome/Edge
- [ ] Firefox
- [ ] Safari
- [ ] Mobile browser (iOS Safari, Chrome Android)

#### Email Deliverability
- [ ] Email masuk (not spam) di Gmail
- [ ] Email masuk (not spam) di Outlook/Hotmail
- [ ] Email masuk (not spam) di Yahoo
- [ ] SPF/DKIM pass di email headers

---

## Deployment Checklist

### Pre-Deployment

- [ ] Dokumentasi lengkap (file ini)
- [ ] Code review passed
- [ ] Manual testing passed (semua checklist)
- [ ] Rate limit tested (3/jam enforcement)
- [ ] SMTP credentials configured di Supabase
- [ ] Redirect URLs registered (production + localhost)
- [ ] `.env.local` tidak ter-commit
- [ ] Build berhasil tanpa error
- [ ] Lint passed

### Supabase Configuration

- [ ] Custom SMTP aktif
- [ ] Email confirmations enabled
- [ ] Site URL: `https://app.sewara.my.id`
- [ ] Redirect URLs:
  - [ ] `https://app.sewara.my.id/auth/callback`
  - [ ] `http://localhost:3000/auth/callback`
- [ ] Sender email: `accounts@sewara.id`
- [ ] Sender name: `Sewara`
- [ ] `mailer_autoconfirm`: `false`

### Resend Configuration

- [ ] Domain `sewara.id` verified
- [ ] SPF record published
- [ ] DKIM signature active
- [ ] DMARC policy configured
- [ ] API key active dan tersimpan aman
- [ ] Test email berhasil terkirim

### Database

- [ ] Tabel `email_verification_attempts` dibuat
- [ ] Index `idx_email_verification_email_sent` exists
- [ ] RLS disabled (table utility, bukan tenant-specific)

### Deployment Steps

1. **Preview deployment:**
   ```bash
   git checkout -b feature/email-verification
   git add .
   git commit -m "feat: Add email verification"
   git push origin feature/email-verification
   npx vercel --prod=false
   ```

2. **Test preview:**
   - Register akun baru
   - Verifikasi email flow
   - Login gate
   - Resend verification

3. **Merge to main:**
   ```bash
   git checkout master
   git merge feature/email-verification
   git push origin master
   ```

4. **Production deployment:**
   ```bash
   npx vercel --prod --yes
   ```

5. **Smoke test production:**
   - Register test akun
   - Email delivered?
   - Verification berhasil?
   - Login gate works?

### Post-Deployment Monitoring

**First 24 hours:**
- [ ] Monitor Supabase Auth logs
- [ ] Monitor Resend delivery stats
- [ ] Check bounce rate < 5%
- [ ] Check complaint rate < 0.1%
- [ ] Monitor rate limit hits (apakah ada abuse?)
- [ ] Check registration success rate
- [ ] Check verification completion rate

**Metrics to track:**
- Total registrations
- Email sent count
- Email delivered count
- Verification completion rate (verified / sent)
- Resend usage (berapa % user butuh resend?)
- Rate limit hits (abuse detection)

---

## Rollback Plan

### If Critical Bug Found

**Symptoms:**
- Email tidak terkirim
- Link tidak berfungsi
- Rate limit terlalu ketat
- Login gate terlalu strict

**Quick rollback:**

1. **Revert register flow:**
   ```diff
   + email_confirm: true,
   ```
   User bisa langsung login tanpa verifikasi (temporary).

2. **Disable login gate:**
   Comment out email verification check di login route.

3. **Redeploy:**
   ```bash
   git revert <commit-hash>
   git push origin master
   npx vercel --prod --yes
   ```

4. **Notify users:**
   - Email verification temporary disabled
   - Akun existing tetap bisa login

**Full rollback:**

```bash
# Revert ke commit sebelum email verification
git reset --hard <commit-before-feature>
git push origin master --force
npx vercel --prod --yes
```

**Database cleanup (opsional):**
```sql
-- Hapus tabel attempts jika tidak diperlukan
DROP TABLE email_verification_attempts;

-- Mark semua email sebagai confirmed (if needed)
-- DANGER: Only in emergency!
UPDATE auth.users SET email_confirmed_at = NOW() 
WHERE email_confirmed_at IS NULL;
```

---

## Future Enhancements

### Phase 2: Kode Verifikasi 6 Digit

**Timeline:** Future (setelah link activation stable)

**Changes:**
- Ganti/tambahkan opsi kode 6 digit
- Kode disimpan hash di database
- Expiry 10 menit
- Rate limit percobaan verifikasi
- UI input 6 digit

**Benefit:**
- Tidak perlu klik link
- Lebih mobile-friendly
- Bisa dipakai untuk reset password juga

### Phase 3: Email Template Customization

**Timeline:** Future

**Features:**
- HTML email template branded Sewara
- Logo, colors, fonts custom
- Footer dengan social media links
- Unsubscribe link (bila diperlukan)

### Phase 4: SMS Verification (Optional)

**Timeline:** Long-term

**Use case:**
- Backup jika email delivery gagal
- Markets tanpa akses email reliable
- Extra security layer

---

## Related Documentation

- [Supabase Auth Email Confirmations](https://supabase.com/docs/guides/auth/auth-email-confirmation)
- [Resend SMTP Documentation](https://resend.com/docs/send-with-nodemailer-smtp)
- [Supabase Custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp)
- `FUTURE_UPDATES.md` — Fitur #8: Verifikasi Email

---

## Changelog

| Date | Author | Changes |
|---|---|---|
| 2026-09-01 | Kiro | Initial documentation |

---

**Status:** ✅ Ready for implementation
