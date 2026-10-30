package httpapi

import (
	"crypto/subtle"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"time"

	"github.com/Rzp1010/sewara-split/sewara-api/internal/db"
)

// maxWebhookBody membatasi body webhook.
const maxWebhookBody = 1 << 20

// hanyaPOST membalas 405 (tanpa body + header Allow) untuk method lain, sama
// seperti route Next yang hanya mengekspor POST.
func hanyaPOST(h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", "POST")
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		h(w, r)
	}
}

// telegramConfigLokal adalah konfigurasi milik user sendiri (dipakai /api/telegram/test).
type telegramConfigLokal struct {
	Aktif      bool
	BotToken   string
	ChatID     string
	TopicLogin int
}

// bacaTelegramConfigLokal meniru getTelegramConfig() lokal di
// app/api/telegram/test/route.ts: default diisi lebih dulu, JSON rusak diabaikan.
func (s *Server) bacaTelegramConfigLokal(r *http.Request, userID string) (telegramConfigLokal, error) {
	cfg := telegramConfigLokal{TopicLogin: telegramThreadLogin}
	setting, err := s.db.GetSettingByKey(r.Context(), userID, "telegram_login_notif")
	if err != nil {
		return cfg, err
	}
	if setting == nil || setting.Value == nil || *setting.Value == "" {
		return cfg, nil
	}
	var raw struct {
		Aktif      bool   `json:"aktif"`
		BotToken   string `json:"botToken"`
		ChatID     any    `json:"chatId"`
		TopicLogin *int   `json:"topicLogin"`
	}
	if err := json.Unmarshal([]byte(*setting.Value), &raw); err != nil {
		return cfg, nil
	}
	cfg.Aktif = raw.Aktif
	cfg.BotToken = raw.BotToken
	cfg.ChatID = telegramChatID(raw.ChatID)
	if raw.TopicLogin != nil {
		cfg.TopicLogin = *raw.TopicLogin
	}
	return cfg, nil
}

// handleTelegramTest: POST /api/telegram/test (superadmin only).
func (s *Server) handleTelegramTest(w http.ResponseWriter, r *http.Request, me db.Identity) {
	if me.Role != "superadmin" {
		writeError(w, http.StatusForbidden, CodeForbidden, "Anda tidak memiliki akses untuk operasi ini.")
		return
	}

	cfg, err := s.bacaTelegramConfigLokal(r, me.UserID)
	if err != nil {
		s.log.Error("gagal membaca konfigurasi telegram", "err", err)
		writeError(w, http.StatusInternalServerError, CodeInternalError, "Terjadi kesalahan server. Coba lagi.")
		return
	}
	if !cfg.Aktif {
		writeValidationError(w, "Notifikasi Telegram belum diaktifkan.", nil)
		return
	}
	if cfg.BotToken == "" || cfg.ChatID == "" {
		writeValidationError(w, "Bot token dan Chat ID wajib diisi.", nil)
		return
	}

	text := "✅ Notifikasi Telegram aktif!\n\n" + waktuID(time.Now()) + "\nIni pesan uji dari Log Login."
	if err := s.tg.sendMessage(r.Context(), cfg.BotToken, cfg.ChatID, cfg.TopicLogin, text, ""); err != nil {
		s.log.Error("gagal mengirim pesan uji telegram", "err", err)
		writeError(w, http.StatusBadGateway, CodeExternalServiceError, "Gagal mengirim pesan ke Telegram. Periksa konfigurasi.")
		return
	}
	writeSuccess(w, http.StatusOK, nil)
}

// telegramWebhookBody adalah payload webhook telegram terverifikasi.
type telegramWebhookBody struct {
	Table  string
	Type   string
	Record map[string]any
}

// parseTelegramWebhook memvalidasi payload. Kembalian false = 400.
// Paritas telegramWebhookSchema: table string non-kosong, type enum,
// record/old_record opsional harus objek.
func parseTelegramWebhook(body io.Reader) (telegramWebhookBody, bool) {
	var raw map[string]json.RawMessage
	if err := json.NewDecoder(io.LimitReader(body, maxWebhookBody)).Decode(&raw); err != nil {
		return telegramWebhookBody{}, false
	}

	table, ok := jsonString(raw["table"])
	if !ok || table == "" {
		return telegramWebhookBody{}, false
	}
	typ, ok := jsonString(raw["type"])
	if !ok || (typ != "INSERT" && typ != "UPDATE" && typ != "DELETE") {
		return telegramWebhookBody{}, false
	}

	record := map[string]any{}
	if v, present := raw["record"]; present && string(v) != "null" {
		if err := json.Unmarshal(v, &record); err != nil {
			return telegramWebhookBody{}, false
		}
		if record == nil {
			record = map[string]any{}
		}
	}
	if v, present := raw["old_record"]; present && string(v) != "null" {
		var old map[string]any
		if err := json.Unmarshal(v, &old); err != nil {
			return telegramWebhookBody{}, false
		}
	}

	return telegramWebhookBody{Table: table, Type: typ, Record: record}, true
}

