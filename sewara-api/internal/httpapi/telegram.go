package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/Rzp1010/sewara-split/sewara-api/internal/config"
)

// Thread Telegram. Paritas sewara-backend/app/api/telegram/webhook/route.ts
// (THREAD_BACKUP=6, THREAD_DAFTAR=25) dan lib/api/constants.ts (THREAD_LOGIN=4).
const (
	telegramThreadLogin  = 4
	telegramThreadBackup = 6
	telegramThreadDaftar = 25
)

// Paritas sendTelegramMessage(..., parseMode="HTML") di lib/services/telegram.ts.
const telegramParseModeHTML = "HTML"

// waktuID meniru new Date(...).toLocaleString('id-ID', {dateStyle:'short',
// timeStyle:'short'}) → "dd/mm/yy, HH.MM". Format timestamp tidak diuji kontrak,
// jadi ini pendekatan deterministik, bukan salinan ICU. Rentang waktu dirender
// pada zona waktu nilai itu sendiri (bukan konversi lokal) agar hasil uji stabil.
func waktuID(t time.Time) string {
	return t.Format("02/01/06, 15.04")
}

// waktuRecord meniru new Date(record.created_at || Date.now()); gagal parse
// jatuh ke waktu sekarang.
func waktuRecord(record map[string]any) time.Time {
	if s, ok := record["created_at"].(string); ok && s != "" {
		if t, err := time.Parse(time.RFC3339, s); err == nil {
			return t
		}
	}
	return time.Now()
}

// nilaiPertama meniru rantai ?? (nullish): ambil nilai non-nil pertama.
func nilaiPertama(record map[string]any, keys ...string) any {
	for _, k := range keys {
		if v, ok := record[k]; ok && v != nil {
			return v
		}
	}
	return nil
}

// teksPertama meniru rantai || untuk nilai skalar: ambil teks non-kosong pertama.
func teksPertama(record map[string]any, keys ...string) string {
	for _, k := range keys {
		switch v := record[k].(type) {
		case string:
			if v != "" {
				return v
			}
		case float64:
			if v != 0 {
				return strconv.FormatFloat(v, 'f', -1, 64)
			}
		case int:
			if v != 0 {
				return strconv.Itoa(v)
			}
		case int64:
			if v != 0 {
				return strconv.FormatInt(v, 10)
			}
		case json.Number:
			if v.String() != "0" {
				return v.String()
			}
		}
	}
	return ""
}

func teksAtau(s, fallback string) string {
	if s == "" {
		return fallback
	}
	return s
}

// formatRupiah meniru formatRupiah() di lib/services/telegram.ts:
// "Rp" + Number(n).toLocaleString("id-ID").
func formatRupiah(n any) string {
	angka, ok := angkaDari(n)
	if !ok {
		angka = 0
	}
	return "Rp" + ribuanID(angka)
}

func angkaDari(v any) (float64, bool) {
	switch t := v.(type) {
	case float64:
		return t, true
	case int:
		return float64(t), true
	case int64:
		return float64(t), true
	case json.Number:
		f, err := t.Float64()
		return f, err == nil
	default:
		return 0, false
	}
}

// ribuanID memformat angka dengan pemisah ribuan titik dan desimal koma (id-ID).
func ribuanID(n float64) string {
	neg := n < 0
	if neg {
		n = -n
	}
	bulat := int64(n)
	frac := n - float64(bulat)

	var b strings.Builder
	s := strconv.FormatInt(bulat, 10)
	for i, c := range s {
		if i > 0 && (len(s)-i)%3 == 0 {
			b.WriteByte('.')
		}
		b.WriteRune(c)
	}
	if frac > 0 {
		d := strings.TrimPrefix(strconv.FormatFloat(frac, 'f', -1, 64), "0")
		b.WriteString(strings.Replace(d, ".", ",", 1))
	}
	if neg {
		return "-" + b.String()
	}
	return b.String()
}

