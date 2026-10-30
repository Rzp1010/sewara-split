package db

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"time"
)

// GetTransactionItems membaca item transaksi dalam konteks tenant.
//
// mode:
//   - "single": param = id transaksi
//   - "bulk":   param = daftar id dipisah koma (hasil dikelompokkan per transaksi)
//   - "all":    ringkasan semua item tenant (transaction_id, item_name, qty, item_type)
//
// Semua query lewat InTenant supaya GUC app.user_id + role authenticated
// terpasang; tanpa itu RLS dilewati (koneksi owner DB bypass policy).
func GetTransactionItems(d *DB, ctx context.Context, userID, mode, param string) (any, error) {
	var out any
	err := d.InTenant(ctx, userID, func(q Querier) error {
		switch mode {
		case "single":
			id, err := strconv.ParseInt(param, 10, 64)
			if err != nil {
				return fmt.Errorf("transaction_id tidak valid: %w", err)
			}
			rows, err := q.Query(ctx, `
				SELECT id, transaction_id, inventory_id, item_name, item_type, qty, unit_price, subtotal,
				       rate_type, serial_number, assigned_components, user_id::text, created_at, updated_at
				FROM transaction_items
				WHERE transaction_id = $1
				ORDER BY id`, id)
			if err != nil {
				return err
			}
			defer rows.Close()

			items := []TransactionItem{}
			for rows.Next() {
				var it TransactionItem
				if err := rows.Scan(&it.ID, &it.TransactionID, &it.InventoryID, &it.ItemName, &it.ItemType,
					&it.Qty, &it.UnitPrice, &it.Subtotal, &it.RateType, &it.SerialNumber,
					&it.AssignedComponents, &it.UserID, &it.CreatedAt, &it.UpdatedAt); err != nil {
					return err
				}
				items = append(items, it)
			}
			if err := rows.Err(); err != nil {
				return err
			}
			out = items
			return nil

		case "bulk":
			ids := parseIDSebagaiInt64(param)
			if len(ids) == 0 {
				out = map[string][]TransactionItem{}
				return nil
			}
			rows, err := q.Query(ctx, `
				SELECT id, transaction_id, inventory_id, item_name, item_type, qty, unit_price, subtotal,
				       rate_type, serial_number, assigned_components, user_id::text, created_at, updated_at
				FROM transaction_items
				WHERE transaction_id = ANY($1)
				ORDER BY id`, ids)
			if err != nil {
				return err
			}
			defer rows.Close()

			grouped := map[string][]TransactionItem{}
			for rows.Next() {
				var it TransactionItem
				if err := rows.Scan(&it.ID, &it.TransactionID, &it.InventoryID, &it.ItemName, &it.ItemType,
					&it.Qty, &it.UnitPrice, &it.Subtotal, &it.RateType, &it.SerialNumber,
					&it.AssignedComponents, &it.UserID, &it.CreatedAt, &it.UpdatedAt); err != nil {
					return err
				}
				key := strconv.FormatInt(it.TransactionID, 10)
				grouped[key] = append(grouped[key], it)
			}
			if err := rows.Err(); err != nil {
				return err
			}
			out = grouped
			return nil

		case "all":
			rows, err := q.Query(ctx, `
				SELECT transaction_id, item_name, qty, item_type
				FROM transaction_items
				ORDER BY id`)
			if err != nil {
				return err
			}
			defer rows.Close()

			items := []RingkasanItem{}
			for rows.Next() {
				var s RingkasanItem
				if err := rows.Scan(&s.TransactionID, &s.ItemName, &s.Qty, &s.ItemType); err != nil {
					return err
				}
				items = append(items, s)
			}
			if err := rows.Err(); err != nil {
				return err
			}
			out = items
			return nil

		default:
			return fmt.Errorf("mode tidak dikenal: %s", mode)
		}
	})
	return out, err
}

// RingkasanItem adalah bentuk ringkas untuk mode "all" (menu laporan).
type RingkasanItem struct {
	TransactionID int64   `json:"transaction_id"`
	ItemName      string  `json:"item_name"`
	Qty           int     `json:"qty"`
	ItemType      *string `json:"item_type"`
}

