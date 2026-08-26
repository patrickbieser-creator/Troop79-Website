import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { verifiedSignupVerdict, decideVerifiedSignupAccess } from '../src/lib/family-access';
import type { IdentitySession } from '../src/lib/identity-session';

/**
 * Plans/Verified-Signup.md Phase A (Patrick, 2026-08-26): the shared troop
 * password is FIRST BASE — it opens the event page and the sign-in screen —
 * but writing a signup needs a verified ADULT identity or a leader session.
 * Before this, anyone holding the Bugle's password could sign up, cancel, or
 * claim jobs for any family with no record of who did it (D-027's Tier 1,
 * now superseded for signup writes).
 *
 * The verdict is a pure function so the rule is testable without a cookie
 * (D-049); the Server Action guard wraps it.
 */
describe('verifiedSignupVerdict', () => {
  it('Anonymous_IsAnon_WhenNothingClearedTheGate', () => {
    expect(verifiedSignupVerdict(null, null)).toBe('anon');
  });

  it('TroopPasswordOnly_MustSignIn_WhenWritingASignup', () => {
    expect(verifiedSignupVerdict('family', null)).toBe('sign-in');
  });

  it('VerifiedAdult_IsAllowed_WhenWritingASignup', () => {
    expect(verifiedSignupVerdict('household', 'adult')).toBe('ok');
  });

  it('VerifiedScout_NeedsAParent_WhenWritingASignup', () => {
    expect(verifiedSignupVerdict('household', 'scout')).toBe('parent');
  });

  it('LeaderSession_IsAllowed_AsToday', () => {
    expect(verifiedSignupVerdict('leader', null)).toBe('ok');
  });

  it('LegacyScoutRole_MustSignIn_ItIsNotAnIdentity', () => {
    // The old shared SCOUT_PASSWORD role is not a person; treat it like the
    // family password, not like a verified scout.
    expect(verifiedSignupVerdict('scout', null)).toBe('sign-in');
  });
});

describe('requireVerifiedSignupAccess (decision core, inputs injected)', () => {
  const adult = { role: 'identity', subjectKind: 'adult', personId: 1, householdKey: '1', displayName: 'Dana', epoch: 0 } as unknown as IdentitySession;
  const scout = { ...adult, subjectKind: 'scout' } as unknown as IdentitySession;
  const fresh = async () => true;
  const revoked = async () => false;

  it('RequireVerifiedSignupAccess_AllowsLeaderAndAdult_RejectsFamilyAndScout', async () => {
    await expect(decideVerifiedSignupAccess('leader', null, fresh)).resolves.toBe('leader');
    await expect(decideVerifiedSignupAccess('household', adult, fresh)).resolves.toBe('household');
    await expect(decideVerifiedSignupAccess('family', null, fresh)).rejects.toThrow(/sign in to sign up/);
    await expect(decideVerifiedSignupAccess('household', scout, fresh)).rejects.toThrow(/parent/);
    await expect(decideVerifiedSignupAccess(null, null, fresh)).rejects.toThrow(/sign in/);
  });

  it('RequireVerifiedSignupAccess_RejectsARevokedAdultSession', async () => {
    await expect(decideVerifiedSignupAccess('household', adult, revoked)).rejects.toThrow(/revoked/);
  });

  it('RequireVerifiedSignupAccess_NeverSpendsTheEpochRead_ForALeader', async () => {
    let calls = 0;
    await decideVerifiedSignupAccess('leader', null, async () => { calls++; return true; });
    expect(calls).toBe(0);
  });
});

describe('signup write actions', () => {
  const src = readFileSync(new URL('../src/app/(public)/events/[id]/actions.ts', import.meta.url), 'utf8');

  it('EveryWriteAction_CallsRequireVerifiedSignupAccess_NotTheOldFamilyGuard', () => {
    for (const name of ['submitSignupAction', 'cancelSignupAction']) {
      const start = src.indexOf(`export async function ${name}`);
      expect(start, name).toBeGreaterThan(-1);
      const end = src.indexOf('\nexport async function', start + 1);
      const body = src.slice(start, end === -1 ? undefined : end);
      expect(body, name).toContain('requireVerifiedSignupAccess(');
      expect(body, name).not.toContain('requireFamilyAccess(');
    }
  });
});
