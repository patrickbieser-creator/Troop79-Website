import { createClient } from '@supabase/supabase-js';

/**
 * Service-role client for tests. Deliberately NOT imported from
 * lib/supabase/server.ts — that module pulls in `next/headers`, which
 * assumes a Next.js request context tests don't have. Same construction,
 * decoupled from the framework runtime.
 */
export function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set — is .env.local present and supabase running?'
    );
  }
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
