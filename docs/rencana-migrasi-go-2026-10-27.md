## 21. W1 akhir: route bisnis pertama + audit keamanan (2026-10-28)

Dua route bisnis selesai dan teruji: `/api/settings` dan `/api/member-types`.

### 21.1 Settings CRUD

| Berkas | Isi |
|---|---|
| `internal/db/settings.go` | GetSettings, GetSettingByKey, UpsertSettings |
| `internal/httpapi/handlers_settings.go` | GET all/by key, POST single/array |

**Role-based access:**
- Staf hanya boleh tulis `KEY_STAF` (kalender_selesai, bukti_backup_ack)
- Key privat (telegram_login_notif, webhook_sheets, invoice_*, cari_sembunyikan_riwayat) hidden dari staf GET
- Owner/superadmin bebas baca/tulis semua

**Smoke test: 12/12 lolos** (auth, CRUD, role owner/staf, tenant isolation)

### 21.2 Member Types CRUD

| Berkas | Isi |
|---|---|
| `internal/db/member_types.go` | GetMemberTypes, InsertMemberType |
| `internal/httpapi/handlers_member_types.go` | GET all (order nama), POST |

**Schema:** `(id, user_id, nama, diskon_persen, status, created_at, diskon_durasi_aturan jsonb)`

**Smoke test: 8/8 lolos** (auth, CRUD, tenant isolation A/B)

### 21.3 Docker staging improvements

`scripts/docker-staging.ps1` sekarang:
- Auto-load seed `staging_seed.sql` saat container dibuat
- Reset sequence `member_types_id_seq` setelah seed (hindari duplicate key)
- Password hash bcrypt untuk owner A & B di auth.users

### 21.4 Audit keamanan, efisiensi, maintainability

**Keamanan (SOLID ✅):**
- SQL injection: 0 — semua query parameterized
- Password: bcrypt cost 10, tidak pernah di-log
- Cookie: HttpOnly + SameSite Lax + Secure (prod)
- RLS enforcement: InTenant konsisten, role authenticated
- Input validation: body size limit (1MB settings, 4KB login)
- Session: SHA-256 hash stored, token 32 byte random
- Error leak: minimal — internal error tidak ekspos ke client

**Efisiensi (BAIK ✅):**
- Connection pool: MaxConns=10 (VPS 1GB), MinConns=1, lifetime 30m, idle 5m
- N+1 query: 1 temuan minor — `UpsertSettings` loop INSERT (acceptable, jarang >10 items)
- Transaction scope: sempit, auto-rollback defer
- Index: belum ada, tambah nanti: `CREATE INDEX idx_member_types_user_nama ON member_types(user_id, nama)`

**Maintainability (7/10 ⚠️):**
- `handleLogin`: **159 baris** — terlalu panjang, perlu refactor jadi helper functions
  - Kandidat: `validateLoginInput()`, `checkAccountStatus()`, `verifyCredentials()`
- `handleSettingsPost`: 93 baris — borderline acceptable
- `requireAuth`: 55 baris — borderline
- Error handling: 34 checks, pattern konsisten
- Logging: structured slog, semua error tercatat
- Panic/Exit: hanya di recovery middleware + main (aman)

**Keputusan:** Refactor `handleLogin` ditunda sampai punya 3-4 route mirip (pola lebih jelas). Kode sudah production-ready untuk staging.

### 21.5 Metrics W1 akhir

| Metric | Nilai |
|---|---|
| Total skenario teruji | 38 (auth 18, settings 12, member-types 8) |
| Baris Go | ~55KB (18 file) |
| Dependencies | 2 direct (pgx, crypto), 5 indirect |
| Route bisnis | 2 (settings, member-types) |
| Security holes | 0 |
| Commits hari ini | 5 (login, Docker staging, settings, member-types, audit) |

### 21.6 Berikutnya

Route bisnis ke-3 dan seterusnya. Kandidat (urut mudah → susah):
1. GET routes read-only (inventaris list, penyewa list)
2. POST/PATCH dengan validasi (inventaris CRUD + bundling)
3. DELETE soft-delete (inventaris status deleted)

Setelah 3-4 route lagi, keputusan sqlc (vs hand-written SQL). → **diputuskan di §22.3**

---

## 22. Route bisnis berikutnya + keputusan sqlc (2026-10-28)

Empat route lagi selesai dan teruji: `/api/profiles`, `/api/dashboard`,
`/api/inventory` (GET+POST). Total skenario teruji naik dari 38 → 72.

### 22.1 Bug JSON tag (temuan paling penting W1)

Struct Go tanpa `json` tag diserialisasi dengan nama field Go (PascalCase):
`{"UserID":"...","Email":"..."}`. Frontend membaca snake_case
(`user_id`, `email`) sesuai bentuk PostgREST, jadi **setiap** respons yang
memakai struct tanpa tag akan tampak "kosong" di UI tanpa error HTTP apa pun.

Diperbaiki pada `Profile`, `MemberType`, `Setting`. `InventoryItem` dan
`InventoryRingkas` ditulis dengan tag sejak awal.

**Aturan sekarang:** setiap struct yang keluar ke client wajib punya tag
`json:"snake_case"` — kecuali nama kolomnya memang camelCase di skema
(`tipeSewa`), yang harus disalin apa adanya.

