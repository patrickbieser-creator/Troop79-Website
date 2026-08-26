import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * /profile's self-service email actions (Plans/Retire-Roster-Contact-
 * Columns.md Phase 2) — addAdultEmailAction, setAdultPrimaryEmailAction,
 * removeAdultEmailAction.
 *
 * These are Server Actions guarded by requireHouseholdIdentity() (a signed
 * cookie this suite has no way to mock — same D-049 boundary
 * tests/roster-send-sign-in-link.test.ts's own source-property test
 * documents), so the property that actually matters here — a parent can
 * manage only THEIR OWN addresses, never a housemate's — is proven by
 * reading the functions' own source: each one must read `session.personId`
 * from the verified identity and never a personId out of its own formData,
 * unlike submitPersonChangeRequestAction's household-membership check a few
 * lines above them (which only proves "some adult in this household", not
 * "this is MY address").
 */
describe('profile email actions — source property', () => {
  const src = readFileSync(new URL('../src/app/(public)/profile/actions.ts', import.meta.url), 'utf8');

  function bodyOf(fnName: string): string {
    const start = src.indexOf(`export async function ${fnName}`);
    expect(start, `${fnName} not found`).toBeGreaterThan(-1);
    const nextFnIdx = src.indexOf('\nexport async function', start + 1);
    return src.slice(start, nextFnIdx === -1 ? undefined : nextFnIdx);
  }

  const fnNames = ['addAdultEmailAction', 'setAdultPrimaryEmailAction', 'removeAdultEmailAction'];

  it.each(fnNames)('%s_NeverReadsAPersonIdOutOfItsOwnFormData', (fnName) => {
    const body = bodyOf(fnName);
    // The only source of "who" is the verified session — never a form field.
    expect(body).toContain('requireParty()');
    expect(body).toContain('session.personId');
    expect(body).not.toMatch(/formData\.get\(\s*['"]personId['"]/);
  });

  it.each(fnNames)('%s_IsGuardedByAVerifiedHouseholdSession', (fnName) => {
    const body = bodyOf(fnName);
    expect(body).toContain('requireParty()');
  });

  it('AddAdultEmailAction_PassesTheTypedEmailAndLabel_ToPersonEmailsLib', () => {
    const body = bodyOf('addAdultEmailAction');
    expect(body).toContain('addPersonEmail(');
    expect(body).toContain('session.personId');
  });

  it('SetAdultPrimaryEmailAction_TargetsAnEmailId_NotARawAddress', () => {
    const body = bodyOf('setAdultPrimaryEmailAction');
    expect(body).toContain('setPrimaryEmail(');
    expect(body).toContain("formData.get('emailId')");
  });

  it('RemoveAdultEmailAction_TargetsAnEmailId_NotARawAddress', () => {
    const body = bodyOf('removeAdultEmailAction');
    expect(body).toContain('removePersonEmail(');
    expect(body).toContain("formData.get('emailId')");
  });
});
