import { describe, it, expect } from 'vitest';
import {
  actorCanProxyMembers,
  decideMemberViewer,
  pickChosenScout,
  type MemberScoutOption
} from '../src/lib/member-viewer';
import type { AdminActor } from '../src/lib/admin-actor';
import type { Capability } from '../src/lib/capabilities';

/**
 * Members proxy (Patrick, 2026-10-13: "add the ability to superuser proxy from
 * the members page, same as under the advancement page"). Read-only; gated on
 * library.proxy_view. The branching lives in pure functions so it is testable
 * without next/headers (D-049).
 */
const SCOUTS: MemberScoutOption[] = [
  { personId: 11, name: 'Anjali S' },
  { personId: 12, name: 'Damian R' }
];

function actor(overrides: Partial<AdminActor> = {}): AdminActor {
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

describe('actorCanProxyMembers (pure)', () => {
  it('MembersProxy_IsOff_WhenActorIsNull', () => {
    expect(actorCanProxyMembers(null)).toBe(false);
  });
  it('MembersProxy_IsOff_WhenGrantIsMissing', () => {
    expect(actorCanProxyMembers(actor())).toBe(false);
  });
  it('MembersProxy_IsOff_WhenActorOnlyHoldsFinanceManage', () => {
    expect(actorCanProxyMembers(actor({ capabilities: new Set<Capability>(['finance.manage']) }))).toBe(false);
  });
  it('MembersProxy_IsOn_ForAnAdultHoldingLibraryProxyView', () => {
    expect(actorCanProxyMembers(actor({ capabilities: new Set<Capability>(['library.proxy_view']) }))).toBe(true);
  });
  it('MembersProxy_IsOff_ForAScoutHoldingLibraryProxyView', () => {
    expect(
      actorCanProxyMembers(actor({ subjectKind: 'scout', capabilities: new Set<Capability>(['library.proxy_view']) }))
    ).toBe(false);
  });
});

describe('pickChosenScout (pure)', () => {
  it('MembersProxy_IsNotProxying_WhenViewScoutIsMissing', () => {
    expect(pickChosenScout(undefined, SCOUTS)).toBeNull();
  });
  it('MembersProxy_IsNotProxying_WhenViewScoutIsNotANumber', () => {
    expect(pickChosenScout('abc', SCOUTS)).toBeNull();
  });
  it('MembersProxy_IsNotProxying_WhenViewScoutIsNotAnActiveScout', () => {
    expect(pickChosenScout('999', SCOUTS)).toBeNull();
  });
  it('MembersProxy_PicksTheScout_WhenViewScoutIsActive', () => {
    expect(pickChosenScout('12', SCOUTS)).toEqual(SCOUTS[1]);
  });
});

describe('decideMemberViewer (pure)', () => {
  it('MembersProxy_ShowsChosenFamily_WhenLeaderHasLibraryProxyView', () => {
    const v = decideMemberViewer({ canProxy: true, hasOwnFamily: false, activeScouts: SCOUTS, chosen: SCOUTS[0] });
    expect(v).toEqual({ kind: 'proxy', personId: 11, name: 'Anjali S', switchOptions: SCOUTS });
  });

  it('MembersProxy_ShowsChosenFamily_EvenWhenLeaderHasTheirOwnFamily', () => {
    const v = decideMemberViewer({ canProxy: true, hasOwnFamily: true, activeScouts: SCOUTS, chosen: SCOUTS[1] });
    expect(v.kind).toBe('proxy');
  });

  it('MembersProxy_IgnoresViewScout_WhenViewerHasNoRights', () => {
    const v = decideMemberViewer({ canProxy: false, hasOwnFamily: true, activeScouts: [], chosen: SCOUTS[0] });
    expect(v).toEqual({ kind: 'own', switchOptions: [] });
  });

  it('MembersProxy_OffersPicker_WhenLeaderHasNoFamilyAndNoChoice', () => {
    const v = decideMemberViewer({ canProxy: true, hasOwnFamily: false, activeScouts: SCOUTS, chosen: null });
    expect(v).toEqual({ kind: 'proxy-available', options: SCOUTS });
  });

  it('MembersProxy_DefaultsToOwnFamilyWithSwitcher_WhenLeaderHasFamily', () => {
    const v = decideMemberViewer({ canProxy: true, hasOwnFamily: true, activeScouts: SCOUTS, chosen: null });
    expect(v).toEqual({ kind: 'own', switchOptions: SCOUTS });
  });

  it('MembersProxy_IsOwn_WhenLeaderHasNoFamilyAndNoActiveScouts', () => {
    const v = decideMemberViewer({ canProxy: true, hasOwnFamily: false, activeScouts: [], chosen: null });
    expect(v).toEqual({ kind: 'own', switchOptions: [] });
  });
});
