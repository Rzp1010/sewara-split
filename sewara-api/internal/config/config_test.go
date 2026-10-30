package config

import (
	"strings"
	"testing"
)

// envProduksi mengisi semua yang wajib di produksi. Tes yang ingin membuktikan
// kegagalan cukup mengosongkan satu variabel setelah memanggil helper ini.
func envProduksi(t *testing.T) {
	t.Helper()
	t.Setenv("APP_ENV", EnvProd)
	t.Setenv("DATABASE_URL", "postgres://contoh")
	t.Setenv("EMAIL_TOKEN_SECRET", "rahasia-uji")
	t.Setenv("MAIL_DRIVER", "log")
	t.Setenv("R2_ENDPOINT", "https://contoh.r2.cloudflarestorage.com")
	t.Setenv("R2_ACCESS_KEY_ID", "kunci-uji")
	t.Setenv("R2_SECRET_ACCESS_KEY", "rahasia-uji")
	t.Setenv("R2_BUCKET", "sewara-dev")
	t.Setenv("R2_BUCKET_NAME", "")
	t.Setenv("FRONTEND_URL", "")
}

func TestProduksiWajibFrontendURL(t *testing.T) {
	envProduksi(t)
	if _, err := Load(); err == nil || !strings.Contains(err.Error(), "FRONTEND_URL") {
		t.Fatalf("tanpa FRONTEND_URL di produksi harus gagal menyebut FRONTEND_URL, dapat: %v", err)
	}

	envProduksi(t)
	t.Setenv("FRONTEND_URL", "https://app.sewara.my.id/")
	cfg, err := Load()
	if err != nil {
		t.Fatalf("konfigurasi produksi lengkap harus lulus, dapat: %v", err)
	}
	if cfg.FrontendURL != "https://app.sewara.my.id" {
		t.Fatalf("garis miring akhir harus dipangkas, dapat: %q", cfg.FrontendURL)
	}
	if !cfg.CookieSecure {
		t.Fatal("produksi harus memakai cookie Secure")
	}
}

// Di luar produksi FRONTEND_URL boleh kosong: handler yang memberi fallback
// localhost supaya pengembangan tidak perlu menyetelnya.
func TestDevTanpaFrontendURLTetapLulus(t *testing.T) {
	t.Setenv("APP_ENV", EnvDev)
	t.Setenv("DATABASE_URL", "postgres://contoh")
	t.Setenv("MAIL_DRIVER", "log")
	t.Setenv("FRONTEND_URL", "")
	for _, k := range []string{"R2_ENDPOINT", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET", "R2_BUCKET_NAME"} {
		t.Setenv(k, "")
	}

	cfg, err := Load()
	if err != nil {
		t.Fatalf("dev tanpa FRONTEND_URL harus tetap lulus, dapat: %v", err)
	}
	if cfg.FrontendURL != "" {
		t.Fatalf("dev tanpa FRONTEND_URL harus kosong, dapat: %q", cfg.FrontendURL)
	}
}
