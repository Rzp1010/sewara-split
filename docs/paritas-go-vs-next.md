# Paritas Go vs Next (audit 2026-10-30)

Audit statis: 47 route Next (`sewara-backend/app/api/**`) vs handler Go
(`sewara-api/internal/**`), dibagi 4 lane, lalu temuan diverifikasi ulang langsung
ke sumber (karena laporan lane memuat false positive). Kode tidak diubah.

Metode: baca kedua sisi, cocokkan path/metode, guard role, validasi + pesan error,
bentuk respons, status HTTP, filter tenant, efek samping (DB/R2/email), lalu cek
pemanggil di `sewara-frontend/src/lib/api-client.js` + `src/lib/db.js`.

## Kesimpulan

Port **belum seragam sepenuhnya**. Sebagian besar endpoint cocok; yang tersisa
bukan sekadar kosmetik, ada 1 celah isolasi tenant dan 1 fitur list yang belum
diport. Seluruh deviasi resmi (rate limit in-memory, storage-off 503, ticker purge,
`TELEGRAM_API_BASE`, stub webhook pembayaran, `FRONTEND_URL` wajib produksi)
terverifikasi memang seperti yang disepakati.

**Status perbaikan (2026-10-30): G1–G6 sudah ditutup.** Batch smoke Docker staging
22 skrip / 504 skenario hijau, termasuk skenario baru untuk masing-masing gap.
Kode lulus `go build`/`go vet`/`go test`. Sisa cakupan audit yang belum tuntas ada
di bagian akhir dokumen ini.

## Gap yang harus ditutup sebelum cutover

### G1. `GET /api/transactions` kehilangan filter/pagination/nested (P1)

- Go: `handlers_transactions.go:15-19` mengirim `db.TransactionQueryOptions{}` kosong;
  structnya hanya `Limit`/`Offset` (`db/transactions.go:448-453`) dan tak dipakai.
- Next: `app/api/transactions/route.ts:41-84` mendukung `kolom` (preset daftar
  kolom), `nested` (items+payments), `ids`, `status`, `cari`, `hideRiwayat`,
  `mulai`/`akhir` + `rentangKolom`/`tanggalKolom`, `limit`/`offset`.
- Frontend memang memakai: `api-client.js:91` (`getAll(params)`), `db.js:347`
  (`getTransactionsCari(q, hideRiwayat)` mengirim `cari` + `hideRiwayat`), dan
  halaman dashboard/riwayat mengirim `status`/`limit`.
- Dampak: pencarian penyewa dan `hideRiwayat` mati; halaman menerima seluruh
  riwayat (data terlalu banyak, urutan/kolom tidak sesuai). PASTI.

### G2. Referensi lintas tenant pada transaksi & item (P1, isolasi data)

- Next menolak di RPC `rpc_save_transaction`: `members` harus milik tenant
  (`Member does not belong to tenant`, 42501) dan `inventory` pada item juga
  (`Inventory does not belong to tenant`) — `schema_prod_20260930.sql:1377,1395`.
- Go belum memvalidasinya (diakui di `db/transactions.go:169`) dan hanya
  mengandalkan FK/RLS: FK `member_id`/`inventory_id` tidak menyertakan tenant,
  sehingga transaksi tenant A bisa menunjuk member/inventory tenant B.
- Dampak: potensi kebocoran/penyimpangan data lintas tenant + pesan error berbeda
  dari Next. PASTI untuk kode; dampak runtime perlu uji staging.

### G3. `guardMaintenance` tidak dijalankan saat status `Disewa` (P1)

- Next: `app/api/transactions/route.ts:98` dan `transactions/[id]/route.ts:52`
  memanggil `guardMaintenance` → 400 `Unit S/N "X" sedang maintenance dan tidak
  bisa disewa.` bila SN berstatus maintenance (`lib/api/kondisi-sn.ts:44-75`).
- Go: belum ada di POST maupun PATCH (`handlers_transactions.go:104,139`).
- Dampak: unit rusak bisa disewakan lewat Go padahal Next menolak. PASTI.

### G4. Scope tenant pada POST `/api/settings` (P1)

- Next: `settings/route.ts:65,83` memakai `getTenantId()` = `profiles.owner_id`
  (owner tenant), jadi tulisan staf menempel ke baris tenant.
- Go: `handlers_settings.go:157,164` memakai `me.UserID` (id user yang login).
  Untuk staf, tulisan `kalender_selesai` / `bukti_backup_ack` mendarat di baris
  milik staf sendiri, bukan baris tenant → owner/staf lain tidak melihatnya.
  Go sudah punya helper yang benar (`db.TenantID`) tapi tidak dipakai di sini.
- Dampak: setting bersama per tenant tidak konsisten. PASTI.

### G5. `POST /api/pembayaran/upload` mencari kolom ID yang salah (P0)

- Frontend: `src/lib/db.js:446-463` mengirim field `transaksiId`; seluruh pemanggil
  (`src/page.js:1086,1237,1353,1460`) memakai `trx.id`/`target.id`/`trxBaru.id` =
  `transactions.id` (bigint, mis. `1761612345678`).
