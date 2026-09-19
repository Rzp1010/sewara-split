-- Snapshot RLS activity_logs (DB sewara: obhvrzholszhjnpvmnna)
-- Tujuan: reproducibility — policy live TIDAK PERLU dijalankan di DB live
-- (sudah aktif; diverifikasi via pg_policies 2026-09-13). Gunakan untuk setup DB baru.
-- Pencipta policy: diterapkan manual pra-audit; sumber dump pg_policies 2026-09-13.

BEGIN;

DROP POLICY IF EXISTS "access_own_or_owner_logs" ON public.activity_logs;

CREATE POLICY "access_own_or_owner_logs"
  ON public.activity_logs FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.user_id = auth.uid() AND profiles.is_active
    )
    AND (
      user_id = auth.uid()
      OR user_id = (
        SELECT profiles.owner_id FROM profiles
        WHERE profiles.user_id = auth.uid()
      )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.user_id = auth.uid() AND profiles.is_active
    )
    AND (
      user_id = auth.uid()
      OR user_id = (
        SELECT profiles.owner_id FROM profiles
        WHERE profiles.user_id = auth.uid()
      )
    )
  );

COMMIT;
