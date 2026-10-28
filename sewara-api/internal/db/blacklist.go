package db

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// ErrBlacklistDuplikat dikembalikan saat pasangan nama+HP sudah ada di daftar
// tenant. Dipisahkan dari ErrNotFound supaya handler bisa membalas 409 dengan
// kode BLACKLIST_DUPLIKAT, bukan 500.
var ErrBlacklistDuplikat = errors.New("penyewa sudah ada di blacklist")

// FotoJaminan adalah satu dokumen jaminan milik entri blacklist.
//
// Nama field JSON camelCase karena mengikuti kontrak backend Next (rowToCamel):
// frontend membaca `fotoJaminan[].label` dan `.path` apa adanya. Mengganti ke
// snake_case akan membuat semua foto hilang dari UI tanpa error.
type FotoJaminan struct {
	Label string `json:"label"`
	Path  string `json:"path"`
}

// BlacklistEntry adalah satu baris penyewa_blacklist.
//
// `FotoJaminan` selalu slice tidak-nil supaya JSON-nya `[]`, bukan `null` —
// frontend langsung memetakan array ini.
type BlacklistEntry struct {
	ID          string        `json:"id"`
	Nama        string        `json:"nama"`
	HP          *string       `json:"hp"`
	Alamat      *string       `json:"alamat"`
	Alasan      string        `json:"alasan"`
	TransaksiID *string       `json:"transaksiId"`
	MemberID    *string       `json:"memberId"`
	FotoJaminan []FotoJaminan `json:"fotoJaminan"`
	AddedBy     *string       `json:"addedBy"`
	CreatedAt   *time.Time    `json:"createdAt"`
}

// sqlBlacklistKolom ditulis sekali supaya SELECT dan RETURNING tidak bisa
// berbeda kolom. Semua uuid di-CAST ke text: pgx memetakan uuid ke [16]byte,
// sedangkan frontend dan JSON butuh string.
const sqlBlacklistKolom = `id::text, nama, hp, alamat, alasan,
	transaksi_id::text, member_id::text, foto_jaminan, added_by::text, created_at`

func scanBlacklistEntry(row rowScanner) (BlacklistEntry, error) {
	var e BlacklistEntry
	var foto []byte

	if err := row.Scan(&e.ID, &e.Nama, &e.HP, &e.Alamat, &e.Alasan,
		&e.TransaksiID, &e.MemberID, &foto, &e.AddedBy, &e.CreatedAt); err != nil {
		return BlacklistEntry{}, err
	}

	e.FotoJaminan = decodeFotoJaminan(foto)
	return e, nil
}

// decodeFotoJaminan menormalkan kolom jsonb menjadi slice.
//
// Baris lama bisa berisi `null`, `{}`, atau bentuk yang tidak dikenali. Semua
// bentuk itu diperlakukan sebagai "tidak ada foto" supaya satu baris rusak tidak
// menggagalkan seluruh daftar blacklist.
func decodeFotoJaminan(raw []byte) []FotoJaminan {
	if len(raw) == 0 {
		return []FotoJaminan{}
	}
	var foto []FotoJaminan
	if err := json.Unmarshal(raw, &foto); err != nil {
		return []FotoJaminan{}
	}
	if foto == nil {
		return []FotoJaminan{}
	}
	return foto
}

// NormalisasiHP menyeragamkan nomor HP untuk pencocokan.
//
// Aturannya sama dengan helper frontend (hpNormal): buang semua non-digit, lalu
// satu angka 0 di depan diganti 6. "0812-345" dan "+62812 345" karena itu
// dianggap nomor yang sama. Fungsi ini diekspor karena handler check memakainya
// untuk masukan pencarian, bukan untuk menyimpan.
func NormalisasiHP(hp string) string {
	var b strings.Builder
	for _, r := range hp {
		if r >= '0' && r <= '9' {
			b.WriteRune(r)
		}
	}
	digit := b.String()
	if strings.HasPrefix(digit, "0") {
		return "6" + digit[1:]
	}
	return digit
}

// ListBlacklist membaca seluruh entri tenant, terbaru dulu.
func (d *DB) ListBlacklist(ctx context.Context, userID string) ([]BlacklistEntry, error) {
	entries := []BlacklistEntry{}

	err := d.InTenant(ctx, userID, func(q Querier) error {
		rows, err := q.Query(ctx, `SELECT `+sqlBlacklistKolom+`
			FROM penyewa_blacklist ORDER BY created_at DESC`)
		if err != nil {
			return err
		}
		defer rows.Close()

		for rows.Next() {
			e, err := scanBlacklistEntry(rows)
			if err != nil {
				return err
			}
			entries = append(entries, e)
		}
		return rows.Err()
	})
	if err != nil {
		return nil, fmt.Errorf("membaca blacklist: %w", err)
	}
	return entries, nil
}

