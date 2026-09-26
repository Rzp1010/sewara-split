/**
 * Data layer frontend Sewara.
 *
 * Nama & signature sengaja SAMA dengan modul lama supaya seluruh halaman
 * tidak perlu diubah. Bedanya: tidak ada Supabase di sini — semua lewat
 * backend API (`@/lib/api-client`). Jadi frontend tetap bebas Supabase,
 * sementara pemanggil lama tetap jalan.
 *
 * Setting aplikasi (getSetting/setSetting) memang LOCAL (localStorage),
 * dipakai sinkron saat render. Sumber kebenarannya tetap backend:
 * initSettings() menarik semua setting tenant ke localStorage saat mount.
 */

import { api, apiRequest, API_BASE } from '@/lib/api-client';

// ============================================================================
// EVENT HELPERS — halaman mendengarkan event ini untuk refresh
// ============================================================================

function kirimEventData() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('dataChanged'));
  }
}

function laporError(detail) {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('dataError', { detail }));
  }
}

// ============================================================================
// SETTINGS — local (sync) + tenant (backend)
// ============================================================================

function bacaLocalSettings() {
  if (typeof localStorage === 'undefined') return {};
  try {
    return JSON.parse(localStorage.getItem('rentalpro_settings') || '{}');
  } catch {
    return {};
  }
}

/** Baca setting lokal (sinkron, untuk render). */
export function getSetting(key, fallback) {
  return bacaLocalSettings()[key] ?? fallback;
}

/** Tulis setting lokal + dorong ke backend (fire-and-forget). */
export function setSetting(key, value) {
  if (typeof localStorage !== 'undefined') {
    const settings = bacaLocalSettings();
    settings[key] = value;
    localStorage.setItem('rentalpro_settings', JSON.stringify(settings));
  }
  api.settings
    .upsert({ key, value: JSON.stringify(value) })
    .catch((e) => console.error('setSetting sync error:', e.message));
  kirimEventData();
}

/** Baca setting tenant dari backend (async). */
export async function getSettingTenant(key, fallback) {
  try {
    const { setting } = await api.settings.get(key);
    if (!setting?.value) return fallback;
    try {
      return JSON.parse(setting.value);
    } catch {
      return fallback;
    }
  } catch (e) {
    console.error('getSettingTenant error:', e.message);
    return fallback;
  }
}

/** Tulis setting tenant ke backend. */
export async function setSettingTenant(key, value) {
  try {
    await api.settings.upsert({ key, value: JSON.stringify(value) });
    kirimEventData();
    return { ok: true };
  } catch (e) {
    console.error('setSettingTenant error:', e.message);
    return { ok: false, error: e.message };
  }
}

/** Menit auto-logout tenant. */
export async function getAutoLogoutMenit() {
  const nilai = await getSettingTenant('auto_logout_minutes', 15);
  return parseInt(nilai, 10) || 15;
}

/**
 * Sinkron setting tenant → localStorage saat mount.
 *
 * Ini yang mengisi cache lokal, sehingga getSetting() (sinkron) di seluruh
 * halaman membaca nilai tenant yang benar — bukan default.
 */
export async function initSettings() {
  if (typeof localStorage === 'undefined') return;
  try {
    const { settings } = await api.settings.getAll();
    const data = settings || [];
    const sebelum = bacaLocalSettings();

    if (data.length > 0) {
      const merged = { ...sebelum };
      for (const row of data) {
        try {
          merged[row.key] = JSON.parse(row.value);
        } catch {
          merged[row.key] = row.value;
        }
      }
      const berubah = JSON.stringify(merged) !== JSON.stringify(sebelum);
      localStorage.setItem('rentalpro_settings', JSON.stringify(merged));
      if (berubah && typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('settingChanged'));
      }
    } else {
      // Tenant belum punya setting → tanam nilai lokal ke backend.
      const rows = Object.entries(sebelum).map(([key, value]) => ({
        key,
        value: JSON.stringify(value),
      }));
      if (rows.length > 0) await api.settings.upsert(rows);
    }
  } catch (e) {
    console.error('initSettings error:', e.message);
  }
}

