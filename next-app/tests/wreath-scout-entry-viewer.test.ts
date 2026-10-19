import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { adminClient } from './helpers/admin-client';
import type { IdentitySession } from '../src/lib/identity-session';
import { loadPersonAuthz } from '../src/lib/capabilities';
import { resolveFamilyScope } from '../src/lib/household-scope';

/**
 * resolveScoutEntryViewer: the one place a request becomes "who is typing". The session layer is the mock boundary
 * (cookie read and the revocation epoch); the family scope is resolved against the real local database.
 */
const mocks = vi.hoisted(() => ({ session: null as unknown, epochOk: true }));
vi.mock('@/lib/family-access', () => ({ getIdentitySessionIfValid: async () => mocks.session }));
vi.mock('@/lib/identity-session', async (orig) => ({ ...(await orig<typeof import('../src/lib/identity-session')>()), isEpochCurrent: async () => mocks.epochOk }));

const admin = adminClient();
let parent: { parentId: number; childId: number };
let scoutPersonId: number;

const session = (personId: number, subjectKind: 'adult' | 'scout', epoch = 1): IdentitySession => ({ role: 'identity', subjectKind, personId, householdKey: 'k', name: 'x', epoch, iat: 0 }) as unknown as IdentitySession;
const viewer = async () => (await import('../src/lib/wreaths/scout-entry-viewer')).resolveScoutEntryViewer(admin);

beforeAll(async () => {
  const { data: rels } = await admin.from('relationships').select('person_id, related_person_id').eq('type', 'parent_of').limit(50);
  const r = (rels ?? [])[0] as { person_id: number; related_person_id: number };
  parent = { parentId: r.person_id, childId: r.related_person_id };
  scoutPersonId = r.related_person_id;
});
beforeEach(() => {
  mocks.session = null;
  mocks.epochOk = true;
});

describe('resolveScoutEntryViewer', () => {
  it('ResolveScoutEntryViewer_ReturnsNull_WithNoSession', async () => {
    expect(await viewer()).toBeNull();
  });
  it('ResolveScoutEntryViewer_ReturnsNull_WhenTheSessionWasRevoked', async () => {
    mocks.session = session(scoutPersonId, 'scout');
    mocks.epochOk = false;
    expect(await viewer()).toBeNull();
  });
  it('ResolveScoutEntryViewer_ScopeOfAScout_IsTheScoutAlone', async () => {
    mocks.session = session(scoutPersonId, 'scout');
    expect((await viewer())?.scope).toEqual([scoutPersonId]);
  });
  it('ResolveScoutEntryViewer_ScopeOfAParent_IncludesTheirChildren', async () => {
    mocks.session = session(parent.parentId, 'adult');
    expect((await viewer())?.scope).toEqual(expect.arrayContaining([parent.parentId, parent.childId]));
  });
  it('ResolveScoutEntryViewer_ScopeOfAParent_IncludesNoOtherScout', async () => {
    mocks.session = session(parent.parentId, 'adult');
    const { data: other } = await admin.from('scouts').select('person_id').neq('person_id', parent.childId).not('person_id', 'is', null).limit(50);
    const kids = new Set(((await admin.from('relationships').select('related_person_id').eq('person_id', parent.parentId).in('type', ['parent_of', 'guardian_of'])).data ?? []).map((r) => (r as { related_person_id: number }).related_person_id));
    const stranger = ((other ?? []) as { person_id: number }[]).find((o) => !kids.has(o.person_id))!;
    expect((await viewer())?.scope).not.toContain(stranger.person_id);
  });
  it('ResolveScoutEntryViewer_NamesTheViewer_FromThePeopleRow', async () => {
    mocks.session = session(parent.parentId, 'adult');
    const { data } = await admin.from('people').select('display_name').eq('id', parent.parentId).single();
    expect((await viewer())?.name).toBe(data!.display_name);
  });
});

/**
 * W-4: a super user (the session holds finance.manage) types in paper orders for any scout. Read-only against the local
 * mirror: an existing finance.manage holder, at their live epoch, and the active wreath sellers already there.
 */
describe('resolveScoutEntryViewer — a super user', () => {
  let superId: number;
  let superEpoch: number;
  let activeSellers: number[];
  beforeAll(async () => {
    const { data } = await admin.from('person_capabilities').select('person_id').eq('capability', 'finance.manage').limit(1);
    superId = ((data ?? [])[0] as { person_id: number }).person_id;
    superEpoch = (await loadPersonAuthz(admin, superId))!.sessionEpoch;
    activeSellers = ((await admin.from('wreath_sellers').select('person_id').eq('active', true)).data ?? []).map((r) => (r as { person_id: number }).person_id);
  });
  it('SuperUserScope_IncludesEveryActiveWreathSeller', async () => {
    mocks.session = session(superId, 'adult', superEpoch);
    expect((await viewer())?.scope).toEqual(expect.arrayContaining(activeSellers));
  });
  it('SuperUserViewer_CarriesTheirOwnHousehold_ForTheEnteringForLabel', async () => {
    mocks.session = session(superId, 'adult', superEpoch);
    expect((await viewer())?.household).toContain(superId);
  });
  it('SuperUserScope_IsTheFamilyAlone_WhenTheSessionEpochIsStale', async () => {
    // hasCapability compares the cookie's epoch with the live one: a stale session holds no capability.
    mocks.session = session(superId, 'adult', superEpoch + 1000);
    expect((await viewer())?.household).toBeUndefined();
  });
  it('NonSuperParentScope_IsTheirFamilyAlone_NotEverySeller', async () => {
    mocks.session = session(parent.parentId, 'adult');
    expect((await viewer())?.scope).toEqual(await resolveFamilyScope(admin, parent.parentId, 'adult'));
  });
  it('NonSuperParentViewer_HasNoHousehold', async () => {
    mocks.session = session(parent.parentId, 'adult');
    expect((await viewer())?.household).toBeUndefined();
  });
});
