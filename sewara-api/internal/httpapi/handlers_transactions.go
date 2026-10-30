package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/Rzp1010/sewara-split/sewara-api/internal/db"
)

// handleTransactionsGet mengembalikan daftar transaksi tenant sesuai query param
// yang sama dengan route Next: kolom (preset), nested, ids, status, cari,
// hideRiwayat, mulai/akhir (+rentangKolom/tanggalKolom), limit, offset.
func (s *Server) handleTransactionsGet(w http.ResponseWriter, r *http.Request, me db.Identity) {
	q := r.URL.Query()
	opts := db.TransactionQueryOptions{
		Kolom:        q.Get("kolom"),
		Nested:       q.Get("nested") == "1",
		Cari:         q.Get("cari"),
		HideRiwayat:  q.Get("hideRiwayat") == "1",
		Mulai:        q.Get("mulai"),
		Akhir:        q.Get("akhir"),
		RentangKolom: q.Get("rentangKolom"),
		TanggalKolom: q.Get("tanggalKolom"),
		Limit:        atoiOr0(q.Get("limit")),
		Offset:       atoiOr0(q.Get("offset")),
	}
	// `?ids=` (kosong) sama dengan tidak ada param di Next (`if (ids)`), jadi
	// hanya aktif saat nilainya tidak kosong.
	if raw := q.Get("ids"); raw != "" {
		opts.IDsAktif = true
		opts.IDs = parseIDDaftar(raw)
	}
	if raw := q.Get("status"); raw != "" {
		opts.StatusAktif = true
		for _, st := range strings.Split(raw, ",") {
			if st = strings.TrimSpace(st); st != "" {
				opts.Status = append(opts.Status, st)
			}
		}
	}

	transactions, err := s.db.GetTransactions(r.Context(), me.UserID, opts)
	if err != nil {
		s.log.Error("gagal membaca transactions", "err", err)
		writeError(w, http.StatusInternalServerError, CodeInternalError, "Terjadi kesalahan server. Coba lagi.")
		return
	}
	writeSuccess(w, http.StatusOK, map[string]any{"transactions": transactions})
}

// atoiOr0 meniru `Number(x || 0)`: kosong/ tidak valid -> 0.
func atoiOr0(s string) int {
	n, err := strconv.Atoi(strings.TrimSpace(s))
	if err != nil {
		return 0
	}
	return n
}

// parseIDDaftar membaca daftar id dipisah koma; bagian tak valid dibuang.
func parseIDDaftar(csv string) []int64 {
	var ids []int64
	for _, bagian := range strings.Split(csv, ",") {
		bagian = strings.TrimSpace(bagian)
		if bagian == "" {
			continue
		}
		if n, err := strconv.ParseInt(bagian, 10, 64); err == nil {
			ids = append(ids, n)
		}
	}
	return ids
}

// guardItem adalah item yang diperiksa guard SN maintenance.
type guardItem struct {
	inventoryID *int64
	sn          *string
	assigned    json.RawMessage
}

// pecahSN meniru pecahSN() di lib/api/kondisi-sn.ts: string dipisah ", ",
// array dan objek {sn|serial_number} ikut didukung.
func pecahSN(v any) []string {
	switch x := v.(type) {
	case nil:
		return nil
	case []any:
		var out []string
		for _, e := range x {
			out = append(out, pecahSN(e)...)
		}
		return out
	case map[string]any:
		if sn, ada := x["sn"]; ada && sn != nil {
			return pecahSN(sn)
		}
		return pecahSN(x["serial_number"])
	case string:
		var out []string
		for _, s := range strings.Split(x, ", ") {
			if s = strings.TrimSpace(s); s != "" {
				out = append(out, s)
			}
		}
		return out
	default:
		return pecahSN(fmt.Sprintf("%v", x))
	}
}

// cekMaintenance meniru guardMaintenance() (lib/api/kondisi-sn.ts): kelompokkan
// SN per inventory_id, baca inventory.kondisi_sn, tolak bila ada SN berstatus
// "maintenance". Fail-open: barang tanpa map kondisi_sn dianggap aman.
// Mengembalikan pesan (bukan error) bila ada SN maintenance.
func (s *Server) cekMaintenance(ctx context.Context, userID string, items []guardItem) (string, error) {
	perInventory := map[int64][]string{}
	for _, it := range items {
		if it.inventoryID == nil {
			continue
		}
		var snVal any
		if it.sn != nil {
			snVal = *it.sn
		}
		sns := pecahSN(snVal)

		var ac any
		if len(it.assigned) > 0 && string(it.assigned) != "null" {
			_ = json.Unmarshal(it.assigned, &ac)
		}
		sns = append(sns, pecahSN(ac)...)

		if len(sns) > 0 {
			perInventory[*it.inventoryID] = append(perInventory[*it.inventoryID], sns...)
		}
	}
	if len(perInventory) == 0 {
		return "", nil
	}

	ids := make([]int64, 0, len(perInventory))
	for id := range perInventory {
		ids = append(ids, id)
	}
	kondisi, err := s.db.KondisiSNInventory(ctx, userID, ids)
	if err != nil {
		return "", err
	}

	for invID, sns := range perInventory {
		var m map[string]struct {
			Kondisi string `json:"kondisi"`
		}
		if raw := kondisi[invID]; len(raw) > 0 {
			_ = json.Unmarshal(raw, &m)
		}
		for _, sn := range sns {
			if m[sn].Kondisi == "maintenance" {
				return `Unit S/N "` + sn + `" sedang maintenance dan tidak bisa disewa.`, nil
			}
		}
	}
	return "", nil
}