// ============================================================================
// DP HANGUS — aturan dari setting, perhitungan murni lokal
// ============================================================================

/** Ambil aturan DP hangus. Return { aktif, aturan: [{min_hari, persentase}] } */
export function getAturanDpHangus() {
  const aktif = getSetting('dp_hangus_aktif', '1') === '1';
  let aturan = [];
  try {
    const raw = getSetting('dp_hangus_aturan', null);
    if (raw) aturan = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    /* pakai default */
  }
  if (!aturan.length) {
    aturan = [
      { min_hari: 7, persentase: 100 },
      { min_hari: 3, persentase: 100 },
      { min_hari: 0, persentase: 100 },
    ];
  }
  return { aktif, aturan };
}

/** Hitung DP hangus berdasarkan aturan. */
export function hitungDpHangus(dpBayar, waktuAmbilRencana, config) {
  if (!dpBayar || dpBayar <= 0) return { jumlah: 0, persentase: 0, label: '' };
  if (!config.aktif)
    return {
      jumlah: dpBayar,
      persentase: 100,
      label: 'DP hangus penuh (aturan manual)',
    };

  const sekarang = new Date();
  const ambil = new Date(waktuAmbilRencana);
  const hariSelisih = Math.ceil((ambil - sekarang) / (1000 * 60 * 60 * 24));

  const sorted = [...config.aturan].sort((a, b) => b.min_hari - a.min_hari);
  for (const rule of sorted) {
    if (hariSelisih >= rule.min_hari) {
      return {
        jumlah: Math.round(dpBayar * (rule.persentase / 100)),
        persentase: rule.persentase,
        label: `${rule.persentase}% (${hariSelisih} hari sebelum jadwal)`,
      };
    }
  }
  return { jumlah: dpBayar, persentase: 100, label: 'DP hangus penuh' };
}

// ============================================================================
// STOK — murni lokal
// ============================================================================

export function getStok(item, inventory) {
  if (item.jenis === 'satuan') return item.sns ? item.sns.length : 0;
  if (item.jenis === 'bundling') {
    if (!item.komponen || item.komponen.length === 0) return 0;
    const stokArr = item.komponen.map((k) => {
      const dbItem = inventory.find((i) => String(i.id) === String(k.idBarang));
      return dbItem ? Math.floor((dbItem.sns || []).length / k.qty) : 0;
    });
    return Math.min(...stokArr);
  }
  return 0;
}

// ============================================================================
// INVENTORY
// ============================================================================

export async function getInventory() {
  const { inventory } = await api.inventory.getAll();
  return inventory || [];
}

export async function getInventoryByIds(ids) {
  if (!ids || ids.length === 0) return [];
  const { inventory } = await api.inventory.getAllByIds(ids);
  return inventory || [];
}

export async function getInventoryRingkas() {
  const { inventory } = await api.inventory.getRingkas();
  return inventory || [];
}

export async function updateInventory(rows) {
  if (!rows || rows.length === 0) return true;
  try {
    for (const row of rows) {
      const { id, ...data } = row;
      if (id !== undefined && id !== null) {
        await api.inventory.update(id, data);
      } else {
        await api.inventory.create(data);
      }
    }
  } catch (e) {
    console.error('updateInventory error:', e.message);
    laporError(`Gagal memperbarui inventaris: ${e.message}`);
    return false;
  }
  kirimEventData();
  return true;
}

export async function hapusInventory(ids) {
  if (!ids || ids.length === 0) return { ok: true, error: null };
  try {
    await api.inventory.bulkDelete(ids);
  } catch (e) {
    console.error('hapusInventory error:', e.message);
    laporError(`Gagal menghapus inventaris: ${e.message}`);
    return { ok: false, code: e.code || 'DELETE_FAILED', error: e.message };
  }
  kirimEventData();
  return { ok: true, error: null };
}

export async function getInventoryUnits(inventoryId) {
  const { units } = await api.inventory.units.getAll(inventoryId);
  return units || [];
}

export async function saveInventoryUnits(inventoryId, serialNumbers) {
  if (!serialNumbers || serialNumbers.length === 0) return;
  await api.inventory.units.save(inventoryId, serialNumbers);
}

