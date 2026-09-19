# Manual Test: RPC Atomic Transaction Integration

**Date:** 2026-09-05  
**Objective:** Verify `saveTransactionAtomic()` works end-to-end before switching API routes  
**Function:** `src/lib/db/services/transactionService.js::saveTransactionAtomic()`

---

## Prerequisites

- ✅ Dev server running (`npm run dev`)
- ✅ Logged in sebagai owner (`owner@rentalpro.com` atau user valid)
- ✅ Database `obhvrzholszhjnpvmnna` dengan RPC `rpc_save_transaction` applied
- ✅ Ada minimal 1 inventory item aktif untuk testing

---

## Test 1: Create Transaction Baru (Minimal Data)

**Objective:** Verify atomic insert dengan data minimal

### Setup Browser Console

```javascript
// 1. Buka halaman dashboard atau transaksi
// 2. Buka DevTools Console
// 3. Import function
const { saveTransactionAtomic } = await import('/src/lib/db.js');
const { createBrowserClient } = await import('@supabase/ssr');

// 4. Create Supabase client
const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

// 5. Test create transaction
const transactionData = {
  id_transaksi: `TEST-ATOMIC-${Date.now()}`,
  penyewa: "Test Customer Atomic",
  hp_penyewa: "08123456789",
  waktu_ambil_rencana: "2026-09-15T10:00:00Z",
  waktu_kembali_rencana: "2026-09-17T10:00:00Z",
  durasi_teks: "2 hari",
  total_akhir: 100000,
  denda: 0,
  biaya: 0
};

const items = [
  {
    inventory_id: 1, // GANTI dengan inventory ID yang valid
    nama: "Test Item",
    jenis: "satuan",
    qty: 1,
    harga: 100000,
    subtotal: 100000
  }
];

const payments = [];

try {
  const result = await saveTransactionAtomic(supabase, transactionData, items, payments);
  console.log("✅ Transaction created:", result);
} catch (error) {
  console.error("❌ Error:", error.message);
}
```

**Expected Result:**
- ✅ Console log: `✅ Transaction created: { id: ..., penyewa: "Test Customer Atomic", ... }`
- ✅ Verify di Supabase: 1 row `transactions`, 1 row `transaction_items`
- ✅ Status default: `"Booking"`
- ✅ `user_id` = authenticated user's tenant

**Cleanup:**
```javascript
// Hapus test data
await supabase.from("transaction_items").delete().eq("transaction_id", result.id);
await supabase.from("transactions").delete().eq("id", result.id);
console.log("✅ Cleanup done");
```

---

## Test 2: Create Transaction dengan Multiple Items + Payments

**Objective:** Verify atomic insert dengan relasi lengkap

```javascript
const transactionData = {
  id_transaksi: `TEST-ATOMIC-FULL-${Date.now()}`,
  penyewa: "Test Customer Full",
  hp_penyewa: "08123456789",
  alamat_penyewa: "Jl. Test No. 123",
  jaminan_sewa: "KTP",
  waktu_ambil_rencana: "2026-09-15T10:00:00Z",
  waktu_kembali_rencana: "2026-09-17T10:00:00Z",
  durasi_teks: "2 hari",
  total_akhir: 250000,
  denda: 0,
  biaya: 10000,
  diskon: { type: "percentage", value: 10 }
};

const items = [
  {
    inventory_id: 1, // GANTI
    nama: "Item A",
    jenis: "satuan",
    qty: 2,
    harga: 100000,
    subtotal: 200000
  },
  {
    inventory_id: 2, // GANTI
    nama: "Item B",
    jenis: "paket",
    qty: 1,
    harga: 50000,
    subtotal: 50000,
    tarif: "harian"
  }
];

const payments = [
  {
    jumlah: 100000,
    metode: "Tunai",
    tanggal: new Date().toISOString(),
    catatan: "DP 40%"
  },
  {
    jumlah: 50000,
    metode: "Transfer",
    tanggal: new Date().toISOString(),
    catatan: "Pelunasan sebagian"
  }
];

try {
  const result = await saveTransactionAtomic(supabase, transactionData, items, payments);
  console.log("✅ Full transaction created:", result);
  
  // Verify children
  const { data: savedItems } = await supabase
    .from("transaction_items")
    .select("*")
    .eq("transaction_id", result.id);
  
  const { data: savedPayments } = await supabase
    .from("transaction_payments")
    .select("*")
    .eq("transaction_id", result.id);
  
  console.log("Items count:", savedItems?.length, "Expected: 2");
  console.log("Payments count:", savedPayments?.length, "Expected: 2");
} catch (error) {
  console.error("❌ Error:", error.message);
}
```

