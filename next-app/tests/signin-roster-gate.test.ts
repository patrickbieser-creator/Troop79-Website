import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * The troop-password gate on the name picker (Plans/Unified-Identity-And-
 * Capabilities.md Phase D, decision 3) — asserted at the source, not
 * behaviorally, because every function here reads cookies()/searchParams,
 * which this suite cannot mock (D-049's boundary, same reasoning as
 * tests/session-status.test.ts).
 *
 * Two real bugs, found live in production 2026-08-17, reported by Patrick as
 * recurring ("this has happened several times"):
 *
 *   1. signin/page.tsx computed `rosterUnlocked` as
 *      `pick === '1' || hasFamilyAccess()`. `pick` is a bare, unsigned URL
 *      query parameter with no relationship to the real session cookie —
 *      once `/signin?pick=1` existed anywhere (browser history, a bookmark,
 *      autocomplete), ANYONE who revisited it skipped the password check
 *      forever, no cookie required.
 *   2. Tracing that fix in qa-lead review turned up a second, worse gap:
 *      signin/actions.ts's requestForPersonAction had no gate of its own at
 *      all — unlike searchRosterAction, which self-gates because "a Server
 *      Action is callable directly" independent of what the rendering page
 *      checked. Any personId could be POSTed there, fully unauthenticated,
 *      and it would still send a real one-time code.
 *
 * Both are the same root cause: trusting that a page-level check protects a
 * Server Action it merely renders a form for. These tests assert the fix at
 * the source and are meant to make BOTH bugs impossible to quietly
 * reintroduce.
 */

const PAGE = 'src/app/(public)/signin/page.tsx';
const ACTIONS = 'src/app/(public)/signin/actions.ts';

describe('signin roster gate', () => {
  it('RosterUnlocked_IsNeverComputedFromAPickParam_OnlyFromTheRealCookie', () => {
    const src = readFileSync(PAGE, 'utf8');
    // Strip line comments first — the security note above rosterUnlocked
    // deliberately quotes the old buggy expression as history, and a regex
    // over raw source would flag its own warning comment as the bug.
    const code = src
      .split('\n')
      .map((line) => line.replace(/\/\/.*$/, ''))
      .join('\n');

    // The exact shape of the bug: an OR against a searchParams value.
    expect(code).not.toMatch(/pick\s*===\s*['"]1['"]/);
    // And the simplest guard of all — the page no longer reads it as a param.
    expect(code).not.toMatch(/\{\s*sent,[\s\S]{0,80}pick[\s\S]{0,80}\}\s*=\s*await searchParams/);
    expect(code).toMatch(/rosterUnlocked\s*=\s*await hasFamilyAccess\(\)/);
  });

  it('RequestForPersonAction_RefusesToSendACode_WithoutTheFamilyGate', () => {
    const src = readFileSync(ACTIONS, 'utf8');
    const start = src.indexOf('export async function requestForPersonAction');
    expect(start, 'requestForPersonAction not found').toBeGreaterThan(-1);
    const end = src.indexOf('\nexport async function', start + 1);
    const body = src.slice(start, end === -1 ? undefined : end);

    // Must check the gate BEFORE ever reaching requestChallengeForPerson —
    // not just somewhere in the file.
    const gateIdx = body.indexOf('hasFamilyAccess()');
    const sendIdx = body.indexOf('requestChallengeForPerson(');
    expect(gateIdx, 'no hasFamilyAccess() check in requestForPersonAction').toBeGreaterThan(-1);
    expect(sendIdx, 'requestChallengeForPerson call not found').toBeGreaterThan(-1);
    expect(gateIdx).toBeLessThan(sendIdx);
  });

  it('SearchRosterAction_StillSelfGates_TheOriginalPrecedentThisFollows', () => {
    // Guards the pattern this fix generalized from — if this one ever loses
    // its gate too, both the picker AND the request action would be exposed.
    const src = readFileSync(ACTIONS, 'utf8');
    const start = src.indexOf('export async function searchRosterAction');
    const end = src.indexOf('\n/*', start + 1);
    const body = src.slice(start, end === -1 ? undefined : end);
    expect(body).toContain('hasFamilyAccess()');
  });
});
