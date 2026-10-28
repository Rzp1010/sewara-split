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

Setelah 3-4 route lagi, keputusan sqlc (vs hand-written SQL).