// ReplaceTransactionItems menghapus semua item satu transaksi lalu menulis ulang
// dari payload, atomic di dalam satu transaksi.
//
// Mengembalikan ErrNotFound bila transaksi tidak ada atau bukan milik tenant.
func ReplaceTransactionItems(d *DB, ctx context.Context, userID string, transactionID int, items []map[string]any) error {
	tenantID, err := d.TenantID(ctx, userID)
	if err != nil {
		return fmt.Errorf("membaca tenant id: %w", err)
	}

	return d.InTenant(ctx, userID, func(q Querier) error {
		var exists bool
		if err := q.QueryRow(ctx,
			"SELECT EXISTS(SELECT 1 FROM transactions WHERE id=$1 AND user_id=$2)",
			transactionID, tenantID).Scan(&exists); err != nil {
			return fmt.Errorf("cek transaksi: %w", err)
		}
		if !exists {
			return ErrNotFound
		}

		if _, err := q.Exec(ctx,
			"DELETE FROM transaction_items WHERE transaction_id=$1 AND user_id=$2",
			transactionID, tenantID); err != nil {
			return fmt.Errorf("hapus item lama: %w", err)
		}

		for _, raw := range items {
			invID := itemInt64(raw, "inventory_id", "ref.id")
			nama := itemString(raw, "nama", "ref.nama")
			if nama == "" {
				nama = "Unknown"
			}
			jenis := itemString(raw, "jenis", "ref.jenis")
			if jenis == "" {
				jenis = "satuan"
			}
			qty := int(itemFloat(raw, "qty"))
			if qty == 0 {
				qty = 1
			}
			harga := itemFloat(raw, "harga", "ref.harga")
			subtotal := float64(qty) * harga

			if _, err := q.Exec(ctx, `
				INSERT INTO transaction_items (
					transaction_id, inventory_id, item_name, item_type, qty, unit_price, subtotal,
					rate_type, serial_number, assigned_components, user_id
				) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
				transactionID, invID, nama, jenis, qty, harga, subtotal,
				itemStringPtr(raw, "tarif"), itemStringPtr(raw, "sn"),
				itemJSON(raw, "assignedSNs"), tenantID); err != nil {
				return fmt.Errorf("insert item: %w", err)
			}
		}
		return nil
	})
}

func parseIDSebagaiInt64(csv string) []int64 {
	var ids []int64
	for _, s := range strings.Split(csv, ",") {
		s = strings.TrimSpace(s)
		if s == "" {
			continue
		}
		if n, err := strconv.ParseInt(s, 10, 64); err == nil {
			ids = append(ids, n)
		}
	}
	return ids
}

// itemLookup mengambil nilai dari payload item, mendukung kunci nested "ref.id".
func itemLookup(m map[string]any, key string) (any, bool) {
	if i := strings.IndexByte(key, '.'); i >= 0 {
		parent, ok := m[key[:i]].(map[string]any)
		if !ok {
			return nil, false
		}
		v, ok := parent[key[i+1:]]
		return v, ok
	}
	v, ok := m[key]
	return v, ok
}

func itemInt64(m map[string]any, keys ...string) *int64 {
	for _, k := range keys {
		v, ok := itemLookup(m, k)
		if !ok || v == nil {
			continue
		}
		switch n := v.(type) {
		case float64:
			i := int64(n)
			return &i
		case int64:
			return &n
		case json.Number:
			if i, err := n.Int64(); err == nil {
				return &i
			}
		}
	}
	return nil
}

func itemFloat(m map[string]any, keys ...string) float64 {
	for _, k := range keys {
		v, ok := itemLookup(m, k)
		if !ok || v == nil {
			continue
		}
		switch n := v.(type) {
		case float64:
			return n
		case int64:
			return float64(n)
		case json.Number:
			if f, err := n.Float64(); err == nil {
				return f
			}
		}
	}
	return 0
}

func itemString(m map[string]any, keys ...string) string {
	for _, k := range keys {
		if v, ok := itemLookup(m, k); ok {
			if s, ok := v.(string); ok {
				return s
			}
		}
	}
	return ""
}

func itemStringPtr(m map[string]any, key string) *string {
	if s := itemString(m, key); s != "" {
		return &s
	}
	return nil
}

// itemJSON mengubah nilai apa pun menjadi json.RawMessage (untuk kolom jsonb).
func itemJSON(m map[string]any, key string) json.RawMessage {
	v, ok := itemLookup(m, key)
	if !ok || v == nil {
		return json.RawMessage("[]")
	}
	b, err := json.Marshal(v)
	if err != nil {
		return json.RawMessage("[]")
	}
	return b
}

// itemStringPtrKeys seperti itemStringPtr tapi menerima beberapa kandidat kunci.
func itemStringPtrKeys(m map[string]any, keys ...string) *string {
	if s := itemString(m, keys...); s != "" {
		return &s
	}
	return nil
}

// itemJSONKeys mengembalikan json.RawMessage dari kunci pertama yang ada.
func itemJSONKeys(m map[string]any, keys ...string) json.RawMessage {
	for _, k := range keys {
		v, ok := itemLookup(m, k)
		if !ok || v == nil {
			continue
		}
		if b, err := json.Marshal(v); err == nil {
			return b
		}
	}
	return json.RawMessage("[]")
}

// NormalizeTransactionItems mengubah array item payload client menjadi
// TransactionItemInput siap insert, menerima bentuk frontend (nama/harga/sn/
// assignedSNs/ref.id, sama seperti rpc_save_transaction + ReplaceTransactionItems)
// maupun bentuk kolom lama (item_name/unit_price/serial_number/dst). Fallback
// mengikuti RPC: nama "Unknown", jenis "satuan", qty 0 -> 1, harga 0,
// subtotal = qty*harga bila subtotal tidak dikirim, assigned default [].
func NormalizeTransactionItems(raw []any) []TransactionItemInput {
	out := make([]TransactionItemInput, 0, len(raw))
	for _, v := range raw {
		m, ok := v.(map[string]any)
		if !ok {
			continue
		}
		out = append(out, normalizeTransactionItem(m))
	}
	return out
}

func normalizeTransactionItem(m map[string]any) TransactionItemInput {
	nama := itemString(m, "nama", "ref.nama", "item_name")
	if nama == "" {
		nama = "Unknown"
	}
	jenis := itemString(m, "jenis", "ref.jenis", "item_type")
	if jenis == "" {
		jenis = "satuan"
	}
	qty := int(itemFloat(m, "qty"))
	if qty == 0 {
		qty = 1
	}
	harga := itemFloat(m, "harga", "ref.harga", "unit_price")
	subtotal := float64(qty) * harga
	if v, ok := itemLookup(m, "subtotal"); ok && v != nil {
		subtotal = itemFloat(m, "subtotal")
	}
	return TransactionItemInput{
		InventoryID:        itemInt64(m, "inventory_id", "ref.id"),
		ItemName:           nama,
		ItemType:           &jenis,
		Qty:                qty,
		UnitPrice:          harga,
		Subtotal:           subtotal,
		RateType:           itemStringPtrKeys(m, "tarif", "rate_type"),
		SerialNumber:       itemStringPtrKeys(m, "sn", "serial_number"),
		AssignedComponents: itemJSONKeys(m, "assignedSNs", "assigned_components"),
	}
}

// NormalizeTransactionPayments mengubah array payment payload client, menerima
// bentuk frontend (jumlah/tanggal/metode/catatan) maupun bentuk lama
// (amount/payment_date/payment_method/notes). Default metode "Tunai" dan
// tanggal now bila kosong (validasi jumlah <= 0 dilakukan pemanggil).
func NormalizeTransactionPayments(raw []any) []TransactionPaymentInput {
	out := make([]TransactionPaymentInput, 0, len(raw))
	for _, v := range raw {
		m, ok := v.(map[string]any)
		if !ok {
			continue
		}
		method := itemString(m, "metode", "payment_method")
		if method == "" {
			method = "Tunai"
		}
		var tanggal time.Time
		if s := itemString(m, "tanggal", "payment_date"); s != "" {
			if t, err := time.Parse(time.RFC3339, s); err == nil {
				tanggal = t
			}
		}
		out = append(out, TransactionPaymentInput{
			Amount:        itemFloat(m, "jumlah", "amount"),
			PaymentMethod: method,
			PaymentDate:   tanggal,
			Notes:         itemStringPtrKeys(m, "catatan", "notes"),
		})
	}
	return out
}
