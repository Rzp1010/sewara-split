// @ts-nocheck
import { NextResponse } from 'next/server';
import { storage } from '@/lib/storage';
import { withErrorHandler } from '@/lib/api/errors';
import { requireAuth } from '@/lib/api/auth';
import { getServerClient } from '@/lib/api/supabase';
import { validationErrorResponse } from '@/lib/api/response';

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

  const signedUrl = await storage.getSignedURL(path, 3600);

  return NextResponse.json({ ok: true, url: signedUrl });
}

export const GET = withErrorHandler(getPhotoHandler);