// ============================================================================
// TRANSAKSI
// ============================================================================

export async function getTransactions() {
  const { transactions } = await api.transactions.getAll();
  return transactions || [];
}

export async function getTransactionsRingkas() {
  const { transactions } = await api.transactions.getAll({ kolom: 'ringkas' });
  return transactions || [];
}

export async function getTransactionsAktif() {
  const { transactions } = await api.transactions.getAll({
    kolom: 'kartu',
    status: 'Booking,Disewa',
  });
  return transactions || [];
}

export async function getTransactionsSelesai(mulai, akhir) {
  const { transactions } = await api.transactions.getAll({
    kolom: 'kartu',
    status: 'Selesai',
    mulai,
    akhir,
    tanggalKolom: 'ambil',
  });
  return transactions || [];
}

export async function getTransactionsBelumSelesai(mulai, akhir) {
  const { transactions } = await api.transactions.getAll({
    kolom: 'kartu',
    status: 'Belum Selesai',
    mulai,
    akhir,
    tanggalKolom: 'ambil',
  });
  return transactions || [];
}

export async function getTransactionsRange(mulai, akhir) {
  const { transactions } = await api.transactions.getAll({ mulai, akhir });
  return transactions || [];
}

export async function getTransactionsRangeRingkas(mulai, akhir) {
  const { transactions } = await api.transactions.getAll({
    kolom: 'ringkas',
    mulai,
    akhir,
  });
  return transactions || [];
}

export async function getTransactionsOverlapAktif(mulai, akhir) {
  const { transactions } = await api.transactions.getAll({
    kolom: 'kartu',
    status: 'Booking,Disewa',
    mulai,
    akhir,
  });
  return transactions || [];
}

export async function getTransactionsLaporan() {
  const { transactions } = await api.transactions.getAll({ kolom: 'laporan' });
  return transactions || [];
}

export async function getTransactionsLaporanRange(mulai, akhir) {
  const { transactions } = await api.transactions.getAll({
    kolom: 'laporan',
    mulai,
    akhir,
    rentangKolom: 'kembali',
  });
  return transactions || [];
}

export async function getTransactionsStatistik() {
  const { transactions } = await api.transactions.getAll({ kolom: 'statistik' });
  return transactions || [];
}

export async function getTransactionsCari(q, hideRiwayat) {
  if (!q) return [];
  const { transactions } = await api.transactions.getAll({
    cari: q,
    hideRiwayat: hideRiwayat ? 1 : undefined,
  });
  return transactions || [];
}

export async function getTransactionById(id) {
  const { transaction } = await api.transactions.getById(id);
  return transaction;
}

// Pesan error server terakhir (mis. tolak SN maintenance), dibaca caller via
// getLastDbError() supaya bisa tampil persis, bukan digantikan pesan generik.
let _dbError = null;
export function getLastDbError() {
  const m = _dbError;
  _dbError = null;
  return m;
}

export async function tambahTransactions(rows) {
  if (!rows || rows.length === 0) return true;
  _dbError = null;
  try {
    for (const tx of rows) {
      const res = await api.transactions.create(tx);
      // RPC pakai IDENTITY — id klien (Date.now()) dibuang DB.
      // Backfill id asli supaya caller (mis. upload bukti bayar) bisa lanjut update.
      if (res?.transaction?.id != null) tx.id = res.transaction.id;
    }
  } catch (e) {
    console.error('tambahTransactions error:', e.message);
    _dbError = e.message;
    laporError(`Gagal menyimpan transaksi: ${e.message}`);
    return false;
  }
  kirimEventData();
  return true;
}

export async function updateTransactions(rows) {
  if (!rows || rows.length === 0) return true;
  _dbError = null;
  try {
    for (const tx of rows) await api.transactions.update(tx.id, tx);
  } catch (e) {
    console.error('updateTransactions error:', e.message);
    _dbError = e.message;
    laporError(`Gagal memperbarui transaksi: ${e.message}`);
    return false;
  }
  kirimEventData();
  return true;
}

