package db

import (
	"context"
	"encoding/json"
	"fmt"
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
	JaminanSewa         *string         `json:"jaminan_sewa"`
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
	JaminanSewa         *string         `json:"jaminan_sewa"`
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

// GetTransactions membaca daftar transaksi tenant, dengan filter opsional.
func (d *DB) GetTransactions(ctx context.Context, userID string, opts TransactionQueryOptions) ([]Transaction, error) {
	// ponytail: pagination/filter kompleks belum lengkap; tambah saat frontend butuh
	var transactions []Transaction
	err := d.InTenant(ctx, userID, func(q Querier) error {
		rows, err := q.Query(ctx, `
			SELECT id, id_transaksi, no_invoice, penyewa, hp_penyewa, alamat_penyewa, jaminan_sewa,
			       waktu_ambil_rencana, waktu_kembali_rencana, waktu_ambil_aktual, waktu_kembali_aktual,
			       status, items, denda, biaya, durasi_teks, total_akhir, pembayaran, "riwayatDilayani",
			       dilayani_oleh, diskon, member_id, created_by, updated_by, dp_hangus, dp_hangus_aturan,
			       printilan, user_id::text, created_at, updated_at
			FROM transactions
			ORDER BY created_at DESC`)
		if err != nil {
			return err
		}
		defer rows.Close()

		for rows.Next() {
			var t Transaction
			if err := rows.Scan(&t.ID, &t.IDTransaksi, &t.NoInvoice, &t.Penyewa, &t.HPPenyewa, &t.AlamatPenyewa,
				&t.JaminanSewa, &t.WaktuAmbilRencana, &t.WaktuKembaliRencana, &t.WaktuAmbilAktual, &t.WaktuKembaliAktual,
				&t.Status, &t.Items, &t.Denda, &t.Biaya, &t.DurasiTeks, &t.TotalAkhir, &t.Pembayaran, &t.RiwayatDilayani,
				&t.DilayaniOleh, &t.Diskon, &t.MemberID, &t.CreatedBy, &t.UpdatedBy, &t.DPHangus, &t.DPHangusAturan,
				&t.Printilan, &t.UserID, &t.CreatedAt, &t.UpdatedAt); err != nil {
				return err
			}
			transactions = append(transactions, t)
		}
		return rows.Err()
	})
	if err != nil {
		return nil, fmt.Errorf("membaca transactions: %w", err)
	}
	return transactions, nil
}

// SaveTransaction menyimpan transaksi + items + payments atomic (INSERT atau UPDATE, replace children).
func (d *DB) SaveTransaction(ctx context.Context, userID string, tx TransactionInput, items []TransactionItemInput, payments []TransactionPaymentInput) (*Transaction, error) {
	tenantID, err := d.TenantID(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("membaca tenant id: %w", err)
	}

	// ponytail: validasi FK member_id + inventory_id belum ada; tambah setelah smoke jalan

	pgTx, err := d.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin transaction: %w", err)
	}
	defer pgTx.Rollback(ctx)

	// Set role authenticated + app.user_id untuk RLS.
	if _, err := pgTx.Exec(ctx, "SET LOCAL role = authenticated"); err != nil {
		return nil, fmt.Errorf("set role: %w", err)
	}
	// GUC app.* tidak terima placeholder; pakai format langsung (userID sudah UUID tervalidasi).
	if _, err := pgTx.Exec(ctx, fmt.Sprintf("SET LOCAL app.user_id = '%s'", userID)); err != nil {
		return nil, fmt.Errorf("set app.user_id: %w", err)
	}

	var result Transaction
	// Cek apakah transaksi sudah ada (UPDATE) atau baru (INSERT).
	var exists bool
	err = pgTx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM transactions WHERE id=$1 AND user_id=$2)", tx.ID, tenantID).Scan(&exists)
	if err != nil {
		return nil, fmt.Errorf("cek transaksi existing: %w", err)
	}

	if exists {
		// UPDATE: merge field yang dikirim client.
		err = pgTx.QueryRow(ctx, `
			UPDATE transactions SET
				id_transaksi = COALESCE($2, id_transaksi),
				no_invoice = COALESCE($3, no_invoice),
				penyewa = COALESCE($4, penyewa),
				hp_penyewa = COALESCE($5, hp_penyewa),
				alamat_penyewa = COALESCE($6, alamat_penyewa),
				jaminan_sewa = COALESCE($7, jaminan_sewa),
				waktu_ambil_rencana = COALESCE($8, waktu_ambil_rencana),
				waktu_kembali_rencana = COALESCE($9, waktu_kembali_rencana),
				waktu_ambil_aktual = COALESCE($10, waktu_ambil_aktual),
				waktu_kembali_aktual = COALESCE($11, waktu_kembali_aktual),
				status = $12,
				items = $13,
				denda = $14,
				biaya = $15,
				durasi_teks = COALESCE($16, durasi_teks),
				total_akhir = $17,
				pembayaran = $18,
				"riwayatDilayani" = $19,
				dilayani_oleh = COALESCE($20, dilayani_oleh),
				diskon = $21,
				member_id = $22,
				dp_hangus = $23,
				dp_hangus_aturan = COALESCE($24, dp_hangus_aturan),
				printilan = $25,
				updated_at = now()
			WHERE id = $1 AND user_id = $26
			RETURNING id, id_transaksi, no_invoice, penyewa, hp_penyewa, alamat_penyewa, jaminan_sewa,
			          waktu_ambil_rencana, waktu_kembali_rencana, waktu_ambil_aktual, waktu_kembali_aktual,
			          status, items, denda, biaya, durasi_teks, total_akhir, pembayaran, "riwayatDilayani",
			          dilayani_oleh, diskon, member_id, created_by, updated_by, dp_hangus, dp_hangus_aturan,
			          printilan, user_id::text, created_at, updated_at`,
			tx.ID, tx.IDTransaksi, tx.NoInvoice, tx.Penyewa, tx.HPPenyewa, tx.AlamatPenyewa, tx.JaminanSewa,
			tx.WaktuAmbilRencana, tx.WaktuKembaliRencana, tx.WaktuAmbilAktual, tx.WaktuKembaliAktual,
			tx.Status, tx.Items, tx.Denda, tx.Biaya, tx.DurasiTeks, tx.TotalAkhir, tx.Pembayaran,
			tx.RiwayatDilayani, tx.DilayaniOleh, tx.Diskon, tx.MemberID, tx.DPHangus, tx.DPHangusAturan,
			tx.Printilan, tenantID).Scan(
			&result.ID, &result.IDTransaksi, &result.NoInvoice, &result.Penyewa, &result.HPPenyewa, &result.AlamatPenyewa,
			&result.JaminanSewa, &result.WaktuAmbilRencana, &result.WaktuKembaliRencana, &result.WaktuAmbilAktual,
			&result.WaktuKembaliAktual, &result.Status, &result.Items, &result.Denda, &result.Biaya, &result.DurasiTeks,
			&result.TotalAkhir, &result.Pembayaran, &result.RiwayatDilayani, &result.DilayaniOleh, &result.Diskon,
			&result.MemberID, &result.CreatedBy, &result.UpdatedBy, &result.DPHangus, &result.DPHangusAturan,
			&result.Printilan, &result.UserID, &result.CreatedAt, &result.UpdatedAt)
	} else {
		// INSERT baru.
		err = pgTx.QueryRow(ctx, `
			INSERT INTO transactions (
				id, id_transaksi, no_invoice, penyewa, hp_penyewa, alamat_penyewa, jaminan_sewa,
				waktu_ambil_rencana, waktu_kembali_rencana, waktu_ambil_aktual, waktu_kembali_aktual,
				status, items, denda, biaya, durasi_teks, total_akhir, pembayaran, "riwayatDilayani",
				dilayani_oleh, diskon, member_id, dp_hangus, dp_hangus_aturan, printilan, user_id
			) VALUES (
				$1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26
			)
			RETURNING id, id_transaksi, no_invoice, penyewa, hp_penyewa, alamat_penyewa, jaminan_sewa,
			          waktu_ambil_rencana, waktu_kembali_rencana, waktu_ambil_aktual, waktu_kembali_aktual,
			          status, items, denda, biaya, durasi_teks, total_akhir, pembayaran, "riwayatDilayani",
			          dilayani_oleh, diskon, member_id, created_by, updated_by, dp_hangus, dp_hangus_aturan,
			          printilan, user_id::text, created_at, updated_at`,
			tx.ID, tx.IDTransaksi, tx.NoInvoice, tx.Penyewa, tx.HPPenyewa, tx.AlamatPenyewa, tx.JaminanSewa,
			tx.WaktuAmbilRencana, tx.WaktuKembaliRencana, tx.WaktuAmbilAktual, tx.WaktuKembaliAktual,
			tx.Status, tx.Items, tx.Denda, tx.Biaya, tx.DurasiTeks, tx.TotalAkhir, tx.Pembayaran,
			tx.RiwayatDilayani, tx.DilayaniOleh, tx.Diskon, tx.MemberID, tx.DPHangus, tx.DPHangusAturan,
			tx.Printilan, tenantID).Scan(
			&result.ID, &result.IDTransaksi, &result.NoInvoice, &result.Penyewa, &result.HPPenyewa, &result.AlamatPenyewa,
			&result.JaminanSewa, &result.WaktuAmbilRencana, &result.WaktuKembaliRencana, &result.WaktuAmbilAktual,
			&result.WaktuKembaliAktual, &result.Status, &result.Items, &result.Denda, &result.Biaya, &result.DurasiTeks,
			&result.TotalAkhir, &result.Pembayaran, &result.RiwayatDilayani, &result.DilayaniOleh, &result.Diskon,
			&result.MemberID, &result.CreatedBy, &result.UpdatedBy, &result.DPHangus, &result.DPHangusAturan,
			&result.Printilan, &result.UserID, &result.CreatedAt, &result.UpdatedAt)
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
			if setClauses != "" {
				setClauses += ", "
			}
			setClauses += fmt.Sprintf("%s = $%d", k, i)
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
// ponytail: tambah field saat filter kompleks dibutuhkan (status, rentang tanggal, nested join)
type TransactionQueryOptions struct {
	Limit  int
	Offset int
}
