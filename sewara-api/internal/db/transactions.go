package db

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

// Transaction adalah record transaksi sewa (booking/rental).
// Tag JSON snake_case wajib: frontend Next membaca nama field apa adanya.
type Transaction struct {
	ID                  int64           `json:"id"`
	IDTransaksi         *string         `json:"id_transaksi"`
	NoInvoice           *string         `json:"no_invoice"`
	Penyewa             string          `json:"penyewa"`
	HPPenyewa           *string         `json:"hp_penyewa"`
	AlamatPenyewa       *string         `json:"alamat_penyewa"`
	JaminanSewa         json.RawMessage `json:"jaminan_sewa"`
	WaktuAmbilRencana   *time.Time      `json:"waktu_ambil_rencana"`
	WaktuKembaliRencana *time.Time      `json:"waktu_kembali_rencana"`
	WaktuAmbilAktual    *time.Time      `json:"waktu_ambil_aktual"`
	WaktuKembaliAktual  *time.Time      `json:"waktu_kembali_aktual"`
	Status              string          `json:"status"`
	Items               json.RawMessage `json:"items"` // legacy denormalized JSON; read-only
	Denda               float64         `json:"denda"`
	Biaya               float64         `json:"biaya"`
	DurasiTeks          *string         `json:"durasi_teks"`
	TotalAkhir          float64         `json:"total_akhir"`
	Pembayaran          json.RawMessage `json:"pembayaran"` // legacy denormalized JSON; read-only
	RiwayatDilayani     json.RawMessage `json:"riwayatDilayani"`
	DilayaniOleh        *string         `json:"dilayani_oleh"`
	Diskon              json.RawMessage `json:"diskon"`
	MemberID            *int64          `json:"member_id"`
	CreatedBy           *string         `json:"created_by"`
	UpdatedBy           *string         `json:"updated_by"`
	DPHangus            float64         `json:"dp_hangus"`
	DPHangusAturan      *string         `json:"dp_hangus_aturan"`
	Printilan           json.RawMessage `json:"printilan"`
	UserID              string          `json:"user_id"`
	CreatedAt           time.Time       `json:"created_at"`
	UpdatedAt           time.Time       `json:"updated_at"`
}

// TransactionItem adalah item sewa per transaksi (normalisasi child table).
type TransactionItem struct {
	ID                 int             `json:"id"`
	TransactionID      int64           `json:"transaction_id"`
	InventoryID        *int64          `json:"inventory_id"`
	ItemName           string          `json:"item_name"`
	ItemType           *string         `json:"item_type"`
	Qty                int             `json:"qty"`
	UnitPrice          float64         `json:"unit_price"`
	Subtotal           float64         `json:"subtotal"`
	RateType           *string         `json:"rate_type"`
	SerialNumber       *string         `json:"serial_number"`
	AssignedComponents json.RawMessage `json:"assigned_components"`
	UserID             string          `json:"user_id"`
	CreatedAt          time.Time       `json:"created_at"`
	UpdatedAt          time.Time       `json:"updated_at"`
}

// TransactionPayment adalah pembayaran per transaksi (normalisasi child table).
type TransactionPayment struct {
	ID            int       `json:"id"`
	TransactionID int64     `json:"transaction_id"`
	Amount        float64   `json:"amount"`
	PaymentMethod string    `json:"payment_method"`
	PaymentDate   time.Time `json:"payment_date"`
	Notes         *string   `json:"notes"`
	UserID        string    `json:"user_id"`
	CreatedAt     time.Time `json:"created_at"`
}

// TransactionInput adalah payload create/update transaction dari client.
type TransactionInput struct {
	ID                  int64           `json:"id"`
	IDTransaksi         *string         `json:"id_transaksi"`
	NoInvoice           *string         `json:"no_invoice"`
	Penyewa             string          `json:"penyewa"`
	HPPenyewa           *string         `json:"hp_penyewa"`
	AlamatPenyewa       *string         `json:"alamat_penyewa"`
	JaminanSewa         json.RawMessage `json:"jaminan_sewa"`
	WaktuAmbilRencana   *time.Time      `json:"waktu_ambil_rencana"`
	WaktuKembaliRencana *time.Time      `json:"waktu_kembali_rencana"`
	WaktuAmbilAktual    *time.Time      `json:"waktu_ambil_aktual"`
	WaktuKembaliAktual  *time.Time      `json:"waktu_kembali_aktual"`
	Status              string          `json:"status"`
	Items               json.RawMessage `json:"items"`
	Denda               float64         `json:"denda"`
	Biaya               float64         `json:"biaya"`
	DurasiTeks          *string         `json:"durasi_teks"`
	TotalAkhir          float64         `json:"total_akhir"`
	Pembayaran          json.RawMessage `json:"pembayaran"`
	RiwayatDilayani     json.RawMessage `json:"riwayatDilayani"`
	DilayaniOleh        *string         `json:"dilayani_oleh"`
	Diskon              json.RawMessage `json:"diskon"`
	MemberID            *int64          `json:"member_id"`
	DPHangus            float64         `json:"dp_hangus"`
	DPHangusAturan      *string         `json:"dp_hangus_aturan"`
	Printilan           json.RawMessage `json:"printilan"`

	// Present mencatat kunci yang benar-benar ada di body (diisi handler dari
	// JSON mentah). rpc_save_transaction memakai `p_transaction ? 'kunci'` untuk
	// beberapa kolom: kunci yang tidak dikirim berarti "pertahankan nilai lama",
	// bukan "tulis nol". Tanpa peta ini perbedaan itu tidak bisa ditiru.
	Present map[string]bool `json:"-"`
}