func jsonString(raw json.RawMessage) (string, bool) {
	if raw == nil {
		return "", false
	}
	var s string
	if err := json.Unmarshal(raw, &s); err != nil {
		return "", false
	}
	return s, true
}

// webhookSecretValid membandingkan header x-webhook-secret dengan secret secara
// timing-safe (paritas validateWebhookSecret di lib/api/webhook-security.ts).
func webhookSecretValid(r *http.Request, secret string) bool {
	if secret == "" {
		return false
	}
	header := r.Header.Get("x-webhook-secret")
	if header == "" {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(header), []byte(secret)) == 1
}

// handleTelegramWebhook: POST /api/telegram/webhook (tanpa auth cookie).
func (s *Server) handleTelegramWebhook(w http.ResponseWriter, r *http.Request) {
	if !webhookSecretValid(r, s.cfg.TelegramWebhookSecret) {
		writeError(w, http.StatusUnauthorized, CodeUnauthorized, "Secret webhook tidak valid.")
		return
	}

	body, ok := parseTelegramWebhook(r.Body)
	if !ok {
		writeValidationError(w, "Webhook payload tidak valid.", nil)
		return
	}

	cfg, err := s.db.TelegramConfigSuperadmin(r.Context(), "telegram_login_notif")
	if err != nil {
		if errors.Is(err, db.ErrTelegramNoSuperadmin) || errors.Is(err, db.ErrTelegramNoBotToken) {
			// Paritas: Next membalas NextResponse.json({error}, {status:500}).
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
			return
		}
		s.log.Error("gagal membaca konfigurasi telegram global", "err", err)
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "Terjadi kesalahan server. Coba lagi."})
		return
	}

	chatID := s.cfg.TelegramChatID

	if body.Table == "transactions" {
		if transaksiDeleteTanpaRecord(body.Type, body.Record) {
			writeJSON(w, http.StatusOK, map[string]any{"ok": true, "skip": "DELETE tanpa record"})
			return
		}
		if err := s.tg.sendMessage(r.Context(), cfg.BotToken, chatID, telegramThreadBackup, formatPesanTransaksi(body.Type, body.Record), telegramParseModeHTML); err != nil {
			s.log.Error("gagal mengirim webhook telegram", "err", err, "table", body.Table, "type", body.Type)
			writeError(w, http.StatusBadGateway, CodeExternalServiceError, "Terjadi kesalahan. Coba lagi.")
			return
		}
		writeSuccess(w, http.StatusOK, map[string]any{"ok": true, "to": "backup"})
		return
	}

	if body.Table == "profiles" && body.Record["status"] == "menunggu" && body.Record["role"] == "owner" {
		if err := s.tg.sendMessage(r.Context(), cfg.BotToken, chatID, telegramThreadDaftar, formatPesanRegistrasi(body.Type, body.Record), telegramParseModeHTML); err != nil {
			s.log.Error("gagal mengirim webhook telegram", "err", err, "table", body.Table, "type", body.Type)
			writeError(w, http.StatusBadGateway, CodeExternalServiceError, "Terjadi kesalahan. Coba lagi.")
			return
		}
		writeSuccess(w, http.StatusOK, map[string]any{"ok": true, "to": "daftar"})
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "skip": body.Table + "/" + body.Type})
}

// handlePaymentWebhook: POST /api/webhooks/payment — stub fail-closed.
// Paritas app/api/webhooks/payment/route.ts: selalu 503 dengan body persis
// (bukan envelope {ok:...}); skeleton Midtrans/Xendit/Stripe tidak diport.
func (s *Server) handlePaymentWebhook(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusServiceUnavailable, map[string]any{
		"error":   "payment_webhook_not_configured",
		"message": "Payment webhook is not configured.",
	})
}
