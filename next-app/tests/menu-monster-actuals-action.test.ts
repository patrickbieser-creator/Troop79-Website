import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CATALOG } from './helpers/menu-monster-fixture';
import type { IdentitySession } from '../src/lib/identity-session';

/**
 * saveActualsAction (Phase 2 release B, P2.4): the scout-only door for "What you
 * paid". The store and the price RPC have their own db tests; here they are
 * stubs so each branch is observable. The session check is REAL.
 */

const mocks = vi.hoisted(() => ({
  session: null as unknown,
  epochCurrent: true,
  loadMenuWith: vi.fn(),
  saveActualsWith: vi.fn(),
  reportPriceWith: vi.fn(),
  loadCatalog: vi.fn()
}));

vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => ({ value: 'cookie' }) }) }));
vi.mock('@/lib/identity-session', async (orig) => ({
  ...(await orig<typeof import('../src/lib/identity-session')>()),
  verifyIdentitySession: async () => mocks.session,
  isEpochCurrent: async () => mocks.epochCurrent
}));
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: () => ({ stub: true }) }));
vi.mock('@/lib/menu-monster/data', () => ({ loadMenuMonsterCatalog: () => mocks.loadCatalog() }));
vi.mock('@/lib/menu-monster/menus-data', () => ({ loadOutingsWith: vi.fn() }));
vi.mock('@/lib/menu-monster/menus-store', async (orig) => ({
  ...(await orig<typeof import('../src/lib/menu-monster/menus-store')>()),
  loadMenuWith: mocks.loadMenuWith,
  saveActualsWith: mocks.saveActualsWith
}));
vi.mock('@/lib/menu-monster/price-history', async (orig) => ({
  ...(await orig<typeof import('../src/lib/menu-monster/price-history')>()),
  reportPriceWith: mocks.reportPriceWith
}));

import { saveActualsAction } from '../src/app/(public)/library/_tools/menu-monster/menu-actions';

const SCOUT: IdentitySession = { role: 'identity', subjectKind: 'scout', personId: 39, householdKey: 'h', displayName: 'Charlie W.', epoch: 1, iat: 0 } as IdentitySession;
const ID = '0b9f8c1e-3a52-4f6e-9d3c-1a2b3c4d5e6f';
const EGGS = { packageId: 'p-egg-store', qty: 2, pricePaid: 3.49 };
const BACON = { packageId: 'p-bac-om', qty: 1, pricePaid: 7.99 };

const stored = (actuals: Record<string, unknown> = {}, owner = 39) => ({ ownerPersonId: owner, menu: { actuals } });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session = SCOUT;
  mocks.epochCurrent = true;
  mocks.loadCatalog.mockResolvedValue(CATALOG);
  mocks.loadMenuWith.mockResolvedValue(stored());
  mocks.saveActualsWith.mockResolvedValue({ status: 'saved' });
  mocks.reportPriceWith.mockResolvedValue('same');
});

describe('saveActualsAction: who may call it', () => {
  it('Anonymous_IsRefused', async () => {
    mocks.session = null;
    expect((await saveActualsAction(ID, { eggs: EGGS })).ok).toBe(false);
    expect(mocks.reportPriceWith).not.toHaveBeenCalled();
  });

  it('Adult_IsRefused_SoALeaderCannotReportPricesThroughAScoutsMenu', async () => {
    mocks.session = { ...SCOUT, subjectKind: 'adult', personId: 5 };
    expect((await saveActualsAction(ID, { eggs: EGGS })).ok).toBe(false);
    expect(mocks.saveActualsWith).not.toHaveBeenCalled();
  });

  it('Scout_IsToldTheMenuIsntTheirs_WhenItBelongsToSomeoneElse', async () => {
    mocks.loadMenuWith.mockResolvedValue(stored({}, 7));
    expect(await saveActualsAction(ID, { eggs: EGGS })).toEqual({ ok: false, error: 'That menu isn’t one of yours.' });
    expect(mocks.reportPriceWith).not.toHaveBeenCalled();
    expect(mocks.saveActualsWith).not.toHaveBeenCalled();
  });

  it('Scout_IsRefused_WhenTheMenuDoesNotExist', async () => {
    mocks.loadMenuWith.mockResolvedValue(null);
    expect((await saveActualsAction(ID, { eggs: EGGS })).ok).toBe(false);
  });

  it.each(['not-a-uuid', '', "x' or 1=1 --"])('Scout_IsRefused_WhenTheMenuIdIs_%s', async (bad) => {
    expect((await saveActualsAction(bad, { eggs: EGGS })).ok).toBe(false);
    expect(mocks.loadMenuWith).not.toHaveBeenCalled();
  });

  it('Scout_IsToldItIsTooBig_WhenThePayloadPassesTheSizeCap', async () => {
    const r = await saveActualsAction(ID, { eggs: EGGS, junk: 'x'.repeat(40 * 1024) });
    expect(r.ok === false && r.error).toMatch(/too big/);
    expect(mocks.loadMenuWith).not.toHaveBeenCalled();
  });
});