// GetBlacklist membaca satu entri milik tenant.
//
// RLS yang menyaring tenant, jadi tidak ada filter user_id tambahan di sini —
// menambahkannya hanya akan menyalin logika yang sudah ditegakkan database.
func (d *DB) GetBlacklist(ctx context.Context, userID, id string) (BlacklistEntry, error) {
	var entry BlacklistEntry

	err := d.InTenant(ctx, userID, func(q Querier) error {
		row := q.QueryRow(ctx, `SELECT `+sqlBlacklistKolom+`
			FROM penyewa_blacklist WHERE id = $1::uuid`, id)

		e, err := scanBlacklistEntry(row)
		if err != nil {
			return err
		}
		entry = e
		return nil
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return BlacklistEntry{}, ErrNotFound
	}
	if err != nil {
		return BlacklistEntry{}, fmt.Errorf("membaca entri blacklist: %w", err)
	}
	return entry, nil
}

// FindBlacklistMatch mencari entri dengan pasangan nama+HP yang sama.
//
// Pencocokan sengaja PASANGAN, bukan salah satu: nama umum seperti "Budi" akan
// menghasilkan false positive kalau hanya nama yang dibandingkan. Kedua nilai
// wajib terisi; kalau salah satu kosong, hasilnya selalu tidak cocok.
//
// Kembalian nil berarti tidak ada yang cocok, bukan error.
func (d *DB) FindBlacklistMatch(ctx context.Context, userID, nama, hp string) (*BlacklistEntry, error) {
	nama = strings.TrimSpace(nama)
	hpNormal := NormalisasiHP(hp)
	if nama == "" || hpNormal == "" {
		return nil, nil
	}

	var found *BlacklistEntry

	err := d.InTenant(ctx, userID, func(q Querier) error {
		// Filter nama di SQL memanfaatkan index (user_id, lower(nama)); normalisasi
		// HP dikerjakan di Go supaya aturannya persis satu sumber dengan frontend.
		rows, err := q.Query(ctx, `SELECT `+sqlBlacklistKolom+`
			FROM penyewa_blacklist
			WHERE lower(btrim(nama)) = lower(btrim($1))`, nama)
		if err != nil {
			return err
		}
		defer rows.Close()

		for rows.Next() {
			e, err := scanBlacklistEntry(rows)
			if err != nil {
				return err
			}
			if e.HP != nil && NormalisasiHP(*e.HP) == hpNormal {
				hasil := e
				found = &hasil
				return nil
			}
		}
		return rows.Err()
	})
	if err != nil {
		return nil, fmt.Errorf("mencari blacklist: %w", err)
	}
	return found, nil
}

// InsertBlacklist menambah entri baru untuk tenant.
//
// Pemeriksaan duplikat dan INSERT berada dalam satu transaksi (lewat InTenant),
// jadi dua permintaan bersamaan tidak bisa lolos dua-duanya.
func (d *DB) InsertBlacklist(ctx context.Context, userID, tenantID string, e BlacklistEntry) (BlacklistEntry, error) {
	duplikat, err := d.FindBlacklistMatch(ctx, userID, e.Nama, ptrOr(e.HP, ""))
	if err != nil {
		return BlacklistEntry{}, err
	}
	if duplikat != nil {
		return BlacklistEntry{}, ErrBlacklistDuplikat
	}

	var saved BlacklistEntry
	err = d.InTenant(ctx, userID, func(q Querier) error {
		row := q.QueryRow(ctx, `
			INSERT INTO penyewa_blacklist
				(user_id, nama, hp, alamat, alasan, transaksi_id, member_id, foto_jaminan, added_by)
			VALUES ($1::uuid, $2, $3, $4, $5, $6::uuid, $7::uuid, $8::jsonb, $9::uuid)
			RETURNING `+sqlBlacklistKolom,
			tenantID, e.Nama, e.HP, e.Alamat, e.Alasan, e.TransaksiID, e.MemberID,
			jsonFoto(e.FotoJaminan), userID)

		s, err := scanBlacklistEntry(row)
		if err != nil {
			return err
		}
		saved = s
		return nil
	})
	if err != nil {
		return BlacklistEntry{}, fmt.Errorf("menyimpan entri blacklist: %w", err)
	}
	return saved, nil
}

// kolomBlacklistBolehDiubah adalah daftar putih kolom untuk UPDATE.
//
// Nama kolom ikut menyusun SQL, jadi nilainya wajib berasal dari daftar ini.
// Yang sengaja tidak ada: id, user_id, added_by, created_at.
var kolomBlacklistBolehDiubah = map[string]string{
	"nama":         "",
	"hp":           "",
	"alamat":       "",
	"alasan":       "",
	"transaksi_id": "::uuid",
	"member_id":    "::uuid",
	"foto_jaminan": "::jsonb",
}

// UpdateBlacklist menulis kolom yang berubah dan mengembalikan baris terbaru.
func (d *DB) UpdateBlacklist(ctx context.Context, userID, id string, sets []SetClause) (BlacklistEntry, error) {
	if len(sets) == 0 {
		return BlacklistEntry{}, errors.New("tidak ada kolom yang diubah")
	}

	bagian := make([]string, 0, len(sets))
	args := make([]any, 0, len(sets)+1)
	for _, s := range sets {
		cast, ok := kolomBlacklistBolehDiubah[s.Kolom]
		if !ok {
			// Tidak bisa terjadi lewat handler; penjaga untuk pemanggil berikutnya.
			return BlacklistEntry{}, fmt.Errorf("kolom blacklist tidak boleh diubah: %s", s.Kolom)
		}
		args = append(args, s.Arg)
		bagian = append(bagian, fmt.Sprintf("%s = $%d%s", s.Kolom, len(args), cast))
	}
	args = append(args, id)
	idParam := len(args)

	var saved BlacklistEntry
	err := d.InTenant(ctx, userID, func(q Querier) error {
		row := q.QueryRow(ctx, `UPDATE penyewa_blacklist SET `+
			strings.Join(bagian, ", ")+fmt.Sprintf(`
			WHERE id = $%d::uuid
			RETURNING `, idParam)+sqlBlacklistKolom, args...)

		e, err := scanBlacklistEntry(row)
		if err != nil {
			return err
		}
		saved = e
		return nil
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return BlacklistEntry{}, ErrNotFound
	}
	if err != nil {
		return BlacklistEntry{}, fmt.Errorf("memperbarui entri blacklist: %w", err)
	}
	return saved, nil
}

// DeleteBlacklist menghapus satu entri dan mengembalikan isinya.
//
// Baris dikembalikan karena handler perlu daftar foto untuk dibersihkan dari
// bucket. Kalau barisnya tidak ada, ErrNotFound — frontend memperlakukannya
// sebagai "sudah terhapus" dan memuat ulang daftar.
func (d *DB) DeleteBlacklist(ctx context.Context, userID, id string) (BlacklistEntry, error) {
	var deleted BlacklistEntry

	err := d.InTenant(ctx, userID, func(q Querier) error {
		row := q.QueryRow(ctx, `DELETE FROM penyewa_blacklist
			WHERE id = $1::uuid RETURNING `+sqlBlacklistKolom, id)

		e, err := scanBlacklistEntry(row)
		if err != nil {
			return err
		}
		deleted = e
		return nil
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return BlacklistEntry{}, ErrNotFound
	}
	if err != nil {
		return BlacklistEntry{}, fmt.Errorf("menghapus entri blacklist: %w", err)
	}
	return deleted, nil
}

// SetFotoBlacklist mengganti daftar foto satu entri. Dipakai setelah salinan
// berkas selesai, supaya baris tidak pernah menunjuk berkas yang belum ada.
func (d *DB) SetFotoBlacklist(ctx context.Context, userID, id string, foto []FotoJaminan) (BlacklistEntry, error) {
	return d.UpdateBlacklist(ctx, userID, id, []SetClause{
		{Kolom: "foto_jaminan", Arg: jsonFoto(foto)},
	})
}

// jsonFoto mengubah slice menjadi JSON untuk kolom jsonb. Slice kosong tetap
// menjadi `[]`, bukan `null`.
//
// Kembaliannya string, bukan []byte: pgx mengirim []byte sebagai bytea, dan
// Postgres menolak cast bytea -> jsonb. String dikirim sebagai text, aman untuk
// parameter `$n::jsonb`.
func jsonFoto(foto []FotoJaminan) string {
	if foto == nil {
		foto = []FotoJaminan{}
	}
	b, err := json.Marshal(foto)
	if err != nil {
		// FotoJaminan hanya berisi string, jadi ini tidak bisa gagal.
		return "[]"
	}
	return string(b)
}

func ptrOr(s *string, fallback string) string {
	if s == nil {
		return fallback
	}
	return *s
}
