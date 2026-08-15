import { describe, it, expect } from 'vitest';
import { householdKeyForPerson } from '../src/lib/households';
import { resolveEffectiveHouseholdKey } from '../src/lib/identity-session';
import type { Household } from '../src/lib/households';

/**
 * Signed-in leader prefill on the Event Signup job board (2026-08-08).
 *
 * The bug: gateAudience() checks the leader cookie FIRST and returns its role,
 * so a signed-in leader is audience 'leader' and never 'household'. The
 * household prefill was gated on `audience === 'household'`, so it never ran
 * for a leader — the most strongly authenticated visitor on the site, matched
 * against the authorized-adults roster at login, was the one shown "choose
 * your family" with no way to sign themselves up.
 *
 * These cover the two pure pieces of the fix. The cookie read itself
 * (leaderSessionPersonId) is not exercised here for the same reason
 * tests/event-signup-prefill.test.ts doesn't render the page: there is no
 * cookie-mocking harness in this suite (D-049's boundary).
 */

const HOUSEHOLDS: Household[] = [
  {
    key: '1',
    label: 'Bieser',
    scouts: [{ id: 'A02', displayName: 'A Scout', personId: 11 }],
    adults: [
      {
        key: 'a1',
        personId: 82,
        leaderCode: 'PB',
        name: 'Patrick Bieser',
        relationship: 'Parent',
        email: null
      }
    ]
  },
  {
    key: 'leader:CM',
    label: 'Committee Member',
    scouts: [],
    adults: [
      {
        key: 'a1',
        personId: 99,
        leaderCode: 'CM',
        name: 'Committee Member',
        relationship: null,
        email: null
      }
    ]
  }
];

describe('Signed-in leader prefill', () => {
  it('Leader_IsPlacedInTheirOwnHousehold_WhenSignedIn', () => {
    expect(householdKeyForPerson(HOUSEHOLDS, 82)).toBe('1');
  });

  it('AdultWithNoScout_ResolvesToTheirHouseholdOfOne', () => {
    // The population that currently can't volunteer at all — committee
    // members and counselors get a `leader:<code>` household of one, and it
    // must resolve like any other so the prefill reaches them too.
    expect(householdKeyForPerson(HOUSEHOLDS, 99)).toBe('leader:CM');
  });

  it('ScoutsCount_NotJustAdults_WhenPlacingAPerson', () => {
    expect(householdKeyForPerson(HOUSEHOLDS, 11)).toBe('1');
  });

  it('UnknownPerson_GetsNoPrefill', () => {
    expect(householdKeyForPerson(HOUSEHOLDS, 12345)).toBeNull();
  });

  it('Leader_CanStillSignUpAnotherFamily_WhenTheySwitch', () => {
    // "Change household" sets ?household= EMPTY, not absent. The prefill must
    // not win that back, or a leader helping another family would be silently
    // dragged back to their own — the same Prefill-over-Lock rule the verified
    // visitor path already follows.
    expect(resolveEffectiveHouseholdKey('', '1')).toBeUndefined();
  });

  it('ExplicitHousehold_BeatsTheLeadersOwn', () => {
    expect(resolveEffectiveHouseholdKey('7', '1')).toBe('7');
  });
});
