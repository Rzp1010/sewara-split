// @ts-nocheck
/**
 * Supabase Client Factories
 * 
 * Centralized Supabase client creation untuk consistency dan reusability
 */

import { createServerClient as createSupabaseServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';

// ============================================================================
// SERVER CLIENT (Cookie-based, untuk authenticated requests)
// ============================================================================

/**
 * Create Supabase server client dengan cookie support
 * 
 * Untuk authenticated API routes yang perlu akses user session dari cookies
 * 
 * @returns {Promise<SupabaseClient>}
 * 
 * @example
 * const supabase = await getServerClient();
 * const { data: { user } } = await supabase.auth.getUser();
 */
export async function getServerClient() {
  const cookieStore = await cookies();
  
  return createSupabaseServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        get(name) {
          return cookieStore.get(name)?.value;
        },
        set(name, value, options) {
          try {
            cookieStore.set({ name, value, ...options });
          } catch (error) {
            // Cookie setting can fail in middleware
            // This is expected behavior, ignore silently
          }
        },
        remove(name, options) {
          try {
            cookieStore.set({ name, value: '', ...options });
          } catch (error) {
            // Cookie removal can fail in middleware
            // This is expected behavior, ignore silently
          }
        },
      },
    }
  );
}

// ============================================================================
// SERVICE ROLE CLIENT (Full admin access, untuk backend operations)
// ============================================================================

/**
 * Create Supabase service role client dengan full admin access
 * 
 * ⚠️ WARNING: Bypasses RLS policies. Use with extreme caution!
 * 
 * Use cases:
 * - Admin operations (user creation/deletion)
 * - Background jobs
 * - System operations
 * - Webhook handlers
 * 
 * @returns {SupabaseClient}
 * 
 * @example
 * const supabase = getServiceRoleClient();
 * const { data, error } = await supabase.auth.admin.createUser({ email, password });
 */
export function getServiceRoleClient() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not configured');
  }
  
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}

// ============================================================================
// ANON CLIENT (No auth, untuk public operations)
// ============================================================================

/**
 * Create Supabase anon client (no auth session)
 * 
 * Untuk public operations atau saat perlu fresh client tanpa session
 * 
 * @returns {SupabaseClient}
 * 
 * @example
 * const supabase = getAnonClient();
 * const { data, error } = await supabase.auth.signInWithPassword({ email, password });
 */
export function getAnonClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}
