import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Build a Plan B5 (Plans/Build-A-Plan.md, Suggestions mode): entering the mode is ONE engine run plus the plan rows.
 * Every lens (Group Sessions, By Scout, Teaching, the campout footer) comes out of that one read; lens switches,
 * filters and ticks are client state (build-plan-suggestions-view.test.tsx pins that no action runs for them).
 * Real local database, read-only; the client counts its round trips (every from() and rpc()).
 */
const state = vi.hoisted(() => ({ counter: null as null | { n: number } }));

function counting(target: SupabaseClient, counter: { n: number }): SupabaseClient {
  return new Proxy(target, {
    get(t, prop, receiver) {
      const v = Reflect.get(t, prop, receiver);
      if ((prop === 'from' || prop === 'rpc') && typeof v === 'function') {
        return (...args: unknown[]) => {
          counter.n++;
          return (v as (...a: unknown[]) => unknown).apply(t, args);
        };
      }
      return v;
    }
  });
}

vi.mock('@/lib/supabase/server', async () => {
  const { adminClient: make } = await import('./helpers/admin-client');
  return { createAdminClient: () => (state.counter ? counting(make(), state.counter) : make()) };
});
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), updateTag: vi.fn(), revalidateTag: vi.fn(), unstable_cache: (fn: unknown) => fn }));
// The catalog read fresh on every call, so both measurements pay for it alike (no per-request dedupe across them).
vi.mock('@/lib/advancement-catalog', async (orig) => {
  const real = await orig<typeof import('../src/lib/advancement-catalog')>();
  const { createAdminClient } = await import('@/lib/supabase/server');
  return { ...real, loadAdvancementCatalog: () => real.fetchAdvancementCatalog(createAdminClient()) };
});

const trips = async (fn: () => Promise<unknown>) => {
  state.counter = { n: 0 };
  try {
    await fn();
    return state.counter.n;
  } finally {
    state.counter = null;
  }
};

describe('Suggestions mode reads', () => {
  it('SuggestionsMode_LoadsInBoundedRoundTrips', async () => {
    const { loadSuggestionsData } = await import('../src/lib/build-plan-suggest-db');
    const { loadEngineInput } = await import('../src/lib/meeting-suggest/load-input');
    const engine = await trips(() => loadEngineInput('2086-03-01', 'Vitest'));
    const mode = await trips(() => loadSuggestionsData('2086-03-01', 'Vitest'));
    // All three lenses and the footer cost exactly one engine read: not one round trip more.
    expect(mode - engine).toBe(0);
  });
});
