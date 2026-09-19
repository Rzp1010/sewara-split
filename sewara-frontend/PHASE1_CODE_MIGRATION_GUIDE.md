# Phase 1 Code Migration Guide

**Status:** DB migration completed ✅  
**Next:** Update application code to use snake_case columns  
**Estimated time:** 2-3 hours

---

## Column Mapping (camelCase → snake_case)

### transactions table

| Old (camelCase) | New (snake_case) | Type | Notes |
|---|---|---|---|
| `noInvoice` | `no_invoice` | TEXT | Invoice number |
| `hpPenyewa` | `hp_penyewa` | TEXT | Customer phone |
| `alamatPenyewa` | `alamat_penyewa` | TEXT | Customer address |
| `totalAkhir` | `total_akhir` | NUMERIC | Final total |
| `waktuAmbilRencana` | `waktu_ambil_rencana` | TIMESTAMPTZ | Planned pickup |
| `waktuAmbil` | `waktu_ambil` | TIMESTAMPTZ | Actual pickup |
| `waktuKembaliRencana` | `waktu_kembali_rencana` | TIMESTAMPTZ | Planned return |
| `waktuKembali` | `waktu_kembali` | TIMESTAMPTZ | Actual return |
| `totalBayar` | `total_bayar` | NUMERIC | Total paid |
| `totalDenda` | `total_denda` | NUMERIC | Total penalty |
| `waktuDibuat` | `waktu_dibuat` | TIMESTAMPTZ | Created at |
| `waktuUpdate` | `waktu_update` | TIMESTAMPTZ | Updated at |
| — | `member_id` | UUID | NEW: Member FK (nullable) |

**Columns unchanged:**
- `id`, `user_id`, `penyewa`, `status`, `items`, `pembayaran`, `catatan`, `jaminan_sewa`, `biaya_dasar`, `denda_tambahan`, `created_at`, `waktu_kembali_aktual`

---

## Files to Update

### 1. Core Database Layer

**File:** `src/lib/db.js` (1218 lines)

**Occurrences to replace:**

```javascript
// Line 46: getTransactionsRingkas
"id,noInvoice,penyewa,status,totalAkhir,biayaDasar,dendaTambahan,waktuAmbilRencana,waktuKembaliRencana,waktuKembaliAktual"
// Change to:
"id,no_invoice,penyewa,status,total_akhir,biaya_dasar,denda_tambahan,waktu_ambil_rencana,waktu_kembali_rencana,waktu_kembali_aktual"

// Search pattern: All select/insert/update operations using:
- noInvoice
- hpPenyewa
- alamatPenyewa
- totalAkhir
- waktuAmbilRencana
- waktuAmbil
- waktuKembaliRencana
- waktuKembali
- totalBayar
- totalDenda
- waktuDibuat
- waktuUpdate
```

**Strategy:**
1. Use find-replace with whole word match
2. Replace in all `.select()`, `.insert()`, `.update()`, `.eq()` calls
3. Replace in object property access (e.g., `transaksi.noInvoice` → `transaksi.no_invoice`)
4. Replace in object construction for insert/update

### 2. Dashboard Pages

#### A. `src/app/dashboard/booking/page.js` (220 lines)

**Key areas:**
- Transaction object construction for insert
- Display of invoice, customer phone, dates
- Form data mapping to DB columns

**Common patterns:**
```javascript
// Insert/update
noInvoice: formData.invoice
// Change to:
no_invoice: formData.invoice

// Display
transaction.noInvoice
// Change to:
transaction.no_invoice
```

#### B. `src/app/dashboard/status/page.js` (180 lines)

**Key areas:**
- Transaction list display
- Status board filtering
- Date range displays (waktuAmbilRencana, waktuKembaliRencana)

#### C. `src/app/dashboard/kalender/page.js`

**Key areas:**
- Calendar event mapping
- Date field access for pickup/return schedules

#### D. `src/app/dashboard/riwayat/page.js`

**Key areas:**
- Transaction history display
- Invoice number display
- Date sorting

#### E. `src/app/dashboard/laporan/page.js`

**Key areas:**
- Report calculations
- Payment summaries (totalBayar, totalDenda)
- Date filtering

#### F. `src/app/dashboard/tracking/page.js`

**Key areas:**
- Active transaction tracking
- Timeline displays using waktu_* fields

#### G. `src/app/dashboard/pelanggan/page.js`

**Key areas:**
- Customer transaction history
- Phone number display (hpPenyewa → hp_penyewa)
- Address display (alamatPenyewa → alamat_penyewa)

#### H. Any other files using transaction fields

**Search globally:**
```bash
# Find all files referencing camelCase fields
rg "noInvoice|hpPenyewa|alamatPenyewa|totalAkhir|waktuAmbil|waktuKembali|totalBayar|totalDenda" --type ts --type tsx --type js
```

---

## Search & Replace Strategy

### Step 1: Global Search (Discovery)

```bash
cd E:\Aplikasi Inventory\sewara-apps

# Find all occurrences
rg "noInvoice" src/
rg "hpPenyewa" src/
rg "alamatPenyewa" src/
rg "totalAkhir" src/
rg "waktuAmbilRencana" src/
rg "waktuAmbil(?!Rencana)" src/  # waktuAmbil but not waktuAmbilRencana
rg "waktuKembaliRencana" src/
rg "waktuKembali(?!Rencana|Aktual)" src/  # waktuKembali but not others
rg "totalBayar" src/
rg "totalDenda" src/
rg "waktuDibuat" src/
rg "waktuUpdate" src/
```

