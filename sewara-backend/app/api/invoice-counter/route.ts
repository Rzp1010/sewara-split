// @ts-nocheck
import { getServerClient } from '@/lib/api/supabase';
import { requireAuth } from '@/lib/api/auth';
import { successResponse } from '@/lib/api/response';
import { withErrorHandler } from '@/lib/api/errors';

export const runtime = 'nodejs';

/**
 * POST /api/invoice-counter
 *
 * Ambil nomor invoice berikutnya untuk tenant: PREFIX-NNNNNN.
 * Pakai RPC increment_invoice_counter kalau ada; fallback ke settings counter.
 */
export const POST = withErrorHandler(async () => {
  const supabase = await getServerClient();
  await requireAuth(supabase);

  const { data: settings } = await supabase
    .from('settings')
    .select('key, value')
    .in('key', ['invoice_prefix', 'invoice_digit', 'invoice_counter']);

  const map = {};
  for (const row of settings || []) {
    try {
      map[row.key] = JSON.parse(row.value);
    } catch {
      map[row.key] = row.value;
    }
  }

  const prefix = map.invoice_prefix || 'INV';
  const digit = parseInt(map.invoice_digit || '6', 10) || 6;

  let counter;
  const { data, error } = await supabase.rpc('increment_invoice_counter', {
    step: 1,
  });

  if (error) {
    counter = (parseInt(map.invoice_counter || '0', 10) || 0) + 1;
    await supabase.from('settings').upsert(
      {
        key: 'invoice_counter',
        value: String(counter),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,key' },
    );
  } else {
    counter = parseInt(data, 10) || 0;
  }

  const no_invoice = `${prefix}-${String(counter).padStart(digit, '0')}`;
  return successResponse({ no_invoice });
});