// escapeHTML meniru escapeHtml() di lib/services/telegram.ts.
func escapeHTML(s string) string {
	return strings.NewReplacer("<", "&lt;", ">", "&gt;").Replace(s)
}

// formatPesanTransaksi meniru formatTransactionMessage() (verbatim).
func formatPesanTransaksi(eventType string, record map[string]any) string {
	separator := strings.Repeat("—", 28)
	emoji := "✏️"
	switch eventType {
	case "INSERT":
		emoji = "🆕"
	case "DELETE":
		emoji = "🗑️"
	}
	waktu := waktuID(waktuRecord(record))
	lines := []string{
		emoji + " *TRANSAKSI — " + eventType + "*",
		separator,
		"Invoice  : " + teksAtau(teksPertama(record, "no_invoice", "invoice"), "-"),
		"Penyewa  : " + teksAtau(teksPertama(record, "nama_penyewa", "penyewa", "user_id"), "-"),
		"Status   : " + teksAtau(teksPertama(record, "status"), "-"),
		"Total    : " + formatRupiah(nilaiPertama(record, "total_akhir", "total", "biaya")),
		"Waktu    : " + waktu,
	}
	js, _ := json.Marshal(record)
	return strings.Join(lines, "\n") + "\n\n<b>JSON:</b>\n<code>" + escapeHTML(string(js)) + "</code>"
}

// formatPesanRegistrasi meniru formatRegistrationMessage() (verbatim).
func formatPesanRegistrasi(eventType string, record map[string]any) string {
	separator := strings.Repeat("—", 28)
	waktu := waktuID(waktuRecord(record))
	lines := []string{
		"🆕 *PENDAFTAR BARU — " + eventType + "*",
		separator,
		"Nama     : " + teksAtau(teksPertama(record, "nama_lengkap", "nama"), "-"),
		"Email    : " + teksAtau(teksPertama(record, "email"), "-"),
		"Role     : " + teksAtau(teksPertama(record, "role"), "-"),
		"Status   : " + teksAtau(teksPertama(record, "status"), "-"),
		"Waktu    : " + waktu,
	}
	js, _ := json.Marshal(record)
	return strings.Join(lines, "\n") + "\n\n<b>JSON:</b>\n<code>" + escapeHTML(string(js)) + "</code>"
}

// transaksiDeleteTanpaRecord meniru guard `eventType === "DELETE" &&
// !record.no_invoice && !record.id` pada route webhook.
func transaksiDeleteTanpaRecord(eventType string, record map[string]any) bool {
	return eventType == "DELETE" && teksPertama(record, "no_invoice") == "" && teksPertama(record, "id") == ""
}

// telegramChatID menormalkan chatId dari JSON (string atau angka).
func telegramChatID(v any) string {
	switch t := v.(type) {
	case string:
		return t
	case float64:
		return strconv.FormatFloat(t, 'f', -1, 64)
	case json.Number:
		return t.String()
	default:
		return ""
	}
}

// telegramSender adalah klien Bot API minimal.
type telegramSender struct {
	base   string
	client *http.Client
}

func newTelegramSender(cfg config.Config) *telegramSender {
	timeout := cfg.TelegramTimeout
	if timeout <= 0 {
		timeout = 10 * time.Second
	}
	return &telegramSender{
		base:   strings.TrimRight(cfg.TelegramAPIBase, "/"),
		client: &http.Client{Timeout: timeout},
	}
}

// sendMessage memanggil POST <base>/bot<token>/sendMessage. parseMode kosong
// berarti field parse_mode tidak dikirim (paritas: route test tidak memakainya).
func (t *telegramSender) sendMessage(ctx context.Context, botToken, chatID string, threadID int, text, parseMode string) error {
	body := map[string]any{
		"chat_id":           chatID,
		"message_thread_id": threadID,
		"text":              text,
	}
	if parseMode != "" {
		body["parse_mode"] = parseMode
	}
	payload, err := json.Marshal(body)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, t.base+"/bot"+botToken+"/sendMessage", bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := t.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("telegram HTTP %d", resp.StatusCode)
	}
	return nil
}
