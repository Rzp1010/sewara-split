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

**Keamanan (SOLID Γ£à):**
- SQL injection: 0 ΓÇö semua query parameterized
- Password: bcrypt cost 10, tidak pernah di-log
- Cookie: HttpOnly + SameSite Lax + Secure (prod)
- RLS enforcement: InTenant konsisten, role authenticated
- Input validation: body size limit (1MB settings, 4KB login)
- Session: SHA-256 hash stored, token 32 byte random
- Error leak: minimal ΓÇö internal error tidak ekspos ke client

**Efisiensi (BAIK Γ£à):**
- Connection pool: MaxConns=10 (VPS 1GB), MinConns=1, lifetime 30m, idle 5m
- N+1 query: 1 temuan minor ΓÇö `UpsertSettings` loop INSERT (acceptable, jarang >10 items)
- Transaction scope: sempit, auto-rollback defer
- Index: belum ada, tambah nanti: `CREATE INDEX idx_member_types_user_nama ON member_types(user_id, nama)`

**Maintainability (7/10 ΓÜá∩╕Å):**
- `handleLogin`: **159 baris** ΓÇö terlalu panjang, perlu refactor jadi helper functions
  - Kandidat: `validateLoginInput()`, `checkAccountStatus()`, `verifyCredentials()`
- `handleSettingsPost`: 93 baris ΓÇö borderline acceptable
- `requireAuth`: 55 baris ΓÇö borderline
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

Route bisnis ke-3 dan seterusnya. Kandidat (urut mudah ΓåÆ susah):
1. GET routes read-only (inventaris list, penyewa list)
2. POST/PATCH dengan validasi (inventaris CRUD + bundling)
3. DELETE soft-delete (inventaris status deleted)

Setelah 3-4 route lagi, keputusan sqlc (vs hand-written SQL). ΓåÆ **diputuskan di ┬º22.3**

---

## 22. Route bisnis berikutnya + keputusan sqlc (2026-10-28)

Empat route lagi selesai dan teruji: `/api/profiles`, `/api/dashboard`,
`/api/inventory` (GET+POST). Total skenario teruji naik dari 38 ΓåÆ 72.

### 22.1 Bug JSON tag (temuan paling penting W1)

Struct Go tanpa `json` tag diserialisasi dengan nama field Go (PascalCase):
`{"UserID":"...","Email":"..."}`. Frontend membaca snake_case
(`user_id`, `email`) sesuai bentuk PostgREST, jadi **setiap** respons yang
memakai struct tanpa tag akan tampak "kosong" di UI tanpa error HTTP apa pun.

Diperbaiki pada `Profile`, `MemberType`, `Setting`. `InventoryItem` dan
`InventoryRingkas` ditulis dengan tag sejak awal.

**Aturan sekarang:** setiap struct yang keluar ke client wajib punya tag
`json:"snake_case"` ΓÇö kecuali nama kolomnya memang camelCase di skema
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
superadmin semua. Ekspektasi "staf bisa melihat atasannya" **salah** ΓÇö jangan
"diperbaiki" di handler; itu perilaku policy.

**Dashboard** memakai dua RPC (`rpc_dashboard_rekap_status`,
`rpc_dashboard_pembayaran`) yang `SECURITY DEFINER` dan memeriksa sendiri bahwa
`p_user_id` adalah tenant pemanggil. Guard itu dipertahankan: kalau konteks
tenant di Go salah, database yang menolak.

**Inventory** ΓÇö dua deviasi positif yang disengaja:
- `?kolom=` (pemilihan kolom dinamis) **ditolak 400**. Nilainya dulu disambung
  langsung ke daftar kolom SELECT; bentuk amannya hanya daftar putih tetap.
  Frontend tidak memakainya untuk inventory (hanya transactions).
- Pelanggaran enum (`jenis`, `kondisi`) dan `nama` kosong dibalas **400**, bukan
  500 dari database.