// ada melaporkan apakah kunci dikirim client.
func (t TransactionInput) ada(kunci string) bool { return t.Present[kunci] }

// jaminanParam menormalkan jaminan lama menjadi array jsonb; nilai null/absen
// mempertahankan nilai lama pada UPDATE.
func (t TransactionInput) jaminanParam() any {
	if !t.ada("jaminan_sewa") {
		return nil
	}
	raw := strings.TrimSpace(string(t.JaminanSewa))
	if raw == "" || raw == "null" {
		return nil
	}
	if raw == `""` {
		return "[]"
	}
	if strings.HasPrefix(raw, "[") {
		return raw
	}
	var nilai string
	if json.Unmarshal(t.JaminanSewa, &nilai) == nil {
		if strings.HasPrefix(strings.TrimSpace(nilai), "[") {
			return nilai
		}
		if nilai == "" {
			return "[]"
		}
		b, _ := json.Marshal([]string{nilai})
		return string(b)
	}
	return raw
}

// invoiceEfektif meniru v_invoice RPC, yaitu
// NULLIF(COALESCE(no_invoice, id_transaksi), "") — kunci yang ada tapi berisi
// string kosong tetap menang dan menghasilkan NULL, bukan jatuh ke id_transaksi.
func (t TransactionInput) invoiceEfektif() *string {
	v := t.NoInvoice
	if v == nil {
		v = t.IDTransaksi
	}
	if v == nil || *v == "" {
		return nil
	}
	return v
}

// jsonJenis melaporkan jenis JSON dari raw ("array", "object", atau "" bila
// kosong/tidak sesuai). Dipakai supaya kolom jsonb hanya ditimpa saat tipenya
// benar — sama dengan CASE WHEN jsonb_typeof(...) = 'array'/'object' di RPC.
func jsonJenis(raw json.RawMessage) string {
	isi := strings.TrimSpace(string(raw))
	switch {
	case isi == "":
		return ""
	case isi[0] == '[':
		return "array"
	case isi[0] == '{':
		return "object"
	}
	return ""
}

// jsonbAwal mengembalikan raw bila tipenya sesuai, kalau tidak pakai nilai
// bawaan kolom (RPC memakai CASE WHEN jsonb_typeof(...) ... ELSE '<default>').
func jsonbAwal(raw json.RawMessage, jenis, def string) json.RawMessage {
	if jsonJenis(raw) == jenis {
		return raw
	}
	return json.RawMessage(def)
}

// TransactionItemInput adalah payload item dari client.
type TransactionItemInput struct {
	InventoryID        *int64          `json:"inventory_id"`
	ItemName           string          `json:"item_name"`
	ItemType           *string         `json:"item_type"`
	Qty                int             `json:"qty"`
	UnitPrice          float64         `json:"unit_price"`
	Subtotal           float64         `json:"subtotal"`
	RateType           *string         `json:"rate_type"`
	SerialNumber       *string         `json:"serial_number"`
	AssignedComponents json.RawMessage `json:"assigned_components"`
}

// TransactionPaymentInput adalah payload payment dari client.
type TransactionPaymentInput struct {
	Amount        float64   `json:"amount"`
	PaymentMethod string    `json:"payment_method"`
	PaymentDate   time.Time `json:"payment_date"`
	Notes         *string   `json:"notes"`
}

// presetKolomTransaksi menyalin konstanta KOLOM di
// app/api/transactions/route.ts. Urutan nama = urutan kunci JSON hasil, jadi
// bentuk baris per preset sama persis dengan backend Next.
var presetKolomTransaksi = map[string][]string{
	"ringkas": {"id", "no_invoice", "penyewa", "status", "total_akhir", "biaya", "denda",
		"waktu_ambil_rencana", "waktu_kembali_rencana", "waktu_kembali_aktual"},
	"kartu": {"id", "no_invoice", "penyewa", "hp_penyewa", "alamat_penyewa", "jaminan_sewa", "status",
		"items", "waktu_ambil_rencana", "waktu_kembali_rencana", "durasi_teks", "total_akhir",
		"pembayaran", "biaya", "denda", "diskon", "dilayani_oleh", "riwayatDilayani", "printilan"},
	"laporan": {"id", "no_invoice", "penyewa", "hp_penyewa", "alamat_penyewa", "jaminan_sewa", "status",
		"waktu_kembali_rencana", "waktu_kembali_aktual", "biaya", "denda", "total_akhir", "pembayaran",
		"dp_hangus", "dp_hangus_aturan", "printilan"},
	"statistik": {"id", "status", "total_akhir"},
}

