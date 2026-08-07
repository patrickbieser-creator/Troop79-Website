import { describe, it, expect } from 'vitest';
import { resolveEffectiveHouseholdKey } from '../src/lib/identity-session';

/**
 * Event Signup verified-visitor prefill (Plans/Family-Identity-Auth.md
 * Phase 2, decision "(b) Prefill" over "(c) Lock"). Pure function, no
 * DB/cookies — same rationale as tests/proof-submission-gate.test.ts. The
 * page itself can't be rendered in this suite (no cookie-mocking harness,
 * D-049's boundary), so this exercises the exact resolution rule
 * events/[id]/page.tsx calls.
 */
describe('Event Signup household prefill', () => {
  it('VerifiedFamily_IsNotChallenged_WhenOpeningEventSignup', () => {
    // No ?household= at all (a first visit) — the verified session's own
    // household prefills, standing in for "the gate never re-challenges and
    // the household picker arrives pre-selected".
    expect(resolveEffectiveHouseholdKey(undefined, '42')).toBe('42');
  });

  it('VerifiedFamily_CanStillSignUpAnotherHousehold_WhenSwitching', () => {
    // "Not you? Change" sets ?household= EMPTY, not absent — the prefill
    // must not win this back, or switching households would silently stop
    // being possible (the (c)-rejection guard: prefill, never a lock).
    expect(resolveEffectiveHouseholdKey('', '42')).toBeUndefined();
  });

  it('ExplicitHousehold_AlwaysWins_OverThePrefill', () => {
    // Someone else's signup link, or a household already picked this visit —
    // an explicit value in the URL is never second-guessed by the prefill.
    expect(resolveEffectiveHouseholdKey('99', '42')).toBe('99');
  });

  it('UnverifiedVisitor_GetsNoPrefill', () => {
    expect(resolveEffectiveHouseholdKey(undefined, null)).toBeUndefined();
  });
});
