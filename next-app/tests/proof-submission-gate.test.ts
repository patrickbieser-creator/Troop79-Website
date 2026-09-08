import { describe, it, expect } from 'vitest';
import { proofSubmissionAllowedFor, canClaimProof } from '../src/lib/library';

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

  // UPDATED 2026-09-07 (Patrick): the ONE sanctioned widening of this gate —
  // a leader whose resolved library viewer is a PROXY for the very scout the
  // proof is for (holder of `library.proxy_view`, `?viewScout=` / the posted
  // scout equals the proxied scout) may file the claim on that scout's
  // behalf. It still goes through the review queue, labelled as leader-filed.
  // A plain leader session with no proxied scout stays refused; 'family',
  // the OLD 'scout' audience and null are untouched by the context argument.
  it('Leader_WithMatchingProxy_IsAllowed_WhenSubmittingProof', () => {
    expect(proofSubmissionAllowedFor('leader', { proxyScoutId: 'A01', forScoutId: 'A01' })).toBe(true);
  });

  it('Leader_WithMismatchedProxy_IsRefused_WhenSubmittingProof', () => {
    expect(proofSubmissionAllowedFor('leader', { proxyScoutId: 'A01', forScoutId: 'B02' })).toBe(false);
    expect(proofSubmissionAllowedFor('leader', { proxyScoutId: 'A01', forScoutId: null })).toBe(false);
  });

  it('Leader_WithoutProxy_StaysRefused_WhenSubmittingProof', () => {
    expect(proofSubmissionAllowedFor('leader', { proxyScoutId: null, forScoutId: 'A01' })).toBe(false);
    expect(proofSubmissionAllowedFor('leader', {})).toBe(false);
  });

  it('ProxyContext_NeverOpens_FamilyScoutOrAnonymous', () => {
    const ctx = { proxyScoutId: 'A01', forScoutId: 'A01' };
    expect(proofSubmissionAllowedFor('family', ctx)).toBe(false);
    expect(proofSubmissionAllowedFor('scout', ctx)).toBe(false);
    expect(proofSubmissionAllowedFor(null, ctx)).toBe(false);
  });
});

/**
 * The page-side twin: whether a requirement row shows "I did this" at all
 * (mb/[mbId]/page.tsx, rank/[rankId]/[code]/page.tsx). Same rule as the
 * action's gate so a viewer is never walked to a form that refuses them.
 */
describe('proof claim visibility (canClaimProof)', () => {
  const own = { kind: 'scout', scoutId: 'A01', scoutName: 'A', switchOptions: [], isProxy: false } as const;
  const proxy = { ...own, isProxy: true } as const;

  it('VerifiedHousehold_SeesClaim_ForOwnScout', () => {
    expect(canClaimProof(own, 'household')).toBe(true);
  });

  it('ProxyLeader_SeesClaim_ForProxiedScout', () => {
    // Identity-cookie leader (audience 'household') and legacy leader cookie alike.
    expect(canClaimProof(proxy, 'household')).toBe(true);
    expect(canClaimProof(proxy, 'leader')).toBe(true);
  });

  it('NoScoutInView_NeverSeesClaim', () => {
    expect(canClaimProof({ kind: 'none' }, 'household')).toBe(false);
    expect(canClaimProof({ kind: 'proxy-available', options: [] }, 'leader')).toBe(false);
  });

  it('OldScoutLogin_AndFamilyPassword_NeverSeeClaim', () => {
    expect(canClaimProof(own, 'scout')).toBe(false);
    expect(canClaimProof(own, 'family')).toBe(false);
    expect(canClaimProof(own, null)).toBe(false);
  });
});
