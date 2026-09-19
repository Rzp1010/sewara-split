// Verifikasi migration DP Hangus di live DB
// Jalankan: node scripts/verify-dp-hangus.mjs
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Load .env.local manual (file punya BOM, --env-file tidak kepepet)
const envPath = resolve(process.cwd(), '.env.local');
for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
  if (m && !(m[1] in process.env)) {
    process.env[m[1]] = m[2].replace(/^"|"$/g, '');
  }
}

if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY tidak ditemukan di .env.local');
  process.exit(1);
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

// 1. Cek kolom baru — select langsung; kalau kolom tidak ada, PostgREST error
const { data: sample, error: errSample } = await supabase
  .from('transactions')
  .select('id, dp_hangus, dp_hangus_aturan')
  .limit(3);

if (errSample) {
  console.log('❌ FAIL select dp_hangus:', errSample.message);
  process.exit(1);
} else {
  console.log('✅ Kolom dp_hangus & dp_hangus_aturan ADA di transactions');
  console.log('   Sample rows:', JSON.stringify(sample));
}

// 2. Cek RPC masih ada + signature benar
// service role tidak punya auth.uid() → RPC harusnya error 28000 (function exists, auth check fail)
const { error: errRpc } = await supabase.rpc('rpc_save_transaction', {
  p_transaction: {},
  p_items: [],
  p_payments: [],
});
if (errRpc && (errRpc.code === '28000' || /Authentication required/.test(errRpc.message))) {
  console.log('✅ RPC rpc_save_transaction ADA (error 28000 = function exists, butuh auth)');
} else if (errRpc && /does not exist/.test(errRpc.message)) {
  console.log('❌ FAIL: RPC rpc_save_transaction TIDAK ADA:', errRpc.message);
  process.exit(1);
} else {
  console.log('⚠️ RPC response tidak terduga:', errRpc ? `${errRpc.code} ${errRpc.message}` : 'success tanpa error');
}

// 3. Statistik dp_hangus
const { count } = await supabase
  .from('transactions')
  .select('id', { count: 'exact', head: true })
  .gt('dp_hangus', 0);
console.log(`ℹ️ Transaksi dengan dp_hangus > 0: ${count ?? 0}`);

// 4. Cek value dp_hangus row lama (harus semua 0/null setelah migration)
const { data: oldRows } = await supabase
  .from('transactions')
  .select('dp_hangus')
  .is('dp_hangus', null);
console.log(`ℹ️ Row dengan dp_hangus NULL (harus 0): ${oldRows?.length ?? 0}`);

console.log('\nSelesai.');
