-- Migration 2026-09-13a: settings RLS own-or-owner (staf ikut tenant), KECUALI key sensitif.
-- MASALAH: policy lama own-only → semua settings staf rusak (diskon default, auto-logout
--   hardcoded 15m, setSetting fitur_mode gagal tiap mount/poll, polusi baris initSettings staf).
-- SENSITIF (diverifikasi live 2026-09-13): telegram_login_notif berisi botToken penuh,
--   webhook_sheets berisi URL dengan token query-param. Staf TIDAK boleh baca/tulis keduanya.
-- DESAIN:
--   - Baris milik sendiri (user_id = auth.uid()) → full access semua key (owner: token telegram-nya sendiri).
--   - Staf (profil.owner_id = settings.user_id, is_active) → akses semua key KECUALI 2 key sensitif.
-- BONUS: bersihkan baris polusi settings milik staf (hasil initSettings lama yang menulis
--   di bawah uid staf — termasuk clone token telegram di shared device).
-- ROLLBACK: DROP POLICY + jalankan ulang policy lama dari supabase/alter7_settings.sql:36-38.
-- Jalankan manual di SQL Editor DB sewara (obhvrzholszhjnpvmnna).
BEGIN;

-- 1) Bersihkan polusi: baris settings milik akun staf (role cs/gudang) tidak pernah dibaca
--    oleh jalur baru (tenant-scoped di baris owner) — aman dihapus.
DELETE FROM settings
WHERE user_id IN (
  SELECT user_id FROM profiles
  WHERE role IN ('cs','gudang') AND owner_id IS NOT NULL
);

-- 2) Ganti policy: own-or-owner dengan pengecualian key sensitif untuk non-owner.
DROP POLICY IF EXISTS "Users can access own settings" ON settings;

CREATE POLICY "settings_own_or_owner" ON settings
FOR ALL TO authenticated
USING (
  user_id = auth.uid()
  OR (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.user_id = auth.uid()
        AND p.owner_id = settings.user_id
        AND p.is_active
    )
    AND key NOT IN ('telegram_login_notif', 'webhook_sheets')
  )
)
WITH CHECK (
  user_id = auth.uid()
  OR (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.user_id = auth.uid()
        AND p.owner_id = settings.user_id
        AND p.is_active
    )
    AND key NOT IN ('telegram_login_notif', 'webhook_sheets')
  )
);

COMMIT;
