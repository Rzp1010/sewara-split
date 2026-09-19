# Struktur SQL Sewara (DB: obhvrzholszhjnpvmnna)

Audit live 2026-09-13 via `scripts/audit-live-db.mjs` (OpenAPI spec + service role).

- **`migrations/`** — SOURCE OF TRUTH. Migration terverifikasi live, urut tanggal prefix.
- **`archive/`** — file superseded/invalid: duplikat, target DB lain (produksi `wbujlusshrrvkjjxkhtj` / tester `srgmeoipuybrkhsxmtsf`), atau digantikan file di `migrations/`. **Jangan dijalankan.**
- **Root `supabase/*.sql`** — migration historis (pra-era `migrations/`) yang sudah applied & terverifikasi live. `rollback_fitur_per_user.sql` = pasangan rollback `migration_fitur_per_user.sql`.

## Aturan

1. Migration baru → `migrations/YYYYMMDD[a-z]_nama.sql`.
2. Sebelum tulis/ubah RPC, cek kolom live dulu (`node scripts/audit-live-db.mjs`). Regresi `20260913b` (kolom camelCase) muncul karena menulis RPC tanpa cek kolom live.
3. DB sewara ≠ produksi ≠ tester — cek header file sebelum jalankan.
4. Trigger/policy tidak terlihat via PostgREST — verifikasi manual di SQL Editor (`pg_policies`, `pg_trigger`) bila ragu.
