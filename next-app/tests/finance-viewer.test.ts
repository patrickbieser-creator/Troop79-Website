import { describe, it, expect } from 'vitest';
import { actorCanProxyFinance, decideFinanceViewer, type FinanceSwitchOption } from '../src/lib/finance-viewer';
import type { AdminActor } from '../src/lib/admin-actor';
import type { Capability } from '../src/lib/capabilities';

/**
 * Finance superuser proxy (Plans/Troop-Finances.md — "extend the superuser
 * proxy logic... to scout accounts on the public site"), mirroring
 * tests/library-scout-progress.test.ts's actorCanProxyLibrary coverage:
 * the scout case is the real regression this guards against, not the
 * happy path. finance.manage is grantable to any person_id — nothing stops
 * it being handed to a scout in the treasurer/officer role someday, and the
 * guard must refuse them regardless of what the grants table says.
 */
describe('actorCanProxyFinance (pure)', () => {
  function actor(overrides: Partial<AdminActor> & { capabilities?: Set<Capability> }): AdminActor {
    return {
      kind: 'identity',
      label: '[TEST] Actor',
      personId: 999,
      capabilities: new Set<Capability>(),
      legacyRole: null,
      subjectKind: 'adult',
      ...overrides
    };
  }

  it('ActorCanProxyFinance_IsFalse_WhenActorIsNull', () => {
    expect(actorCanProxyFinance(null)).toBe(false);
  });

  it('ActorCanProxyFinance_IsFalse_WhenGrantIsMissing', () => {
    expect(actorCanProxyFinance(actor({ capabilities: new Set<Capability>() }))).toBe(false);
  });

  it('ActorCanProxyFinance_IsFalse_WhenActorHoldsOnlyAnUnrelatedCapability', () => {
    // The exact scenario the "don't reuse a capability across domains"
    // design note warns about: library.proxy_view must not imply finance
    // proxy access just because both are "proxy" concepts.
    expect(actorCanProxyFinance(actor({ capabilities: new Set<Capability>(['library.proxy_view']) }))).toBe(false);
  });

  it('ActorCanProxyFinance_IsTrue_ForAnAdultHoldingFinanceManage', () => {
    expect(actorCanProxyFinance(actor({ capabilities: new Set<Capability>(['finance.manage']) }))).toBe(true);
  });

  it('ActorCanProxyFinance_IsFalse_ForAScoutHoldingFinanceManage', () => {
    expect(
      actorCanProxyFinance(actor({ subjectKind: 'scout', capabilities: new Set<Capability>(['finance.manage']) }))
    ).toBe(false);
  });
});

/**
 * decideFinanceViewer (pure) — the actual whose-money-do-I-see branching,
 * extracted out of resolveFinanceViewer for the D-049 reason documented in
 * lib/finance-viewer.ts (qa-lead, 2026-08-18, pre-production BLOCK finding:
 * this file previously covered only the one-line actorCanProxyFinance guard
 * and left the real branch logic — proxy-available vs. family-default vs.
 * explicit-proxy-pick vs. none — completely untested).
 */