- `denda` dideklarasikan `text` di skema tetapi frontend mengirim **angka**
  (hasil `parseInt` di form dan CSV). `inventoryBody.Denda` karena itu
  `json.RawMessage` + `jsonText()`, supaya kedua bentuk diterima dan tersimpan
  sebagai teks ("5000").
- `?ids=` kosong = filter kosong ΓåÆ **nol baris**, bukan seluruh katalog
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
| Bug yang pernah terjadi | 1 ΓÇö JSON tag (bukan SQL) |

Alasan penolakan:
1. **Tidak ada masalah yang mau disembuhkan.** 29 query, 0 bug SQL.
2. **CAST `::text` jadi friksi.** sqlc menginfer `uuid` ΓåÆ `pgtype.UUID`, bukan
   `string`, sementara frontend butuh string. Butuh override per kolom.
3. **21 field nullable tetap pointer manual** ΓÇö sqlc tidak menghilangkannya.
4. **Query dinamis tidak bisa digenerate** (`UpsertSettings` loop per baris,
   parameter NULL opsional dashboard), jadi hasilnya campuran dua pola.
5. **Biaya rewrite** 772 baris + 7 handler + 6 smoke test untuk mencegah 0 bug.

**Pemicu tinjau ulang (salah satu):** query >60; ΓëÑ2 bug kelas kolom/tipe yang
lolos ke runtime; satu file route butuh 6ΓÇô8 query sendiri (kandidat:
`transactions`); skema berubah >3├ù per minggu setelah cutover.

Ini keputusan **tingkat codebase**, bukan tingkat fitur: sqlc menghemat tenaga
per query, dan tenaga itu baru mahal saat jumlah query besar. Query dinamis,
panggilan RPC, dan query 3 baris tidak akan pernah untung dengan generator.

### 22.4 Metrics setelah ┬º22

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
(`parseInt("")` = `NaN` ΓåÆ JSON `null`), dan nilai itu harus benar-benar
mengosongkan kolom, bukan diabaikan.

### 23.2 Keamanan penyusunan SQL

`SET` dibangun dari nama kolom, jadi nama itu tidak boleh datang dari klien:

- handler hanya menerjemahkan kunci yang ada di daftar putihnya sendiri;
- `db.susunSet` memeriksa ulang setiap kolom terhadap `kolomBolehDiubah` dan
  mengembalikan error kalau tidak terdaftar (lapisan kedua);
- semua nama kolom dikutip; nilai selalu lewat parameter `$n`.

`id`, `user_id`, `created_at`, `updated_at` diabaikan tanpa error ΓÇö frontend
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
   hanya `idBarang` + `qty`, diurutkan ΓÇö `nama` bukan bagian definisi paket.
2. **Guard hanya jalan kalau `komponen` ikut dikirim.** PATCH nama saja tidak
   menambah query.
3. **Pemeriksaan dan UPDATE dalam satu transaksi**, jadi tidak ada celah antara
   cek dan tulis.

### 23.5 Preflight hapus memeriksa pemakaian, bukan status

`DELETE` menolak barang yang tercatat di `transaction_items` **apa pun status
transaksinya**. Ini perilaku backend Next dan sudah dikunci smoke test: barang
yang hanya dipakai transaksi `Selesai` atau `Dibatalkan` tetap tidak bisa
dihapus. Alasannya struktural ΓÇö FK `transaction_items ΓåÆ inventory` adalah
`ON DELETE RESTRICT`, jadi menghapusnya memang akan gagal; preflight hanya
mengubah error mentah menjadi 409 yang bisa dibaca.

Hapus bersifat idempoten: id yang tidak ada, atau milik tenant lain, tetap
dibalas 200. RLS yang menyaring, dan frontend memperlakukan "selesai" sebagai
sinyal memuat ulang daftar.

### 23.6 Metrics setelah ┬º23

| Metric | Nilai |
|---|---|
| Total skenario teruji | 104 |
| Endpoint Go | 13 |
| Route bisnis | 5 |
| Security holes | 0 |

### 23.7 Berikutnya