// guardItemDariInput memetakan item payload POST ke bentuk guard.
func guardItemDariInput(items []db.TransactionItemInput) []guardItem {
	out := make([]guardItem, 0, len(items))
	for _, it := range items {
		out = append(out, guardItem{inventoryID: it.InventoryID, sn: it.SerialNumber, assigned: it.AssignedComponents})
	}
	return out
}

// guardItemDariDetail memetakan item tersimpan (PATCH) ke bentuk guard.
func guardItemDariDetail(items []db.TransactionItem) []guardItem {
	out := make([]guardItem, 0, len(items))
	for _, it := range items {
		out = append(out, guardItem{inventoryID: it.InventoryID, sn: it.SerialNumber, assigned: it.AssignedComponents})
	}
	return out
}

// handleTransactionsPost membuat/update transaksi atomic dengan items + payments.
func (s *Server) handleTransactionsPost(w http.ResponseWriter, r *http.Request, me db.Identity) {
	// Bentuk body persis route Next: `tx = body.transaction ?? body`,
	// `items = body.items ?? []`, `payments = body.payments ?? []`. Jadi body
	// flat bentuk frontend (transaksi + `items`) diterima, dan wrapper lama
	// {transaction, items, payments} tetap jalan karena `transaction` menang.
	var raw map[string]any
	if err := json.NewDecoder(io.LimitReader(r.Body, 2<<20)).Decode(&raw); err != nil {
		writeValidationError(w, "Body tidak valid.", nil)
		return
	}

	txRaw := any(raw)
	if v, ok := raw["transaction"]; ok && v != nil {
		txRaw = v
	}
	txBytes, err := json.Marshal(txRaw)
	if err != nil {
		writeValidationError(w, "Body tidak valid.", nil)
		return
	}
	var tx db.TransactionInput
	if err := json.Unmarshal(txBytes, &tx); err != nil {
		writeValidationError(w, "Body tidak valid.", nil)
		return
	}

	itemsRaw, _ := raw["items"].([]any)
	paymentsRaw, _ := raw["payments"].([]any)
	items := db.NormalizeTransactionItems(itemsRaw)
	payments := db.NormalizeTransactionPayments(paymentsRaw)

	// Validasi: ID wajib (client-generated, RPC pattern sama).
	if tx.ID == 0 {
		writeValidationError(w, "transaction.id wajib diisi (client-generated, misal Date.now()).", nil)
		return
	}

	// Validasi: penyewa wajib.
	if tx.Penyewa == "" {
		writeValidationError(w, "transaction.penyewa wajib diisi.", nil)
		return
	}

	// Validasi: status harus salah satu enum valid.
	validStatus := map[string]bool{"Booking": true, "Disewa": true, "Selesai": true, "Belum Selesai": true, "Dibatalkan": true}
	if tx.Status == "" {
		tx.Status = "Booking"
	}
	if !validStatus[tx.Status] {
		writeValidationError(w, "transaction.status tidak valid.", nil)
		return
	}

	// Validasi: denda, biaya, total >= 0.
	if tx.Denda < 0 || tx.Biaya < 0 || tx.TotalAkhir < 0 || tx.DPHangus < 0 {
		writeValidationError(w, "denda, biaya, total_akhir, dp_hangus harus >= 0.", nil)
		return
	}

	// Validasi items: qty > 0, harga/subtotal >= 0. Nama TIDAK divalidasi karena
	// normalisasi sudah memberi fallback "Unknown" (pola implisit RPC).
	for i, item := range items {
		if item.Qty <= 0 {
			writeValidationError(w, "items["+strconv.Itoa(i)+"]: qty harus > 0.", nil)
			return
		}
		if item.UnitPrice < 0 || item.Subtotal < 0 {
			writeValidationError(w, "items["+strconv.Itoa(i)+"]: unit_price dan subtotal harus >= 0.", nil)
			return
		}
	}

	// Validasi payments: amount > 0, metode enum, tanggal default now.
	for i, pmt := range payments {
		if pmt.Amount <= 0 {
			writeValidationError(w, "payments["+strconv.Itoa(i)+"]: amount harus > 0.", nil)
			return
		}
		validMethod := map[string]bool{"Tunai": true, "Transfer": true, "QRIS": true}
		if !validMethod[pmt.PaymentMethod] {
			writeValidationError(w, "payments["+strconv.Itoa(i)+"]: payment_method tidak valid.", nil)
			return
		}
		if pmt.PaymentDate.IsZero() {
			payments[i].PaymentDate = time.Now()
		}
	}

	// G3: guard SN maintenance sebelum simpan (acuan POST route Next :98, tanpa
	// syarat status — Next memanggilnya untuk setiap simpan).
	if msg, err := s.cekMaintenance(r.Context(), me.UserID, guardItemDariInput(items)); err != nil {
		s.log.Error("gagal cek maintenance SN", "err", err, "id", tx.ID)
		writeError(w, http.StatusInternalServerError, CodeInternalError, "Terjadi kesalahan server. Coba lagi.")
		return
	} else if msg != "" {
		writeValidationError(w, msg, nil)
		return
	}

	result, err := s.db.SaveTransaction(r.Context(), me.UserID, tx, items, payments)
	if err != nil {
		// G2: referensi lintas tenant -> 403, pesan disamakan dengan rpc_save_transaction.
		if errors.Is(err, db.ErrMemberLainTenant) || errors.Is(err, db.ErrInventoryLainTenant) {
			writeError(w, http.StatusForbidden, CodeForbidden, err.Error())
			return
		}
		s.log.Error("gagal menyimpan transaksi", "err", err, "id", tx.ID)
		writeError(w, http.StatusInternalServerError, CodeInternalError, "Terjadi kesalahan server. Coba lagi.")
		return
	}

	writeSuccess(w, http.StatusOK, map[string]any{"transaction": result})
}