- Next: `app/api/pembayaran/upload/route.ts:47-62` → `.eq('id', transaksiId)` +
  `.eq('user_id', ownerId)`; key `bukti-bayar/<ownerId>/<transaksiId>/pay-<ts>.<ext>`.
- Go: `handlers_pembayaran.go:310-314` mewajibkan `uuidPattern` (pola UUID milik
  entri blacklist, `handlers_blacklist.go:31`) dan `db/pembayaran.go:51` mencari
  kolom `id_transaksi`.
- Dampak: nilai bigint dari frontend ditolak 400 `File atau transaksi ID tidak
  valid.` → upload bukti bayar mati total di Go. PASTI.
- Kenapa smoke hijau: `scripts/smoke-pembayaran.ps1:45-52` menyemai sendiri
  `id_transaksi` berisi UUID (`aaaaaaaa-...`) lalu mengirim UUID itu, jadi tidak
  pernah menguji nilai yang dikirim frontend.

### G6. `POST /api/transactions` menolak body flat yang dikirim frontend (P0)

- Frontend: `db.js:370-388` (`tambahTransactions`) → `api-client.js:93-94` mengirim
  objek transaksi **flat** (bukan `{transaction, items, payments}`); bentuknya di
  `booking/page.js:1395-1449` (`id: Date.now()`, `items`, `pembayaran` legacy,
  `printilan`, `riwayatDilayani`). Tidak ada pemanggil `saveTransactionItems` di
  halaman (`db.js:436` hanya definisi) → seluruh simpan transaksi lewat POST ini.
- Next: `transactions/route.ts:94-107` → `const tx = body?.transaction ?? body`,
  `items = body?.items ?? []`, `payments = body?.payments ?? []`, lalu RPC
  (`schema_prod_20260930.sql:1395-1405`) memetakan item bentuk frontend
  (`nama`/`ref.nama`→`Unknown`, `jenis`, `qty`, `harga`, `tarif`, `sn`,
  `assignedSNs`) dan payment (`jumlah`, `tanggal`, `metode`, `catatan`).
- Go: `handlers_transactions.go:193-209` hanya menerima wrapper dan langsung 400
  `transaction.id wajib diisi (client-generated, misal Date.now()).`; `TransactionItemInput`/
  `TransactionPaymentInput` (`db/transactions.go:107-125`) memakai nama kolom DB.
- Dampak: simpan booking/transaksi mustahil dari UI. PASTI.
- Catatan: `db.ReplaceTransactionItems` (`db/transaction_items.go:133-186`) sudah
  memetakan nama frontend dengan benar — normalisasi yang sama belum dipakai POST.

## Domain lain: blacklist & promo (audit terpisah, tanpa gap P1)

- Blacklist: CRUD/check/upload/header seragam atau lebih ketat di Go. Beda:
  urutan validasi PATCH (Go validasi nama/alasan/hp dulu, Next UUID dulu → pesan
  error pertama bisa berbeda untuk request multi-invalid); `alamat:null` disimpan
  NULL di Go; header foto: storage error non-not-found → Go 502 vs Next 404.
- Promo: Go lebih ketat (validasi kode/diskon/kuota/status, 404 saat baris tidak
  ada) sedangkan Next meneruskan body ke DB dan sukses untuk delete nol baris.
  **Next justru lebih longgar pada isolasi**: `promo/validate` dan `promo/use`
  mencari promo hanya `.eq('id')` tanpa filter tenant (`promo/validate/route.ts:35-39`,
  `promo/use/route.ts:32-36`) sementara Go tenant-scoped — Go lebih aman, tidak
  perlu diubah. Satu beda kosmetik: pesan kuota habis Go berakhiran titik, Next
  tidak (`handlers_promo.go:296-299` vs `promo/use/route.ts:70-75`), ditampilkan
  langsung oleh `db.js:844-852`.
- Status promo `expired` untuk baris berstatus non-standar: Go mempertahankan
  status lama di respons, Next menormalkan jadi `expired` (`handlers_promo.go:24-37`
  vs `promo/route.ts:38-54`). Hanya relevan untuk data historis di luar kontrak.

## Domain lain: invoice-counter, telegram, admin (audit terpisah)

- `POST /api/invoice-counter`: kedua sisi memakai RPC `increment_invoice_counter`
  dan format `PREFIX-NNNNNN` dari setting tenant (default `INV`, 6 digit) →
  SERAGAM pada jalur normal. Beda: Next punya fallback baca-lalu-tulis setting
  bila RPC gagal (`invoice-counter/route.ts:19-55`), Go langsung 500
  (`handlers_invoice.go:16-29`). Skema wajib punya RPC, jadi fallback hanya
  relevan untuk skema lama — dicatat, tidak diperbaiki.
- `POST /api/telegram/webhook`: keduanya mengirim HTML (`telegram.go:146-189` +
  `telegramParseModeHTML` vs `lib/services/telegram.ts` default `parseMode = "HTML"`),
  dan keduanya skip event DELETE tanpa `no_invoice`/`id`. SERAGAM.
