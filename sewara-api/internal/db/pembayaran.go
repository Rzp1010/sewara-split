package db

import (
	"context"
	"encoding/json"
	"fmt"
	"time"
)

// PembayaranTransaksi memuat kolom yang diperlukan ekspor dan reminder.
type PembayaranTransaksi struct {
	ID                     int64
	IDTransaksi, NoInvoice *string
	Penyewa                string
	Pembayaran             json.RawMessage
}

func (d *DB) ListPembayaranTransaksi(ctx context.Context, userID string) ([]PembayaranTransaksi, error) {
	var hasil []PembayaranTransaksi
	err := d.InTenant(ctx, userID, func(q Querier) error {
		rows, err := q.Query(ctx, `SELECT id,id_transaksi,no_invoice,penyewa,pembayaran FROM transactions ORDER BY id`)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var t PembayaranTransaksi
			if err := rows.Scan(&t.ID, &t.IDTransaksi, &t.NoInvoice, &t.Penyewa, &t.Pembayaran); err != nil {
				return err
			}
			hasil = append(hasil, t)
		}
		return rows.Err()
	})
	if err != nil {
		return nil, fmt.Errorf("membaca transaksi pembayaran: %w", err)
	}
	return hasil, nil
}

func (d *DB) UpsertPembayaranAck(ctx context.Context, userID, tenantID, bulan string, now time.Time) error {
	return d.InTenant(ctx, userID, func(q Querier) error {
		_, err := q.Exec(ctx, `INSERT INTO settings(user_id,key,value,updated_at) VALUES($1::uuid,'bukti_backup_ack',$2,$3) ON CONFLICT(user_id,key) DO UPDATE SET value=EXCLUDED.value,updated_at=EXCLUDED.updated_at`, tenantID, bulan, now)
		return err
	})
}

func (d *DB) TransaksiMilikTenant(ctx context.Context, userID, tenantID, transaksiID string) (bool, error) {
	found := false
	err := d.InTenant(ctx, userID, func(q Querier) error {
		return q.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM transactions WHERE id_transaksi=$1 AND user_id=$2::uuid)`, transaksiID, tenantID).Scan(&found)
	})
	return found, err
}
