// @ts-nocheck
/**
 * Payment Proof Photo API Route
 *
 * Streaming langsung byte bukti bayar dari R2 (browser tidak pernah menerima URL R2).
 */
import { NextResponse } from 'next/server';
import { storage } from '@/lib/storage';
import { withErrorHandler } from '@/lib/api/errors';
import { requireAuth } from '@/lib/api/auth';
import { getServerClient } from '@/lib/api/supabase';
import { validationErrorResponse, notFoundResponse } from '@/lib/api/response';

export const runtime = 'nodejs';

async function getPhotoHandler(request) {
  const supabase = await getServerClient();
  const user = await requireAuth(supabase, 'Anda harus login terlebih dahulu.');

  const url = new URL(request.url);
  const path = url.searchParams.get('path');
  if (!path) {
    return validationErrorResponse('Parameter path wajib diisi.');
  }

  const { data: prof } = await supabase
    .from('profiles')
    .select('owner_id')
    .eq('user_id', user.id)
    .maybeSingle();
  const ownerId = prof?.owner_id || user.id;

  if (!path.startsWith(`bukti-bayar/${ownerId}/`)) {
    return validationErrorResponse('Path tidak valid.');
  }

  let bytes;
  try {
    bytes = await storage.get(path);
  } catch (e) {
    return notFoundResponse('Bukti tidak ditemukan (mungkin sudah terhapus otomatis).');
  }
  const ext = path.split('.').pop()?.toLowerCase();
  const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
  return new NextResponse(bytes, { headers: { 'Content-Type': mime, 'Cache-Control': 'private, max-age=3600', 'Content-Disposition': 'inline' } });
}

export const GET = withErrorHandler(getPhotoHandler);