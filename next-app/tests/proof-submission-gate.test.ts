import { describe, it, expect } from 'vitest';
import { proofSubmissionAllowedFor } from '../src/lib/library';

/**
 * Regression guard for Plans/Family-Identity-Auth.md Phase 0 (2026-08-06):
 * a shared SCOUT_PASSWORD holder could previously claim proof submission
 * under ANY active scout's name — the roster picker was "a courtesy, not a
 * binding proof," and the reviewing leader had no independent way to verify
 * the claim. Patrick overrode that: a scout may claim only their own work,
 * and until Tier 2-S (verified scout identity) exists, the scout-login path
 * doesn't exist at all rather than being narrowed. Leaders are refused too —
 * they sign off directly via Fast Entry, no review queue needed.
 *
 * Pure function, no DB/cookies — unlike the rest of this project's test
 * suite (D-049, integration against real Postgres), this one genuinely has
 * no I/O to integrate against.
 *
 * UPDATED for Plans/Family-Identity-Auth.md Phase 2 (2026-08-06):
 * 'household' — a VERIFIED identity session, adult or scout subjectKind
 * alike — is now allowed. This is Tier 2-S actually reopening the scout
 * path Phase 0 closed, on a real identity basis instead of the free-pick
 * that made Phase 0 necessary. The OLD unverified 'scout' (shared
 * SCOUT_PASSWORD) stays refused permanently — it is superseded by
 * 'household', not reopened itself.
 *
 * UPDATED again 2026-08-21: Tier 1 ('family' — shared troop password +
 * self-asserted household, lib/profile-household-session.ts) is retired.
 * Phase 3's leader-issued-code safety net, the reason it stayed alive, was
 * decided against — verified sign-in (email) is the only path now.
 */
describe('proof submission audience gate', () => {
  it('ScoutLogin_IsRefused_WhenSubmittingProof', () => {
    expect(proofSubmissionAllowedFor('scout')).toBe(false);
  });

  it('LeaderSession_IsRefused_WhenSubmittingProof', () => {
    expect(proofSubmissionAllowedFor('leader')).toBe(false);
  });

  it('AnonymousVisitor_IsRefused_WhenSubmittingProof', () => {
    expect(proofSubmissionAllowedFor(null)).toBe(false);
  });

  it('Family_IsRefused_WhenSubmittingProof', () => {
    expect(proofSubmissionAllowedFor('family')).toBe(false);
  });

  it('VerifiedHousehold_IsAllowed_WhenSubmittingProof', () => {
    expect(proofSubmissionAllowedFor('household')).toBe(true);
  });
});
