package db

import (
	"context"
	"encoding/json"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

type FotoPelanggan struct {
	Label string `json:"label"`
	Path  string `json:"path"`
}

type Pelanggan struct {
	ID        int64           `json:"id"`
	Nama      string          `json:"nama"`
	HP        string          `json:"hp"`
	HPNormal  string          `json:"hp_normal"`
	Alamat    string          `json:"alamat"`
	Catatan   string          `json:"catatan"`
	Foto      []FotoPelanggan `json:"foto"`
	Sumber    string          `json:"sumber"`
	UpdatedAt time.Time       `json:"updated_at"`
}

func ListPelanggan(ctx context.Context, d *DB, userID string) ([]Pelanggan, error) {
	list := []Pelanggan{}
	err := d.InTenant(ctx, userID, func(q Querier) error {
		rows, err := q.Query(ctx, `SELECT id, nama, hp, hp_normal, alamat, catatan, foto, 'pelanggan', updated_at FROM pelanggan
			UNION ALL
			SELECT 0, t.penyewa, COALESCE(t.hp_penyewa,''), '', COALESCE(t.alamat_penyewa,''), '', '[]'::jsonb, 'riwayat', max(t.updated_at)
			FROM transactions t WHERE t.user_id = $1 AND btrim(t.penyewa) <> ''
			GROUP BY t.penyewa, t.hp_penyewa, t.alamat_penyewa
			ORDER BY 2, 8`, userID)
		if err != nil {
			return err
		}
		defer rows.Close()
		seen := map[string]bool{}
		for rows.Next() {
			var p Pelanggan
			var foto []byte
			if err := rows.Scan(&p.ID, &p.Nama, &p.HP, &p.HPNormal, &p.Alamat, &p.Catatan, &foto, &p.Sumber, &p.UpdatedAt); err != nil {
				return err
			}
			_ = json.Unmarshal(foto, &p.Foto)
			if p.Foto == nil {
				p.Foto = []FotoPelanggan{}
			}
			key := strings.ToLower(strings.TrimSpace(p.Nama)) + "\x00" + NormalisasiHP(p.HP)
			if p.HPNormal == "" {
				key = strings.ToLower(strings.TrimSpace(p.Nama)) + "\x00"
			}
			if seen[key] {
				continue
			}
			seen[key] = true
			list = append(list, p)
		}
		return rows.Err()
	})
	return list, err
}

func (d *DB) GetPelanggan(ctx context.Context, userID string, id int64) (Pelanggan, error) {
	var p Pelanggan
	var foto []byte
	err := d.InTenant(ctx, userID, func(q Querier) error {
		return q.QueryRow(ctx, `SELECT id,nama,hp,hp_normal,alamat,catatan,foto,'pelanggan',updated_at FROM pelanggan WHERE id=$1`, id).Scan(&p.ID, &p.Nama, &p.HP, &p.HPNormal, &p.Alamat, &p.Catatan, &foto, &p.Sumber, &p.UpdatedAt)
	})
	if err == pgx.ErrNoRows {
		return p, ErrNotFound
	}
	if err != nil {
		return p, err
	}
	_ = json.Unmarshal(foto, &p.Foto)
	if p.Foto == nil {
		p.Foto = []FotoPelanggan{}
	}
	return p, nil
}

func (d *DB) UpsertPelanggan(ctx context.Context, userID, nama, hp, alamat string) (Pelanggan, error) {
	nama = strings.TrimSpace(nama)
	hp = strings.TrimSpace(hp)
	alamat = strings.TrimSpace(alamat)
	normal := NormalisasiHP(hp)
	var p Pelanggan
	var foto []byte
	err := d.InTenant(ctx, userID, func(q Querier) error {
		var sql string
		if normal != "" {
			sql = `INSERT INTO pelanggan(user_id,nama,hp,hp_normal,alamat) VALUES($1,$2,$3,$4,$5) ON CONFLICT (user_id,hp_normal) WHERE hp_normal <> '' DO UPDATE SET nama=excluded.nama,hp=excluded.hp,hp_normal=excluded.hp_normal,alamat=excluded.alamat,updated_at=now() RETURNING id,nama,hp,hp_normal,alamat,catatan,foto,'pelanggan',updated_at`
		} else {
			sql = `INSERT INTO pelanggan(user_id,nama,hp,hp_normal,alamat) VALUES($1,$2,$3,'',$4) ON CONFLICT (user_id,(lower(btrim(nama)))) WHERE hp_normal = '' DO UPDATE SET nama=excluded.nama,hp=excluded.hp,hp_normal='',alamat=excluded.alamat,updated_at=now() RETURNING id,nama,hp,hp_normal,alamat,catatan,foto,'pelanggan',updated_at`
		}
		return q.QueryRow(ctx, sql, userID, nama, hp, normal, alamat).Scan(&p.ID, &p.Nama, &p.HP, &p.HPNormal, &p.Alamat, &p.Catatan, &foto, &p.Sumber, &p.UpdatedAt)
	})
	if err != nil {
		return p, err
	}
	_ = json.Unmarshal(foto, &p.Foto)
	if p.Foto == nil {
		p.Foto = []FotoPelanggan{}
	}
	return p, nil
}

func (d *DB) UpdatePelanggan(ctx context.Context, userID string, id int64, nama, hp, alamat, catatan string, foto []FotoPelanggan, ubahFoto bool) (Pelanggan, error) {
	normal := NormalisasiHP(hp)
	fotoJSON, _ := json.Marshal(foto)
	var p Pelanggan
	var out []byte
	err := d.InTenant(ctx, userID, func(q Querier) error {
		if ubahFoto {
			return q.QueryRow(ctx, `UPDATE pelanggan SET nama=$2,hp=$3,hp_normal=$4,alamat=$5,catatan=$6,foto=$7,updated_at=now() WHERE id=$1 RETURNING id,nama,hp,hp_normal,alamat,catatan,foto,'pelanggan',updated_at`, id, nama, hp, normal, alamat, catatan, fotoJSON).Scan(&p.ID, &p.Nama, &p.HP, &p.HPNormal, &p.Alamat, &p.Catatan, &out, &p.Sumber, &p.UpdatedAt)
		}
		return q.QueryRow(ctx, `UPDATE pelanggan SET nama=$2,hp=$3,hp_normal=$4,alamat=$5,catatan=$6,updated_at=now() WHERE id=$1 RETURNING id,nama,hp,hp_normal,alamat,catatan,foto,'pelanggan',updated_at`, id, nama, hp, normal, alamat, catatan).Scan(&p.ID, &p.Nama, &p.HP, &p.HPNormal, &p.Alamat, &p.Catatan, &out, &p.Sumber, &p.UpdatedAt)
	})
	if err == pgx.ErrNoRows {
		return p, ErrNotFound
	}
	if err != nil {
		return p, err
	}
	_ = json.Unmarshal(out, &p.Foto)
	if p.Foto == nil {
		p.Foto = []FotoPelanggan{}
	}
	return p, nil
}

func (d *DB) SetFotoPelanggan(ctx context.Context, userID string, id int64, foto []FotoPelanggan) (Pelanggan, error) {
	b, _ := json.Marshal(foto)
	var p Pelanggan
	var out []byte
	err := d.InTenant(ctx, userID, func(q Querier) error {
		return q.QueryRow(ctx, `UPDATE pelanggan SET foto=$2,updated_at=now() WHERE id=$1 RETURNING id,nama,hp,hp_normal,alamat,catatan,foto,'pelanggan',updated_at`, id, b).Scan(&p.ID, &p.Nama, &p.HP, &p.HPNormal, &p.Alamat, &p.Catatan, &out, &p.Sumber, &p.UpdatedAt)
	})
	if err == pgx.ErrNoRows {
		return p, ErrNotFound
	}
	if err != nil {
		return p, err
	}
	_ = json.Unmarshal(out, &p.Foto)
	return p, nil
}
