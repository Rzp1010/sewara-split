-- ============================================================
-- LOCKOUT LOGIN: kolom penalti per akun di profiles
-- DB redesign: uniscegyqyqnvmuxnfsr
-- Tanggal: 2026-08-10
-- Idempotent (aman dijalankan ulang)
-- Rujukan: PLAN_KEAMANAN_LOGIN.md (Fitur A — lockout semua role)
-- ============================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS failed_login    INTEGER     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_failed_at  TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS cooldown_until  TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS locked_until    TIMESTAMPTZ NULL;

NOTIFY pgrst, 'reload schema';