// kolomTransaksiDefault adalah `*` (kolom preset tidak dikenal): seluruh kolom
// tabel, urutan sama dengan backend Next.
var kolomTransaksiDefault = []string{
	"id", "id_transaksi", "no_invoice", "penyewa", "hp_penyewa", "alamat_penyewa", "jaminan_sewa",
	"waktu_ambil_rencana", "waktu_kembali_rencana", "waktu_ambil_aktual", "waktu_kembali_aktual",
	"status", "items", "denda", "biaya", "durasi_teks", "total_akhir", "pembayaran", "riwayatDilayani",
	"dilayani_oleh", "diskon", "member_id", "created_by", "updated_by", "dp_hangus", "dp_hangus_aturan",
	"printilan", "user_id", "created_at", "updated_at",
}

// exprKolomTransaksi menerjemahkan nama kolom preset menjadi ekspresi SQL.
// Hanya nama dari preset di atas yang pernah masuk ke sini, jadi tidak ada input
// pemanggil yang disambung ke SQL.
func exprKolomTransaksi(nama string) string {
	switch nama {
	case "user_id":
		return "t.user_id::text"
	case "riwayatDilayani":
		return `t."riwayatDilayani"`
	default:
		return "t." + nama
	}
}

// GetTransactions membaca daftar transaksi tenant sebagai array JSON mentah.
//
// Dikembalikan sebagai json.RawMessage, bukan []Transaction, karena `kolom`
// memilih subset kolom (preset) yang tidak bisa diwakili struct tetap tanpa
// menambah kunci yang tidak diminta. json_build_object menulis tepat kolom yang
// diminta, dan array_to_json merangkainya jadi satu array JSON.
func (d *DB) GetTransactions(ctx context.Context, userID string, opts TransactionQueryOptions) (json.RawMessage, error) {
	kolom := kolomTransaksiDefault
	if preset, ok := presetKolomTransaksi[opts.Kolom]; ok {
		kolom = preset
	}

	bagian := make([]string, 0, len(kolom)*2+4)
	for _, nama := range kolom {
		bagian = append(bagian, "'"+nama+"'", exprKolomTransaksi(nama))
	}
	if opts.Nested {
		bagian = append(bagian,
			"'transaction_items'", `(SELECT coalesce(json_agg(row_to_json(i) ORDER BY i.id), '[]'::json) FROM transaction_items i WHERE i.transaction_id = t.id)`,
			"'transaction_payments'", `(SELECT coalesce(json_agg(row_to_json(p) ORDER BY p.id), '[]'::json) FROM transaction_payments p WHERE p.transaction_id = t.id)`,
		)
	}

	where, args := susunFilterTransaksi(opts)
	sql := "SELECT coalesce(array_to_json(array(SELECT json_build_object(" +
		strings.Join(bagian, ", ") + ") FROM transactions t" + where + susunUrutanTransaksi(opts) + ")), '[]'::json)"

	var raw json.RawMessage
	err := d.InTenant(ctx, userID, func(q Querier) error {
		return q.QueryRow(ctx, sql, args...).Scan(&raw)
	})
	if err != nil {
		return nil, fmt.Errorf("membaca transactions: %w", err)
	}
	return raw, nil
}

// susunFilterTransaksi menyusun klausa WHERE + argumen, meniru urutan filter
// route Next. IDsAktif/StatusAktif membedakan "parameter tidak ada" (tanpa
// filter) dari "ada tapi kosong" (nol baris).
func susunFilterTransaksi(opts TransactionQueryOptions) (string, []any) {
	var conds []string
	var args []any
	add := func(format string, v any) {
		args = append(args, v)
		conds = append(conds, fmt.Sprintf(format, len(args)))
	}

	if opts.IDsAktif {
		if len(opts.IDs) == 0 {
			conds = append(conds, "FALSE")
		} else {
			add("t.id = ANY($%d::bigint[])", opts.IDs)
		}
	}
	if opts.StatusAktif {
		if len(opts.Status) == 0 {
			conds = append(conds, "FALSE")
		} else {
			add("t.status::text = ANY($%d::text[])", opts.Status)
		}
	}
	if opts.Cari != "" {
		add("t.penyewa ILIKE $%d", "%"+opts.Cari+"%")
	}
	if opts.HideRiwayat {
		conds = append(conds, "t.status::text NOT IN ('Selesai','Dibatalkan')")
	}
	if opts.Mulai != "" && opts.Akhir != "" {
		switch {
		case opts.TanggalKolom == "ambil":
			add("t.waktu_ambil_rencana >= $%d::timestamptz", opts.Mulai)
			add("t.waktu_ambil_rencana <= $%d::timestamptz", opts.Akhir)
		case opts.RentangKolom == "kembali":
			add("t.waktu_kembali_rencana >= $%d::timestamptz", opts.Mulai)
			add("t.waktu_kembali_rencana <= $%d::timestamptz", opts.Akhir)
		default:
			// default Next: overlap (mulai <= kembali_rencana dan ambil_rencana <= akhir)
			add("t.waktu_ambil_rencana <= $%d::timestamptz", opts.Akhir)
			add("t.waktu_kembali_rencana >= $%d::timestamptz", opts.Mulai)
		}
	}

	if len(conds) == 0 {
		return "", args
	}
	return " WHERE " + strings.Join(conds, " AND "), args
}

