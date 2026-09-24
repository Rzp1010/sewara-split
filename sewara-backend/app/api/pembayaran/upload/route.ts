// @ts-nocheck
import { NextResponse } from 'next/server';
import { storage } from '@/lib/storage';
import { pembayaranUploadLimiter, checkRateLimit } from '@/lib/api/rate-limit';
import { withErrorHandler } from '@/lib/api/errors';
import { requireAuth } from '@/lib/api/auth';
import { getServerClient } from '@/lib/api/supabase';
import {
  validationErrorResponse,
  notFoundResponse,
} from '@/lib/api/response';

export const runtime = 'nodejs';

const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_SIZE = 5 * 1024 * 1024;

async function uploadHandler(request) {
  const supabase = await getServerClient();
  const user = await requireAuth(supabase, 'Anda harus login terlebih dahulu.');

  const rateLimitResponse = await checkRateLimit(
    pembayaranUploadLimiter,
    user.id,
    'Terlalu banyak upload. Coba lagi dalam beberapa saat.'
  );
  if (rateLimitResponse) return rateLimitResponse;

  const formData = await request.formData();
  const file = formData.get('file');
  const transaksiId = formData.get('transaksiId');

  if (!file || typeof file.arrayBuffer !== 'function' || !transaksiId) {
    return validationErrorResponse('File atau transaksi ID tidak valid.');
  }
  if (!ALLOWED_MIME.includes(file.type)) {
    return validationErrorResponse('Jenis file tidak didukung. Gunakan JPG, PNG, atau WebP.');
  }
  if (file.size > MAX_SIZE) {
    return validationErrorResponse('Ukuran file maksimal 5 MB.');
  }

  // Tenant aktif: staf pakai owner_id, owner pakai user_id sendiri.
  const { data: prof } = await supabase
    .from('profiles')
    .select('owner_id')
    .eq('user_id', user.id)
    .maybeSingle();
  const ownerId = prof?.owner_id || user.id;

  const { data: trx } = await supabase
    .from('transactions')
    .select('id')
    .eq('id', transaksiId)
    .eq('user_id', ownerId)
    .maybeSingle();
  if (!trx) {
    return notFoundResponse('Transaksi tidak ditemukan.');
  }

  const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
  const key = `bukti-bayar/${ownerId}/${transaksiId}/pay-${Date.now()}.${ext}`;

  await storage.upload(key, Buffer.from(await file.arrayBuffer()), file.type);

  return NextResponse.json({ ok: true, path: key });
}

export const POST = withErrorHandler(uploadHandler);