Lihat ┬º24 ΓÇö daftar route berikutnya berubah setelah audit pemakaian.
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
  `x-purge-secret`). Di Go wajib jadi ticker internal, bukan cron OS ΓÇö aturan
  portabilitas runtime (┬º18). Kalau tidak diport, retensi bukti bayar 2 bulan
  berhenti jalan tanpa error apa pun.
- `GET /api/auth/callback` tidak dirujuk kode frontend mana pun; dia target
  `emailRedirectTo`. Tetap wajib ada, terutama saat verifikasi email pindah ke
  SMTP sendiri.
- Metode mati di route yang tetap hidup ΓÇö jangan diport, tapi jangan dihapus
  sebelum cutover karena masih jadi rujukan paritas: `DELETE /api/inventory/{id}`,
  `POST /api/transaction-items`, `GET /api/logs`, `DELETE /api/logs`, dan
  `GET /api/invoice/header` lewat `api.invoice.headerGet`.

### 24.6 Sisa kerja

Setelah blacklist, 47 path / 68 metode harus ada di Go; 14 path sudah diport;
sisa **33 path / 48 metode**. Domain berikutnya: promo atau members (CRUD murni),
satu domain per commit.

## 25. Domain blacklist Go (2026-10-29)

Tujuh metode selesai di `handlers_blacklist.go`: daftar, tambah, ubah, hapus,
check pasangan nama+HP, unggah dokumen, dan proxy dokumen. Akses tulis khusus
owner; baca dan check mengikuti isolasi tenant RLS. Saat membuat entri dari
member, snapshot dokumen disalin server-side ke prefix `blacklist/<tenant>/`.

`migrations/0005_blacklist.sql` menyalin skema, RLS, constraint maksimal lima
dokumen, dan index dari migration Next. Ledger dicatat runner staging, bukan file
migration (┬ºaturan DB pengecualian 2026-10-27).

`scripts/smoke-blacklist.ps1`: **41/41 lolos** pada Docker staging. Cakupan CRUD,
validasi, owner/staf, isolasi dua tenant, normalisasi HP, duplikat, dan guard
prefix. Upload/proxy bucket nyata belum diuji: storage sengaja off; respons 503,
400, dan 403 guard terverifikasi.

### 25.1 Wajib sebelum blacklist Go dinyatakan parity

Tunda sampai frontend dapat mengarahkan `/api/blacklist*` ke API Go lokal.
Pakai bucket dev `sewara-dev`, bukan produksi. Dari UI uji upload JPG/PDF, baca
proxy header, tenant lain `403`, snapshot dokumen member saat create, dan hapus
file setelah ganti/hapus entri. Bersihkan seluruh object uji prefix `blacklist/`.

Deviasi positif: guard prefix dan validasi `path` pada header dijalankan sebelum
cek storage. Tenant tidak pernah mendapat 503 sebagai pengganti 403 untuk path
milik tenant lain.

## 26. Domain promo CRUD Go (2026-10-29)

Empat metode CRUD selesai di `handlers_promo.go`: daftar, tambah, ubah, hapus.
Kode otomatis uppercase + trim. Constraint duplikat per tenant dikembalikan
`409 PROMO_DUPLIKAT`. GET otomatis tandai expired (`berlaku_sampai` lewat ATAU
`terpakai >= kuota`).

`internal/db/promo.go`: 6 metode (List/Get/Insert/Update/Delete/TandaiPromoExpired).
Update read-modify-write, field nil tidak diubah. Constraint `promo_codes_user_kode`
mapped ke `ErrPromoDuplikat`.

`scripts/smoke-promo.ps1`: **30/30 lolos** pada Docker staging. Cakupan CRUD,
validasi diskon 0-100, kuota ΓëÑ0, status aktif/nonaktif, duplikat kode per tenant,
isolasi dua tenant, auto-tandai expired tanggal + kuota.

Perbaikan staging: reset `promo_codes_id_seq` setelah seed supaya INSERT smoke
tidak bentrok dengan seed `OVERRIDING SYSTEM VALUE` id 1-4.

