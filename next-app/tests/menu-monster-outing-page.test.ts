import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The outing's food page (release 5): only the outing's crew — a signed-in scout or a leader — gets it.
 * Nobody signed in, a parent, a bad id or an outing that does not exist all end in notFound(), and the
 * menus are never read for someone who is not crew.
 */

const mocks = vi.hoisted(() => ({
  session: null as unknown,
  leader: null as unknown,
  verified: true,
  listOutingMenusWith: vi.fn(),
  loadOutingWith: vi.fn()
}));

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  }
}));
vi.mock('@/lib/family-access', () => ({
  getIdentitySessionIfValid: async () => mocks.session,
  requireVerifiedScoutIdentity: async () => {
    if (!mocks.verified) throw new Error('revoked');
    return mocks.session;
  }
}));
vi.mock('@/lib/admin-actor', () => ({ resolveAdminActor: async () => mocks.leader }));
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: () => ({ stub: true }) }));
vi.mock('@/lib/menu-monster/menus-store', () => ({ listOutingMenusWith: mocks.listOutingMenusWith, ownerCreditNamesWith: async () => new Map() }));
vi.mock('@/lib/menu-monster/bought-store', () => ({ loadBoughtWith: async () => ({ lines: {}, done: null }) }));
vi.mock('@/lib/menu-monster/data', () => ({ loadMenuMonsterCatalog: async () => ({ ingredients: [], packages: [], recipes: [], conversions: [], aliases: {} }) }));
vi.mock('@/lib/menu-monster/menus-data', () => ({ loadOutingWith: mocks.loadOutingWith }));
vi.mock('@/lib/identity-session', async (orig) => ({ ...(await orig<object>()), isEpochCurrent: async () => true }));
vi.mock('@/lib/household-scope', () => ({ resolveFamilyScope: async (_sb: unknown, id: number) => [id] }));

import OutingFoodPage from '../src/app/(public)/library/menu-monster/outings/[entryId]/page';

const SCOUT = { subjectKind: 'scout', personId: 39, displayName: 'Charlie W.' };
const PARENT = { subjectKind: 'adult', personId: 50, displayName: 'Pat W.' };
const OUTING = { id: 7, title: 'Fall Camporee', startDate: '2026-10-09', endDate: '2026-10-11', status: 'published' };
const open = (entryId: string) => OutingFoodPage({ params: Promise.resolve({ entryId }) });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session = SCOUT;
  mocks.leader = null;
  mocks.verified = true;
  mocks.loadOutingWith.mockResolvedValue(OUTING);
  mocks.listOutingMenusWith.mockResolvedValue([]);
});

describe('outing food page access', () => {
  it('Scout_GetsThePage', async () => {
    expect(await open('7')).toBeTruthy();
  });

  it('Nobody_GetsNotFound_AndNoMenusAreRead', async () => {
    mocks.session = null;
    await expect(open('7')).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mocks.listOutingMenusWith).not.toHaveBeenCalled();
  });

  it('Parent_GetsNotFound_AndNoMenusAreRead', async () => {
    mocks.session = PARENT;
    await expect(open('7')).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mocks.listOutingMenusWith).not.toHaveBeenCalled();
  });

  it('Scout_GetsNotFound_WhenTheSignInWasRevoked', async () => {
    mocks.verified = false;
    await expect(open('7')).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mocks.listOutingMenusWith).not.toHaveBeenCalled();
  });

  it.each(['abc', '0', '-3', '1.5', '7; drop'])('BadId_%s_GetsNotFound', async (id) => {
    await expect(open(id)).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mocks.loadOutingWith).not.toHaveBeenCalled();
  });

  it('MissingOuting_GetsNotFound', async () => {
    mocks.loadOutingWith.mockResolvedValue(null);
    await expect(open('7')).rejects.toThrow('NEXT_NOT_FOUND');
  });
});

describe('outing food page: a draft outing', () => {
  it('Leader_GetsADraftOuting', async () => {
    mocks.session = null;
    mocks.leader = { subjectKind: 'adult', personId: 82, displayName: 'Patrick B.', capabilities: new Set(['admin']) };
    mocks.loadOutingWith.mockResolvedValue({ ...OUTING, status: 'draft' });
    expect(await open('7')).toBeTruthy();
  });

  it('Scout_GetsNotFound_WhenTheOutingIsNotPublished', async () => {
    mocks.loadOutingWith.mockResolvedValue({ ...OUTING, status: 'draft' });
    await expect(open('7')).rejects.toThrow('NEXT_NOT_FOUND');
  });
});