**Pelajaran untuk smoke test:** memeriksa status code tidak cukup. Assertion
harus memeriksa **nama field**. Catatan jebakan PowerShell: `-match`/`-notmatch`
case-insensitive, sehingga `-notmatch '"TipeSewa"'` selalu gagal karena cocok
dengan `"tipeSewa"`; gunakan `-cmatch`/`-cnotmatch`.

### 22.2 Rute baru

| Route | Berkas | Skenario |
|---|---|---|
| `GET /api/profiles` (+`?email=`) | `db/profiles.go`, `handlers_profiles.go` | 8 |
| `GET /api/dashboard` (+`?mulai=`,`?akhir=`) | `db/dashboard.go`, `handlers_dashboard.go` | 6 |
| `GET/POST /api/inventory` | `db/inventory.go`, `handlers_inventory.go` | 20 |

**Cakupan baris profiles ditentukan RLS, bukan filter handler.**
`profiles_select_allowed` = `(user_id = auth.uid()) OR superadmin OR (owner_id = auth.uid())`.
Konsekuensinya: CS melihat 1 baris (dirinya), owner 2 (dirinya + stafnya),
superadmin semua. Ekspektasi "staf bisa melihat atasannya" **salah** — jangan
"diperbaiki" di handler; itu perilaku policy.

**Dashboard** memakai dua RPC (`rpc_dashboard_rekap_status`,
`rpc_dashboard_pembayaran`) yang `SECURITY DEFINER` dan memeriksa sendiri bahwa
`p_user_id` adalah tenant pemanggil. Guard itu dipertahankan: kalau konteks
tenant di Go salah, database yang menolak.

**Inventory** — dua deviasi positif yang disengaja:
- `?kolom=` (pemilihan kolom dinamis) **ditolak 400**. Nilainya dulu disambung
  langsung ke daftar kolom SELECT; bentuk amannya hanya daftar putih tetap.
  Frontend tidak memakainya untuk inventory (hanya transactions).
- Pelanggaran enum (`jenis`, `kondisi`) dan `nama` kosong dibalas **400**, bukan
  500 dari database.
- `denda` dideklarasikan `text` di skema tetapi frontend mengirim **angka**
  (hasil `parseInt` di form dan CSV). `inventoryBody.Denda` karena itu
  `json.RawMessage` + `jsonText()`, supaya kedua bentuk diterima dan tersimpan
  sebagai teks ("5000").
- `?ids=` kosong = filter kosong → **nol baris**, bukan seluruh katalog
  (`q.Has("ids")`, bukan `q.Get("ids") == ""`). Ini bug yang tertangkap smoke
  test sebelum commit.
- `id` tidak pernah dari client: `DEFAULT nextval(inventory_id_seq)`.
  `user_id` diisi tenant (`owner_id` staf), dan RLS `WITH CHECK` menolak tenant lain.

### 22.3 Keputusan sqlc: TIDAK diadopsi (dengan bukti)

Pengukuran pada 5 route yang sudah ada:

| Metrik | Nilai |
|---|---|
| Query hand-written | 29 |
| Baris `internal/db` | 772 |
| CAST `::text`/`::uuid`/`::timestamptz` | 35 |
| Field nullable (`*string`, `*time.Time`) | 21 |
| Bug SQL sejak awal | **0** |
| Bug yang pernah terjadi | 1 — JSON tag (bukan SQL) |

Alasan penolakan:
1. **Tidak ada masalah yang mau disembuhkan.** 29 query, 0 bug SQL.
2. **CAST `::text` jadi friksi.** sqlc menginfer `uuid` → `pgtype.UUID`, bukan
   `string`, sementara frontend butuh string. Butuh override per kolom.
3. **21 field nullable tetap pointer manual** — sqlc tidak menghilangkannya.
4. **Query dinamis tidak bisa digenerate** (`UpsertSettings` loop per baris,
   parameter NULL opsional dashboard), jadi hasilnya campuran dua pola.
5. **Biaya rewrite** 772 baris + 7 handler + 6 smoke test untuk mencegah 0 bug.

**Pemicu tinjau ulang (salah satu):** query >60; ≥2 bug kelas kolom/tipe yang
lolos ke runtime; satu file route butuh 6–8 query sendiri (kandidat:
`transactions`); skema berubah >3× per minggu setelah cutover.

Ini keputusan **tingkat codebase**, bukan tingkat fitur: sqlc menghemat tenaga
per query, dan tenaga itu baru mahal saat jumlah query besar. Query dinamis,
panggilan RPC, dan query 3 baris tidak akan pernah untung dengan generator.

### 22.4 Metrics setelah §22

| Metric | Nilai |
|---|---|
| Total skenario teruji | 72 (login 18, settings 12, member-types 8, profiles 8, dashboard 6, inventory 20) |
| Route bisnis | 5 (settings, member-types, profiles, dashboard, inventory) |
| Query hand-written | 31 |
| Security holes | 0 |

### 22.5 Berikutnya

1. `PATCH/DELETE /api/inventory/[id]` + `POST /api/inventory/bulk-delete`
2. `GET/POST /api/inventory-units`
3. `GET/POST /api/members` (mulai butuh cross-check blacklist)
