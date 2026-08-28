import { describe, it, expect } from 'vitest';
import { adminClient } from './helpers/admin-client';
import { fetchAdvancementCatalog } from '@/lib/advancement-catalog';

/**
 * The `advancement-catalog` `unstable_cache` entry (Plans/Performance-
 * Review-2026-08-27.md #11/#16) must be plain arrays of plain objects —
 * Next serialises a cache entry as JSON, so a Map/Set/Date sneaking into
 * the shape would come back from the cache as `{}` or a string, silently
 * breaking every reader. `fetchAdvancementCatalog` is the uncached
 * fetch+shape `unstable_cache` wraps (calling the cached wrapper itself
 * hangs outside a Next.js server context — see the module comment), so
 * this exercises the real shape against local Supabase without touching
 * `unstable_cache`.
 */
const admin = adminClient();

describe('fetchAdvancementCatalog', () => {
  it('SurvivesAJsonRoundTrip_WithNoDataLoss', async () => {
    const catalog = await fetchAdvancementCatalog(admin);
    const roundTripped = JSON.parse(JSON.stringify(catalog));
    expect(roundTripped).toEqual(catalog);
  });

  it('ReturnsPlainArrays_ForEveryCatalogTable', async () => {
    const catalog = await fetchAdvancementCatalog(admin);
    for (const key of ['ranks', 'rankRequirements', 'meritBadges', 'meritBadgeRequirements', 'skills'] as const) {
      expect(Array.isArray(catalog[key])).toBe(true);
    }
  });

  it('IncludesTheKnownEagleRankInTheRanksCatalog', async () => {
    // A light sanity pin, not just a shape check — catches an empty/wrong
    // read (e.g. a bad filter) that JSON-round-trips fine but is useless.
    const catalog = await fetchAdvancementCatalog(admin);
    expect(catalog.ranks.some((r) => r.id === 'eagle')).toBe(true);
  });
});
