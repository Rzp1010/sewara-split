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
}

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

	return Config{
		Addr:         addr,
		DatabaseURL:  dbURL,
		Env:          env,
		CookieSecure: env == EnvProd,
		SessionTTL:   ttl,
	}, nil
}

func (c Config) IsProd() bool { return c.Env == EnvProd }
