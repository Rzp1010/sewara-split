package config

import (
	"fmt"
	"os"
	"strings"
	"time"
)

// Config hanya berisi nilai yang benar-benar dipakai. Tidak ada default
// tersembunyi untuk hal yang bisa salah tanpa ketahuan.
type Config struct {
	Addr         string
	DatabaseURL  string
	Env          string
	CookieSecure bool
	SessionTTL   time.Duration
	PurgeSecret  string

	// Storage adalah object storage S3-compatible (Cloudflare R2). Di development
	// boleh kosong; di produksi wajib lengkap karena upload foto jaminan, foto
	// member, bukti bayar, dan header invoice bergantung padanya.
	Storage StorageConfig

	// Eksternal Telegram + webhook.
	TelegramWebhookSecret string        // secret header x-webhook-secret untuk /api/telegram/webhook
	TelegramChatID        string        // chat_id default notifikasi
	TelegramAPIBase       string        // basis Bot API; seam uji menunjuk stub lokal
	TelegramTimeout       time.Duration // timeout klien HTTP Telegram

	// Email verifikasi akun.
	FrontendURL      string        // basis redirect callback (mis. https://app.sewara.my.id)
	PublicAPIURL     string        // basis tautan verifikasi; kosong → diturunkan dari request
	MailDriver       string        // "log" | "smtp"
	SMTPHost         string        //
	SMTPPort         string        //
	SMTPUser         string        //
	SMTPPass         string        //
	SMTPFrom         string        //
	EmailTokenSecret string        // kunci HMAC token verifikasi
	EmailTokenTTL    time.Duration // masa berlaku token verifikasi
}

// StorageConfig menampung kredensial R2. Bucket kosong berarti fitur file mati;
// itu hanya sah di development.
type StorageConfig struct {
	Endpoint  string
	Region    string
	AccessKey string
	SecretKey string
	Bucket    string
}

// Enabled menandakan storage siap dipakai. Handler file wajib memeriksanya dan
// membalas error yang jelas, bukan panik atau diam-diam melewati upload.
func (s StorageConfig) Enabled() bool { return s.Bucket != "" }

const (
	EnvDev  = "development"
	EnvProd = "production"
)