- `GET /api/admin/users`: field, urutan `created_at DESC`, dan `jumlah_staff`
  sama di kedua sisi (dipakai `dashboard/manajemen/page.js:357,436-439`). SERAGAM.
- Guard role domain ini: tidak ada bukti staf bisa membaca/mengubah data privat
  yang Next larang. `/api/logs` dibatasi `user.UserID` (bukan lintas tenant),
  `/api/logs/login` owner/superadmin, `/api/admin/users` owner/superadmin,
  webhook memakai `x-webhook-secret`. Padanan Next untuk `/api/logs/login` belum
  ditemukan saat audit.

## Beda perilaku yang tidak mematahkan frontend (keputusanmu diperlukan)

| # | Beda | Sisi Go | Sisi Next | Catatan |
|---|---|---|---|---|
| B1 | Kegagalan DB/hash saat registrasi | 500 `{error:"Terjadi kesalahan. Coba lagi."}` (`handlers_auth_extra.go:61-77`) | 200 sukses generik (`register/route.ts:93-96,116-118`) | **Bukan soal email duplikat** — untuk email yang sudah ada keduanya balas 200 `{ok:true}` (Go: `created=false` di `handlers_auth_extra.go:80-90`; Next: `register/route.ts:91-96`). Hanya kegagalan DB nyata yang berbeda; jarang dan tidak memutus frontend. |
| B2 | Rate limit registrasi 5/IP/10 menit | tidak ada | ada (429) | Jenis limit in-memory → sudah disepakati tidak diport. |
| B3 | `POST /api/members` status | 201 | 200 | Frontend hanya cek `res.ok`/`data.ok`. |
| B4 | 404 vs 500 saat baris tak ada (members, member-types) | 404 rapi | 500 dari `.single()` | Go lebih baik; frontend tampil pesan. |
| B5 | `invoice_ttd` untuk staf | disembunyikan | disembunyikan | **Klaim lane keliru**: daftar `KEY_PRIVAT` Go dan Next identik (`handlers_settings.go:19-27` vs `settings/route.ts:17`). |
| B6 | Envelope error login | `{ok:false,error:{...}}` + `retryAfterMs` | `{error, retryAfterMs}` mentah | `api-client.js:24-33` menerima keduanya → bukan masalah. Lockout/cooldown Go ada (`handlers_login.go:193-244`). |
| B7 | Setting `value:null` | SQL NULL | teks `"null"` | Tidak ada jalur frontend yang mengirim null. |
| B8 | `/api/profiles?email=` | `lower(email)` | case-sensitive | Go lebih toleran; frontend kirim email apa adanya. |
| B9 | `/api/profiles` field ekstra | `subscribed_until` | tidak di-select | Field tambahan diabaikan klien. |
| B10 | `?ids=` kosong pada inventory | daftar kosong | katalog penuh | Frontend tidak pernah mengirim `ids` kosong. |
| B11 | `GET /api/dashboard` timestamp invalid | 400 eksplisit | diteruskan ke RPC | Input invalid tak dikirim UI. |

## Cakupan yang belum tuntas

- `GET /api/transactions/{id}` dan `/api/transaction-items` (GET/POST): kesetaraan
  `kolom`/`nested`, bentuk detail, dan pemetaan item belum dibandingkan baris demi
  baris.
- Promo: kalkulasi diskon, aturan tanggal/kuota, dan tenant filter `use` belum
  dibandingkan penuh.
- Blacklist CRUD: role (owner vs superadmin), copy-on-create foto, dan pesan tiap
  validasi belum dibandingkan penuh.
- Manajemen/admin (`admin/users`, `admin/data`), invoice-counter, invoice header,
  pembayaran (upload/photo/export/reminder/ack/purge), telegram, webhooks: baru
  sebagian dibandingkan.
- Suite smoke tidak menangkap G1–G4 karena skenario belum menyentuh
  filter/pencarian, referensi lintas tenant, SN maintenance, dan setting staf.

## Rencana perbaikan (menunggu persetujuan)

1. Lane TRANS: G1 (parse seluruh query param + preset kolom + nested) di
   `handlers_transactions.go` + `db/transactions.go`; G3 (`guardMaintenance`)
   POST+PATCH; G2 (validasi tenant `member_id` + `inventory_id` item) di
   `SaveTransaction`.
2. Lane SETTINGS: G4 pakai `db.TenantID` untuk GET/POST settings. **Selesai**
   (belum diuji smoke).
3. Lane PEMBAYARAN: G5 cari `transactions.id` + tenant, bukan `id_transaksi` +
   pola UUID; perbaiki skenario smoke agar memakai nilai seperti frontend.
4. Lane TRANS-B: G6 terima body flat + normalisasi item/payment bentuk frontend
   seperti RPC (dan periksa paritas PATCH `transactions/[id]`).
5. Setelah perbaikan: tambah skenario smoke untuk G1–G6 (pencarian/hideRiwayat,
   referensi lintas tenant, SN maintenance, setting staf, upload bukti bayar
   dengan ID numerik, POST flat bentuk frontend + assert `transaction_items`)
   lalu jalankan batch penuh.
