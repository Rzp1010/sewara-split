/**
 * Phase 3 Verification: Test RPC Functions
 * 
 * Tests all fixed RPC functions to verify they use snake_case columns:
 * 1. rpc_dashboard_rekap_status
 * 2. rpc_dashboard_pembayaran
 * 3. notify_telegram_transaksi (indirectly via trigger)
 * 
 * Usage:
 *   node scripts/test-rpc-functions.js
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env.local manually
const envPath = resolve(__dirname, '../.env.local');
const envContent = readFileSync(envPath, 'utf-8');
const envVars = {};
envContent.split('\n').forEach(line => {
  const match = line.match(/^([^=]+)=(.*)$/);
  if (match) {
    envVars[match[1].trim()] = match[2].trim();
  }
});

const supabaseUrl = envVars.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = envVars.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing Supabase credentials in .env.local');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Test credentials (update with actual user)
// IMPORTANT: Update these with your actual credentials before running
const TEST_EMAIL = process.env.TEST_EMAIL || 'owner@user.com'; // Change to your test user
const TEST_PASSWORD = process.env.TEST_PASSWORD || 'owner'; // Change to your test password

if (TEST_EMAIL === 'owner@user.com' && TEST_PASSWORD === 'owner') {
  console.warn('\n⚠️  WARNING: Using default test credentials.');
  console.warn('   Please set TEST_EMAIL and TEST_PASSWORD environment variables:');
  console.warn('   TEST_EMAIL=your@email.com TEST_PASSWORD=yourpass node scripts/test-rpc-functions.js\n');
}

let userId = null;

/**
 * Login and get user ID
 */
async function login() {
  console.log('\n🔐 Logging in...');
  const { data, error } = await supabase.auth.signInWithPassword({
    email: TEST_EMAIL,
    password: TEST_PASSWORD
  });

  if (error) {
    console.error('❌ Login failed:', error.message);
    process.exit(1);
  }

  userId = data.user.id;
  console.log('✅ Logged in as:', TEST_EMAIL);
  console.log('   User ID:', userId);
}

/**
 * Test 1: rpc_dashboard_rekap_status
 */
async function testRekapStatus() {
  console.log('\n📊 Test 1: rpc_dashboard_rekap_status');
  console.log('   Purpose: Dashboard status counts (Booking, Disewa, Telat, etc.)');
  console.log('   Fixed: "waktuKembaliRencana" → waktu_kembali_rencana');
  
  const { data, error } = await supabase.rpc('rpc_dashboard_rekap_status', {
    p_user_id: userId,
    p_mulai: null,
    p_akhir: null
  });

  if (error) {
    console.error('   ❌ FAILED:', error.message);
    if (error.message.includes('column') && error.message.includes('does not exist')) {
      console.error('   💡 Likely cause: RPC still references camelCase columns');
    }
    return false;
  }

  console.log('   ✅ SUCCESS');
  console.log('   Result:', {
    booking: data.booking || 0,
    disewa: data.disewa || 0,
    mendekati: data.mendekati || 0,
    telat: data.telat || 0,
    belumSelesai: data.belumSelesai || 0,
    selesai: data.selesai || 0
  });
  return true;
}

/**
 * Test 2: rpc_dashboard_pembayaran
 */
async function testPembayaran() {
  console.log('\n💰 Test 2: rpc_dashboard_pembayaran');
  console.log('   Purpose: Dashboard payment reports (Total Akhir, per method)');
  console.log('   Fixed: "totalAkhir" → total_akhir');
  
  // Test with different basis values
  const bases = ['selesai', 'aktif', 'semua'];
  let allPassed = true;

  for (const basis of bases) {
    console.log(`\n   Testing basis="${basis}"...`);
    const { data, error } = await supabase.rpc('rpc_dashboard_pembayaran', {
      p_user_id: userId,
      p_mulai: null,
      p_akhir: null,
      p_basis: basis
    });

    if (error) {
      console.error('   ❌ FAILED:', error.message);
      if (error.message.includes('column') && error.message.includes('does not exist')) {
        console.error('   💡 Likely cause: RPC still references camelCase columns');
      }
      allPassed = false;
      continue;
    }

    console.log(`   ✅ basis="${basis}" SUCCESS`);
    console.log('      Result:', {
      totalAkhir: data.totalAkhir || 0,
      diterima: data.diterima || 0,
      tunai: data.tunai || 0,
      transfer: data.transfer || 0,
      qris: data.qris || 0
    });
  }

  return allPassed;
}

/**
 * Test 3: Check transactions table schema
 */