/** Simpan satu transaksi atomic (backend pakai RPC). */
export async function saveTransactionAtomic(transactionData, items = [], payments = []) {
  const { transaction } = await api.transactions.create({
    transaction: transactionData,
    items,
    payments,
  });
  kirimEventData();
  return transaction;
}

// ============================================================================
// ITEM & PEMBAYARAN TRANSAKSI
// ============================================================================

export async function getTransactionItems(transactionId) {
  const { items } = await api.transactions.items.get(transactionId);
  return items || [];
}

export async function getTransactionItemsBulk(transactionIds) {
  if (!transactionIds || transactionIds.length === 0) return {};
  const { itemsByTransaction } = await api.transactions.items.getBulk(transactionIds);
  return itemsByTransaction || {};
}

export async function getTransactionItemsSemua() {
  const { items } = await api.transactions.items.getAll();
  return items || [];
}

export async function saveTransactionItems(transactionId, items) {
  if (!items || items.length === 0) return;
  await api.transactions.items.save(transactionId, items);
}

export async function getTransactionPayments(transactionId) {
  const { payments } = await api.transactions.payments.get(transactionId);
  return payments || [];
}

export async function saveTransactionPayments(transactionId, payments) {
  if (!payments || payments.length === 0) return;
  await api.transactions.payments.save(transactionId, payments);
}

// ============================================================================
// BUKTI BAYAR — upload/foto/ekspor (multipart + blob, bukan JSON)
// ============================================================================

