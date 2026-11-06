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
	MemberID  int64           `json:"member_id"`
	FotoDari  string          `json:"foto_dari"`
}

func GabungPool(pelanggan, members, riwayat []Pelanggan) []Pelanggan {
	all := make([]Pelanggan, 0, len(pelanggan)+len(members)+len(riwayat))
	all = append(all, pelanggan...)
	all = append(all, members...)
	all = append(all, riwayat...)
	out := make([]Pelanggan, 0, len(all))
	for _, p := range all {
		if p.HPNormal == "" {
			p.HPNormal = NormalisasiHP(p.HP)
		}
		p.FotoDari = "pelanggan"
		if p.MemberID != 0 {
			p.FotoDari = "member"
		}
		found := -1
		for i := range out {
			if samePoolPerson(out[i], p) {
				found = i
				break
			}
		}
		if found < 0 {
			out = append(out, p)
			continue
		}
		keep := &out[found]
		if keep.HP == "" {
			keep.HP = p.HP
		}
		if keep.HPNormal == "" {
			keep.HPNormal = p.HPNormal
		}
		if keep.HPNormal == "" {
			keep.HPNormal = NormalisasiHP(keep.HP)
		}
		if keep.Alamat == "" {
			keep.Alamat = p.Alamat
		}
		if keep.Catatan == "" {
			keep.Catatan = p.Catatan
		}
		if keep.MemberID == 0 && p.MemberID != 0 {
			keep.MemberID = p.MemberID
			keep.Foto = p.Foto
			keep.FotoDari = "member"
		}
	}
	return out
}

func samePoolPerson(a, b Pelanggan) bool {
	if strings.ToLower(strings.TrimSpace(a.Nama)) != strings.ToLower(strings.TrimSpace(b.Nama)) {
		return false
	}
	ah, bh := NormalisasiHP(a.HP), NormalisasiHP(b.HP)
	return ah == "" || bh == "" || ah == bh
}

func decodeFoto(raw []byte) []FotoPelanggan {
	var foto []FotoPelanggan
	_ = json.Unmarshal(raw, &foto)
	if foto == nil {
		foto = []FotoPelanggan{}
	}
	return foto
}

func ListPelanggan(ctx context.Context, d *DB, userID string) ([]Pelanggan, error) {
	var result []Pelanggan
	err := d.InTenant(ctx, userID, func(q Querier) error {
		read := func(query string) ([]Pelanggan, error) {
			rows, err := q.Query(ctx, query, userID)
			if err != nil {
				return nil, err
			}
			defer rows.Close()
			var list []Pelanggan
			for rows.Next() {
				var p Pelanggan
				var foto []byte
				if err := rows.Scan(&p.ID, &p.Nama, &p.HP, &p.HPNormal, &p.Alamat, &p.Catatan, &foto, &p.Sumber, &p.UpdatedAt, &p.MemberID); err != nil {
					return nil, err
				}
				p.Foto = decodeFoto(foto)
				list = append(list, p)
			}
			return list, rows.Err()
		}
		pel, err := read(`SELECT p.id,p.nama,p.hp,p.hp_normal,p.alamat,p.catatan,p.foto,'pelanggan',p.updated_at,0 FROM pelanggan p WHERE p.user_id=$1 ORDER BY p.nama`)
		if err != nil {
			return err
		}
		mem, err := read(`SELECT 0,m.nama,m.hp,'',m.alamat,'',m.foto_jaminan,'member',m.created_at,m.id FROM members m WHERE m.user_id=$1 ORDER BY m.nama`)
		if err != nil {
			return err
		}
		riw, err := read(`SELECT 0,t.penyewa,COALESCE(t.hp_penyewa,''),'',COALESCE(t.alamat_penyewa,''),'','[]'::jsonb,'riwayat',max(t.updated_at),0 FROM transactions t WHERE t.user_id=$1 AND btrim(t.penyewa)<>'' GROUP BY t.penyewa,t.hp_penyewa,t.alamat_penyewa ORDER BY 2,8`)
		if err != nil {
			return err
		}
		result = GabungPool(pel, mem, riw)
		return nil
	})
	return result, err
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
