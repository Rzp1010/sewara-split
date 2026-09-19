export const ROLE_SUPERADMIN = "superadmin";
export const ROLE_OWNER = "owner";
export const ROLE_CS = "cs";
export const ROLE_GUDANG = "gudang";

// Email superadmin (pemilik sistem) — dipakai untuk guard UI/validasi khusus
export const SUPERADMIN_EMAIL = "superadmin@rentalpro.com";

// Hak akses menu per role (href -> daftar role yang boleh)
export const HAK_MENU = {
  "/dashboard": [ROLE_SUPERADMIN, ROLE_OWNER, ROLE_CS, ROLE_GUDANG],
  "/dashboard/inventaris": [ROLE_OWNER, ROLE_GUDANG],
  "/dashboard/booking": [ROLE_OWNER, ROLE_CS],
  "/dashboard/status": [ROLE_OWNER, ROLE_CS],
  "/dashboard/riwayat": [ROLE_OWNER, ROLE_CS],
  "/dashboard/tracking": [ROLE_OWNER, ROLE_CS, ROLE_GUDANG],
  "/dashboard/log": [ROLE_OWNER, ROLE_GUDANG],
  "/dashboard/kalender": [ROLE_OWNER, ROLE_CS],
  "/dashboard/laporan": [ROLE_OWNER, ROLE_CS],
  "/dashboard/sdm": [ROLE_OWNER],
  "/dashboard/member": [ROLE_OWNER, ROLE_CS],
  "/dashboard/pelanggan": [ROLE_OWNER, ROLE_CS],
  "/dashboard/promo": [ROLE_OWNER, ROLE_CS],
  "/dashboard/pengaturan": [ROLE_OWNER, ROLE_SUPERADMIN],
  "/dashboard/loginlog": [ROLE_SUPERADMIN, ROLE_OWNER],
  "/dashboard/manajemen": [ROLE_SUPERADMIN],
  "/dashboard/progres": [ROLE_SUPERADMIN],
  "/dashboard/todo": [ROLE_SUPERADMIN],
};

export function roleBolehAkses(role, href) {
  if (!role) return false; // fail-closed: role kosong/unknown selalu ditolak
  const izin = HAK_MENU[href];
  return Array.isArray(izin) && izin.includes(role);
}

export const LABEL_ROLE = {
  superadmin: "Super Admin",
  owner: "Owner",
  cs: "CS",
  gudang: "Gudang",
};
