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

---

## 23. CRUD inventaris tuntas: PATCH/DELETE + bulk-delete (2026-10-28)

Tiga endpoint melengkapi `/api/inventory`: `PATCH /api/inventory/{id}`,
`DELETE /api/inventory/{id}`, `POST /api/inventory/bulk-delete`.
**32 skenario** baru lolos.

### 23.1 Bentuk PATCH: map, bukan struct

PATCH harus membedakan tiga hal yang tidak bisa diwakili satu tipe field:

| Keadaan | Arti |
|---|---|
| kolom tidak ada di body | jangan disentuh |
| kolom ada, nilainya `null` | kosongkan kolom |
| kolom ada, nilainya terisi | isi kolom |

Karena itu body dibaca sebagai `map[string]json.RawMessage`, lalu
`buildInventoryPatch` menerjemahkannya menjadi `[]db.SetClause`. Struct dengan
pointer tidak cukup: `nil` akan berarti dua hal sekaligus.

Konsekuensi nyata: form edit mengirim `denda: null` ketika kolomnya dikosongkan
(`parseInt("")` = `NaN` → JSON `null`), dan nilai itu harus benar-benar
mengosongkan kolom, bukan diabaikan.

### 23.2 Keamanan penyusunan SQL

`SET` dibangun dari nama kolom, jadi nama itu tidak boleh datang dari klien:

- handler hanya menerjemahkan kunci yang ada di daftar putihnya sendiri;
- `db.susunSet` memeriksa ulang setiap kolom terhadap `kolomBolehDiubah` dan
  mengembalikan error kalau tidak terdaftar (lapisan kedua);
- semua nama kolom dikutip; nilai selalu lewat parameter `$n`.

`id`, `user_id`, `created_at`, `updated_at` diabaikan tanpa error — frontend
mengirim seluruh baris dan backend Next juga membuang `user_id` diam-diam.
Kolom **tidak dikenal** justru ditolak 400, supaya salah ketik tidak lolos
sebagai "tidak ada yang berubah".

### 23.3 Deviasi positif dari backend Next

| Keadaan | Next | Go |
|---|---|---|
| PATCH id tenant lain / tidak ada | 500 (`.single()` gagal) | **404** |
| PATCH kolom tidak dikenal | 500 (PostgREST) | **400** |
| DELETE barang dipakai transaksi | 500 (FK mentah) | **409 `INVENTORY_IN_USE`** |
| `updated_at` saat PATCH | tidak pernah maju (klien mengirim nilai lama) | `now()` |
| bulk-delete | cek lalu hapus, dua pernyataan terpisah | satu transaksi (atomik) |

`INVENTORY_IN_USE` bukan sekadar kerapian: frontend mencocokkan
`hasil.code === "INVENTORY_IN_USE"` untuk menampilkan pesan yang tepat, jadi
kode itu harus ada di amplop error.

### 23.4 Guard paket (PAKET_IN_USE)

Isi paket tidak boleh berubah selama paket dipakai transaksi **Booking** atau
**Disewa**. Tiga hal yang mudah salah:

1. **Penyimpanan ulang dengan isi sama harus lolos.** Frontend mengirim seluruh
   baris, jadi tanpa pengecualian ini setiap penyimpanan paket yang sedang
   dipakai akan ditolak. Perbandingan memakai bentuk kanonik (`komponenKanonik`):
   hanya `idBarang` + `qty`, diurutkan — `nama` bukan bagian definisi paket.
2. **Guard hanya jalan kalau `komponen` ikut dikirim.** PATCH nama saja tidak
   menambah query.
3. **Pemeriksaan dan UPDATE dalam satu transaksi**, jadi tidak ada celah antara
   cek dan tulis.

### 23.5 Preflight hapus memeriksa pemakaian, bukan status

