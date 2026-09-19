/**
 * Quick RLS Smoke Test
 * Test cross-tenant isolation sebelum restructure
 * 
 * Usage: node scripts/test-rls-isolation.js
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('❌ Missing Supabase credentials in .env.local');
  process.exit(1);
}

// Test credentials - ganti dengan 2 owner berbeda dari DB
const OWNER_A = {
  email: 'owner@user.com', // ganti dengan owner A
  password: 'test123' // ganti dengan password
};

const OWNER_B = {
  email: 'test@user.com', // ganti dengan owner B (berbeda tenant)
  password: 'test123' // ganti dengan password
};

async function testCrossTenantIsolation() {
  console.log('🔍 Testing RLS Cross-Tenant Isolation\n');
  
  let passed = 0;
  let failed = 0;

  // Login as Owner A
  const clientA = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const { data: authA, error: errorA } = await clientA.auth.signInWithPassword(OWNER_A);
  
  if (errorA) {
    console.error('❌ Cannot login as Owner A:', errorA.message);
    return;
  }

  const ownerAId = authA.user.id;
  console.log(`✓ Owner A logged in: ${ownerAId}`);

  // Login as Owner B
  const clientB = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const { data: authB, error: errorB } = await clientB.auth.signInWithPassword(OWNER_B);
  
  if (errorB) {
    console.error('❌ Cannot login as Owner B:', errorB.message);
    return;
  }

  const ownerBId = authB.user.id;
  console.log(`✓ Owner B logged in: ${ownerBId}\n`);

  // Test tables
  const tables = [
    'inventory',
    'transactions',
    'members',
    'member_templates',
    'promo_codes',
    'settings',
    'logs'
  ];

  for (const table of tables) {
    console.log(`Testing: ${table}`);

    // Owner A reads their own data
    const { data: dataA, error: errA } = await clientA
      .from(table)
      .select('*')
      .limit(1);

    if (errA) {
      console.log(`  ⚠️  Owner A cannot read ${table}: ${errA.message}`);
    } else {
      console.log(`  ✓ Owner A can read ${table} (${dataA?.length || 0} rows)`);
    }

    // Owner B tries to read Owner A's data (should fail or return empty)
    const { data: dataB, error: errB } = await clientB
      .from(table)
      .select('*')
      .limit(100);

    if (errB) {
      console.log(`  ✓ Owner B denied from ${table}: ${errB.message}`);
      passed++;
    } else if (dataB && dataB.length === 0) {
      console.log(`  ✓ Owner B gets empty result from ${table}`);
      passed++;
    } else {
      // Check if any row belongs to Owner A
      const hasOwnerAData = dataB.some(row => 
        row.user_id === ownerAId || row.owner_id === ownerAId
      );
      
      if (hasOwnerAData) {
        console.log(`  ❌ LEAK: Owner B can see Owner A's data in ${table}!`);
        failed++;
      } else {
        console.log(`  ✓ Owner B only sees their own data in ${table}`);
        passed++;
      }
    }

    console.log('');
  }

  // Test profiles (different pattern - might allow read all but not write)
  console.log('Testing: profiles (special case)');
  const { data: profilesB } = await clientB
    .from('profiles')
    .select('*')
    .limit(100);

  if (profilesB) {
    const hasOwnerAProfile = profilesB.some(p => p.user_id === ownerAId);
    if (hasOwnerAProfile) {
      console.log('  ⚠️  profiles allows cross-tenant read (might be by design for lookup)');
    } else {
      console.log('  ✓ profiles isolated');
    }
  }

  // Cleanup
  await clientA.auth.signOut();
  await clientB.auth.signOut();

  console.log('\n' + '='.repeat(50));
  console.log(`Results: ${passed} passed, ${failed} failed`);
  
  if (failed > 0) {
    console.log('\n❌ CRITICAL: RLS isolation has leaks!');
    console.log('DO NOT proceed with restructure until fixed.');
    process.exit(1);
  } else {
    console.log('\n✅ Basic RLS isolation looks good.');
    console.log('Safe to proceed with restructure.');
  }
}

testCrossTenantIsolation().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
