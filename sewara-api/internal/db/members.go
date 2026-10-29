package db

import (
	"context"
	"encoding/json"
	"time"

	"github.com/jackc/pgx/v5"
)

// FotoJaminanMember adalah satu dokumen jaminan member (sama struktur dengan blacklist).
type FotoJaminanMember struct {
	Label string `json:"label"`
	Path  string `json:"path"`
}

// Member adalah data member tenant.
type Member struct {
	ID           int64                `json:"id"`
	UserID       string               `json:"user_id"`
	Nama         string               `json:"nama"`
	HP           string               `json:"hp"`
	Alamat       string               `json:"alamat"`
	DiskonPersen float64              `json:"diskon_persen"`
	Status       string               `json:"status"`
	CreatedAt    time.Time            `json:"created_at"`
	TipeID       *int64               `json:"tipe_id"`
	Email        *string              `json:"email"`
	FotoJaminan  []FotoJaminanMember  `json:"foto_jaminan"`
	Catatan      *string              `json:"catatan"`
	// Field join dari member_types (diisi saat GET list).
	TipeNama            *string         `json:"tipeNama,omitempty"`
	DiskonDurasiAturan  json.RawMessage `json:"diskon_durasi_aturan,omitempty"`
}

// ListMembers membaca semua member tenant + join tipe.
func (db *DB) ListMembers(ctx context.Context, tenantID string) ([]Member, error) {
	rows, err := db.pool.Query(ctx, `
		SELECT m.id, m.user_id, m.nama, m.hp, m.alamat, m.diskon_persen, m.status,
		       m.created_at, m.tipe_id, m.email, m.foto_jaminan, m.catatan,
		       mt.nama AS tipe_nama, mt.diskon_persen AS tipe_diskon, mt.status AS tipe_status,
		       mt.diskon_durasi_aturan
		FROM members m
		LEFT JOIN member_types mt ON m.tipe_id = mt.id AND m.user_id = mt.user_id
		WHERE m.user_id = $1
		ORDER BY m.nama
	`, tenantID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var list []Member
	for rows.Next() {
		var m Member
		var fotoJSON []byte
		var tipeNama, tipeStatus *string
		var tipeDiskon *float64
		var tipeAturan []byte

		if err := rows.Scan(&m.ID, &m.UserID, &m.Nama, &m.HP, &m.Alamat, &m.DiskonPersen,
			&m.Status, &m.CreatedAt, &m.TipeID, &m.Email, &fotoJSON, &m.Catatan,
			&tipeNama, &tipeDiskon, &tipeStatus, &tipeAturan); err != nil {
			return nil, err
		}

		if len(fotoJSON) > 0 && string(fotoJSON) != "null" {
			_ = json.Unmarshal(fotoJSON, &m.FotoJaminan)
		}

		if tipeNama != nil && tipeStatus != nil && *tipeStatus == "aktif" {
			m.TipeNama = tipeNama
			if tipeDiskon != nil {
				m.DiskonPersen = *tipeDiskon
			}
			if len(tipeAturan) > 0 {
				m.DiskonDurasiAturan = tipeAturan
			}
		}

		list = append(list, m)
	}
	return list, rows.Err()
}

// GetMember membaca satu member milik tenant.
func (db *DB) GetMember(ctx context.Context, tenantID string, id int64) (Member, error) {
	var m Member
	var fotoJSON []byte

	err := db.pool.QueryRow(ctx, `
		SELECT id, user_id, nama, hp, alamat, diskon_persen, status, created_at,
		       tipe_id, email, foto_jaminan, catatan
		FROM members
		WHERE id = $1 AND user_id = $2
	`, id, tenantID).Scan(&m.ID, &m.UserID, &m.Nama, &m.HP, &m.Alamat, &m.DiskonPersen,
		&m.Status, &m.CreatedAt, &m.TipeID, &m.Email, &fotoJSON, &m.Catatan)

	if err != nil {
		if err == pgx.ErrNoRows {
			return m, ErrNotFound
		}
		return m, err
	}

	if len(fotoJSON) > 0 && string(fotoJSON) != "null" {
		_ = json.Unmarshal(fotoJSON, &m.FotoJaminan)
	}
	return m, nil
}

// InsertMember membuat member baru.
func (db *DB) InsertMember(ctx context.Context, tenantID, nama, hp, alamat string,
	diskonPersen float64, status string, tipeID *int64, email, catatan *string,
	fotoJaminan []FotoJaminanMember) (Member, error) {

	fotoJSON := []byte("[]")
	if len(fotoJaminan) > 0 {
		fotoJSON, _ = json.Marshal(fotoJaminan)
	}

	var m Member
	var fotoOut []byte
	err := db.pool.QueryRow(ctx, `
		INSERT INTO members (user_id, nama, hp, alamat, diskon_persen, status, tipe_id, email, catatan, foto_jaminan)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
		RETURNING id, user_id, nama, hp, alamat, diskon_persen, status, created_at, tipe_id, email, foto_jaminan, catatan
	`, tenantID, nama, hp, alamat, diskonPersen, status, tipeID, email, catatan, fotoJSON).
		Scan(&m.ID, &m.UserID, &m.Nama, &m.HP, &m.Alamat, &m.DiskonPersen, &m.Status,
			&m.CreatedAt, &m.TipeID, &m.Email, &fotoOut, &m.Catatan)

	if err != nil {
		return m, err
	}
	if len(fotoOut) > 0 && string(fotoOut) != "null" {
		_ = json.Unmarshal(fotoOut, &m.FotoJaminan)
	}
	return m, nil
}

// UpdateMember mengubah field member. Field nil tidak diubah (read-modify-write).
func (db *DB) UpdateMember(ctx context.Context, tenantID string, id int64,
	nama, hp, alamat *string, diskonPersen *float64, status *string,
	tipeID **int64, email, catatan **string, fotoJaminan *[]FotoJaminanMember) (Member, error) {

	lama, err := db.GetMember(ctx, tenantID, id)
	if err != nil {
		return lama, err
	}

	if nama != nil {
		lama.Nama = *nama
	}
	if hp != nil {
		lama.HP = *hp
	}
	if alamat != nil {
		lama.Alamat = *alamat
	}
	if diskonPersen != nil {
		lama.DiskonPersen = *diskonPersen
	}
	if status != nil {
		lama.Status = *status
	}
	if tipeID != nil {
		lama.TipeID = *tipeID
	}
	if email != nil {
		lama.Email = *email
	}
	if catatan != nil {
		lama.Catatan = *catatan
	}
	if fotoJaminan != nil {
		lama.FotoJaminan = *fotoJaminan
	}

	fotoJSON, _ := json.Marshal(lama.FotoJaminan)
	var fotoOut []byte

	err = db.pool.QueryRow(ctx, `
		UPDATE members
		SET nama = $3, hp = $4, alamat = $5, diskon_persen = $6, status = $7,
		    tipe_id = $8, email = $9, catatan = $10, foto_jaminan = $11
		WHERE id = $1 AND user_id = $2
		RETURNING id, user_id, nama, hp, alamat, diskon_persen, status, created_at, tipe_id, email, foto_jaminan, catatan
	`, id, tenantID, lama.Nama, lama.HP, lama.Alamat, lama.DiskonPersen, lama.Status,
		lama.TipeID, lama.Email, lama.Catatan, fotoJSON).
		Scan(&lama.ID, &lama.UserID, &lama.Nama, &lama.HP, &lama.Alamat, &lama.DiskonPersen,
			&lama.Status, &lama.CreatedAt, &lama.TipeID, &lama.Email, &fotoOut, &lama.Catatan)

	if err != nil {
		if err == pgx.ErrNoRows {
			return lama, ErrNotFound
		}
		return lama, err
	}
	if len(fotoOut) > 0 && string(fotoOut) != "null" {
		_ = json.Unmarshal(fotoOut, &lama.FotoJaminan)
	}
	return lama, nil
}

// DeleteMember menghapus member milik tenant.
func (db *DB) DeleteMember(ctx context.Context, tenantID string, id int64) error {
	tag, err := db.pool.Exec(ctx, `
		DELETE FROM members WHERE id = $1 AND user_id = $2
	`, id, tenantID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// SetFotoMember mengubah foto_jaminan member.
func (db *DB) SetFotoMember(ctx context.Context, tenantID string, id int64, foto []FotoJaminanMember) (Member, error) {
	fotoJSON, _ := json.Marshal(foto)
	var m Member
	var fotoOut []byte

	err := db.pool.QueryRow(ctx, `
		UPDATE members
		SET foto_jaminan = $3
		WHERE id = $1 AND user_id = $2
		RETURNING id, user_id, nama, hp, alamat, diskon_persen, status, created_at, tipe_id, email, foto_jaminan, catatan
	`, id, tenantID, fotoJSON).
		Scan(&m.ID, &m.UserID, &m.Nama, &m.HP, &m.Alamat, &m.DiskonPersen, &m.Status,
			&m.CreatedAt, &m.TipeID, &m.Email, &fotoOut, &m.Catatan)

	if err != nil {
		if err == pgx.ErrNoRows {
			return m, ErrNotFound
		}
		return m, err
	}
	if len(fotoOut) > 0 && string(fotoOut) != "null" {
		_ = json.Unmarshal(fotoOut, &m.FotoJaminan)
	}
	return m, nil
}
