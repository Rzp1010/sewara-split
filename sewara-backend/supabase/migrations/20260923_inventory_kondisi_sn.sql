-- Kondisi per S/N unit. Map JSONB: { "SN": { "kondisi": "baik|bermasalah|maintenance", "catatan": string|null } }
-- Idempotent & additive. Default '{}' = semua unit dianggap baik (tanpa backfill).
ALTER TABLE public.inventory
  ADD COLUMN IF NOT EXISTS kondisi_sn JSONB NOT NULL DEFAULT '{}'::jsonb;