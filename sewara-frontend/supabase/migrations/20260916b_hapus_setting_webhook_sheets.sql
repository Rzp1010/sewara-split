-- Migration 2026-09-16b: Hapus setting webhook_sheets (fitur mati).
-- Field "URL Webhook Google Sheets" tak punya pengirim di kode — tidak pernah
-- dipakai mengirim data. UI-nya sudah dihapus dari /pengaturan.
-- Jalankan manual di SQL Editor DB sewara (obhvrzholszhjnpvmnna).
BEGIN;

DELETE FROM settings WHERE key = 'webhook_sheets';

COMMIT;