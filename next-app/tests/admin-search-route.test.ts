import { describe, it, expect, vi } from 'vitest';

/** GET /admin/search (Plans/Admin-Portal-Nav.md decision 8): who may ask, and what a failure gives away. */
let actor: unknown = null;
vi.mock('@/lib/admin-actor', () => ({ resolveAdminActor: async () => actor, actorCanEnterAdmin: (a: unknown) => a != null }));
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: () => ({}) }));
const search = vi.fn();
vi.mock('@/lib/admin-record-search', async (orig) => ({
  ...(await orig<typeof import('../src/lib/admin-record-search')>()),
  searchRecords: (...a: unknown[]) => search(...a)
}));
const { GET } = await import('../src/app/admin/search/route');

describe('search route', () => {
  it('SearchRoute_NoActor_403', async () => {
    actor = null;
    expect((await GET(new Request('http://x/admin/search?q=ab'))).status).toBe(403);
  });

  it('SearchRoute_IsNeverCached', async () => {
    actor = { capabilities: new Set(['roster.manage']) };
    search.mockResolvedValueOnce({ people: [], calendar: [], articles: [] });
    expect((await GET(new Request('http://x/admin/search?q=ab'))).headers.get('cache-control')).toBe('private, no-store');
  });

  it('SearchRoute_Failure_LeaksNoMessage', async () => {
    actor = { capabilities: new Set(['roster.manage']) };
    search.mockRejectedValueOnce(new Error('relation "secret_table" does not exist'));
    const res = await GET(new Request('http://x/admin/search?q=ab'));
    expect([res.status, (await res.text()).includes('secret')]).toEqual([500, false]);
  });
});
