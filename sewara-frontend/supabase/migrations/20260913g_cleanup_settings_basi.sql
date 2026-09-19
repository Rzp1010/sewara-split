-- Migration 2026-09-13g: Bersihkan baris settings basi (di luar tenant-root).
--
-- Aturan resolve app (src/lib/db/helpers/tenantHelper.js): ownerId = owner_id || user_id.
-- => Baris settings HANYA dibaca bila keyed ke UID profil root (owner_id IS NULL).
-- Baris keyed ke UID staf / sub-owner / profil yatim = tak terjangkau kode = sampah.
-- Audit live 2026-09-16: 26 baris basi —
--   * 8134c20e-09d7-4e34-a32b-c7951f0854f1 (cs2@rentalpro.com, role cs) -> 22 baris
--   * 35b915e1-1af0-488d-a706-e1f39aeff3a4 (profil yatim, tak ada di profiles) -> 4 baris
--
-- Jalankan manual di SQL Editor DB sewara (obhvrzholszhjnpvmnna).
BEGIN;

DELETE FROM settings WHERE user_id IN (
  '8134c20e-09d7-4e34-a32b-c7951f0854f1',
  '35b915e1-1af0-488d-a706-e1f39aeff3a4'
);

NOTIFY pgrst, 'reload schema';

COMMIT;