`DELETE` menolak barang yang tercatat di `transaction_items` **apa pun status
transaksinya**. Ini perilaku backend Next dan sudah dikunci smoke test: barang
yang hanya dipakai transaksi `Selesai` atau `Dibatalkan` tetap tidak bisa
dihapus. Alasannya struktural — FK `transaction_items → inventory` adalah
`ON DELETE RESTRICT`, jadi menghapusnya memang akan gagal; preflight hanya
mengubah error mentah menjadi 409 yang bisa dibaca.

Hapus bersifat idempoten: id yang tidak ada, atau milik tenant lain, tetap
dibalas 200. RLS yang menyaring, dan frontend memperlakukan "selesai" sebagai
sinyal memuat ulang daftar.

### 23.6 Metrics setelah §23

| Metric | Nilai |
|---|---|
| Total skenario teruji | 104 |
| Endpoint Go | 13 |
| Route bisnis | 5 |
| Security holes | 0 |

### 23.7 Berikutnya

Lihat §24 — daftar route berikutnya berubah setelah audit pemakaian.
`GET/POST /api/inventory-units` ternyata tidak dipakai siapa pun dan sudah dibuang.

## 24. Audit pemakaian endpoint + pembersihan (2026-10-28)

### 24.1 Alasan

Angka "61 endpoint tersisa" dihitung dari semua file route, bukan dari yang
benar-benar dipakai. Sebelum menambah route, perlu bukti mana yang hidup.

### 24.2 Cara

`scripts/audit-endpoint-usage.js` melacak rantai **halaman/komponen -> `lib/db.js`
-> `lib/api-client.js` -> route**, ditambah pemakaian path literal (`<img src>`,
anchor unduh) dan pemanggil non-frontend (cron, webhook). Hasil lengkap ada di
`endpoint-matrix.md` bagian "Pemakaian endpoint di frontend".

Empat bug parsing ditemukan saat memverifikasi hasil (semua sudah diperbaiki):
metode HTTP menyeberang ke properti berikutnya, pencocokan path gagal karena
pemisah Windows, `apiRequest` yang dipanggil langsung dari `db.js` tidak dihitung,
dan `apiRequest(` yang path-nya ada di baris berikutnya. Pelajarannya: hasil audit
yang tidak diverifikasi dengan grep independen mudah salah ke arah "tidak dipakai",
dan kesalahan itu akan membuang fitur yang masih hidup.

### 24.3 Hasil

Dari 74 metode: 64 dipakai frontend, 4 dipanggil pihak lain, 6 mati.

### 24.4 Tindakan

Empat route dibuang bersama definisi `api-client` dan pembungkus `db.js`
(commit `d2fba0e`): `/api/admin/akun`, `/api/dashboard/statistik`,
`/api/inventory-units`, `/api/transaction-payments`. Tabel DB **tidak** di-drop.
Validasi sebelum membuang: nol pemanggil di backend, frontend, SQL/seed, CI, dan
akses dinamis; `node --check` lolos; `npm run build` static export lolos.

### 24.5 Temuan yang mengubah rencana

- **`POST /api/pembayaran/purge` dijalankan crontab VPS** (`0 3 15 * *`,
  `x-purge-secret`). Di Go wajib jadi ticker internal, bukan cron OS — aturan
  portabilitas runtime (§18). Kalau tidak diport, retensi bukti bayar 2 bulan
  berhenti jalan tanpa error apa pun.
- `GET /api/auth/callback` tidak dirujuk kode frontend mana pun; dia target
  `emailRedirectTo`. Tetap wajib ada, terutama saat verifikasi email pindah ke
  SMTP sendiri.
- Metode mati di route yang tetap hidup — jangan diport, tapi jangan dihapus
  sebelum cutover karena masih jadi rujukan paritas: `DELETE /api/inventory/{id}`,
  `POST /api/transaction-items`, `GET /api/logs`, `DELETE /api/logs`, dan
  `GET /api/invoice/header` lewat `api.invoice.headerGet`.

### 24.6 Sisa kerja

47 path / 68 metode harus ada di Go; 9 path sudah diport; sisa **38 path /
55 metode**. Urutan berikutnya: domain blacklist (CRUD + upload + check +
proxy foto), satu domain per commit.

