import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * What "signed in" means in the utility bar.
 *
 * Reported 2026-08-16: the bar read "Signed in · Family" for someone who had
 * only typed the troop password and had not signed in as anybody.
 *
 * That was true once. Phase D demoted FAMILY_PASSWORD from a credential to
 * the gate on the name picker — it unlocks a list of names and grants
 * nothing, and what you leave that screen with is a per-person identity
 * session. This route had not caught up, so the shared cookie was still being
 * reported as a session.
 *
 * The route reads cookies, which this suite cannot mock (D-049's boundary),
 * so these assert the rule at the source. Crude, but it is the rule that
 * matters and it is the one that silently regressed.
 */

const ROUTE = 'src/app/api/session-status/route.ts';

describe('session status', () => {
  it('FamilyPasswordCookie_IsNotReportedAsSignedIn', () => {
    const src = readFileSync(ROUTE, 'utf8');
    // The tell-tale of the bug: a branch handing back loggedIn:true with the
    // 'Family' level for the shared cookie rather than a named person.
    expect(src).not.toMatch(/familySession\s*\)\s*\{[\s\S]{0,200}loggedIn:\s*true/);
    // And the simplest guard of all — the route no longer consults it.
    expect(src).not.toContain('verifyFamilySession');
  });

  it('OnlyANamedSession_ReportsSignedIn', () => {
    const src = readFileSync(ROUTE, 'utf8');
    // Exactly two things count: a legacy leader session (a typed label) and a
    // verified identity (a real person). Nothing else may set loggedIn.
    const trueBranches = src.match(/loggedIn:\s*true/g) ?? [];
    expect(trueBranches).toHaveLength(2);
    expect(src).toContain('leaderSession');
    expect(src).toContain('identitySession');
  });

  it('VerifiedIdentity_IsTheOnlyThingThatCountsAsAMember', () => {
    const src = readFileSync(ROUTE, 'utf8');
    // isVerifiedMember gates the Members area and story submission, both of
    // which act under the person's own name — the troop password can never
    // satisfy that.
    expect(src).toMatch(/isVerifiedMember:\s*true/);
    const memberTrue = src.match(/isVerifiedMember:\s*true/g) ?? [];
    expect(memberTrue).toHaveLength(1);
  });
});
