/**
 * Supabase client for Server Components, Route Handlers, and Server Actions.
 * Uses cookies for session — the user's auth.uid() flows through to RLS.
 *
 * Anything that needs to BYPASS RLS (admin tasks, server-only data loads)
 * should use the service-role client below — never expose it to the browser.
 */

import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { createClient as createPlainClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

/** Per-request server client. Reads/writes the session cookie so RLS sees the user. */
export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // setAll throws when called from a Server Component (no response to mutate).
          // The middleware handles refresh; ignoring here is safe.
        }
      }
    }
  });
}

/**
 * Service-role client. Bypasses RLS. Only call from server code where you need
 * admin access (seed scripts, cron jobs). Throws at import time if the secret
 * isn't configured.
 */
export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY not set');
  return createPlainClient(SUPABASE_URL, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}