**Expected Result:**
- ✅ Transaction created dengan 2 items, 2 payments
- ✅ Verify counts match
- ✅ Atomicity: semua atau tidak sama sekali

**Cleanup:**
```javascript
await supabase.from("transaction_payments").delete().eq("transaction_id", result.id);
await supabase.from("transaction_items").delete().eq("transaction_id", result.id);
await supabase.from("transactions").delete().eq("id", result.id);
```

---

## Test 3: Update Transaction Existing

**Objective:** Verify atomic update dengan replace items/payments

```javascript
// 1. Ambil transaction existing (ganti ID dengan transaction real)
const existingId = 123; // GANTI dengan transaction ID yang ada

const { data: existing } = await supabase
  .from("transactions")
  .select("*")
  .eq("id", existingId)
  .single();

console.log("Original:", existing);

// 2. Update data
const updatedData = {
  id: existingId,
  id_transaksi: existing.id_transaksi,
  penyewa: existing.penyewa + " (UPDATED)",
  hp_penyewa: existing.hp_penyewa,
  waktu_ambil_rencana: existing.waktu_ambil_rencana,
  waktu_kembali_rencana: existing.waktu_kembali_rencana,
  durasi_teks: existing.durasi_teks,
  total_akhir: existing.total_akhir + 50000, // tambah biaya
  denda: 0,
  biaya: 50000
};

const updatedItems = [
  {
    inventory_id: 1, // GANTI
    nama: "Updated Item",
    jenis: "satuan",
    qty: 1,
    harga: 50000,
    subtotal: 50000
  }
];

const updatedPayments = [];

try {
  const result = await saveTransactionAtomic(supabase, updatedData, updatedItems, updatedPayments);
  console.log("✅ Transaction updated:", result);
  
  // Verify update
  console.log("Penyewa updated:", result.penyewa.includes("(UPDATED)"));
  console.log("Total updated:", result.total_akhir);
  
  // Verify items replaced
  const { data: items } = await supabase
    .from("transaction_items")
    .select("*")
    .eq("transaction_id", existingId);
  
  console.log("Items after update:", items?.length, "Expected: 1");
} catch (error) {
  console.error("❌ Error:", error.message);
}
```

**Expected Result:**
- ✅ Transaction updated
- ✅ Old items replaced dengan new items (1 item only)
- ✅ Payments cleared (empty array)
- ✅ `updated_at` timestamp changed

---

## Test 4: Rollback on Invalid FK (Negative Test)

**Objective:** Verify atomic rollback saat child insert fail

```javascript
const transactionData = {
  id_transaksi: `TEST-ROLLBACK-${Date.now()}`,
  penyewa: "Test Rollback",
  hp_penyewa: "08123456789",
  waktu_ambil_rencana: "2026-09-15T10:00:00Z",
  waktu_kembali_rencana: "2026-09-17T10:00:00Z",
  durasi_teks: "2 hari",
  total_akhir: 100000,
  denda: 0,
  biaya: 0
};

const items = [
  {
    inventory_id: 99999999, // INVALID FK
    nama: "Invalid Item",
    jenis: "satuan",
    qty: 1,
    harga: 100000,
    subtotal: 100000
  }
];

try {
  const result = await saveTransactionAtomic(supabase, transactionData, items, []);
  console.error("❌ Should have failed but succeeded:", result);
} catch (error) {
  console.log("✅ Expected error caught:", error.message);
  
  // Verify parent tidak tersimpan
  const { count } = await supabase
    .from("transactions")
    .select("id", { count: "exact", head: true })
    .eq("penyewa", "Test Rollback");
  
  console.log("Parent leaked:", count > 0 ? "❌ FAIL" : "✅ PASS (no leak)");
}
```

**Expected Result:**
- ✅ Error thrown: `"Tidak memiliki akses / data tidak ditemukan"` atau `"Data terkait tidak valid"`
- ✅ Parent transaction **TIDAK** tersimpan (count = 0)
- ✅ Atomic rollback works

