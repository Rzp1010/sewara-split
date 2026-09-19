// @ts-nocheck
import { NextResponse } from 'next/server';
import { storage, buildStorageKey } from '@/lib/storage';
import { memberUploadLimiter, checkRateLimit } from '@/lib/api/rate-limit';
import { withErrorHandler, logError } from '@/lib/api/errors';
import { requireAuth } from '@/lib/api/auth';
import { getServerClient } from '@/lib/api/supabase';
import {
  validationErrorResponse,
  notFoundResponse,
} from '@/lib/api/response';

export const runtime = 'nodejs';

async function uploadHandler(request) {
  const supabase = await getServerClient();
  const user = await requireAuth(supabase, 'Anda harus login terlebih dahulu.');

    // Rate limit: 50 uploads per minute per user
    const rateLimitResponse = await checkRateLimit(
      memberUploadLimiter,
      user.id,
      'Terlalu banyak upload. Coba lagi dalam beberapa saat.'
    );
    if (rateLimitResponse) {
      return rateLimitResponse;
    }

    const formData = await request.formData();
    const file = formData.get('file');
    const memberId = formData.get('memberId');
    const label = formData.get('label'); // User-selected dropdown label
    const index = formData.get('index'); // Document index (0-4)
    const allowedLabels = ['KTP', 'SIM', 'NPWP', 'Kartu Keluarga', 'Lainnya'];
    const allowedMimeTypes = ['image/jpeg', 'image/png', 'application/pdf'];

    if (!file || typeof file.arrayBuffer !== 'function' || !memberId || !label || !allowedLabels.includes(label)) {
      return validationErrorResponse('File, member ID, atau label tidak valid.');
    }
    if (index === null || index === undefined || isNaN(index) || Number(index) < 0 || Number(index) > 4) {
      return validationErrorResponse('Index dokumen tidak valid (harus 0-4).');
    }
    if (!allowedMimeTypes.includes(file.type)) {
      return validationErrorResponse('Jenis file tidak didukung. Gunakan JPG, PNG, atau PDF.');
    }
    if (file.size > 10 * 1024 * 1024) {
      return validationErrorResponse('Ukuran file maksimal 10 MB.');
    }

    // Tenant aktif: staf pakai owner_id (data member milik owner), owner pakai user_id sendiri.
    const { data: prof } = await supabase
      .from('profiles')
      .select('owner_id')
      .eq('user_id', user.id)
      .maybeSingle();
    const ownerId = prof?.owner_id || user.id;

    const { data: member, error: memberError } = await supabase
      .from('members')
      .select('foto_jaminan')
      .eq('id', memberId)
      .eq('user_id', ownerId)
      .single();
    if (memberError || !member) {
      return notFoundResponse('Member tidak ditemukan.');
    }

    // Parse existing documents array
    let documents = Array.isArray(member.foto_jaminan) ? member.foto_jaminan : [];
    
    // Check max 5 documents limit
    const docIndex = Number(index);
    if (docIndex >= documents.length && documents.length >= 5) {
      return validationErrorResponse('Maksimal 5 dokumen diizinkan.');
    }

    // Generate unique storage key with index (prefix ownerId — selaras dgn /api/member/photo)
    const ext = file.type === 'application/pdf' ? 'pdf' : file.type === 'image/png' ? 'png' : 'jpg';
    const key = `${ownerId}/${memberId}/doc-${docIndex}.${ext}`;
    
    // Upload to R2
    await storage.upload(key, Buffer.from(await file.arrayBuffer()), file.type);

    // Update or insert document in array
    const newDoc = { label, path: key };
    if (docIndex < documents.length) {
      // Replace existing document at index
      const oldPath = documents[docIndex]?.path;
      if (oldPath && oldPath !== key) {
        try { await storage.delete(oldPath); } catch (e) { logError(e, {
          route: '/api/member/upload',
          operation: 'delete_old_file',
          path: oldPath
        }); }
      }
      documents[docIndex] = newDoc;
    } else {
      // Append new document
      documents.push(newDoc);
    }

    const { error: updateError } = await supabase
      .from('members')
      .update({ foto_jaminan: documents })
      .eq('id', memberId)
      .eq('user_id', ownerId);
    if (updateError) throw updateError;

  return NextResponse.json({ ok: true, path: key, label });
}

export const POST = withErrorHandler(uploadHandler);