/** Upload file bukti. -> path string | null */
export async function uploadBuktiBayar(file, transaksiId) {
  if (!file) return null;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 90_000);
  try {
    let berkas = file;
    if (file.size > 1_500_000 && typeof window !== 'undefined') {
      try {
        const imageCompression = (await import('browser-image-compression')).default;
        berkas = await imageCompression(file, { maxSizeMB: 1, maxWidthOrHeight: 1920, useWebWorker: true, fileType: file.type });
      } catch {
        berkas = file; // kompresi gagal -> pakai file asli
      }
    }
    const fd = new FormData();
    fd.append('file', berkas);
    fd.append('transaksiId', String(transaksiId));
    const res = await fetch(`${API_BASE}/api/pembayaran/upload`, {
      method: 'POST',
      credentials: 'include',
      body: fd,
      signal: ctl.signal,
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.message || 'Upload gagal');
    return data.path || null;
  } catch (e) {
    console.error('uploadBuktiBayar error:', e.name === 'AbortError' ? 'upload timeout 90s' : e.message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** URL proxy bukti bayar (stream via backend, auth cookie). */
export function urlBuktiBayar(path) {
  return path ? `${API_BASE}/api/pembayaran/photo?path=${encodeURIComponent(path)}` : null;
}

/** Ekspor bukti bulan YYYY-MM. -> { ok, message } ; trigger download saat ok. */
export async function eksporBuktiBayar(bulan) {
  try {
    const res = await fetch(
      `${API_BASE}/api/pembayaran/export?bulan=${encodeURIComponent(bulan)}`,
      { credentials: 'include' },
    );
    const ctype = res.headers.get('content-type') || '';
    if (!res.ok || ctype.includes('application/json')) {
      let msg = 'Gagal mengekspor bukti bayar.';
      try {
        const data = await res.json();
        msg = data.message || msg;
      } catch {
        /* biarkan pesan default */
      }
      return { ok: false, message: msg };
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bukti-bayar-${bulan}.zip`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    return { ok: true };
  } catch (e) {
    console.error('eksporBuktiBayar error:', e.message);
    return { ok: false, message: e.message };
  }
}

/** Nomor invoice berikutnya. */
export async function buatIDUnik() {
  const { no_invoice } = await api.invoice.nextNumber();
  return no_invoice;
}

// ============================================================================
// MEMBER
// ============================================================================

export async function getMembers() {
  const { members } = await api.members.getAll();
  return members || [];
}

export async function simpanMember(member) {
  try {
    const body = { ...member };
    delete body.user_id;
    delete body.tipeNama;
    delete body.diskon_persen;
    const id = body.id;
    delete body.id;

    const hasil = id
      ? await api.members.update(id, body)
      : await api.members.create(body);
    kirimEventData();
    return { ok: true, data: hasil.member };
  } catch (e) {
    console.error('simpanMember error:', e.message);
    return { ok: false, error: e.message };
  }
}

export async function hapusMember(id) {
  try {
    await api.members.delete(id);
    kirimEventData();
    return { ok: true };
  } catch (e) {
    console.error('hapusMember error:', e.message);
    return { ok: false, error: e.message };
  }
}

export async function getMemberTemplates() {
  const { memberTypes } = await api.memberTypes.getAll();
  return memberTypes || [];
}

export async function simpanMemberTemplate(tpl) {
  try {
    const row = { ...tpl };
    const id = row.id;
    delete row.id;
    delete row.user_id;

    const hasil = id
      ? await apiRequest(`/api/member-types/${id}`, {
          method: 'PATCH',
          body: JSON.stringify(row),
        })
      : await api.memberTypes.create(row);
    kirimEventData();
    return { ok: true, data: hasil.memberType };
  } catch (e) {
    console.error('simpanMemberTemplate error:', e.message);
    return { ok: false, error: e.message };
  }
}

export async function hapusMemberTemplate(id) {
  try {
    await api.memberTypes.delete(id);
    kirimEventData();
    return { ok: true };
  } catch (e) {
    console.error('hapusMemberTemplate error:', e.message);
    return { ok: false, error: e.message };
  }
}

/** Saran pelanggan: member + riwayat transaksi. */
export async function getPelangganSuggestions() {
  try {
    const [members, transactions] = await Promise.all([
      getMembers(),
      getTransactionsCari('', false).catch(() => []),
    ]);

    const memberSuggestions = (members || []).map((m) => ({
      ...m,
      sumber: 'member',
    }));
    const memberNames = new Set(
      memberSuggestions
        .map((m) => String(m.nama || '').trim().toLowerCase())
        .filter(Boolean),
    );

    const history = [];
    const historyNames = new Set();
    for (const t of transactions || []) {
      const nama = String(t.penyewa || '').trim();
      const key = nama.toLowerCase();
      if (!key || memberNames.has(key) || historyNames.has(key)) continue;
      historyNames.add(key);
      history.push({
        id: `history-${t.id}`,
        nama,
        hp: t.hp_penyewa || '',
        alamat: t.alamat_penyewa || '',
        status: 'history',
        sumber: 'history',
        diskon_persen: 0,
      });
    }
    return [...history, ...memberSuggestions];
  } catch (e) {
    console.error('getPelangganSuggestions error:', e.message);
    return [];
  }
}

// ============================================================================
// PROMO
// ============================================================================

export function promoSudahKadaluarsa(promo, now = Date.now()) {
  const sampai = promo?.berlaku_sampai
    ? new Date(promo.berlaku_sampai).getTime()
    : null;
  return (
    (sampai != null && now >= sampai) ||
    (promo?.kuota != null && Number(promo.terpakai || 0) >= Number(promo.kuota))
  );
}

/** Backend sudah menandai yang kedaluwarsa saat GET; ini tinggal diteruskan. */
export async function tandaiPromoKadaluarsa(promos) {
  return promos || [];
}

export async function getPromoCodes() {
  const { promos } = await api.promo.getAll();
  return promos || [];
}

export async function validasiPromo(id) {
  const hasil = await api.promo.validate(id);
  if (!hasil.valid) return { ok: false, error: hasil.error, data: hasil.promo };
  return { ok: true, data: hasil.promo };
}

export async function simpanPromo(promo) {
  try {
    const row = { ...promo };
    const id = row.id;
    delete row.id;
    delete row.user_id;

    const hasil = id
      ? await api.promo.update(id, row)
      : await api.promo.create(row);
    kirimEventData();
    return { ok: true, data: hasil.promo };
  } catch (e) {
    console.error('simpanPromo error:', e.message);
    return { ok: false, error: e.message };
  }
}

export async function hapusPromo(id) {
  try {
    await api.promo.delete(id);
    kirimEventData();
    return { ok: true };
  } catch (e) {
    console.error('hapusPromo error:', e.message);
    return { ok: false, error: e.message };
  }
}

export async function pakaiPromo(id) {
  try {
    await api.promo.use(id);
    kirimEventData();
    return { ok: true };
  } catch (e) {
    console.error('pakaiPromo error:', e.message);
    return { ok: false, error: e.message };
  }
}

// ============================================================================
// LOG AKTIVITAS
// ============================================================================

export async function getLogs(startDate, endDate) {
  const { logs } = await api.logs.getAll({ startDate, endDate });
  return logs || [];
}

export async function getLogsTerbaru(offset, limit = 200) {
  const { logs } = await api.logs.getAll({ offset, limit });
  return logs || [];
}

export async function tambahLogs(rows) {
  if (!rows || rows.length === 0) return true;
  try {
    await api.logs.create(rows);
  } catch (e) {
    console.error('tambahLogs error:', e.message);
    laporError(`Gagal mencatat log: ${e.message}`);
    return false;
  }
  kirimEventData();
  return true;
}

export async function deleteLogs(logIds) {
  if (!logIds || logIds.length === 0) return { ok: true, dihapus: 0, error: null };
  try {
    const { deleted } = await api.logs.delete({ ids: logIds });
    return { ok: true, dihapus: deleted || 0, error: null };
  } catch (e) {
    return { ok: false, dihapus: 0, error: `Gagal menghapus log: ${e.message}` };
  }
}

export async function deleteOldLogs() {
  try {
    const { deleted } = await api.logs.delete({ olderThanDays: 90 });
    return { ok: true, dihapus: deleted || 0, error: null };
  } catch (e) {
    return { ok: false, dihapus: 0, error: `Gagal membersihkan log lama: ${e.message}` };
  }
}

export async function getLoginLogs() {
  try {
    const { logs } = await api.loginLogs.getAll();
    return { ok: true, data: logs || [], error: null };
  } catch (e) {
    console.error('getLoginLogs error:', e.message);
    return { ok: false, data: [], error: e.message };
  }
}

// ============================================================================
// DASHBOARD
// ============================================================================

export async function getDashboardStatistik(rentang = null) {
  const params = rentang?.mulai && rentang?.akhir
    ? { mulai: rentang.mulai, akhir: rentang.akhir }
    : {};
  const { statistik } = await api.dashboard.getStatistik(params);
  return statistik;
}

export async function getRekapStatus(rentang = null) {
  const params = rentang?.mulai && rentang?.akhir
    ? { mulai: rentang.mulai, akhir: rentang.akhir }
    : {};
  const { rekapStatus } = await api.dashboard.getStats(params);
  return rekapStatus;
}

export async function getPembayaranRentang(rentang = null) {
  const params = rentang?.mulai && rentang?.akhir
    ? { mulai: rentang.mulai, akhir: rentang.akhir }
    : {};
  const { pembayaran } = await api.dashboard.getStats(params);
  return pembayaran;
}

export async function getDashboardManajemen() {
  const { manajemen } = await api.dashboard.getManajemen();
  return manajemen;
}

// ============================================================================
// AKUN & ADMIN
// ============================================================================

export async function getNamaInvoice() {
  try {
    const { user } = await api.auth.me();
    return (
      user?.nama_invoice ||
      user?.nama_lengkap ||
      user?.username ||
      user?.email ||
      null
    );
  } catch (e) {
    console.error('getNamaInvoice error:', e.message);
    return null;
  }
}

/** Profil lengkap user (bentuk lama dipakai halaman sdm/manajemen). */
export async function getRole(email) {
  if (!email) return null;
  try {
    const { profile } = await api.profiles.getByEmail(email);
    if (!profile) return null;
    return {
      role: profile.role,
      isActive: profile.is_active,
      nama: profile.nama_lengkap,
      ownerId: profile.owner_id,
      username: profile.username,
      namaInvoice: profile.nama_invoice,
      status: profile.status,
      subscribedUntil: profile.subscribed_until,
    };
  } catch (e) {
    console.error('getRole error:', e.message);
    return null;
  }
}

export async function listStaff() {
  try {
    const { users } = await api.admin.listUsers();
    const staff = (users || []).filter(
      (u) => u.role === 'cs' || u.role === 'gudang',
    );
    return { ok: true, data: staff, error: null };
  } catch (e) {
    console.error('listStaff error:', e.message);
    return { ok: false, data: [], error: 'Gagal memuat daftar staf.' };
  }
}

export async function listOwners() {
  try {
    const { users } = await api.admin.listUsers();
    const owners = (users || []).filter((u) => u.role === 'owner');
    return { ok: true, data: owners, error: null };
  } catch (e) {
    console.error('listOwners error:', e.message);
    return { ok: false, data: [], error: 'Gagal memuat daftar Owner.' };
  }
}

export async function getSemuaAkun() {
  try {
    const { akun } = await api.admin.akun();
    return { ok: true, data: akun || [], error: null };
  } catch (e) {
    console.error('getSemuaAkun error:', e.message);
    return { ok: false, data: [], error: e.message };
  }
}

export async function getAdminLogs() {
  try {
    const { logs } = await api.admin.logs();
    return { ok: true, data: logs || [], error: null };
  } catch (e) {
    return { ok: false, data: [], error: 'Gagal memuat log admin.' };
  }
}

export async function createUser(userData) {
  try {
    await api.admin.createUser(userData);
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

export async function deleteUser(email) {
  try {
    await api.admin.deleteUser(email);
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

export async function updateUser(updates) {
  const isPasswordUpdate = Boolean(updates.password);
  try {
    await api.admin.patchUser({
      email: updates.email,
      action: isPasswordUpdate ? 'ubah_password' : 'edit_profil',
      ...(isPasswordUpdate ? { new_password: updates.password } : {}),
      ...(!isPasswordUpdate
        ? {
            nama_lengkap: updates.nama_lengkap,
            username: updates.username,
            nama_invoice: updates.nama_invoice,
          }
        : {}),
    });
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

export async function unlockUser(email) {
  try {
    await api.admin.patchUser({ email, action: 'unlock_akun' });
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

export async function setRole(email, role) {
  try {
    await api.admin.patchUser({ email, action: 'set_role', role });
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

export async function _setRoleLegacy(email, role) {
  return setRole(email, role);
}

export async function toggleActive(email) {
  try {
    const { is_active } = await api.admin.patchUser({
      email,
      action: 'toggle_active',
    });
    return { ok: true, is_active, error: null };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

export async function setujuiPendaftaran(email, durasi) {
  try {
    await api.admin.patchUser({ email, action: 'setujui_registrasi', durasi });
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

export async function tolakPendaftaran(email) {
  try {
    await api.admin.patchUser({ email, action: 'tolak_registrasi' });
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

export async function perpanjangLangganan(email, durasi) {
  try {
    await api.admin.patchUser({ email, action: 'perpanjang_langganan', durasi });
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

export async function checkOwnerExists(email) {
  const profil = await getRole(email);
  return profil?.role === 'owner';
}

export async function createOwnerAccount(email, password, nama) {
  return createUser({ email, password, nama_lengkap: nama, role: 'owner' });
}

// ============================================================================
// AUTH & DATA WIPE
// ============================================================================

/** Login lewat backend (lockout ditangani server). */
export async function loginApi(email, password) {
  try {
    await api.auth.login(email, password);
    return { ok: true, error: null };
  } catch (e) {
    return {
      ok: false,
      status: e.status || 0,
      error: e.message,
      retryAfterMs: e.retryAfterMs || 0,
    };
  }
}

export async function registerApi(email, password, nama_lengkap, nama_bisnis) {
  try {
    await api.auth.register(email, password, nama_lengkap, nama_bisnis);
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, status: e.status || 0, error: e.message };
  }
}

/** Kosongkan seluruh data tenant (owner/superadmin). */
export async function hapusSemuaData() {
  try {
    const hasil = await apiRequest('/api/admin/data', { method: 'POST' });
    kirimEventData();
    return hasil.total || null;
  } catch (e) {
    console.error('hapusSemuaData error:', e.message);
    laporError(e.message);
    return null;
  }
}