// susunUrutanTransaksi meniru cabang order/limit route Next: cari -> id DESC
// batas 100; limit -> id ASC + range; selain itu created_at DESC tanpa batas.
func susunUrutanTransaksi(opts TransactionQueryOptions) string {
	switch {
	case opts.Cari != "":
		return " ORDER BY t.id DESC LIMIT 100"
	case opts.Limit > 0:
		offset := opts.Offset
		if offset < 0 {
			offset = 0
		}
		return fmt.Sprintf(" ORDER BY t.id ASC LIMIT %d OFFSET %d", opts.Limit, offset)
	default:
		return " ORDER BY t.created_at DESC"
	}
}

// KondisiSNInventory membaca map kondisi_sn (jsonb) untuk daftar barang.
// Barang milik tenant lain tidak muncul (RLS), sehingga guard SN fail-open.
func (d *DB) KondisiSNInventory(ctx context.Context, userID string, ids []int64) (map[int64]json.RawMessage, error) {
	hasil := map[int64]json.RawMessage{}
	if len(ids) == 0 {
		return hasil, nil
	}
	err := d.InTenant(ctx, userID, func(q Querier) error {
		rows, err := q.Query(ctx, `SELECT id, kondisi_sn FROM inventory WHERE id = ANY($1::bigint[])`, ids)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var id int64
			var raw json.RawMessage
			if err := rows.Scan(&id, &raw); err != nil {
				return err
			}
			hasil[id] = raw
		}
		return rows.Err()
	})
	if err != nil {
		return nil, fmt.Errorf("membaca kondisi_sn: %w", err)
	}
	return hasil, nil
}

// ErrMemberLainTenant / ErrInventoryLainTenant meniru penolakan referensi lintas
// tenant oleh rpc_save_transaction (SQLSTATE 42501). Pesan disamakan persis
// dengan rpc supaya respons Go identik dengan backend Next.
var (
	ErrMemberLainTenant    = errors.New("Member does not belong to tenant")
	ErrInventoryLainTenant = errors.New("Inventory does not belong to tenant")
	// ErrTransaksiLainTenant meniru pesan rpc_save_transaction saat id sudah
	// dipakai tenant lain (SQLSTATE 42501).
	ErrTransaksiLainTenant = errors.New("Transaction belongs to another tenant")
)

// ErrKolomAsing dikembalikan UpdateTransaction saat body memuat kunci yang bukan
// kolom tabel transactions. Backend Next memakai PostgREST yang menolak kolom
// tak dikenal; tanpa daftar putih, nama kunci JSON akan disambung mentah ke SQL.
type ErrKolomAsing struct{ Kolom string }

func (e ErrKolomAsing) Error() string { return "kolom transaksi tidak dikenal: " + e.Kolom }

// kolomTransaksiBolehDiubah memetakan nama kolom JSON (seperti yang dikirim
// frontend) ke ekspresi SQL-nya. `id`, `user_id`, `created_at`, dan `updated_at`
// tidak ada di sini — handler sudah membuangnya sebelum sampai ke fungsi ini.
var kolomTransaksiBolehDiubah = map[string]string{
	"id_transaksi":          "id_transaksi",
	"no_invoice":            "no_invoice",
	"penyewa":               "penyewa",
	"hp_penyewa":            "hp_penyewa",
	"alamat_penyewa":        "alamat_penyewa",
	"jaminan_sewa":          "jaminan_sewa",
	"waktu_ambil_rencana":   "waktu_ambil_rencana",
	"waktu_kembali_rencana": "waktu_kembali_rencana",
	"waktu_ambil_aktual":    "waktu_ambil_aktual",
	"waktu_kembali_aktual":  "waktu_kembali_aktual",
	"status":                "status",
	"items":                 "items",
	"denda":                 "denda",
	"biaya":                 "biaya",
	"durasi_teks":           "durasi_teks",
	"total_akhir":           "total_akhir",
	"pembayaran":            "pembayaran",
	"riwayatDilayani":       `"riwayatDilayani"`,
	"dilayani_oleh":         "dilayani_oleh",
	"diskon":                "diskon",
	"member_id":             "member_id",
	"created_by":            "created_by",
	"updated_by":            "updated_by",
	"dp_hangus":             "dp_hangus",
	"dp_hangus_aturan":      "dp_hangus_aturan",
	"printilan":             "printilan",
}