describe('decideFinanceViewer (pure)', () => {
  const CADEN: FinanceSwitchOption = { personId: 501, name: 'Caden' };
  const RONNIE: FinanceSwitchOption = { personId: 502, name: 'Ronnie' };
  const ACTIVE_SCOUTS = [CADEN, RONNIE];

  it('Viewer_IsNone_WhenNoSessionAndNoProxyCapability', () => {
    // "revoked/expired session" and "no session at all" collapse to the same
    // input shape here — resolveFinanceViewer() is what turns an
    // epoch-mismatched or missing cookie into familyScope: null; this
    // function just has to refuse to invent a scope out of nothing.
    const result = decideFinanceViewer({
      canProxy: false,
      familyScope: null,
      familyLabel: '',
      activeScouts: [],
      chosen: null
    });
    expect(result).toEqual({ kind: 'none' });
  });

  it('Viewer_IsNone_WhenSessionRevokedEvenIfActorHadFinanceManage', () => {
    // canProxy true (the grant is real) but familyScope null (the identity
    // session itself failed isEpochCurrent) and no active scouts to proxy
    // into — nothing left to show.
    const result = decideFinanceViewer({
      canProxy: true,
      familyScope: null,
      familyLabel: '',
      activeScouts: [],
      chosen: null
    });
    expect(result).toEqual({ kind: 'none' });
  });

  it('Viewer_IsProxyAvailable_ForAdultWithNoChildren_HoldingFinanceManage', () => {
    // A pure treasurer/leader: verified adult identity, but resolveFamilyScope
    // found no children — so hasFamily is false, and with real active scouts
    // to choose from, the UI should offer the picker rather than showing 'none'.
    const result = decideFinanceViewer({
      canProxy: true,
      familyScope: [],
      familyLabel: 'Patrick',
      activeScouts: ACTIVE_SCOUTS,
      chosen: null
    });
    expect(result).toEqual({ kind: 'proxy-available', options: ACTIVE_SCOUTS });
  });

  it('Viewer_IsNone_ForAdultWithNoChildren_LackingFinanceManage', () => {
    // Same "no children" shape, but without the grant — must not fall
    // through to proxy-available just because activeScouts happens to be
    // populated (it wouldn't be, in the real resolver, but this function
    // shouldn't rely on the caller getting that right).
    const result = decideFinanceViewer({
      canProxy: false,
      familyScope: [],
      familyLabel: 'Some Leader',
      activeScouts: [],
      chosen: null
    });
    expect(result).toEqual({ kind: 'none' });
  });

  it('Viewer_DefaultsToOwnFamily_WhenFinanceManageHolderHasChildren_AndNoExplicitPick', () => {
    // Patrick's exact case: finance.manage held, real family scope present,
    // no ?viewScout= yet — must default to family, not auto-proxy.
    const result = decideFinanceViewer({
      canProxy: true,
      familyScope: [10, 501],
      familyLabel: 'Bieser Family',
      activeScouts: ACTIVE_SCOUTS,
      chosen: null
    });
    expect(result).toEqual({
      kind: 'scope',
      personIds: [10, 501],
      label: 'Bieser Family',
      switchOptions: ACTIVE_SCOUTS,
      isProxy: false
    });
  });

  it('Viewer_SwitchesToExplicitPick_WhenViewScoutChosen_EvenWithOwnFamilyAvailable', () => {
    // Picking a scout from the switcher overrides the family default and
    // narrows personIds to just that one scout — this is what "toggles
    // family view off" means per Patrick's spec.
    const result = decideFinanceViewer({
      canProxy: true,
      familyScope: [10, 501],
      familyLabel: 'Bieser Family',
      activeScouts: ACTIVE_SCOUTS,
      chosen: RONNIE
    });
    expect(result).toEqual({
      kind: 'scope',
      personIds: [502],
      label: 'Ronnie',
      switchOptions: ACTIVE_SCOUTS,
      isProxy: true
    });
  });

  it('Viewer_ShowsOrdinaryFamily_WithEmptySwitchOptions_WhenLackingFinanceManage', () => {
    // The common case: a regular parent with no proxy grant at all. No
    // switcher should be offered — switchOptions must be empty, not just
    // unused, since the UI renders the switcher purely off this array.
    const result = decideFinanceViewer({
      canProxy: false,
      familyScope: [10, 501],
      familyLabel: 'Bieser Family',
      activeScouts: [],
      chosen: null
    });
    expect(result).toEqual({
      kind: 'scope',
      personIds: [10, 501],
      label: 'Bieser Family',
      switchOptions: [],
      isProxy: false
    });
  });

  it('Viewer_IgnoresChosen_WhenActorCannotProxy_EvenIfCallerPassedOneIn', () => {
    // Defensive: the real resolver only ever populates `chosen` when
    // canProxy is true (it only fetches activeScouts under that guard), but
    // this pure function must not trust that invariant blindly — a scout
    // session erroneously holding finance.manage is exactly the case
    // actorCanProxyFinance() guards against upstream, so canProxy will
    // already be false for them by the time this runs.
    const result = decideFinanceViewer({
      canProxy: false,
      familyScope: [501],
      familyLabel: 'Caden',
      activeScouts: [],
      chosen: CADEN
    });
    expect(result).toEqual({
      kind: 'scope',
      personIds: [501],
      label: 'Caden',
      switchOptions: [],
      isProxy: false
    });
  });
});
