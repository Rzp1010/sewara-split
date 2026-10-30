package db

import (
	"context"
	"encoding/json"
	"errors"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
)

// Error konfigurasi Telegram global dibalas apa adanya oleh route webhook:
// backend Next mengembalikan NextResponse.json({error}, {status:500}), jadi
// teksnya harus persis sama.
var (
	ErrTelegramNoSuperadmin = errors.New("Superadmin tidak ditemukan.")
	ErrTelegramNoBotToken   = errors.New("botToken belum diatur di pengaturan Telegram.")
)

// TelegramGlobalConfig adalah botToken/chatId milik superadmin pertama.
type TelegramGlobalConfig struct {
	BotToken string
	ChatID   string
}

// TelegramConfigSuperadmin meniru getTelegramConfig() di
// sewara-backend/lib/services/telegram.ts: cari superadmin pertama, lalu baca
// settings[key] miliknya dan parsing botToken/chatId. Tanpa botToken → error
// yang dipakai route webhook sebagai {error} 500.
func (d *DB) TelegramConfigSuperadmin(ctx context.Context, key string) (TelegramGlobalConfig, error) {
	var cfg TelegramGlobalConfig
	err := d.inSystemTx(ctx, func(tx pgx.Tx) error {
		var uid string
		if err := tx.QueryRow(ctx, `SELECT user_id::text FROM profiles WHERE role='superadmin' ORDER BY created_at LIMIT 1`).Scan(&uid); err != nil {
			if err == pgx.ErrNoRows {
				return ErrTelegramNoSuperadmin
			}
			return err
		}

		var value *string
		if err := tx.QueryRow(ctx, `SELECT value FROM settings WHERE user_id=$1::uuid AND key=$2`, uid, key).Scan(&value); err != nil && err != pgx.ErrNoRows {
			return err
		}
		if value == nil || strings.TrimSpace(*value) == "" {
			return ErrTelegramNoBotToken
		}

		var raw map[string]any
		if err := json.Unmarshal([]byte(*value), &raw); err != nil {
			return ErrTelegramNoBotToken
		}
		bot, _ := raw["botToken"].(string)
		if strings.TrimSpace(bot) == "" {
			return ErrTelegramNoBotToken
		}
		cfg.BotToken = bot
		cfg.ChatID = chatIDString(raw["chatId"])
		return nil
	})
	if err != nil {
		return TelegramGlobalConfig{}, err
	}
	return cfg, nil
}

// chatIDString menormalkan chatId yang bisa berupa string atau angka di JSON.
func chatIDString(v any) string {
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
