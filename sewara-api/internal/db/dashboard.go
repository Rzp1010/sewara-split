package db

import (
	"context"
	"encoding/json"
	"fmt"
)

// DashboardStats adalah hasil dua RPC dashboard, dikembalikan apa adanya sebagai
// jsonb. Sengaja tidak dipecah per field: bentuknya milik RPC, dan frontend sudah
// membacanya sebagai array; menyalin strukturnya di Go berarti dua tempat yang
// harus diubah setiap kali RPC berubah.
type DashboardStats struct {
	RekapStatus json.RawMessage
	Pembayaran  json.RawMessage
}

// TenantID mengembalikan id tenant aktif: owner_id kalau user adalah staf,
// user_id sendiri kalau user adalah owner. Sama dengan getTenantId() di backend Next.
//
// Dibaca lewat InTenant, jadi RLS yang memastikan user hanya bisa membaca
// barisnya sendiri.
func (d *DB) TenantID(ctx context.Context, userID string) (string, error) {
	tenant := userID
	err := d.InTenant(ctx, userID, func(q Querier) error {
		var ownerID *string
		if err := q.QueryRow(ctx, `SELECT owner_id::text FROM profiles WHERE user_id = $1::uuid`, userID).Scan(&ownerID); err != nil {
			return err
		}
		if ownerID != nil {
			tenant = *ownerID
		}
		return nil
	})
	if err != nil {
		return "", fmt.Errorf("membaca tenant id: %w", err)
	}
	return tenant, nil
}

// DashboardStats memanggil dua RPC agregasi dashboard.
//
// Tenant id dikirim eksplisit karena RPC-nya SECURITY DEFINER dan memeriksa
// sendiri bahwa p_user_id cocok dengan tenant pemanggil. Pemeriksaan itu
// dipertahankan: kalau konteks tenant di Go salah, database yang menolak,
// bukan handler yang harus ingat.
func (d *DB) DashboardStats(ctx context.Context, userID, tenantID string, mulai, akhir *string) (DashboardStats, error) {
	var stats DashboardStats

	err := d.InTenant(ctx, userID, func(q Querier) error {
		if err := q.QueryRow(ctx,
			`SELECT public.rpc_dashboard_rekap_status($1::uuid, $2::timestamptz, $3::timestamptz)`,
			tenantID, mulai, akhir).Scan(&stats.RekapStatus); err != nil {
			return fmt.Errorf("rekap status: %w", err)
		}
		if err := q.QueryRow(ctx,
			`SELECT public.rpc_dashboard_pembayaran($1::uuid, $2::timestamptz, $3::timestamptz)`,
			tenantID, mulai, akhir).Scan(&stats.Pembayaran); err != nil {
			return fmt.Errorf("pembayaran: %w", err)
		}
		return nil
	})
	if err != nil {
		return DashboardStats{}, fmt.Errorf("membaca statistik dashboard: %w", err)
	}

	// RPC bisa mengembalikan NULL (mis. tidak ada data); ubah ke array kosong
	// supaya frontend tidak perlu menangani null di sini juga.
	if len(stats.RekapStatus) == 0 || string(stats.RekapStatus) == "null" {
		stats.RekapStatus = json.RawMessage("[]")
	}
	if len(stats.Pembayaran) == 0 || string(stats.Pembayaran) == "null" {
		stats.Pembayaran = json.RawMessage("[]")
	}

	return stats, nil
}
