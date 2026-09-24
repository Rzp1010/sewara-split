// @ts-nocheck
/**
 * Cron purge bukti bayar lama (retensi 2 bulan).
 * BUKAN endpoint user — dilindungi header x-purge-secret.
 */
import { NextResponse } from 'next/server';
import { storage } from '@/lib/storage';
import { withErrorHandler, logInfo } from '@/lib/api/errors';

export const runtime = 'nodejs';

const PREFIX = 'bukti-bayar/';
const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;
const DELETE_BATCH = 1000;

/**
 * Cutoff = 00:00 WIB tanggal 1 (bulan sekarang - 2), dikembalikan sebagai Date UTC.
 */
function getCutoff() {
  const nowWib = new Date(Date.now() + WIB_OFFSET_MS);
  const y = nowWib.getUTCFullYear();
  const m = nowWib.getUTCMonth(); // 0-based
  const cutoffWibWall = Date.UTC(y, m - 2, 1, 0, 0, 0);
  return new Date(cutoffWibWall - WIB_OFFSET_MS);
}

async function purgeHandler(request) {
  const secret = process.env.PURGE_SECRET;
  const provided = request.headers.get('x-purge-secret');
  if (!secret || provided !== secret) {
    return NextResponse.json({ ok: false, message: 'Unauthorized' }, { status: 401 });
  }

  const cutoff = getCutoff();
  const cutoffIso = cutoff.toISOString();

  // List semua objek di prefix, paginate continuation token.
  const toDelete = [];
  let token;
  do {
    const res = await storage.list(PREFIX, token);
    for (const obj of res.Contents || []) {
      if (obj.Key && obj.LastModified && new Date(obj.LastModified) < cutoff) {
        toDelete.push(obj.Key);
      }
    }
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);

  // Hapus batch maks 1000.
  let deleted = 0;
  for (let i = 0; i < toDelete.length; i += DELETE_BATCH) {
    const batch = toDelete.slice(i, i + DELETE_BATCH);
    await storage.deleteMany(batch);
    deleted += batch.length;
  }

  logInfo('Purge bukti bayar selesai', {
    route: '/api/pembayaran/purge',
    deleted,
    cutoff: cutoffIso,
  });

  return NextResponse.json({ ok: true, deleted, cutoff: cutoffIso });
}

export const POST = withErrorHandler(purgeHandler);