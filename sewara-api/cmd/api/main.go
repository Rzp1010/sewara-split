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
	"github.com/Rzp1010/sewara-split/sewara-api/internal/httpapi"
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

	// W1: buka pool pgx di sini dan suntikkan ke httpapi.New sebagai *tenant.DB.
	srv := &http.Server{
		Addr:    cfg.Addr,
		Handler: httpapi.New(cfg, log),
		// Timeout eksplisit: tanpa ini, koneksi lambat menahan worker.
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      60 * time.Second, // ekspor ZIP & streaming R2 butuh ruang
		IdleTimeout:       120 * time.Second,
		MaxHeaderBytes:    1 << 20,
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

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

func newLogger(prod bool) *slog.Logger {
	opts := &slog.HandlerOptions{Level: slog.LevelInfo}
	if prod {
		return slog.New(slog.NewJSONHandler(os.Stdout, opts))
	}
	return slog.New(slog.NewTextHandler(os.Stdout, opts))
}
