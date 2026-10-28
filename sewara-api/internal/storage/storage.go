// Package storage adalah satu-satunya jalan ke object storage (Cloudflare R2,
// API-nya S3-compatible).
//
// Aturan yang dijaga di sini:
//   - Aplikasi tidak pernah menyentuh disk lokal. Semua berkas pengguna hidup di
//     bucket, jadi proses bisa dipindah ke container kapan saja (aturan
//     portabilitas runtime).
//   - Pemanggil tidak pernah melihat tipe SDK. Yang keluar dari paket ini hanya
//     []byte, error, dan ErrNotFound, supaya penggantian pustaka tidak merembet
//     ke handler.
//   - Objek yang tidak ada dipetakan ke ErrNotFound, bukan error mentah. Tanpa
//     itu, handler harus mengenali kode error SDK, dan pemetaan seperti itu
//     gampang basi.
package storage

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"
	"github.com/aws/smithy-go"
)

// ErrNotFound berarti objek tidak ada di bucket.
var ErrNotFound = errors.New("objek tidak ditemukan")

// maxObjectSize membatasi berapa banyak yang boleh dibaca ke memori. Semua
// berkas yang dilayani aplikasi ini maksimal 5 MB; batas 32 MB memberi ruang
// untuk berkas lama tanpa membiarkan satu objek raksasa menghabiskan RAM VPS.
const maxObjectSize = 32 << 20

// Store adalah pegangan ke satu bucket.
type Store struct {
	client *s3.Client
	bucket string
}

// New membuat klien S3 yang menunjuk ke R2.
//
// Region diisi "auto" kalau tidak diberikan: R2 memakai nilai itu, dan SigV4
// tetap butuh region untuk menandatangani permintaan.
func New(cfg Config) (*Store, error) {
	if cfg.Endpoint == "" || cfg.AccessKey == "" || cfg.SecretKey == "" || cfg.Bucket == "" {
		return nil, fmt.Errorf("konfigurasi storage tidak lengkap")
	}

	region := cfg.Region
	if region == "" {
		region = "auto"
	}

	client := s3.New(s3.Options{
		Region:       region,
		BaseEndpoint: aws.String(cfg.Endpoint),
		Credentials:  credentials.NewStaticCredentialsProvider(cfg.AccessKey, cfg.SecretKey, ""),
		// Path-style menghindari ketergantungan pada DNS wildcard bucket, yang
		// tidak selalu tersedia di balik proxy.
		UsePathStyle: true,
	})

	return &Store{client: client, bucket: cfg.Bucket}, nil
}

// Config adalah kredensial yang dibutuhkan Store.
type Config struct {
	Endpoint  string
	Region    string
	AccessKey string
	SecretKey string
	Bucket    string
}

// Get membaca seluruh objek ke memori.
func (s *Store) Get(ctx context.Context, key string) ([]byte, error) {
	out, err := s.client.GetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(s.bucket),
		Key:    aws.String(key),
	})
	if err != nil {
		if isNotFound(err) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("membaca objek %q: %w", key, err)
	}
	defer out.Body.Close()

	body, err := io.ReadAll(io.LimitReader(out.Body, maxObjectSize))
	if err != nil {
		return nil, fmt.Errorf("membaca isi objek %q: %w", key, err)
	}
	return body, nil
}

// Put menulis objek. contentType disimpan apa adanya supaya browser bisa
// menampilkan gambar/PDF langsung tanpa menebak dari ekstensi.
func (s *Store) Put(ctx context.Context, key string, body []byte, contentType string) error {
	_, err := s.client.PutObject(ctx, &s3.PutObjectInput{
		Bucket:        aws.String(s.bucket),
		Key:           aws.String(key),
		Body:          bytes.NewReader(body),
		ContentLength: aws.Int64(int64(len(body))),
		ContentType:   aws.String(contentType),
	})
	if err != nil {
		return fmt.Errorf("menulis objek %q: %w", key, err)
	}
	return nil
}

// Delete menghapus objek. Objek yang sudah tidak ada dianggap berhasil: semua
// pemanggil di aplikasi ini membersihkan berkas sisa, dan "sudah hilang" adalah
// keadaan yang diinginkan, bukan kegagalan.
func (s *Store) Delete(ctx context.Context, key string) error {
	_, err := s.client.DeleteObject(ctx, &s3.DeleteObjectInput{
		Bucket: aws.String(s.bucket),
		Key:    aws.String(key),
	})
	if err != nil && !isNotFound(err) {
		return fmt.Errorf("menghapus objek %q: %w", key, err)
	}
	return nil
}

// isNotFound mengenali "tidak ada" dari dua bentuk yang dipakai S3/R2: tipe
// NoSuchKey untuk GetObject, dan kode teks untuk DeleteObject/HeadObject.
func isNotFound(err error) bool {
	var noKey *types.NoSuchKey
	if errors.As(err, &noKey) {
		return true
	}
	var apiErr smithy.APIError
	if errors.As(err, &apiErr) {
		switch apiErr.ErrorCode() {
		case "NoSuchKey", "NotFound", "404":
			return true
		}
	}
	return false
}
