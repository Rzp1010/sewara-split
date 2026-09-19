-- Migration: Extend members table untuk data pelanggan lengkap
-- Date: 24 August 2026
-- Project: Sewara (obhvrzholszhjnpvmnna)

-- Add new columns to members table
ALTER TABLE members ADD COLUMN IF NOT EXISTS hp TEXT;
ALTER TABLE members ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE members ADD COLUMN IF NOT EXISTS alamat TEXT;
ALTER TABLE members ADD COLUMN IF NOT EXISTS foto_jaminan JSONB DEFAULT '{}';
ALTER TABLE members ADD COLUMN IF NOT EXISTS catatan TEXT;

-- Create indexes for search performance
CREATE INDEX IF NOT EXISTS idx_members_hp ON members(hp) WHERE hp IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_members_email ON members(email) WHERE email IS NOT NULL;

-- Add comments
COMMENT ON COLUMN members.hp IS 'Nomor HP pelanggan (format Indonesia: 08xx atau +62)';
COMMENT ON COLUMN members.email IS 'Email pelanggan';
COMMENT ON COLUMN members.alamat IS 'Alamat lengkap pelanggan';
COMMENT ON COLUMN members.foto_jaminan IS 'Path foto jaminan (KTP/SIM/dokumen) stored in R2 - Format: {"ktp": "user_id/member_id_ktp.jpg", "sim": "...", "lainnya": "..."}';
COMMENT ON COLUMN members.catatan IS 'Catatan internal untuk pelanggan';

-- Sample foto_jaminan structure:
-- {
--   "ktp": "user-abc-123/member-001_ktp.jpg",
--   "sim": "user-abc-123/member-001_sim.jpg",
--   "lainnya": "user-abc-123/member-001_jaminan.pdf"
-- }