Sisa: `POST /api/promo/validate` dan `POST /api/promo/use` (logika kadaluarsa +
concurrency guard `terpakai`).


## 27. Domain members CRUD Go (2026-10-29)

CRUD anggota selesai di `handlers_members.go`: GET/POST/PATCH/DELETE. Normalisasi
HP (leading 0ΓåÆ6, hanya digit). Constraint `members_user_nama_hp` unik per tenant
dikembalikan `409 MEMBER_DUPLIKAT`.

`internal/db/members.go`: 5 metode (List/Get/Insert/Update/Delete). Update
read-modify-write, field `nil` tidak diubah. HP dinormalisasi sebelum query/insert
untuk konsistensi pencarian.

`scripts/smoke-members.ps1`: **22/22 lolos** pada Docker staging. Cakupan CRUD,
validasi nama/HP wajib, duplikat pair nama+HP per tenant, isolasi dua tenant,
normalisasi HP `0812` ΓåÆ `6812`.

Belum: upload foto (`POST /api/member/upload`) dan proxy foto (`GET /api/member/photo`)
ΓÇö menunggu keputusan R2 di G1.

## 28. Rekapitulasi progres migrasi (2026-10-29)

**Selesai dan lolos smoke:**
- Auth: login, me (18 skenario)
- Settings GET/POST (12)
- Member-types CRUD (8)
- Profiles GET (8)
- Dashboard GET (6)
- Inventory GET/POST/PATCH/DELETE + bulk-delete (32)
- Blacklist CRUD + check + upload/header tanpa storage (41)
- Promo CRUD + validate + use (30)
- Members CRUD (22)

Total: **9 domain, 29 endpoint, 177 skenario smoke lolos.**

**Sisa kerja (dari `endpoint-matrix.md` ┬ºaudit):** 24 path / 36 metode.

Kelompok berikutnya (urutan mudahΓåÆsulit):
1. **CRUD murni** (risiko rendah, pola seragam): `logs`, `transaction-items`,
   `member-types/{id}` DELETE/PATCH.
2. **Agregat** (query laporan): `dashboard/manajemen`, `pembayaran/reminder`.
3. **Transaksi** (logika bisnis inti): `transactions` GET/POST/PATCH, `transaction-items`,
   `invoice-counter`.
4. **File** (R2 + presigned/proxy): `invoice/header`, `member/photo`, `member/upload`,
   `pembayaran/photo`, `pembayaran/upload`, `pembayaran/export`.
5. **Admin** (lintas tenant): `admin/data`, `admin/logs`, `admin/users`.
6. **Auth** (sesi + registrasi): `auth/register`, `auth/callback`, `auth/logout`,
   `auth/resend-verification`.
7. **Eksternal** (webhook + signature): `telegram/test`, `telegram/webhook`,
   `webhooks/payment`.

**Gate G1 (akhir minggu 2):** minimal transaksi GET/POST + invoice + 1 file endpoint
lolos smoke. Kalau gagal, migrasi dihentikan.

**Commit terakhir:** `797e4d1` (members CRUD). Branch `dev` lokal, belum push.

## 29. Hasil smoke test Docker staging (2026-10-29)

**DB staging kanonis:** Docker `sewara-staging-db`, database `sewara`, host port 5433.
Portable PostgreSQL lokal dihentikan selama smoke Docker; jangan jalankan kedua DB
bersamaan karena sama-sama memakai port 5433. `smoke-login.ps1` dan `smoke-auth.ps1`
dialihkan ke Docker staging; bukan lagi portable DB.

**Smoke Docker lulus:**

| Skrip | Skenario | Hasil |
|---|---:|---|
| `smoke-blacklist.ps1` | 41 | PASS |
| `smoke-dashboard.ps1` | 6 | PASS |
| `smoke-inventory.ps1` | 20 | PASS |
| `smoke-inventory-crud.ps1` | 32 | PASS |
| `smoke-member-types.ps1` | 8 | PASS |
| `smoke-members.ps1` | 24 | PASS |
| `smoke-profiles.ps1` | 8 | PASS |
| `smoke-promo-logika.ps1` | 18 | PASS |
| `smoke-promo.ps1` | 30 | PASS |
| `smoke-settings.ps1` | 12 | PASS* (run lama; assertion lemah) |

