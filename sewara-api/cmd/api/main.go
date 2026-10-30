package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/Rzp1010/sewara-split/sewara-api/internal/config"
	"github.com/Rzp1010/sewara-split/sewara-api/internal/db"
	"github.com/Rzp1010/sewara-split/sewara-api/internal/httpapi"
	"github.com/Rzp1010/sewara-split/sewara-api/internal/storage"
)

func main() {
	if err := run(); err != nil {
		slog.Error("api berhenti", "err", err)
		os.Exit(1)
	}
}

func run() error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	log := newLogger(cfg.IsProd())
	slog.SetDefault(log)

	// Satu pool untuk seluruh proses. Gagal cepat kalau database tidak terjangkau.
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	database, err := db.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer database.Close()

	var store *storage.Store
	if cfg.Storage.Enabled() {
		store, err = storage.New(storage.Config{
			Endpoint:  cfg.Storage.Endpoint,
			Region:    cfg.Storage.Region,
			AccessKey: cfg.Storage.AccessKey,
			SecretKey: cfg.Storage.SecretKey,
			Bucket:    cfg.Storage.Bucket,
		})
		if err != nil {
			return err
		}
		log.Info("storage terhubung", "bucket", cfg.Storage.Bucket)
	} else {
		log.Warn("storage tidak dikonfigurasi; fitur file tidak akan berfungsi")
	}

	// Sesi kedaluwarsa dibersihkan berkala; tanpa ini tabel auth.sessions tumbuh terus.
	go cleanupSessions(ctx, log, database)
	if store != nil {
		go cleanupPaymentProofs(ctx, log, store)
	}

	srv := &http.Server{
		Addr:    cfg.Addr,
		Handler: httpapi.New(cfg, log, database, store),
		// Timeout eksplisit: tanpa ini, koneksi lambat menahan worker.
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      60 * time.Second, // ekspor ZIP & streaming R2 butuh ruang
		IdleTimeout:       120 * time.Second,
		MaxHeaderBytes:    1 << 20,
	}

	serveErr := make(chan error, 1)
	go func() {
		log.Info("api mendengarkan", "addr", cfg.Addr, "env", cfg.Env)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			serveErr <- err
		}
	}()

	select {
	case err := <-serveErr:
		return err
	case <-ctx.Done():
		log.Info("sinyal berhenti diterima, menutup dengan rapi")
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	return srv.Shutdown(shutdownCtx)
}

func cleanupPaymentProofs(ctx context.Context, log *slog.Logger, store *storage.Store) {
	ticker := time.NewTicker(time.Hour)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			now := time.Now().In(time.FixedZone("WIB", 7*3600))
			if now.Day() != 15 || now.Hour() < 3 {
				continue
			}
			cutoff := time.Date(now.Year(), now.Month()-2, 1, 0, 0, 0, 0, time.FixedZone("WIB", 7*3600))
			n, err := store.DeleteOlderThan(ctx, "bukti-bayar/", cutoff)
			if err != nil {
				log.Error("gagal purge bukti bayar terjadwal", "err", err)
				continue
			}
			log.Info("purge bukti bayar terjadwal selesai", "deleted", n, "cutoff", cutoff.UTC().Format(time.RFC3339Nano))
		}
	}
}

func newLogger(prod bool) *slog.Logger {
	opts := &slog.HandlerOptions{Level: slog.LevelInfo}
	if prod {
		return slog.New(slog.NewJSONHandler(os.Stdout, opts))
	}
	return slog.New(slog.NewTextHandler(os.Stdout, opts))
}

// cleanupSessions menghapus sesi kedaluwarsa sekali sejam di latar belakang.
// Kegagalan dicatat dan diabaikan: pembersihan ini pemeliharaan, bukan fungsi
// yang boleh menjatuhkan proses.
func cleanupSessions(ctx context.Context, log *slog.Logger, database *db.DB) {
	ticker := time.NewTicker(time.Hour)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			n, err := database.DeleteExpiredSessions(ctx)
			if err != nil {
				log.Error("gagal membersihkan sesi kedaluwarsa", "err", err)
				continue
			}
			if n > 0 {
				log.Info("sesi kedaluwarsa dibersihkan", "jumlah", n)
			}
		}
	}
}