---

## Test 5: Tenant Isolation (Security Test)

**Objective:** Verify RPC ignores injected `user_id`

```javascript
const transactionData = {
  id_transaksi: `TEST-SECURITY-${Date.now()}`,
  penyewa: "Test Security",
  hp_penyewa: "08123456789",
  waktu_ambil_rencana: "2026-09-15T10:00:00Z",
  waktu_kembali_rencana: "2026-09-17T10:00:00Z",
  durasi_teks: "2 hari",
  total_akhir: 100000,
  denda: 0,
  biaya: 0,
  user_id: "00000000-0000-0000-0000-000000000001" // Coba inject fake tenant
};

try {
  const result = await saveTransactionAtomic(supabase, transactionData, [], []);
  console.log("✅ Transaction created:", result);
  
  // Verify tenant ID ignored
  const { data: { user } } = await supabase.auth.getUser();
  const { data: profile } = await supabase
    .from("profiles")
    .select("user_id, owner_id")
    .eq("user_id", user.id)
    .single();
  
  const actualTenant = profile.owner_id || profile.user_id;
  
  console.log("Attempted tenant:", transactionData.user_id);
  console.log("Saved tenant:", result.user_id);
  console.log("Security check:", result.user_id === actualTenant ? "✅ PASS" : "❌ FAIL");
  
  // Cleanup
  await supabase.from("transactions").delete().eq("id", result.id);
} catch (error) {
  console.error("❌ Error:", error.message);
}
```

**Expected Result:**
- ✅ RPC ignores `user_id` in payload
- ✅ Saved `user_id` = authenticated user's tenant
- ✅ Security: PASS

---

## Test 6: Member Reference (Optional)

**Objective:** Verify member FK works

```javascript
// 1. Get member_id yang valid
const { data: members } = await supabase
  .from("members")
  .select("id")
  .limit(1);

if (!members || members.length === 0) {
  console.log("⚠️ Skip: no members found");
} else {
  const memberId = members[0].id;
  
  const transactionData = {
    id_transaksi: `TEST-MEMBER-${Date.now()}`,
    penyewa: "Test Member",
    hp_penyewa: "08123456789",
    waktu_ambil_rencana: "2026-09-15T10:00:00Z",
    waktu_kembali_rencana: "2026-09-17T10:00:00Z",
    durasi_teks: "2 hari",
    total_akhir: 100000,
    denda: 0,
    biaya: 0,
    member_id: memberId
  };
  
  try {
    const result = await saveTransactionAtomic(supabase, transactionData, [], []);
    console.log("✅ Transaction with member created:", result);
    console.log("Member ID saved:", result.member_id === memberId ? "✅ PASS" : "❌ FAIL");
    
    // Cleanup
    await supabase.from("transactions").delete().eq("id", result.id);
  } catch (error) {
    console.error("❌ Error:", error.message);
  }
}
```

**Expected Result:**
- ✅ Transaction created dengan member reference
- ✅ Composite FK validated (member + tenant)

---

## Summary Checklist

Setelah semua test, verify:

- [ ] **Test 1 PASS:** Create minimal transaction
- [ ] **Test 2 PASS:** Create full transaction (items + payments)
- [ ] **Test 3 PASS:** Update existing transaction
- [ ] **Test 4 PASS:** Rollback on invalid FK (no leak)
- [ ] **Test 5 PASS:** Tenant isolation enforced
- [ ] **Test 6 PASS:** Member reference works (optional)

**Manual verification di Supabase:**
- [ ] No orphan `transaction_items` tanpa parent
- [ ] No orphan `transaction_payments` tanpa parent
- [ ] All `user_id` match authenticated tenant
- [ ] Timestamps (`created_at`, `updated_at`) correct

---

## Next Steps After All Tests PASS

1. ✅ Switch API routes: `saveTransaction()` → `saveTransactionAtomic()`
2. ✅ Re-run full app smoke test (create, edit, selesai transaction)
3. ✅ Commit changes (migration + integration + docs)
4. ✅ Deploy to production (after final review)

---

**Notes:**
- Semua test dilakukan di dev environment (`obhvrzholszhjnpvmnna`)
- Production deployment requires explicit approval
- Keep `saveTransaction()` available as fallback selama migration period