**Total batch awal:** 10 smoke scripts, 199 skenario bertanda lolos saat run awal
(termasuk `smoke-settings` 12 skenario dengan assertion isolasi lemah). Verifikasi
lanjutan 2026-10-29:

| Skrip | Skenario | Hasil |
|---|---:|---|
| `smoke-settings.ps1` | 13 | PASS (rerun bersih) |
| `smoke-login.ps1` | 18 | PASS |
| `smoke-auth.ps1` | 4 | PASS |

`smoke-settings.ps1` assertion diperbaiki dan harness dibersihkan untuk rerun:
tenant owner A memegang 3 seed keys; owner-test mulai tanpa settings, lalu memiliki
3 key (`test_key`, `k1`, `k2`) setelah tes writes; owner A tetap hanya melihat 3 seed
keys. Semua 13 skenario lulus pada rerun bersih. Smoke login dan auth memakai Docker
staging; portable PostgreSQL bukan target tes.

Sepuluh smoke awal dijalankan ulang berurutan setelah perubahan harness: sembilan
lulus sebelum settings, lalu batch sempat berhenti karena settings stale data dan
assertion count keliru. Setelah cleanup/accounting diperbaiki, full batch terpadu
2026-10-29 lulus: 12 script berstatus exit 0, berurutan, tanpa script terlewat.

Audit assertion lanjutan memperkuat body/tenant checks di dashboard, profiles,
member-types, dan settings. Full batch Docker pasca-perubahan lulus berurutan: 12/12
scripts, exit 0 semua. Skenario: blacklist 41, dashboard 6, inventory 20,
inventory-crud 32, login 18, members 24, member-types 8, profiles 8, promo 30,
promo-logika 18, settings 13, auth 4 = **222 skenario**.

**Cakupan verifikasi terakhir:** 18 smoke scripts, 395 skenario lulus (batch Docker
berurutan 2026-10-30). Ini tidak membuktikan seluruh endpoint migration Go;
lihat batas cakupan di bawah. `go test ./...` sebelumnya lulus sebagai build/package
check, tetapi semua package tidak punya test file.

**Full batch berurutan 2026-10-30 (pasca PATCH/DELETE member-types, GET/PATCH
transactions `:id`, GET/POST transaction-items, GET/POST/DELETE logs + GET
logs/login, domain manajemen, domain invoice admin, lalu grup pembayaran):** 18
smoke scripts Docker, exit 0 semua, 395 skenario lulus. `go build ./...`,
`go vet ./...`, dan `go test ./...` (pembayaran_test.go) juga lulus.

Syarat menjalankan batch: mulai dari container yang dibuat ulang
(`docker-staging.ps1 reset` lalu `start`). Skrip berbagi satu DB dan
`smoke-settings.ps1` menuntut settings seed apa adanya; tanpa reset, sisa state
batch sebelumnya membuat batch berhenti di skrip itu (terjadi 2026-10-30, bukan
regresi kode: setelah reset, 17/17 hijau).

| Skrip | Skenario | Hasil |
|---|---:|---|
| `smoke-login.ps1` | 18 | PASS |
| `smoke-settings.ps1` | 13 | PASS |
| `smoke-member-types.ps1` | 8 | PASS |
| `smoke-member-types-crud.ps1` | 15 | PASS |
| `smoke-profiles.ps1` | 8 | PASS |
| `smoke-dashboard.ps1` | 6 | PASS |
| `smoke-inventory.ps1` | 20 | PASS |
| `smoke-inventory-crud.ps1` | 32 | PASS |
| `smoke-members.ps1` | 24 | PASS |
| `smoke-blacklist.ps1` | 41 | PASS |
| `smoke-promo.ps1` | 30 | PASS |
| `smoke-promo-logika.ps1` | 18 | PASS |
| `smoke-transactions.ps1` | 26 | PASS |
| `smoke-transaction-items.ps1` | 20 | PASS |
| `smoke-logs.ps1` | 26 | PASS |
| `smoke-manajemen.ps1` | 49 | PASS |
| `smoke-invoice.ps1` | 17 | PASS |
| `smoke-pembayaran.ps1` | 24 | PASS |

