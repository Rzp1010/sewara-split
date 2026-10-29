package httpapi

import (
	"encoding/json"
	"io"
	"net/http"
	"strconv"
	"time"

	"github.com/Rzp1010/sewara-split/sewara-api/internal/db"
)

// handleTransactionsGet mengembalikan daftar transaksi tenant.
// ponytail: filter status/rentang/nested join belum ada; tambah saat frontend butuh
func (s *Server) handleTransactionsGet(w http.ResponseWriter, r *http.Request, me db.Identity) {
	// ponytail: pagination/filter dari query params belum diparse; default list semua
	opts := db.TransactionQueryOptions{}

	transactions, err := s.db.GetTransactions(r.Context(), me.UserID, opts)
	if err != nil {
		s.log.Error("gagal membaca transactions", "err", err)
		writeError(w, http.StatusInternalServerError, CodeInternalError, "Terjadi kesalahan server. Coba lagi.")
		return
	}
	writeSuccess(w, http.StatusOK, map[string]any{"transactions": transactions})
}

// handleTransactionsPost membuat/update transaksi atomic dengan items + payments.
func (s *Server) handleTransactionsPost(w http.ResponseWriter, r *http.Request, me db.Identity) {
	var body struct {
		Transaction db.TransactionInput          `json:"transaction"`
		Items       []db.TransactionItemInput    `json:"items"`
		Payments    []db.TransactionPaymentInput `json:"payments"`
	}

	if err := json.NewDecoder(io.LimitReader(r.Body, 2<<20)).Decode(&body); err != nil {
		writeValidationError(w, "Body tidak valid.", nil)
		return
	}

	// Validasi: ID wajib (client-generated, RPC pattern sama).
	if body.Transaction.ID == 0 {
		writeValidationError(w, "transaction.id wajib diisi (client-generated, misal Date.now()).", nil)
		return
	}

	// Validasi: penyewa wajib.
	if body.Transaction.Penyewa == "" {
		writeValidationError(w, "transaction.penyewa wajib diisi.", nil)
		return
	}

	// Validasi: status harus salah satu enum valid.
	validStatus := map[string]bool{"Booking": true, "Disewa": true, "Selesai": true, "Belum Selesai": true, "Dibatalkan": true}
	if body.Transaction.Status == "" {
		body.Transaction.Status = "Booking"
	}
	if !validStatus[body.Transaction.Status] {
		writeValidationError(w, "transaction.status tidak valid.", nil)
		return
	}

	// Validasi: denda, biaya, total >= 0.
	if body.Transaction.Denda < 0 || body.Transaction.Biaya < 0 || body.Transaction.TotalAkhir < 0 || body.Transaction.DPHangus < 0 {
		writeValidationError(w, "denda, biaya, total_akhir, dp_hangus harus >= 0.", nil)
		return
	}

	// Validasi items: qty > 0, harga >= 0.
	for i, item := range body.Items {
		if item.Qty <= 0 {
			writeValidationError(w, "items["+strconv.Itoa(i)+"]: qty harus > 0.", nil)
			return
		}
		if item.UnitPrice < 0 || item.Subtotal < 0 {
			writeValidationError(w, "items["+strconv.Itoa(i)+"]: unit_price dan subtotal harus >= 0.", nil)
			return
		}
		if item.ItemName == "" {
			writeValidationError(w, "items["+strconv.Itoa(i)+"]: item_name wajib diisi.", nil)
			return
		}
	}

	// Validasi payments: amount > 0.
	for i, pmt := range body.Payments {
		if pmt.Amount <= 0 {
			writeValidationError(w, "payments["+strconv.Itoa(i)+"]: amount harus > 0.", nil)
			return
		}
		validMethod := map[string]bool{"Tunai": true, "Transfer": true, "QRIS": true}
		if pmt.PaymentMethod == "" {
			body.Payments[i].PaymentMethod = "Tunai"
		}
		if !validMethod[pmt.PaymentMethod] {
			writeValidationError(w, "payments["+strconv.Itoa(i)+"]: payment_method tidak valid.", nil)
			return
		}
		if pmt.PaymentDate.IsZero() {
			body.Payments[i].PaymentDate = time.Now()
		}
	}

	// ponytail: guardMaintenance (cek kondisi_sn item saat status=Disewa) belum ada; tambah setelah domain ini jalan

	result, err := s.db.SaveTransaction(r.Context(), me.UserID, body.Transaction, body.Items, body.Payments)
	if err != nil {
		s.log.Error("gagal menyimpan transaksi", "err", err, "id", body.Transaction.ID)
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
// ponytail: guardMaintenance saat status=Disewa belum ada; tambah setelah domain ini jalan
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
