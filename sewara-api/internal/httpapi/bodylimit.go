package httpapi

import "net/http"

// Batas ukuran body per jenis endpoint. Decoder yang membaca r.Body tanpa batas
// bisa dipakai menghabiskan memori server; MaxBytesReader menggagalkan decode
// sebelum payload besar dialokasikan.
const (
	bodyKecil  = 8 << 10  // 8 KB  — body kontrol (baca, hapus, ack)
	bodySedang = 64 << 10 // 64 KB — body form/objek tunggal
	bodyBesar  = 1 << 20  // 1 MB  — body daftar (batch log, item transaksi)
)

// limitBody memasang batas baca pada r.Body. Decoder yang melewati batas akan
// mengembalikan error (http.MaxBytesError), yang sudah dipetakan handler ke 400.
func limitBody(w http.ResponseWriter, r *http.Request, n int64) {
	r.Body = http.MaxBytesReader(w, r.Body, n)
}
