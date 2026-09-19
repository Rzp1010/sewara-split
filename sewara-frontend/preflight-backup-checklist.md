# Preflight Backup & Checks
**Tanggal:** 27 Agustus 2026
**Waktu mulai:** _______
**Supabase Project:** obhvrzholszhjnpvmnna

---

## 1. Backup Database

### Via Supabase Dashboard

1. Buka https://supabase.com/dashboard/project/obhvrzholszhjnpvmnna
2. Klik **Settings** (kiri bawah)
3. Klik **Database** → **Backups**
4. Klik **Create backup** atau tunggu daily backup selesai
5. Screenshot timestamp backup
6. ✅ **Backup selesai:** _______

---

## 2. Preflight Row Count

### Jalankan di Supabase SQL Editor

```sql
-- Preflight Row Count
-- Simpan hasil ini ke file preflight-rowcount.txt

SELECT 'admin_logs' AS table_name, COUNT(*) AS row_count FROM admin_logs
UNION ALL
SELECT 'app_config', COUNT(*) FROM app_config
UNION ALL
SELECT 'inventory', COUNT(*) FROM inventory
UNION ALL
SELECT 'login_logs', COUNT(*) FROM login_logs
UNION ALL
SELECT 'logs', COUNT(*) FROM logs
UNION ALL
SELECT 'member_templates', COUNT(*) FROM member_templates
UNION ALL
SELECT 'members', COUNT(*) FROM members
UNION ALL
SELECT 'profiles', COUNT(*) FROM profiles
UNION ALL
SELECT 'promo_codes', COUNT(*) FROM promo_codes
UNION ALL
SELECT 'settings', COUNT(*) FROM settings
UNION ALL
SELECT 'transactions', COUNT(*) FROM transactions
UNION ALL
SELECT 'versi_akun', COUNT(*) FROM versi_akun
ORDER BY table_name;
```

### Hasil (copy paste):

```
| table_name       | row_count |
|------------------|-----------|
| admin_logs       |           |
| app_config       |           |
| inventory        |           |
| login_logs       |           |
| logs             |           |
| member_templates |           |
| members          |           |
| profiles         |           |
| promo_codes      |           |
| settings         |           |
| transactions     |           |
| versi_akun       |           |
```

✅ **Row count tercatat:** _______

---

## 3. Preflight Schema - Transactions

```sql
-- Preflight Schema Check: transactions
-- Jalankan untuk cek nama kolom aktual

SELECT 
  column_name, 
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns 
WHERE table_schema = 'public'
  AND table_name = 'transactions' 
ORDER BY ordinal_position;
```

### Hasil (copy kolom penting):

```
Kolom camelCase yang ditemukan:
- [ ] noInvoice
- [ ] hpPenyewa
- [ ] alamatPenyewa
- [ ] jaminanSewa
- [ ] waktuAmbilRencana
- [ ] waktuKembaliRencana
- [ ] waktuAmbilAktual
- [ ] waktuKembaliAktual
- [ ] durasiTeks
- [ ] biayaDasar
- [ ] dendaTambahan
- [ ] totalAkhir
- [ ] riwayatDilayani

Kolom snake_case yang ditemukan:
- [ ] hp_penyewa
- [ ] alamat_penyewa
- [ ] jaminan_sewa
- [ ] waktu_ambil_rencana
- [ ] waktu_kembali_rencana
- [ ] waktu_ambil_aktual
- [ ] waktu_kembali_aktual
- [ ] durasi_teks
- [ ] biaya
- [ ] denda
```

✅ **Schema transactions tercatat:** _______

---

## 4. Preflight Schema - Inventory

```sql
-- Preflight Schema Check: inventory

SELECT 
  column_name, 
  data_type
FROM information_schema.columns 
WHERE table_schema = 'public'
  AND table_name = 'inventory' 
ORDER BY ordinal_position;
```

### Hasil:

```
Kolom yang ditemukan:
- [ ] nama atau name?
- [ ] tipeSewa ada?
- [ ] kondisi ada?
- [ ] keterangan ada?
- [ ] tag ada?
```

✅ **Schema inventory tercatat:** _______

---

## 5. Preflight Schema - Members

```sql
-- Preflight Schema Check: members

SELECT 
  column_name, 
  data_type
FROM information_schema.columns 
WHERE table_schema = 'public'
  AND table_name = 'members' 
ORDER BY ordinal_position;
```

### Hasil:

```
Kolom yang ditemukan:
- [ ] hp ada?
- [ ] email ada?
- [ ] alamat ada?
- [ ] foto_jaminan ada? (tipe JSONB?)
- [ ] catatan ada?
- [ ] tipe_id ada?
```

✅ **Schema members tercatat:** _______

---

## 6. RLS Smoke Test

```bash
cd E:\Aplikasi Inventory\sewara-apps
node scripts/test-rls-isolation.js
```

### Hasil:

```
- [ ] Test passed
- [ ] Test failed (catat error)
```

✅ **RLS test selesai:** _______

---

## 7. Build Test

```bash
npm run build
```

### Hasil:

```
- [ ] Build success
- [ ] Build failed (catat error)
```

✅ **Build test selesai:** _______

---

## Kesimpulan Preflight

- [ ] ✅ Backup database tersimpan
- [ ] ✅ Row count 12 tabel tercatat
- [ ] ✅ Schema transactions tercatat (ada kolom duplikat camelCase/snake_case?)
- [ ] ✅ Schema inventory tercatat
- [ ] ✅ Schema members tercatat
- [ ] ✅ RLS test passed
- [ ] ✅ Build test passed

**Status:** SIAP / TIDAK SIAP untuk Phase 1

**Waktu selesai:** _______

---

## Catatan Tambahan

(Tulis temuan penting di sini)
