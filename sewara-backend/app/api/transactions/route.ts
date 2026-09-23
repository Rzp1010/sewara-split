// @ts-nocheck
import { getServerClient } from '@/lib/api/supabase';
import { requireAuth } from '@/lib/api/auth';
import { successResponse } from '@/lib/api/response';
import { withErrorHandler } from '@/lib/api/errors';
import { guardMaintenance } from '@/lib/api/kondisi-sn';

export const runtime = 'nodejs';

// Preset kolom — dipakai frontend supaya payload kecil (lihat lib/db.js lama).
const KOLOM = {
  ringkas:
    'id,no_invoice,penyewa,status,total_akhir,biaya,denda,waktu_ambil_rencana,waktu_kembali_rencana,waktu_kembali_aktual',
  kartu:
    'id,no_invoice,penyewa,hp_penyewa,alamat_penyewa,jaminan_sewa,status,items,waktu_ambil_rencana,waktu_kembali_rencana,durasi_teks,total_akhir,pembayaran,biaya,denda,diskon,dilayani_oleh,riwayatDilayani,printilan',
  laporan:
    'id,no_invoice,penyewa,hp_penyewa,alamat_penyewa,jaminan_sewa,status,waktu_kembali_rencana,waktu_kembali_aktual,biaya,denda,total_akhir,pembayaran,dp_hangus,dp_hangus_aturan,printilan',
  statistik: 'id,status,total_akhir',
};

/**
 * GET /api/transactions
 *
 * Params:
 *   kolom=ringkas|kartu|laporan|statistik   preset kolom (default *)
 *   nested=1                                ikutkan items + payments
 *   ids=a,b                                 .in('id')
 *   status=A,B                              .in('status')
 *   cari=teks                               ilike penyewa, limit 100
 *   hideRiwayat=1                           exclude Selesai/Dibatalkan
 *   mulai,akhir                             filter rentang (default: overlap)
 *   rentangKolom=kembali                    rentang pakai waktu_kembali_rencana
 *   tanggalKolom=ambil                      rentang pakai waktu_ambil_rencana
 *   limit,offset
 */
export const GET = withErrorHandler(async (request) => {
  const supabase = await getServerClient();
  await requireAuth(supabase);

  const { searchParams } = new URL(request.url);
  const kolom = KOLOM[searchParams.get('kolom')] || '*';
  const nested = searchParams.get('nested') === '1';
  const select = nested ? `${kolom}, transaction_items!transaction_id(*), transaction_payments!transaction_id(*)` : kolom;

  const ids = searchParams.get('ids');
  const status = searchParams.get('status');
  const cari = searchParams.get('cari');
  const hideRiwayat = searchParams.get('hideRiwayat') === '1';
  const mulai = searchParams.get('mulai');
  const akhir = searchParams.get('akhir');
  const rentangKolom = searchParams.get('rentangKolom');
  const tanggalKolom = searchParams.get('tanggalKolom');
  const limit = Number(searchParams.get('limit') || 0);
  const offset = Number(searchParams.get('offset') || 0);

  let query = supabase.from('transactions').select(select);

  if (ids) query = query.in('id', ids.split(',').filter(Boolean));
  if (status) query = query.in('status', status.split(',').filter(Boolean));
  if (cari) query = query.ilike('penyewa', `%${cari}%`);
  if (hideRiwayat) query = query.not('status', 'in', '("Selesai","Dibatalkan")');

  if (mulai && akhir) {
    if (tanggalKolom === 'ambil') {
      query = query.gte('waktu_ambil_rencana', mulai).lte('waktu_ambil_rencana', akhir);
    } else if (rentangKolom === 'kembali') {
      query = query.gte('waktu_kembali_rencana', mulai).lte('waktu_kembali_rencana', akhir);
    } else {
      // default: ambil <= akhir AND kembali >= mulai (overlap)
      query = query.lte('waktu_ambil_rencana', akhir).gte('waktu_kembali_rencana', mulai);
    }
  }

  if (cari) {
    query = query.order('id', { ascending: false }).limit(100);
  } else if (limit) {
    query = query.order('id', { ascending: true }).range(offset, offset + limit - 1);
  } else {
    query = query.order('created_at', { ascending: false });
  }

  const { data, error } = await query;
  if (error) throw error;
  return successResponse({ transactions: data });
});

/**
 * POST /api/transactions — simpan transaksi atomic via RPC
 */
export const POST = withErrorHandler(async (request) => {
  const supabase = await getServerClient();
  await requireAuth(supabase);

  const body = await request.json();

  // Guard: tolak SN berstatus maintenance sebelum simpan (bermasalah tetap boleh).
  const guardError = await guardMaintenance(supabase, body?.items ?? []);
  if (guardError) return guardError;

  const { data, error } = await supabase.rpc('rpc_save_transaction', {
    p_transaction: body?.transaction ?? body,
    p_items: body?.items ?? [],
    p_payments: body?.payments ?? [],
    p_replace_items: true,
    p_replace_payments: true,
  });

  if (error) throw error;
  return successResponse({ transaction: data });
});