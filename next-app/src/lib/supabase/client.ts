/**
 * Supabase client for Client Components. Use sparingly — most data should be
 * fetched in Server Components (see server.ts). Use this when you need
 * realtime subscriptions, auth state hooks, or in-browser-only flows.
 */

'use client';

import { createBrowserClient } from '@supabase/ssr';

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
