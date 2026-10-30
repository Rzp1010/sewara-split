package db

import (
	"context"
	"fmt"
	"strconv"
)

// NextInvoiceNumber menaikkan penghitung dan membaca format dalam satu transaksi tenant.
func (d *DB) NextInvoiceNumber(ctx context.Context, tenantID string) (string, error) {
	prefix, digit := "INV", 6
	var counter int
	err := d.InTenant(ctx, tenantID, func(q Querier) error {
		if err := q.QueryRow(ctx, `SELECT public.increment_invoice_counter(1)`).Scan(&counter); err != nil {
			return err
		}
		rows, err := q.Query(ctx, `SELECT key, value FROM settings WHERE key IN ('invoice_prefix', 'invoice_digit')`)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var key string
			var value *string
			if err := rows.Scan(&key, &value); err != nil {
				return err
			}
			v := UnquoteSetting(value)
			switch key {
			case "invoice_prefix":
				if v != "" {
					prefix = v
				}
			case "invoice_digit":
				if n, err := strconv.Atoi(v); err == nil && n != 0 {
					digit = n
				}
			}
		}
		return rows.Err()
	})
	if err != nil {
		return "", fmt.Errorf("membuat nomor invoice: %w", err)
	}
	return fmt.Sprintf("%s-%0*d", prefix, digit, counter), nil
}

func UnquoteSetting(value *string) string {
	if value == nil {
		return ""
	}
	v := *value
	if len(v) >= 2 && v[0] == '"' && v[len(v)-1] == '"' {
		return v[1 : len(v)-1]
	}
	return v
}

// ponytail: RPC wajib ada pada skema; tambah fallback manual hanya bila skema lama tanpa RPC perlu didukung.
