package httpapi

import (
	"testing"
	"time"
)

func TestReminderWindowWIB(t *testing.T) {
	loc := time.FixedZone("WIB", 7*3600)
	for _, tc := range []struct {
		day  int
		want bool
	}{{7, false}, {8, true}, {15, true}, {16, false}} {
		t.Run(time.Date(2026, 10, tc.day, 12, 0, 0, 0, loc).Format("02"), func(t *testing.T) {
			if got := reminderWindow(time.Date(2026, 10, tc.day, 12, 0, 0, 0, loc)); got != tc.want {
				t.Fatalf("reminderWindow()=%v want %v", got, tc.want)
			}
		})
	}
}

func TestBulanReminderTargetFallback(t *testing.T) {
	loc := time.FixedZone("WIB", 7*3600)
	for _, tc := range []struct {
		name             string
		now              time.Time
		target, fallback int
		want             string
		count            int
	}{
		{"target", time.Date(2026, 10, 10, 0, 0, 0, 0, loc), 2, 1, "2026-08", 2},
		{"fallback", time.Date(2026, 10, 10, 0, 0, 0, 0, loc), 0, 3, "2026-07", 3},
		{"januari", time.Date(2026, 1, 10, 0, 0, 0, 0, loc), 1, 4, "2025-11", 1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			m, n := bulanReminder(tc.now, tc.target, tc.fallback)
			if m != tc.want || n != tc.count {
				t.Fatalf("got %s,%d want %s,%d", m, n, tc.want, tc.count)
			}
		})
	}
}

func TestPurgeCutoffWIB(t *testing.T) {
	loc := time.FixedZone("WIB", 7*3600)
	for _, tc := range []struct {
		name string
		now  time.Time
		want string
	}{
		{"oktober", time.Date(2026, 10, 30, 12, 0, 0, 0, loc), "2026-08-01T00:00:00+07:00"},
		{"januari", time.Date(2026, 1, 20, 12, 0, 0, 0, loc), "2025-11-01T00:00:00+07:00"},
		{"februari", time.Date(2026, 2, 20, 12, 0, 0, 0, loc), "2025-12-01T00:00:00+07:00"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := purgeCutoff(tc.now).Format(time.RFC3339); got != tc.want {
				t.Fatalf("got %s want %s", got, tc.want)
			}
		})
	}
}
