import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IdentitySession } from '../src/lib/identity-session';

/**
 * Release 6 — "Suggest this for the recipe" (brand-actions.ts suggestRecipeBrandAction): only someone signed in
 * reaches the store, the person is always the session's, and the store's refusals come back as plain sentences.
 */
const mocks = vi.hoisted(() => ({ session: null as unknown, epochCurrent: true, suggest: vi.fn() }));

vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => ({ value: 'cookie' }) }) }));
vi.mock('@/lib/identity-session', async (orig) => ({
  ...(await orig<typeof import('../src/lib/identity-session')>()),
  verifyIdentitySession: async () => mocks.session,
  isEpochCurrent: async () => mocks.epochCurrent
}));
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: () => ({ stub: true }) }));
vi.mock('@/lib/admin-actor', () => ({ resolveAdminActor: async () => null }));
vi.mock('@/lib/household-scope', () => ({ resolveFamilyScope: async () => [39] }));
vi.mock('@/lib/audit', () => ({ recordAuditAs: vi.fn() }));
vi.mock('@/lib/menu-monster/data', () => ({ loadMenuMonsterCatalog: async () => ({}) }));
vi.mock('@/lib/menu-monster/menus-store', async (orig) => ({ ...(await orig<object>()), ownerCreditNamesWith: async () => new Map([[50, 'Pat W.']]) }));
vi.mock('@/lib/menu-monster/brands-store', () => ({ addBrandWith: vi.fn(), suggestRecipeBrandWith: mocks.suggest }));

import { suggestRecipeBrandAction } from '../src/app/(public)/library/_tools/menu-monster/brand-actions';

const SCOUT = { role: 'identity', subjectKind: 'scout', personId: 39, householdKey: 'h', displayName: 'Charlie W.', epoch: 1, iat: 0 } as IdentitySession;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session = SCOUT;
  mocks.epochCurrent = true;
  mocks.suggest.mockResolvedValue('ok');
});

describe('suggestRecipeBrandAction', () => {
  it('Author_Suggests_AsThemselves', async () => {
    expect(await suggestRecipeBrandAction('S-0000abcd', 'bacon', 'b-kirk')).toEqual({ ok: true });
    expect(mocks.suggest.mock.calls[0].slice(1)).toEqual([39, 'S-0000abcd', 'bacon', 'b-kirk']);
  });

  it('Author_Clears_WithNull', async () => {
    await suggestRecipeBrandAction('S-0000abcd', 'bacon', null);
    expect(mocks.suggest.mock.calls[0][4]).toBeNull();
  });

  it('AParent_Suggests_AsThemselves', async () => {
    mocks.session = { ...SCOUT, subjectKind: 'adult', personId: 50 };
    await suggestRecipeBrandAction('S-0000abcd', 'bacon', 'b-kirk');
    expect(mocks.suggest.mock.calls[0][1]).toBe(50);
  });

  it('AVisitor_IsRefused_AndReachesNoStore', async () => {
    mocks.session = null;
    expect((await suggestRecipeBrandAction('S-0000abcd', 'bacon', 'b-kirk')).ok).toBe(false);
    expect(mocks.suggest).not.toHaveBeenCalled();
  });

  it('ARevokedScout_IsRefused', async () => {
    mocks.epochCurrent = false;
    expect((await suggestRecipeBrandAction('S-0000abcd', 'bacon', 'b-kirk')).ok).toBe(false);
    expect(mocks.suggest).not.toHaveBeenCalled();
  });

  it.each([
    [{ id: 1 }, 'bacon', 'b'],
    ['S-1', 'a b', 'b'],
    ['S-1', 'bacon', 7],
    ['x'.repeat(90), 'bacon', null]
  ])('MalformedInput_%#_ReachesNoStore', async (r, i, b) => {
    expect((await suggestRecipeBrandAction(r, i, b)).ok).toBe(false);
    expect(mocks.suggest).not.toHaveBeenCalled();
  });

  it('NotTheAuthor_HearsWhy', async () => {
    mocks.suggest.mockResolvedValue('not_yours');
    expect(await suggestRecipeBrandAction('B003', 'bacon', 'b-kirk')).toEqual({ ok: false, error: 'Only the person who wrote a recipe can suggest a brand for it.' });
  });
});
