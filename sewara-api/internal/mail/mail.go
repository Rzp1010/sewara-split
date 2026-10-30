// Package mail mengirim email transaksional (verifikasi akun).
//
// Ada dua driver, dipilih lewat MAIL_DRIVER:
//   - log  — menulis tautan verifikasi ke stdout. Dipakai saat development/uji
//     supaya alur verifikasi bisa diuji tanpa SMTP dan tanpa jaringan luar.
//   - smtp — mengirim lewat net/smtp memakai SMTP_HOST/PORT/USER/PASS/FROM.
//
// Tidak ada berkas yang ditulis dan tidak ada state di memori proses, sesuai
// aturan portabilitas runtime.
package mail

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/smtp"
	"os"
	"strings"
)

// Sender mengirim satu email verifikasi. Antarmuka sempit supaya handler tidak
// terikat pada driver tertentu.
type Sender interface {
	SendVerification(ctx context.Context, to, verifyURL string) error
}

// Config adalah penyetelan driver email.
type Config struct {
	Driver string // "log" atau "smtp"
	Host   string
	Port   string
	User   string
	Pass   string
	From   string
}

// New membuat Sender sesuai driver. Driver smtp menolak konfigurasi kosong
// (gagal saat start, bukan diam-diam tidak mengirim).
func New(cfg Config) (Sender, error) {
	switch cfg.Driver {
	case "log":
		// Seam uji: driver log menulis tautan ke stdout; tidak ada SMTP/jaringan.
		return logSender{}, nil
	case "smtp":
		if strings.TrimSpace(cfg.Host) == "" || strings.TrimSpace(cfg.From) == "" {
			return nil, errors.New("konfigurasi SMTP tidak lengkap: SMTP_HOST dan SMTP_FROM wajib diisi")
		}
		port := strings.TrimSpace(cfg.Port)
		if port == "" {
			port = "587"
		}
		return &smtpSender{cfg: cfg, port: port}, nil
	default:
		return nil, fmt.Errorf("MAIL_DRIVER tidak dikenal: %q", cfg.Driver)
	}
}

// logSender menulis tepat satu baris berisi URL verifikasi ke stdout.
type logSender struct{}

func (logSender) SendVerification(_ context.Context, to, verifyURL string) error {
	_, err := fmt.Fprintf(os.Stdout, "MAIL_DRIVER=log ke=%s url=%s\n", to, verifyURL)
	return err
}

type smtpSender struct {
	cfg  Config
	port string
}

func (s *smtpSender) SendVerification(_ context.Context, to, verifyURL string) error {
	var auth smtp.Auth
	if s.cfg.User != "" {
		auth = smtp.PlainAuth("", s.cfg.User, s.cfg.Pass, s.cfg.Host)
	}
	msg := buildMessage(s.cfg.From, to, verifyURL)
	return smtp.SendMail(net.JoinHostPort(s.cfg.Host, s.port), auth, s.cfg.From, []string{to}, []byte(msg))
}

func buildMessage(from, to, verifyURL string) string {
	body := "Halo,\r\n\r\nTerima kasih telah mendaftar di Sewara.\r\n" +
		"Buka tautan berikut untuk memverifikasi alamat email Anda:\r\n\r\n" +
		verifyURL + "\r\n\r\nAbaikan email ini jika Anda tidak merasa mendaftar.\r\n"

	var b strings.Builder
	b.WriteString("From: " + from + "\r\n")
	b.WriteString("To: " + to + "\r\n")
	b.WriteString("Subject: Verifikasi Email Sewara\r\n")
	b.WriteString("MIME-Version: 1.0\r\n")
	b.WriteString("Content-Type: text/plain; charset=UTF-8\r\n")
	b.WriteString("\r\n")
	b.WriteString(body)
	return b.String()
}
