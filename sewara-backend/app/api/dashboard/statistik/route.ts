// @ts-nocheck
import { getServerClient } from '@/lib/api/supabase';
import { requireAuth } from '@/lib/api/auth';
import { successResponse } from '@/lib/api/response';
import { withErrorHandler } from '@/lib/api/errors';

export const runtime = 'nodejs';

/**
 * GET /api/dashboard/statistik?mulai=&akhir=
 *
 * Angka ringkas dashboard: barang, transaksi aktif, selesai, pendapatan.
 */
export const GET = withErrorHandler(async (request) => {
  const supabase = await getServerClient();
  await requireAuth(supabase);

  const { searchParams } = new URL(request.url);
  const mulai = searchParams.get('mulai');
  const akhir = searchParams.get('akhir');

  const { data: settingBasis } = await supabase
    .from('settings')
    .select('value')
    .eq('key', 'basis_pendapatan')
    .maybeSingle();

  let basis = 'selesai';
  if (settingBasis?.value) {
    try {
      basis = JSON.parse(settingBasis.value);
    } catch {
      basis = settingBasis.value;
    }
  }

  const rentang = (q) => {
    if (!mulai || !akhir) return q;
    return q.gte('created_at', mulai).lte('created_at', akhir);
  };

  const { count: barang } = await supabase
    .from('inventory')
    .select('id', { count: 'exact', head: true });

  const { count: aktif } = await rentang(
    supabase
      .from('transactions')
      .select('id', { count: 'exact', head: true })
      .not('status', 'in', '("Selesai","Dibatalkan","Belum Selesai")'),
  );

  const { count: selesai } = await rentang(
    supabase
      .from('transactions')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'Selesai'),
  );

  const buatQueryPendapatan = () => {
    const q = supabase.from('transactions').select('total_akhir');
    if (basis === 'selesai') return q.eq('status', 'Selesai');
    if (basis === 'aktif') return q.in('status', ['Selesai', 'Disewa']);
    return q.neq('status', 'Dibatalkan');
  };

  // ponytail: loop fetch 1000/halaman — .sum() aggregate tidak tersedia.
  // Kalau baris transaksi >50k, ganti ke RPC sum di DB.
  const pageSize = 1000;
  let pendapatan = 0;
  let offset = 0;
  while (true) {
    const { data, error } = await rentang(buatQueryPendapatan()).range(
      offset,
      offset + pageSize - 1,
    );
    if (error) throw error;
    const batch = data || [];
    for (const r of batch) pendapatan += Number(r.total_akhir || 0);
    if (batch.length < pageSize) break;
    offset += pageSize;
  }

  return successResponse({
    statistik: {
      barang: barang || 0,
      aktif: aktif || 0,
      selesai: selesai || 0,
      pendapatan,
    },
  });
});