// SaveTransaction menyimpan transaksi + items + payments atomic (INSERT atau UPDATE, replace children).
func (d *DB) SaveTransaction(ctx context.Context, userID string, tx TransactionInput, items []TransactionItemInput, payments []TransactionPaymentInput) (*Transaction, error) {
	tenantID, err := d.TenantID(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("membaca tenant id: %w", err)
	}

	pgTx, err := d.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin transaction: %w", err)
	}
	defer pgTx.Rollback(ctx)

	// Cek keberadaan transaksi SEBELUM role diubah: jalur ini memakai role
	// pemilik DB (bypass RLS), jadi id milik tenant lain tetap terlihat dan bisa
	// ditolak 42501 seperti rpc_save_transaction — bukan jatuh ke INSERT lalu
	// unique_violation 500.
	var adaTenant, adaGlobal bool
	if err := pgTx.QueryRow(ctx,
		"SELECT EXISTS(SELECT 1 FROM transactions WHERE id=$1 AND user_id=$2)",
		tx.ID, tenantID).Scan(&adaTenant); err != nil {
		return nil, fmt.Errorf("cek transaksi existing: %w", err)
	}
	if err := pgTx.QueryRow(ctx,
		"SELECT EXISTS(SELECT 1 FROM transactions WHERE id=$1)", tx.ID).Scan(&adaGlobal); err != nil {
		return nil, fmt.Errorf("cek transaksi lintas tenant: %w", err)
	}
	if adaGlobal && !adaTenant {
		return nil, ErrTransaksiLainTenant
	}

	// Set role authenticated + app.user_id untuk RLS.
	if _, err := pgTx.Exec(ctx, "SET LOCAL role = authenticated"); err != nil {
		return nil, fmt.Errorf("set role: %w", err)
	}
	// GUC app.* tidak terima placeholder; pakai format langsung (userID sudah UUID tervalidasi).
	if _, err := pgTx.Exec(ctx, fmt.Sprintf("SET LOCAL app.user_id = '%s'", userID)); err != nil {
		return nil, fmt.Errorf("set app.user_id: %w", err)
	}

	// G2: cegah referensi lintas tenant, sama dengan rpc_save_transaction
	// (SQLSTATE 42501). Dijalankan di transaksi yang sama, jadi kegagalan tidak
	// menyisakan baris separuh tersimpan.
	if tx.MemberID != nil {
		var milik bool
		if err := pgTx.QueryRow(ctx,
			"SELECT EXISTS(SELECT 1 FROM members WHERE id=$1 AND user_id=$2)",
			*tx.MemberID, tenantID).Scan(&milik); err != nil {
			return nil, fmt.Errorf("cek member tenant: %w", err)
		}
		if !milik {
			return nil, ErrMemberLainTenant
		}
	}
	for _, item := range items {
		if item.InventoryID == nil {
			continue
		}
		var milik bool
		if err := pgTx.QueryRow(ctx,
			"SELECT EXISTS(SELECT 1 FROM inventory WHERE id=$1 AND user_id=$2)",
			*item.InventoryID, tenantID).Scan(&milik); err != nil {
			return nil, fmt.Errorf("cek inventory tenant: %w", err)
		}
		if !milik {
			return nil, ErrInventoryLainTenant
		}
	}

	var result Transaction
	exists := adaTenant

	const kolomHasil = `id, id_transaksi, no_invoice, penyewa, hp_penyewa, alamat_penyewa, jaminan_sewa,
		waktu_ambil_rencana, waktu_kembali_rencana, waktu_ambil_aktual, waktu_kembali_aktual,
		status, items, denda, biaya, durasi_teks, total_akhir, pembayaran, "riwayatDilayani",
		dilayani_oleh, diskon, member_id, created_by, updated_by, dp_hangus, dp_hangus_aturan,
		printilan, user_id::text, created_at, updated_at`

	scanHasil := func(row interface{ Scan(dest ...any) error }) error {
		return row.Scan(
			&result.ID, &result.IDTransaksi, &result.NoInvoice, &result.Penyewa, &result.HPPenyewa, &result.AlamatPenyewa,
			&result.JaminanSewa, &result.WaktuAmbilRencana, &result.WaktuKembaliRencana, &result.WaktuAmbilAktual,
			&result.WaktuKembaliAktual, &result.Status, &result.Items, &result.Denda, &result.Biaya, &result.DurasiTeks,
			&result.TotalAkhir, &result.Pembayaran, &result.RiwayatDilayani, &result.DilayaniOleh, &result.Diskon,
			&result.MemberID, &result.CreatedBy, &result.UpdatedBy, &result.DPHangus, &result.DPHangusAturan,
			&result.Printilan, &result.UserID, &result.CreatedAt, &result.UpdatedAt)
	}

	if exists {
		// UPDATE: hanya kunci yang benar-benar dikirim yang ditimpa, sisanya
		// dipertahankan — meniru rpc_save_transaction: COALESCE untuk teks/waktu,
		// `? 'kunci'` untuk nilai yang boleh nol/null, jsonb_typeof untuk jsonb.
		set := []string{"updated_at = now()"}
		args := []any{tx.ID}
		tambah := func(expr string, v any) {
			args = append(args, v)
			set = append(set, fmt.Sprintf(expr, len(args)))
		}

		tambah("id_transaksi = COALESCE($%d, id_transaksi)", tx.IDTransaksi)
		tambah("no_invoice = COALESCE($%d, no_invoice)", tx.invoiceEfektif())
		tambah("penyewa = COALESCE($%d, penyewa)", tx.Penyewa)
		tambah("hp_penyewa = COALESCE($%d, hp_penyewa)", tx.HPPenyewa)
		tambah("alamat_penyewa = COALESCE($%d, alamat_penyewa)", tx.AlamatPenyewa)
		tambah("jaminan_sewa = COALESCE($%d::jsonb, jaminan_sewa)", tx.jaminanParam())
		tambah("waktu_ambil_rencana = COALESCE($%d, waktu_ambil_rencana)", tx.WaktuAmbilRencana)
		tambah("waktu_kembali_rencana = COALESCE($%d, waktu_kembali_rencana)", tx.WaktuKembaliRencana)
		tambah("waktu_ambil_aktual = COALESCE($%d, waktu_ambil_aktual)", tx.WaktuAmbilAktual)
		tambah("waktu_kembali_aktual = COALESCE($%d, waktu_kembali_aktual)", tx.WaktuKembaliAktual)

		// status: kunci tidak ada / kosong = pertahankan nilai lama.
		var status any
		if tx.ada("status") && tx.Status != "" {
			status = tx.Status
		}
		tambah("status = COALESCE($%d::enum_status_transaksi, status)", status)

		// Nilai angka: ditulis hanya bila kunci ada (0 pun sah).
		for _, angka := range []struct {
			kunci, kolom string
			nilai        float64
		}{
			{"denda", "denda", tx.Denda},
			{"biaya", "biaya", tx.Biaya},
			{"total_akhir", "total_akhir", tx.TotalAkhir},
			{"dp_hangus", "dp_hangus", tx.DPHangus},
		} {
			if tx.ada(angka.kunci) {
				tambah(angka.kolom+" = $%d", angka.nilai)
			}
		}

		tambah("durasi_teks = COALESCE($%d, durasi_teks)", tx.DurasiTeks)
		tambah("dilayani_oleh = COALESCE($%d, dilayani_oleh)", tx.DilayaniOleh)
		tambah("dp_hangus_aturan = COALESCE($%d, dp_hangus_aturan)", tx.DPHangusAturan)

		if tx.ada("member_id") {
			tambah("member_id = $%d", tx.MemberID)
		}
		if jsonJenis(tx.Items) == "array" {
			tambah("items = $%d::jsonb", tx.Items)
		}
		if jsonJenis(tx.Pembayaran) == "object" {
			tambah("pembayaran = $%d::jsonb", tx.Pembayaran)
		}
		if jsonJenis(tx.Diskon) == "object" {
			tambah("diskon = $%d::jsonb", tx.Diskon)
		}
		if jsonJenis(tx.RiwayatDilayani) == "array" {
			tambah(`"riwayatDilayani" = $%d::jsonb`, tx.RiwayatDilayani)
		}
		if tx.ada("printilan") {
			tambah("printilan = $%d::jsonb", jsonbAwal(tx.Printilan, "array", "[]"))
		}

		args = append(args, tenantID)
		query := fmt.Sprintf("UPDATE transactions SET %s WHERE id = $1 AND user_id = $%d RETURNING %s",
			strings.Join(set, ", "), len(args), kolomHasil)
		err = scanHasil(pgTx.QueryRow(ctx, query, args...))
	} else {
		// INSERT: nilai bawaan seperti RPC — kolom jsonb tidak pernah NULL dan
		// no_invoice jatuh ke id_transaksi.
		status := tx.Status
		if status == "" {
			status = "Booking"
		}
		err = scanHasil(pgTx.QueryRow(ctx, `
			INSERT INTO transactions (
				id, id_transaksi, no_invoice, penyewa, hp_penyewa, alamat_penyewa, jaminan_sewa,
				waktu_ambil_rencana, waktu_kembali_rencana, waktu_ambil_aktual, waktu_kembali_aktual,
				status, items, denda, biaya, durasi_teks, total_akhir, pembayaran, "riwayatDilayani",
				dilayani_oleh, diskon, member_id, dp_hangus, dp_hangus_aturan, printilan, user_id
			) VALUES (
				$1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26
			) RETURNING `+kolomHasil,
			tx.ID, tx.IDTransaksi, tx.invoiceEfektif(), tx.Penyewa, tx.HPPenyewa, tx.AlamatPenyewa, tx.jaminanParam(),
			tx.WaktuAmbilRencana, tx.WaktuKembaliRencana, tx.WaktuAmbilAktual, tx.WaktuKembaliAktual,
			status, jsonbAwal(tx.Items, "array", "[]"), tx.Denda, tx.Biaya, tx.DurasiTeks, tx.TotalAkhir,
			jsonbAwal(tx.Pembayaran, "object", "{}"), jsonbAwal(tx.RiwayatDilayani, "array", "[]"),
			tx.DilayaniOleh, jsonbAwal(tx.Diskon, "object", "{}"), tx.MemberID, tx.DPHangus, tx.DPHangusAturan,
			jsonbAwal(tx.Printilan, "array", "[]"), tenantID))
	}
	if err != nil {
		return nil, fmt.Errorf("simpan transaction parent: %w", err)
	}

	// Replace transaction_items.
	if _, err := pgTx.Exec(ctx, "DELETE FROM transaction_items WHERE transaction_id=$1 AND user_id=$2", tx.ID, tenantID); err != nil {
		return nil, fmt.Errorf("hapus transaction_items lama: %w", err)
	}
	for _, item := range items {
		_, err := pgTx.Exec(ctx, `
			INSERT INTO transaction_items (
				transaction_id, inventory_id, item_name, item_type, qty, unit_price, subtotal,
				rate_type, serial_number, assigned_components, user_id
			) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
			tx.ID, item.InventoryID, item.ItemName, item.ItemType, item.Qty, item.UnitPrice, item.Subtotal,
			item.RateType, item.SerialNumber, item.AssignedComponents, tenantID)
		if err != nil {
			return nil, fmt.Errorf("insert transaction_item: %w", err)
		}
	}

	// Replace transaction_payments.
	if _, err := pgTx.Exec(ctx, "DELETE FROM transaction_payments WHERE transaction_id=$1 AND user_id=$2", tx.ID, tenantID); err != nil {
		return nil, fmt.Errorf("hapus transaction_payments lama: %w", err)
	}
	for _, pmt := range payments {
		_, err := pgTx.Exec(ctx, `
			INSERT INTO transaction_payments (
				transaction_id, amount, payment_method, payment_date, notes, user_id
			) VALUES ($1, $2, $3, $4, $5, $6)`,
			tx.ID, pmt.Amount, pmt.PaymentMethod, pmt.PaymentDate, pmt.Notes, tenantID)
		if err != nil {
			return nil, fmt.Errorf("insert transaction_payment: %w", err)
		}
	}

	if err := pgTx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit transaction: %w", err)
	}

	return &result, nil
}

// TransactionDetail adalah transaksi + child items + payments (GET by id).
type TransactionDetail struct {
	Transaction
	Items    []TransactionItem    `json:"transaction_items"`
	Payments []TransactionPayment `json:"transaction_payments"`
}

// GetTransactionDetail membaca satu transaksi + items + payments milik tenant. Return nil jika tidak ditemukan.
func (d *DB) GetTransactionDetail(ctx context.Context, userID string, id int64) (*TransactionDetail, error) {
	detail := &TransactionDetail{Items: []TransactionItem{}, Payments: []TransactionPayment{}}
	found := false
	err := d.InTenant(ctx, userID, func(q Querier) error {
		var t Transaction
		err := q.QueryRow(ctx, `
			SELECT id, id_transaksi, no_invoice, penyewa, hp_penyewa, alamat_penyewa, jaminan_sewa,
			       waktu_ambil_rencana, waktu_kembali_rencana, waktu_ambil_aktual, waktu_kembali_aktual,
			       status, items, denda, biaya, durasi_teks, total_akhir, pembayaran, "riwayatDilayani",
			       dilayani_oleh, diskon, member_id, created_by, updated_by, dp_hangus, dp_hangus_aturan,
			       printilan, user_id::text, created_at, updated_at
			FROM transactions
			WHERE id = $1`, id).
			Scan(&t.ID, &t.IDTransaksi, &t.NoInvoice, &t.Penyewa, &t.HPPenyewa, &t.AlamatPenyewa,
				&t.JaminanSewa, &t.WaktuAmbilRencana, &t.WaktuKembaliRencana, &t.WaktuAmbilAktual, &t.WaktuKembaliAktual,
				&t.Status, &t.Items, &t.Denda, &t.Biaya, &t.DurasiTeks, &t.TotalAkhir, &t.Pembayaran, &t.RiwayatDilayani,
				&t.DilayaniOleh, &t.Diskon, &t.MemberID, &t.CreatedBy, &t.UpdatedBy, &t.DPHangus, &t.DPHangusAturan,
				&t.Printilan, &t.UserID, &t.CreatedAt, &t.UpdatedAt)
		if err != nil {
			if err.Error() == "no rows in result set" {
				return nil
			}
			return err
		}
		found = true
		detail.Transaction = t

		rows, err := q.Query(ctx, `
			SELECT id, transaction_id, inventory_id, item_name, item_type, qty, unit_price, subtotal,
			       rate_type, serial_number, assigned_components, user_id::text, created_at, updated_at
			FROM transaction_items
			WHERE transaction_id = $1
			ORDER BY id`, id)
		if err != nil {
			return err
		}
		for rows.Next() {
			var it TransactionItem
			if err := rows.Scan(&it.ID, &it.TransactionID, &it.InventoryID, &it.ItemName, &it.ItemType,
				&it.Qty, &it.UnitPrice, &it.Subtotal, &it.RateType, &it.SerialNumber, &it.AssignedComponents,
				&it.UserID, &it.CreatedAt, &it.UpdatedAt); err != nil {
				rows.Close()
				return err
			}
			detail.Items = append(detail.Items, it)
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return err
		}
		rows.Close()

		prows, err := q.Query(ctx, `
			SELECT id, transaction_id, amount, payment_method::text, payment_date, notes, user_id::text, created_at
			FROM transaction_payments
			WHERE transaction_id = $1
			ORDER BY id`, id)
		if err != nil {
			return err
		}
		for prows.Next() {
			var p TransactionPayment
			if err := prows.Scan(&p.ID, &p.TransactionID, &p.Amount, &p.PaymentMethod, &p.PaymentDate,
				&p.Notes, &p.UserID, &p.CreatedAt); err != nil {
				prows.Close()
				return err
			}
			detail.Payments = append(detail.Payments, p)
		}
		if err := prows.Err(); err != nil {
			prows.Close()
			return err
		}
		prows.Close()
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("membaca transaksi detail: %w", err)
	}
	if !found {
		return nil, nil
	}
	return detail, nil
}

// UpdateTransaction mengubah field parent transaksi. Return nil jika tidak ditemukan / bukan milik tenant.
// Items dan payments children tidak disentuh (pola Next PATCH).
func (d *DB) UpdateTransaction(ctx context.Context, userID string, id int64, fields map[string]any) (*Transaction, error) {
	var result Transaction
	err := d.InTenant(ctx, userID, func(q Querier) error {
		setClauses := ""
		args := []any{id}
		i := 2
		for k, v := range fields {
			// Daftar putih wajib: kunci JSON tidak boleh disambung ke SQL.
			kolom, boleh := kolomTransaksiBolehDiubah[k]
			if !boleh {
				return ErrKolomAsing{Kolom: k}
			}
			if setClauses != "" {
				setClauses += ", "
			}
			setClauses += fmt.Sprintf("%s = $%d", kolom, i)
			args = append(args, v)
			i++
		}

		query := fmt.Sprintf(`
			UPDATE transactions
			SET %s, updated_at = now()
			WHERE id = $1
			RETURNING id, id_transaksi, no_invoice, penyewa, hp_penyewa, alamat_penyewa, jaminan_sewa,
			          waktu_ambil_rencana, waktu_kembali_rencana, waktu_ambil_aktual, waktu_kembali_aktual,
			          status, items, denda, biaya, durasi_teks, total_akhir, pembayaran, "riwayatDilayani",
			          dilayani_oleh, diskon, member_id, created_by, updated_by, dp_hangus, dp_hangus_aturan,
			          printilan, user_id::text, created_at, updated_at`, setClauses)

		return q.QueryRow(ctx, query, args...).
			Scan(&result.ID, &result.IDTransaksi, &result.NoInvoice, &result.Penyewa, &result.HPPenyewa, &result.AlamatPenyewa,
				&result.JaminanSewa, &result.WaktuAmbilRencana, &result.WaktuKembaliRencana, &result.WaktuAmbilAktual,
				&result.WaktuKembaliAktual, &result.Status, &result.Items, &result.Denda, &result.Biaya, &result.DurasiTeks,
				&result.TotalAkhir, &result.Pembayaran, &result.RiwayatDilayani, &result.DilayaniOleh, &result.Diskon,
				&result.MemberID, &result.CreatedBy, &result.UpdatedBy, &result.DPHangus, &result.DPHangusAturan,
				&result.Printilan, &result.UserID, &result.CreatedAt, &result.UpdatedAt)
	})
	if err != nil {
		if err.Error() == "no rows in result set" {
			return nil, nil
		}
		return nil, fmt.Errorf("update transaksi: %w", err)
	}
	return &result, nil
}

// TransactionQueryOptions adalah parameter filter GetTransactions.
type TransactionQueryOptions struct {
	Kolom        string   // preset kolom (ringkas|kartu|laporan|statistik); kosong = semua
	Nested       bool     // sertakan transaction_items + transaction_payments
	IDs          []int64  // filter id (hanya bila IDsAktif)
	IDsAktif     bool     // parameter ids ada (walau kosong)
	Status       []string // filter status (hanya bila StatusAktif)
	StatusAktif  bool     // parameter status ada (walau kosong)
	Cari         string   // ilike penyewa, batas 100 baris
	HideRiwayat  bool     // kecualikan Selesai/Dibatalkan
	Mulai        string   // awal rentang (dipakai bila Mulai & Akhir terisi)
	Akhir        string   // akhir rentang
	RentangKolom string   // "kembali" -> pakai waktu_kembali_rencana
	TanggalKolom string   // "ambil" -> pakai waktu_ambil_rencana
	Limit        int
	Offset       int
}