// handleTransactionsDetailGet membaca satu transaksi + items + payments.
func (s *Server) handleTransactionsDetailGet(w http.ResponseWriter, r *http.Request, me db.Identity) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id <= 0 {
		writeValidationError(w, "id transaksi tidak valid.", nil)
		return
	}

	detail, err := s.db.GetTransactionDetail(r.Context(), me.UserID, id)
	if err != nil {
		s.log.Error("gagal membaca transaksi detail", "err", err, "id", id)
		writeError(w, http.StatusInternalServerError, CodeInternalError, "Terjadi kesalahan server. Coba lagi.")
		return
	}
	if detail == nil {
		writeError(w, http.StatusNotFound, CodeNotFound, "Transaction not found")
		return
	}

	writeSuccess(w, http.StatusOK, map[string]any{"transaction": detail})
}

// handleTransactionsDetailPatch mengubah field parent transaksi (items/payments tidak disentuh).
func (s *Server) handleTransactionsDetailPatch(w http.ResponseWriter, r *http.Request, me db.Identity) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id <= 0 {
		writeValidationError(w, "id transaksi tidak valid.", nil)
		return
	}

	var body map[string]any
	if err := json.NewDecoder(io.LimitReader(r.Body, 2<<20)).Decode(&body); err != nil {
		writeValidationError(w, "Body tidak valid.", nil)
		return
	}

	// Buang child tables & metadata sebelum update (pola Next).
	delete(body, "transaction_items")
	delete(body, "transaction_payments")
	delete(body, "created_at")
	delete(body, "updated_at")
	delete(body, "user_id")
	delete(body, "id")

	if len(body) == 0 {
		writeValidationError(w, "Tidak ada perubahan.", nil)
		return
	}

	if status, ok := body["status"].(string); ok && status != "" {
		validStatus := map[string]bool{"Booking": true, "Disewa": true, "Selesai": true, "Belum Selesai": true, "Dibatalkan": true}
		if !validStatus[status] {
			writeValidationError(w, "status tidak valid.", nil)
			return
		}
	}

	// G3: saat status diubah jadi "Disewa", tolak bila SN unit maintenance
	// (acuan PATCH detail route Next :45-61; dibaca dari item tersimpan).
	if status, _ := body["status"].(string); status == "Disewa" {
		detail, err := s.db.GetTransactionDetail(r.Context(), me.UserID, id)
		if err != nil {
			s.log.Error("gagal membaca transaksi untuk guard SN", "err", err, "id", id)
			writeError(w, http.StatusInternalServerError, CodeInternalError, "Terjadi kesalahan server. Coba lagi.")
			return
		}
		if detail != nil {
			if msg, err := s.cekMaintenance(r.Context(), me.UserID, guardItemDariDetail(detail.Items)); err != nil {
				s.log.Error("gagal cek maintenance SN", "err", err, "id", id)
				writeError(w, http.StatusInternalServerError, CodeInternalError, "Terjadi kesalahan server. Coba lagi.")
				return
			} else if msg != "" {
				writeValidationError(w, msg, nil)
				return
			}
		}
	}

	result, err := s.db.UpdateTransaction(r.Context(), me.UserID, id, body)
	if err != nil {
		s.log.Error("gagal update transaksi", "err", err, "id", id)
		writeError(w, http.StatusInternalServerError, CodeInternalError, "Terjadi kesalahan server. Coba lagi.")
		return
	}
	if result == nil {
		writeError(w, http.StatusNotFound, CodeNotFound, "Transaction not found")
		return
	}

	writeSuccess(w, http.StatusOK, map[string]any{"transaction": result})
}
