// @ts-nocheck
/**
 * GET /api/pembayaran/reminder
 *
 * Banner peringatan backup bukti bayar. Window tgl 8..15 WIB bulan berjalan.
 * target = bulan berjalan - 2 (framing lebih ketat 1 bulan dari purge asli:
 * yang benar-benar dihapus cycle ini = bulan berjalan - 3).
 */
import { withErrorHandler } from '@/lib/api/errors';
import { requireAuth } from '@/lib/api/auth';
import { getServerClient } from '@/lib/api/supabase';
import { successResponse } from '@/lib/api/response';

export const runtime = 'nodejs';

const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;
const PAGE_SIZE = 1000;

function monthStr(y, m0) {
  const d = new Date(Date.UTC(y, m0, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function readAckValue(raw) {
  if (typeof raw !== 'string') return null;
  const t = raw.trim();
  try {
    const parsed = JSON.parse(t);
    return typeof parsed === 'string' ? parsed : null;
  } catch {
    return t;
  }
}

function tglEntri(r) {
  if (typeof r?.tanggal === 'string') return r.tanggal;
  if (typeof r?.tgl === 'string') return r.tgl;
  return '';
}

function countMonth(transactions, bulan) {
  let count = 0;
  for (const trx of transactions) {
    const riwayat = Array.isArray(trx.pembayaran?.riwayatBayar)
      ? trx.pembayaran.riwayatBayar
      : [];
    for (const r of riwayat) {
      if (
        r &&
        typeof r.bukti === 'string' &&
        r.bukti &&
        tglEntri(r).startsWith(bulan)
      ) {
        count++;
      }
    }
  }
  return count;
}

async function reminderHandler(request) {
  const supabase = await getServerClient();
  const user = await requireAuth(supabase, 'Anda harus login terlebih dahulu.');

  const nowWib = new Date(Date.now() + WIB_OFFSET_MS);
  const y = nowWib.getUTCFullYear();
  const m = nowWib.getUTCMonth(); // 0-based
  const day = nowWib.getUTCDate();

  // Window tampilkan: tgl 8..15 WIB bulan berjalan.
  if (day < 8 || day > 15) {
    return successResponse({ show: false });
  }

  // Tenant aktif: staf pakai owner_id, owner pakai user_id sendiri.
  const { data: prof } = await supabase
    .from('profiles')
    .select('owner_id')
    .eq('user_id', user.id)
    .maybeSingle();
  const ownerId = prof?.owner_id || user.id;

  const target = monthStr(y, m - 2); // bulan berjalan - 2
  const bulanSebelumTarget = monthStr(y, m - 3); // yang benar-benar dihapus cycle ini
  const purgeTanggal = `${monthStr(y, m)}-15`;

  // Scan semua transaksi tenant (paginate).
  const transactions = [];
  for (let page = 0; ; page++) {
    const from = page * PAGE_SIZE;
    const { data, error } = await supabase
      .from('transactions')
      .select('id,pembayaran')
      .eq('user_id', ownerId)
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    transactions.push(...data);
    if (data.length < PAGE_SIZE) break;
  }

  const jumlahTarget = countMonth(transactions, target);
  const jumlahSebelum = countMonth(transactions, bulanSebelumTarget);

  // Bila bulan target kosong tapi bulan yang benar2 dihapus cycle ini berisi,
  // arahkan peringatan ke bulan yang ada file-nya (yang akan hilang duluan).
  const bulanTampil = jumlahTarget > 0 ? target : bulanSebelumTarget;
  const jumlahTampil = jumlahTarget > 0 ? jumlahTarget : jumlahSebelum;

  // Ack: settings tenant key `bukti_backup_ack` (value = YYYY-MM terakhir di-ack).
  const { data: setting } = await supabase
    .from('settings')
    .select('value')
    .eq('user_id', ownerId)
    .eq('key', 'bukti_backup_ack')
    .maybeSingle();
  const ack = readAckValue(setting?.value);

  const show = ack !== bulanTampil && (jumlahTarget > 0 || jumlahSebelum > 0);

  return successResponse({ show, bulan: bulanTampil, purgeTanggal, jumlah: jumlahTampil });
}

export const GET = withErrorHandler(reminderHandler);