Catatan batch:

- `smoke-pembayaran.ps1` baru (24 skenario): keenam endpoint pembayaran diuji
  tanpa R2 (`R2_*` kosong). `purge` satu-satunya endpoint yang TIDAK dibungkus
  `requireAuth` — 401 berasal dari perbandingan header `x-purge-secret` dengan env
  `PURGE_SECRET`, jadi asersinya `{"ok":false,"message":"Unauthorized"}`, bukan
  kode `UNAUTHORIZED`. `photo` membalas **400** "Path tidak valid." untuk prefix
  tenant lain (paritas Next), sedangkan 503 `msgStorageOff` dipakai untuk prefix
  sendiri saat storage mati. `reminder-ack` oleh staf diverifikasi menulis baris
  `settings` milik OWNER (bukan id staf) dan tidak menyentuh tenant lain; skrip
  memulihkan settings owner A ke seed di akhir. `upload` diuji tiga cabang:
  transaksiId bukan UUID (400), transaksi tidak ada (404), transaksi ada +
  storage mati (503).
- Deviasi sengaja dari Next: bila `store == nil`, handler pembayaran membalas 503
  `EXTERNAL_SERVICE_ERROR` `msgStorageOff` (Next jatuh ke 500 lewat
  `withErrorHandler`) — konsisten dengan handler blacklist/invoice.
- Logika waktu tidak bisa diandalkan ke jam mesin saat batch, jadi dipisah ke
  fungsi murni ber-parameter `now` dan diuji di
  `internal/httpapi/pembayaran_test.go`: jendela hari WIB 8–15, pemilihan bulan
  reminder (−2 dengan fallback −3, termasuk lintas tahun), dan cutoff purge
  (00:00 WIB tanggal 1 bulan berjalan −2 bulan, termasuk Januari/Februari).
  Purge terjadwal dijalankan ticker internal `cmd/api/main.go` (hari WIB 15, jam
  ≥3, idempoten lewat cutoff) — cron OS dilarang aturan portabilitas; endpoint
  `POST /api/pembayaran/purge` tetap ada untuk paritas dan pemicu manual.
- Jalur sukses berkas masih belum berbukti: ZIP `export`, stream byte `photo`,
  dan unggah ke R2 butuh bucket hidup (menunggu rotasi secret R2). Yang terbukti
  baru kontrak: validasi, guard prefix, 404, 503.
- Pelajaran harness: PowerShell TIDAK membedakan besar-kecil huruf pada variabel,
  sehingga `$A` (UUID tenant) bisa tertimpa `$a` (cookie sesi) dan SQL berikutnya
  gagal `invalid input syntax for type uuid`. Skrip smoke memakai nama panjang
  (`$OWNER_A`).

- `smoke-invoice.ps1` baru (17 skenario): `POST /api/invoice-counter` memakai RPC
  `increment_invoice_counter` (versi per-tenant, migration 20260913) sehingga
  owner dan staf tenant yang sama berbagi satu counter — dibuktikan dengan
  urutan `INV-000001` (owner A) → `INV-000002` (owner A) → `INV-000003` (staf A)
  plus cek ledger `settings.invoice_counter` di DB, dan tenant B tetap mulai dari
  `INV-000001`. `GET/POST/DELETE /api/invoice/header` diuji dengan storage
  dimatikan: guard prefix `headers/<tenantId>.` (403) diperiksa sebelum cek
  storage, jadi 403 tetap kembali tanpa R2; 404 (belum diatur), 503 (storage off)
  dan 400 (path kosong) ikut diverifikasi, termasuk nilai settings ber-kutip JSON.
  Jalur sukses upload/stream byte R2 belum diuji (menunggu rotasi secret R2).
  Skrip membersihkan jejak settings-nya di akhir supaya skrip lain dalam batch
  yang sama tetap melihat seed apa adanya.