// Load membaca environment dan gagal cepat kalau ada yang tidak masuk akal.
// Kesalahan konfigurasi harus terlihat saat start, bukan saat request pertama.
func Load() (Config, error) {
	env := strings.TrimSpace(os.Getenv("APP_ENV"))
	if env == "" {
		env = EnvDev
	}
	if env != EnvDev && env != EnvProd {
		return Config{}, fmt.Errorf("APP_ENV tidak dikenal: %q (pakai %q atau %q)", env, EnvDev, EnvProd)
	}

	dbURL := strings.TrimSpace(os.Getenv("DATABASE_URL"))
	if dbURL == "" {
		return Config{}, fmt.Errorf("DATABASE_URL wajib diisi")
	}

	addr := strings.TrimSpace(os.Getenv("ADDR"))
	if addr == "" {
		addr = "127.0.0.1:4000"
	}

	ttl := 30 * 24 * time.Hour
	if raw := strings.TrimSpace(os.Getenv("SESSION_TTL")); raw != "" {
		parsed, err := time.ParseDuration(raw)
		if err != nil {
			return Config{}, fmt.Errorf("SESSION_TTL tidak valid: %w", err)
		}
		if parsed <= 0 {
			return Config{}, fmt.Errorf("SESSION_TTL harus lebih dari nol")
		}
		ttl = parsed
	}

	storageCfg, err := loadStorage(env)
	if err != nil {
		return Config{}, err
	}

	// Timeout default menyamai TELEGRAM.REQUEST_TIMEOUT di
	// sewara-backend/lib/api/constants.ts (10 detik).
	tgTimeout := 10 * time.Second
	if raw := strings.TrimSpace(os.Getenv("TELEGRAM_TIMEOUT")); raw != "" {
		parsed, err := time.ParseDuration(raw)
		if err != nil {
			return Config{}, fmt.Errorf("TELEGRAM_TIMEOUT tidak valid: %w", err)
		}
		if parsed <= 0 {
			return Config{}, fmt.Errorf("TELEGRAM_TIMEOUT harus lebih dari nol")
		}
		tgTimeout = parsed
	}

	// Seam uji: TELEGRAM_API_BASE bisa diarahkan ke stub lokal.
	tgBase := strings.TrimSpace(os.Getenv("TELEGRAM_API_BASE"))
	if tgBase == "" {
		tgBase = "https://api.telegram.org"
	}
	tgChatID := strings.TrimSpace(os.Getenv("TELEGRAM_CHAT_ID"))
	if tgChatID == "" {
		tgChatID = "-1003838354394"
	}

	// Email. Default driver: smtp di produksi, log di luar produksi (agar
	// pengembangan/uji tidak perlu SMTP).
	mailDriver := strings.ToLower(strings.TrimSpace(os.Getenv("MAIL_DRIVER")))
	if mailDriver == "" {
		if env == EnvProd {
			mailDriver = "smtp"
		} else {
			mailDriver = "log"
		}
	}
	if mailDriver != "log" && mailDriver != "smtp" {
		return Config{}, fmt.Errorf("MAIL_DRIVER tidak dikenal: %q (pakai \"log\" atau \"smtp\")", mailDriver)
	}

	tokenTTL := 24 * time.Hour
	if raw := strings.TrimSpace(os.Getenv("EMAIL_TOKEN_TTL")); raw != "" {
		parsed, err := time.ParseDuration(raw)
		if err != nil {
			return Config{}, fmt.Errorf("EMAIL_TOKEN_TTL tidak valid: %w", err)
		}
		if parsed <= 0 {
			return Config{}, fmt.Errorf("EMAIL_TOKEN_TTL harus lebih dari nol")
		}
		tokenTTL = parsed
	}

	smtpHost := strings.TrimSpace(os.Getenv("SMTP_HOST"))
	smtpFrom := strings.TrimSpace(os.Getenv("SMTP_FROM"))
	tokenSecret := strings.TrimSpace(os.Getenv("EMAIL_TOKEN_SECRET"))
	if env == EnvProd {
		if tokenSecret == "" {
			return Config{}, fmt.Errorf("EMAIL_TOKEN_SECRET wajib diisi di produksi")
		}
		if mailDriver == "smtp" && (smtpHost == "" || smtpFrom == "") {
			return Config{}, fmt.Errorf("konfigurasi SMTP wajib di produksi: isi SMTP_HOST dan SMTP_FROM")
		}
	}

	return Config{
		Addr:                  addr,
		DatabaseURL:           dbURL,
		Env:                   env,
		CookieSecure:          env == EnvProd,
		SessionTTL:            ttl,
		PurgeSecret:           os.Getenv("PURGE_SECRET"),
		Storage:               storageCfg,
		TelegramWebhookSecret: strings.TrimSpace(os.Getenv("WEBHOOK_TELEGRAM_SECRET")),
		TelegramChatID:        tgChatID,
		TelegramAPIBase:       tgBase,
		TelegramTimeout:       tgTimeout,
		FrontendURL:           strings.TrimRight(strings.TrimSpace(os.Getenv("FRONTEND_URL")), "/"),
		PublicAPIURL:          strings.TrimRight(strings.TrimSpace(os.Getenv("PUBLIC_API_URL")), "/"),
		MailDriver:            mailDriver,
		SMTPHost:              smtpHost,
		SMTPPort:              strings.TrimSpace(os.Getenv("SMTP_PORT")),
		SMTPUser:              strings.TrimSpace(os.Getenv("SMTP_USER")),
		SMTPPass:              os.Getenv("SMTP_PASS"),
		SMTPFrom:              smtpFrom,
		EmailTokenSecret:      tokenSecret,
		EmailTokenTTL:         tokenTTL,
	}, nil
}

// loadStorage membaca kredensial R2.
//
// Aturannya: kosong semua berarti fitur file tidak aktif (hanya boleh di
// development); terisi sebagian adalah kesalahan konfigurasi dan harus terlihat
// saat start. Di produksi, kosong juga kesalahan — lebih baik gagal start
// daripada menerima upload lalu membalas 500 pada tiap permintaan.
func loadStorage(env string) (StorageConfig, error) {
	cfg := StorageConfig{
		Endpoint:  strings.TrimSpace(os.Getenv("R2_ENDPOINT")),
		Region:    strings.TrimSpace(os.Getenv("R2_REGION")),
		AccessKey: strings.TrimSpace(os.Getenv("R2_ACCESS_KEY_ID")),
		SecretKey: strings.TrimSpace(os.Getenv("R2_SECRET_ACCESS_KEY")),
		Bucket:    strings.TrimSpace(os.Getenv("R2_BUCKET")),
	}

	wajib := []struct {
		nama string
		isi  string
	}{
		{"R2_ENDPOINT", cfg.Endpoint},
		{"R2_ACCESS_KEY_ID", cfg.AccessKey},
		{"R2_SECRET_ACCESS_KEY", cfg.SecretKey},
		{"R2_BUCKET", cfg.Bucket},
	}

	var kosong []string
	for _, w := range wajib {
		if w.isi == "" {
			kosong = append(kosong, w.nama)
		}
	}

	if len(kosong) == len(wajib) {
		if env == EnvProd {
			return cfg, fmt.Errorf("storage wajib dikonfigurasi di produksi: isi %s",
				strings.Join([]string{"R2_ENDPOINT", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"}, ", "))
		}
		return cfg, nil
	}

	if len(kosong) > 0 {
		return cfg, fmt.Errorf("konfigurasi storage tidak lengkap, kosong: %s", strings.Join(kosong, ", "))
	}

	return cfg, nil
}

func (c Config) IsProd() bool { return c.Env == EnvProd }