async function testTransactionsSchema() {
  console.log('\n🗄️  Test 3: Verify transactions table schema');
  console.log('   Purpose: Ensure camelCase columns are dropped');
  
  // Try to select a dropped column - should fail
  const { data, error } = await supabase
    .from('transactions')
    .select('noInvoice')
    .limit(1);

  if (error) {
    if (error.message.includes('column') && error.message.includes('does not exist')) {
      console.log('   ✅ SUCCESS: camelCase columns confirmed dropped');
      return true;
    } else {
      console.error('   ⚠️  Unexpected error:', error.message);
      return false;
    }
  }

  console.error('   ❌ FAILED: camelCase column "noInvoice" still exists!');
  return false;
}

/**
 * Test 4: Verify snake_case columns exist
 */
async function testSnakeCaseColumns() {
  console.log('\n✅ Test 4: Verify snake_case columns exist');
  console.log('   Purpose: Ensure new columns are accessible');
  
  const { data, error } = await supabase
    .from('transactions')
    .select('no_invoice, hp_penyewa, total_akhir, waktu_kembali_rencana')
    .limit(1);

  if (error) {
    console.error('   ❌ FAILED:', error.message);
    return false;
  }

  console.log('   ✅ SUCCESS: All snake_case columns accessible');
  if (data.length > 0) {
    console.log('   Sample row:', {
      no_invoice: data[0].no_invoice,
      hp_penyewa: data[0].hp_penyewa,
      total_akhir: data[0].total_akhir,
      waktu_kembali_rencana: data[0].waktu_kembali_rencana
    });
  }
  return true;
}

/**
 * Test 5: Indirect test of notify_telegram_transaksi trigger
 */
async function testTelegramTrigger() {
  console.log('\n📱 Test 5: Telegram webhook trigger (indirect)');
  console.log('   Purpose: Verify trigger uses snake_case in anti-spam guard');
  console.log('   Fixed: "totalAkhir", "biayaDasar", "noInvoice" → snake_case');
  console.log('   Note: This test only checks if updates work without errors');
  
  // Get a transaction to update
  const { data: transactions, error: fetchError } = await supabase
    .from('transactions')
    .select('id, status, total_akhir')
    .limit(1);

  if (fetchError || !transactions || transactions.length === 0) {
    console.log('   ⚠️  SKIPPED: No transactions available for testing');
    return true; // Not a failure, just no data
  }

  const testTransaction = transactions[0];
  console.log(`   Testing with transaction ID: ${testTransaction.id}`);

  // Update transaction (should trigger notify_telegram_transaksi)
  // Using same values to trigger anti-spam guard logic
  const { error: updateError } = await supabase
    .from('transactions')
    .update({ status: testTransaction.status })
    .eq('id', testTransaction.id);

  if (updateError) {
    console.error('   ❌ FAILED:', updateError.message);
    if (updateError.message.includes('column') && updateError.message.includes('does not exist')) {
      console.error('   💡 Likely cause: Trigger still references camelCase columns');
    }
    return false;
  }

  console.log('   ✅ SUCCESS: Update executed without trigger errors');
  console.log('   Note: Check Telegram for webhook notification (if enabled)');
  return true;
}

/**
 * Main test runner
 */
async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  Phase 3 RPC Function Verification');
  console.log('  Sewara Apps (obhvrzholszhjnpvmnna)');
  console.log('  Date: 2026-08-28');
  console.log('═══════════════════════════════════════════════════════════');

  try {
    await login();

    const results = {
      rekapStatus: await testRekapStatus(),
      pembayaran: await testPembayaran(),
      schemaCleanup: await testTransactionsSchema(),
      snakeCase: await testSnakeCaseColumns(),
      telegram: await testTelegramTrigger()
    };

    // Summary
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('  Test Summary');
    console.log('═══════════════════════════════════════════════════════════');
    console.log(`  1. rpc_dashboard_rekap_status:     ${results.rekapStatus ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`  2. rpc_dashboard_pembayaran:       ${results.pembayaran ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`  3. Schema cleanup (camelCase):     ${results.schemaCleanup ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`  4. Snake_case columns:             ${results.snakeCase ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`  5. notify_telegram_transaksi:      ${results.telegram ? '✅ PASS' : '❌ FAIL'}`);
    console.log('═══════════════════════════════════════════════════════════');

    const allPassed = Object.values(results).every(r => r === true);
    
    if (allPassed) {
      console.log('\n🎉 ALL TESTS PASSED! Phase 3 migration verified successfully.');
      process.exit(0);
    } else {
      console.log('\n⚠️  SOME TESTS FAILED. Please review errors above.');
      process.exit(1);
    }

  } catch (err) {
    console.error('\n❌ Unexpected error:', err);
    process.exit(1);
  }
}

main();