### Step 2: Automated Replace (with verification)

**Option A: VS Code Find & Replace**
- Use Regex mode
- Replace whole words only
- Verify each replacement visually

**Option B: Use sed/PowerShell (risky, need backup)**
```powershell
# Example for one file
(Get-Content src/lib/db.js) -replace '\bnoInvoice\b', 'no_invoice' | Set-Content src/lib/db.js
```

**Recommended:** Manual or semi-automated with visual verification per file.

### Step 3: Test After Each File

```bash
npm run build
```

Stop immediately if build fails. Fix before continuing.

---

## Common Patterns to Replace

### 1. Select queries

```javascript
// OLD
.select("noInvoice,hpPenyewa,totalAkhir")

// NEW
.select("no_invoice,hp_penyewa,total_akhir")
```

### 2. Object property access

```javascript
// OLD
transaction.noInvoice
transaction.waktuAmbilRencana

// NEW
transaction.no_invoice
transaction.waktu_ambil_rencana
```

### 3. Insert/Update objects

```javascript
// OLD
{
  noInvoice: invoice,
  hpPenyewa: phone,
  totalAkhir: total
}

// NEW
{
  no_invoice: invoice,
  hp_penyewa: phone,
  total_akhir: total
}
```

### 4. Filter/where conditions

```javascript
// OLD
.eq("noInvoice", invoice)
.gte("waktuAmbilRencana", startDate)

// NEW
.eq("no_invoice", invoice)
.gte("waktu_ambil_rencana", startDate)
```

### 5. Order by

```javascript
// OLD
.order("waktuAmbilRencana", { ascending: false })

// NEW
.order("waktu_ambil_rencana", { ascending: false })
```

---

## Special Cases to Watch

### 1. String interpolation

```javascript
// OLD
console.log(`Invoice: ${transaction.noInvoice}`)

// NEW
console.log(`Invoice: ${transaction.no_invoice}`)
```

### 2. Destructuring

```javascript
// OLD
const { noInvoice, hpPenyewa, totalAkhir } = transaction;

// NEW
const { no_invoice, hp_penyewa, total_akhir } = transaction;
```

### 3. Spread operators

```javascript
// OLD
{ ...existingData, noInvoice: newInvoice }

// NEW
{ ...existingData, no_invoice: newInvoice }
```

### 4. Array methods

```javascript
// OLD
transactions.filter(t => t.totalAkhir > 1000000)

// NEW
transactions.filter(t => t.total_akhir > 1000000)
```

---

## Verification Checklist

After each file update:

- [ ] **Build:** `npm run build` — no errors
- [ ] **Lint:** Check for TypeScript/ESLint warnings
- [ ] **Visual:** Review changed lines in git diff
- [ ] **Logic:** Ensure no broken references

After all files updated:

- [ ] **Local test:** `npm run dev`
  - [ ] Login
  - [ ] Dashboard loads
  - [ ] Status page displays transactions
  - [ ] Booking form works
  - [ ] Kalender shows events
  - [ ] Laporan displays data
  - [ ] Pelanggan shows customer info
  - [ ] No console errors

---

## Rollback Plan

If code update fails:

```bash
git diff src/  # Review changes
git checkout src/  # Discard all changes
git status  # Verify clean
```

Or revert specific file:

```bash
git checkout src/lib/db.js
```

---

## Execution Order (Recommended)

1. **Start with `db.js`** (core layer)
   - Update all select/insert/update
   - Build test
   - Commit: "refactor: Update db.js to use snake_case transaction columns"

2. **Update dashboard pages one by one:**
   - `booking/page.js` → test → commit
   - `status/page.js` → test → commit
   - `kalender/page.js` → test → commit
   - `riwayat/page.js` → test → commit
   - `laporan/page.js` → test → commit
   - `tracking/page.js` → test → commit
   - `pelanggan/page.js` → test → commit

3. **Search for remaining references:**
   ```bash
   rg "noInvoice|hpPenyewa|totalAkhir" src/
   ```
   
4. **Full build & test:**
   ```bash
   npm run build
   npm run dev
   # Manual smoke test all pages
   ```

5. **Deploy production:**
   ```bash
   git push origin master
   npx vercel --prod --yes
   ```

---

## Tips

- **Use IDE search:** VS Code/Cursor "Find in Files" with regex
- **Commit often:** One logical unit per commit
- **Test incrementally:** Don't wait until all files changed
- **Watch console:** Browser DevTools for runtime errors
- **Keep checklist:** Mark each file as done

---

## Estimated Time Breakdown

| Task | Time |
|---|---:|
| db.js update | 30-45 min |
| booking/page.js | 15-20 min |
| status/page.js | 15-20 min |
| kalender/page.js | 10-15 min |
| riwayat/page.js | 10-15 min |
| laporan/page.js | 10-15 min |
| tracking/page.js | 10-15 min |
| pelanggan/page.js | 10-15 min |
| Other files (if any) | 10-20 min |
| Build & test | 20-30 min |
| Deploy & verify | 10-15 min |
| **Total** | **2-3 hours** |

---

## Ready to Execute?

**Prerequisites:**
- [x] DB migration Phase 1 completed
- [x] RLS smoke test passed (pending)
- [x] Build test passed (pending)
- [ ] Ready to start code update

**Next:** Start with `src/lib/db.js` file update.

Ping orchestrator when ready to begin code changes! 🚀