- `smoke-manajemen.ps1` baru (49 skenario): `GET /api/dashboard/manajemen` (agregat
  global lintas tenant), `GET/POST/PATCH/DELETE /api/admin/users` (isolasi list owner
  vs superadmin + `jumlah_staff`, gerbang role per aksi, `DURASI_VALID` 1/3/6/12,
  strict decode body, 404 seragam untuk target di luar wewenang), `GET /api/admin/logs`
  (superadmin saja), `POST /api/admin/data` (wipe tenant B: transactions -> inventory ->
  activity_logs -> members/member_types/promo_codes, lalu reset `invoice_counter`).
  Aksi destruktif (DELETE cascade, wipe tenant B, `tolak_registrasi`) dijalankan paling
  akhir agar tidak merusak akun/sesi skenario sebelumnya.
- Domain manajemen memakai `InTenant` untuk seluruh operasi per-tenant (RLS
  `profiles_select_allowed`/`profiles_write_allowed` plus trigger
  `protect_profile_self_escalation` sebagai lapis kedua). Akses `auth.users` (buat akun,
  hapus akun, ubah password) lewat jalur sistem — `authenticated` tidak punya grant di
  schema `auth`. Audit `admin_logs` di-INSERT langsung, bukan lewat
  `rpc_tambah_admin_log` (RPC itu menuntut GUC `app.jwt` yang tidak di-set Go).
- Deviasi sengaja dari Next: rate limit per user (`checkRateLimit`) dilewati — belum ada
  padanannya di Go; akun nonaktif ditolak `requireAuth` dengan 401 `UNAUTHORIZED`, bukan
  403 `"Akun Anda dinonaktifkan."`; `invoice_counter` ditulis sebagai teks biasa
  (`0`), bukan JSON string ber-kutip seperti `JSON.stringify(String(mulai-1))` di Next —
  sama dengan nilai seed dan `setSetting` frontend.
- `scripts/docker-staging.ps1` diperkuat setelah insiden C: penuh (Docker Desktop
  read-only): pembuatan container kini menunggu `pg_isready` **di dalam** container
  (proxy Docker Desktop menerima TCP dari host sebelum Postgres siap, jadi cek dari host
  menyesatkan) dan tiap pemuatan berkas SQL memeriksa exit code `psql -v ON_ERROR_STOP=1`.
  Sebelumnya kegagalan muat skema hanya muncul sebagai "Tabel: 0" dan batch lanjut
  dengan DB kosong.

- `smoke-logs.ps1` baru (26 skenario): CRUD log aktivitas (stamp `user_id` tenant,
  isolasi RLS, hapus by ids / `olderThanDays` / semua) + log login (owner = tenant
  sendiri, superadmin = semua, staf lain 403). Uji isolasi lewat isi body, bukan
  status.
- `/api/logs/login` membaca `login_logs` yang RLS-nya aktif **tanpa policy**, jadi
  akses lewat `inSystemTx` (jalur sistem, sama seperti service role backend Next)
  dengan filter `owner_id` eksplisit. Role dari `db.Identity`, bukan query profil lagi.
- Paritas login sukses diperbaiki: backend Next menulis `owner_id || user_id`, jadi
  login sukses owner memakai `user_id` sendiri — tanpa ini halaman log login tenant
  owner kosong. Perubahan kecil di `afterLoginSuccess`.

- `smoke-transaction-items.ps1` baru (20 skenario): GET `single`/`bulk`/`all` +
  POST replace item satu transaksi. Isolasi tenant diuji lewat RLS (kunci tenant B
  tidak muncul di hasil tenant A), POST ke transaksi tenant lain → 404, GET id
  bukan angka → 400, replace kosong → DELETE all.
