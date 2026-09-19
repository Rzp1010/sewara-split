// @ts-nocheck
import { getServerClient } from '@/lib/api/supabase';
import { requireAuth } from '@/lib/api/auth';
import { successResponse } from '@/lib/api/response';
import { withErrorHandler } from '@/lib/api/errors';

export const runtime = 'nodejs';

/**
 * GET /api/inventory-units?inventory_id=x
 */
export const GET = withErrorHandler(async (request) => {
  const supabase = await getServerClient();
  await requireAuth(supabase);

  const { searchParams } = new URL(request.url);
  const inventoryId = searchParams.get('inventory_id');
  if (!inventoryId) throw new Error('inventory_id wajib diisi.');

  const { data, error } = await supabase
    .from('inventory_units')
    .select('*')
    .eq('inventory_id', inventoryId)
    .order('serial_number');
  if (error) throw error;
  return successResponse({ units: data || [] });
});

/**
 * POST /api/inventory-units — replace unit S/N satu inventory
 * Body: { inventory_id, serial_numbers: [...], user_id? }
 */
export const POST = withErrorHandler(async (request) => {
  const supabase = await getServerClient();
  const user = await requireAuth(supabase);

  const { inventory_id, serial_numbers, user_id } = await request.json();
  if (!inventory_id) throw new Error('inventory_id wajib diisi.');

  const { error: deleteError } = await supabase
    .from('inventory_units')
    .delete()
    .eq('inventory_id', inventory_id);
  if (deleteError) throw deleteError;

  if (!serial_numbers || serial_numbers.length === 0)
    return successResponse({ ok: true });

  const units = serial_numbers.map((sn) => ({
    inventory_id,
    serial_number: sn,
    status: 'available',
    user_id: user_id || user.id,
  }));

  const { error } = await supabase.from('inventory_units').upsert(units, {
    onConflict: 'inventory_id,serial_number,user_id',
    ignoreDuplicates: false,
  });
  if (error) throw error;
  return successResponse({ ok: true });
});