describe('saveActualsAction: what it reports', () => {
  it('Scout_ReportsOnlyTheLinesWhosePriceChanged', async () => {
    mocks.loadMenuWith.mockResolvedValue(stored({ eggs: EGGS }));
    await saveActualsAction(ID, { eggs: { ...EGGS, qty: 3 }, bacon: BACON });
    expect(mocks.reportPriceWith).toHaveBeenCalledTimes(1);
    expect(mocks.reportPriceWith.mock.calls[0][1]).toEqual({ packageId: 'p-bac-om', newPrice: 7.99, reportedBy: 39, menuId: ID });
  });

  it('Scout_ReportsNothing_WhenNoLineChanged', async () => {
    mocks.loadMenuWith.mockResolvedValue(stored({ eggs: EGGS }));
    await saveActualsAction(ID, { eggs: EGGS });
    expect(mocks.reportPriceWith).not.toHaveBeenCalled();
    expect(mocks.saveActualsWith).toHaveBeenCalledTimes(1);
  });

  it('Scout_ReportsTheLine_WhenOnlyThePackageChanged', async () => {
    mocks.loadMenuWith.mockResolvedValue(stored({ bacon: { ...BACON, packageId: 'p-bac-kirk' } }));
    await saveActualsAction(ID, { bacon: BACON });
    expect(mocks.reportPriceWith).toHaveBeenCalledTimes(1);
  });

  it('Scout_NeverReportsALine_ForAnUnknownPackage', async () => {
    await saveActualsAction(ID, { eggs: { ...EGGS, packageId: 'p-nope' } });
    expect(mocks.reportPriceWith).not.toHaveBeenCalled();
  });

  it('Scout_ReportsAsTheSession_EvenWhenThePayloadNamesSomeoneElse', async () => {
    await saveActualsAction(ID, { eggs: { ...EGGS, reportedBy: 7 }, reportedBy: 7 });
    expect(mocks.reportPriceWith.mock.calls[0][1]).toMatchObject({ reportedBy: 39 });
  });
});

describe('saveActualsAction: what it returns', () => {
  it('Scout_GetsAppliedAndHeldCounts_AndAStatusPerLine', async () => {
    mocks.reportPriceWith.mockResolvedValueOnce('applied').mockResolvedValueOnce('held');
    const r = await saveActualsAction(ID, { eggs: EGGS, bacon: BACON });
    expect(r).toEqual({ ok: true, applied: 1, held: 1, results: { eggs: 'applied', bacon: 'held' } });
  });

  it('Scout_GetsSameForALine_WhoseBookPriceAlreadyMatches', async () => {
    const r = await saveActualsAction(ID, { eggs: EGGS });
    expect(r).toEqual({ ok: true, applied: 0, held: 0, results: { eggs: 'same' } });
  });

  it('Scout_KeepsThePaidPrice_EvenWhenALineIsHeld', async () => {
    mocks.reportPriceWith.mockResolvedValue('held');
    await saveActualsAction(ID, { eggs: EGGS });
    expect(mocks.saveActualsWith.mock.calls[0][3]).toEqual({ eggs: EGGS });
  });

  it('Scout_SavesActualsAsThePersonWhoSignedIn', async () => {
    await saveActualsAction(ID, { eggs: EGGS });
    expect(mocks.saveActualsWith.mock.calls[0].slice(1, 3)).toEqual([{ personId: 39, label: 'Charlie W.' }, ID]);
  });

  it('Scout_ResnapshotsTheMenu_WhenAPriceWasApplied', async () => {
    mocks.reportPriceWith.mockResolvedValue('applied');
    await saveActualsAction(ID, { eggs: EGGS });
    expect(mocks.saveActualsWith.mock.calls[0][5]).toEqual({ resnapshot: true });
  });

  it('Scout_KeepsTheSnapshot_WhenNothingWasApplied', async () => {
    mocks.reportPriceWith.mockResolvedValue('held');
    await saveActualsAction(ID, { eggs: EGGS });
    expect(mocks.saveActualsWith.mock.calls[0][5]).toEqual({ resnapshot: false });
  });

  it('Scout_ResnapshotsAgainstAFreshCatalog_AfterAnAppliedPrice', async () => {
    mocks.reportPriceWith.mockResolvedValue('applied');
    await saveActualsAction(ID, { eggs: EGGS });
    expect(mocks.loadCatalog).toHaveBeenCalledTimes(2);
  });

  it('Scout_IsToldTheMenuIsntTheirs_WhenTheStoreFindsNothingToWrite', async () => {
    mocks.saveActualsWith.mockResolvedValue({ status: 'not_found' });
    expect((await saveActualsAction(ID, { eggs: EGGS })).ok).toBe(false);
  });
});
