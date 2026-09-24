// @ts-nocheck
import { NextResponse } from 'next/server';
import JSZip from 'jszip';
import { storage } from '@/lib/storage';
import { withErrorHandler, logWarning } from '@/lib/api/errors';
import { requireAuth } from '@/lib/api/auth';
import { getServerClient } from '@/lib/api/supabase';
import { validationErrorResponse } from '@/lib/api/response';

export const runtime = 'nodejs';

const PAGE_SIZE = 1000;

function sanitize(name) {
  return String(name || '')
    .replace(/[\\/:*?"<>|\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extFromPath(path) {
  const m = String(path).match(/\.([a-z0-9]+)(?:\?|$)/i);
  return m ? m[1].toLowerCase() : 'jpg';
}

async function exportHandler(request) {
  const supabase = await getServerClient();
  const user = await requireAuth(supabase, 'Anda harus login terlebih dahulu.');

  const url = new URL(request.url);
  const bulan = url.searchParams.get('bulan');
  if (!bulan || !/^\d{4}-\d{2}$/.test(bulan)) {
    return validationErrorResponse('Parameter bulan tidak valid. Format: YYYY-MM.');
  }

  // Tenant aktif: staf pakai owner_id, owner pakai user_id sendiri.
  const { data: prof } = await supabase
    .from('profiles')
    .select('owner_id')
    .eq('user_id', user.id)
    .maybeSingle();
  const ownerId = prof?.owner_id || user.id;

  // Scan semua transaksi tenant (paginate).
  const transactions = [];
  for (let page = 0; ; page++) {
    const from = page * PAGE_SIZE;
    const { data, error } = await supabase
      .from('transactions')
      .select('id,kode,no_invoice,penyewa,pembayaran')
      .eq('user_id', ownerId)
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    transactions.push(...data);
    if (data.length < PAGE_SIZE) break;
  }

  // Kumpulkan entri bukti bayar bulan tsb, urut kronologis per transaksi.
  const entries = [];
  for (const trx of transactions) {
    const riwayat = Array.isArray(trx.pembayaran?.riwayatBayar)
      ? trx.pembayaran.riwayatBayar
      : [];
    const hits = riwayat
      .filter(
        (r) =>
          r &&
          typeof r.bukti === 'string' &&
          r.bukti &&
          typeof r.tanggal === 'string' &&
          r.tanggal.startsWith(bulan)
      )
      .sort((a, b) => String(a.tanggal).localeCompare(String(b.tanggal)));
    const base = sanitize(trx.no_invoice || trx.kode || trx.id);
    const penyewa = sanitize(trx.penyewa);
    hits.forEach((r, i) => {
      const suffix = i === 0 ? '' : ` (${i + 1})`;
      const ext = extFromPath(r.bukti);
      entries.push({
        path: r.bukti,
        filename: `${base} - ${penyewa}${suffix}.${ext}`,
      });
    });
  }

  if (entries.length === 0) {
    return NextResponse.json({
      ok: false,
      message: 'Tidak ada bukti bayar untuk bulan tersebut.',
    });
  }

  const zip = new JSZip();
  const folder = zip.folder(`bukti-bayar-${bulan}`);
  let skipped = 0;

  for (const entry of entries) {
    try {
      const buf = await storage.get(entry.path);
      folder.file(entry.filename, buf);
    } catch (e) {
      skipped++;
      logWarning('Bukti bayar export: file di-skip', {
        route: '/api/pembayaran/export',
        path: entry.path,
        error: e?.message,
      });
    }
  }

  const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });

  return new NextResponse(zipBuffer, {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename=bukti-bayar-${bulan}.zip`,
      'X-Skipped-Count': String(skipped),
    },
  });
}

export const GET = withErrorHandler(exportHandler);