- RLS `/api/transaction-items` awalnya bocor (`all` menampilkan item semua tenant).
  Penyebab: GUC `app.user_id` diset di luar transaksi tanpa `SET LOCAL ROLE
  authenticated`, sehingga query dijalankan sebagai owner DB yang bypass RLS.
  Perbaikan: seluruh akses lewat `db.InTenant` (set GUC + turun role authenticated).
  Deteksi bocor hanya muncul karena assertion memeriksa body/tenant, bukan status.

- `smoke-transactions` naik 14 → 26: 12 skenario baru untuk GET/PATCH
  `/api/transactions/{id}` (detail + items + payments nested, isolasi tenant,
  validasi id non-angka, 404 tenant lain, PATCH status/field, body kosong).
- `smoke-member-types-crud.ps1` baru (15 skenario): PATCH/DELETE
  `/api/member-types/{id}` — validasi body, user_id diabaikan, 404 milik tenant
  lain/ tidak ada, DELETE idempoten, isolasi antar tenant.
- `smoke-inventory-crud` awalnya 7 GAGAL karena seed `staging_seed.sql` tidak lagi
  berisi transaksi (baris 1001-1004/2001-2004 dihapus untuk smoke-transactions
  mulai dari 0), sehingga guard `INVENTORY_IN_USE` tidak pernah terpicu dan
  barang seed ikut terhapus. Bukan bug Go — setup smoke diperbaiki: script kini
  meng-insert sendiri transaksi 3001 (Booking) memakai barang 101 + paket uji,
  dan 3002 (Disewa) memakai barang 102. Rerun bersih 32/32.
- PATCH `smoke-member-types.ps1` sempat terduplikasi (dua instans paralel di DB
  bersama) dan satu run tampil GAGAL karena kontaminasi data; rerun berurutan
  tunggal 8/8 bersih. Smoke tidak boleh paralel — port 5433 & container dipakai
  bersama.
- `smoke-auth.ps1` tetap dikecualikan dari batch: target portable DB, belum
  dimigrasi ke Docker (lihat known issue AGENTS.md 2026-10-29).

**Audit cakupan lanjutan 2026-10-29:**

- `/api/member/upload` dan `/api/member/photo` belum terdaftar di Go router.
  Handler CRUD members menerima `foto_jaminan`, tetapi belum ada jalur HTTP upload/
  proxy. R2 tidak dikonfigurasi pada mesin ini: tak ada `R2_*` di `.env.example`;
  kredensial runtime berada di env/config lokal yang tidak dibaca atau ditampilkan.
  R2 dev nyata tidak diuji.
- `/api/auth/register`, `/api/auth/callback`, `/api/auth/logout`, dan
  `/api/auth/resend-verification` belum ada di router Go. Endpoint lama register/
  resend/callback memerlukan Supabase Auth/SMTP; tidak dapat smoke secara aman di
  Docker DB saja. Logout juga belum punya handler Go.

**Batas tersisa sebelum port route yang belum ada:**

- Member upload/photo: endpoint `/api/member/upload` dan `/api/member/photo` belum
  terdaftar di Go router. Handler CRUD members menerima `foto_jaminan` JSON, tetapi
  belum ada jalur HTTP upload/proxy. R2 dev tidak diuji; kredensial terekspos di chat
  sebelumnya, perlu rotasi sebelum pemakaian berikutnya.
- Auth legacy: `/api/auth/register`, `/api/auth/callback`, `/api/auth/logout`,
  `/api/auth/resend-verification` belum ada di Go router. Endpoint register/resend/
  callback nyata memerlukan Supabase Auth + SMTP eksternal; tidak dapat smoke secara
  aman di Docker DB saja. Logout juga belum punya handler Go.
- Assertion lemah tersisa: `smoke-dashboard`, `smoke-profiles`, `smoke-settings` masih
  cek HTTP 200 saja pada beberapa skenario; body/isolasi tidak diverifikasi penuh.
  Audit lanjutan bisa menambah edge case tanpa mengubah source aplikasi.

Smoke yang tersedia sudah lulus terpadu. Refactor Go pending approval user.
