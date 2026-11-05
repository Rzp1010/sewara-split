-- 0007_chat.sql — tabel chat internal tenant untuk staging Go
--
-- Mirror kontrak fitur chat internal yang disepakati. Ledger dicatat runner
-- (scripts/docker-staging.ps1), JANGAN tulis INSERT INTO schema_migrations.

BEGIN;

CREATE TABLE IF NOT EXISTS public.chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  trx_id uuid,
  author_id uuid,
  author_nama text NOT NULL DEFAULT '',
  author_role text,
  pesan text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chat_messages_pesan_check CHECK (length(trim(pesan)) BETWEEN 1 AND 2000)
);

CREATE TABLE IF NOT EXISTS public.chat_reads (
  user_id uuid NOT NULL,
  scope text NOT NULL,
  last_read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, scope)
);

ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_reads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS chat_messages_access_own_or_owner ON public.chat_messages;
CREATE POLICY chat_messages_access_own_or_owner
  ON public.chat_messages FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.user_id = auth.uid() AND profiles.is_active)
    AND (user_id = auth.uid() OR user_id = (SELECT profiles.owner_id FROM profiles WHERE profiles.user_id = auth.uid()))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.user_id = auth.uid() AND profiles.is_active)
    AND (user_id = auth.uid() OR user_id = (SELECT profiles.owner_id FROM profiles WHERE profiles.user_id = auth.uid()))
  );

DROP POLICY IF EXISTS chat_reads_access_self ON public.chat_reads;
CREATE POLICY chat_reads_access_self
  ON public.chat_reads FOR ALL TO authenticated
  USING (
    user_id = auth.uid()
    AND EXISTS (SELECT 1 FROM profiles WHERE profiles.user_id = auth.uid() AND profiles.is_active)
  )
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (SELECT 1 FROM profiles WHERE profiles.user_id = auth.uid() AND profiles.is_active)
  );

CREATE INDEX IF NOT EXISTS chat_messages_user_created_idx ON public.chat_messages (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS chat_messages_user_trx_created_idx ON public.chat_messages (user_id, trx_id, created_at DESC);

COMMIT;
