// @ts-nocheck
import { getServerClient } from '@/lib/api/supabase';
import { requireAuth } from '@/lib/api/auth';
import { getTenantId } from '@/lib/api/tenant';
import { successResponse } from '@/lib/api/response';
import { withErrorHandler } from '@/lib/api/errors';

export const runtime = 'nodejs';

export const GET = withErrorHandler(async (request: Request) => {
  const supabase = await getServerClient();
  const user = await requireAuth(supabase);

  const { searchParams } = new URL(request.url);
  const mulai = searchParams.get('mulai') || undefined;
  const akhir = searchParams.get('akhir') || undefined;

  // RPC dashboard stats — pakai TENANT id (owner), bukan id staf.
  // Guard RPC (20260913c) menolak p_user_id = id staf yang login.
  const tenantId = await getTenantId(supabase, user.id);

  const { data: rekapStatus, error: rekapError } = await supabase
    .rpc('rpc_dashboard_rekap_status', {
      p_user_id: tenantId,
      p_mulai: mulai,
      p_akhir: akhir,
    });

  const { data: pembayaran, error: bayarError } = await supabase
    .rpc('rpc_dashboard_pembayaran', {
      p_user_id: tenantId,
      p_mulai: mulai,
      p_akhir: akhir,
    });

  if (rekapError) throw rekapError;
  if (bayarError) throw bayarError;

  return successResponse({
    rekapStatus: rekapStatus || [],
    pembayaran: pembayaran || [],
  });
});
