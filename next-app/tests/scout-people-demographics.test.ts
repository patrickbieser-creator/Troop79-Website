import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * createScout/updateScout (Plans/Retire-Roster-Contact-Columns.md): contact
 * and demographic fields write to `people` via the shared
 * writePersonDemographics(), never to `scouts` directly any more.
 *
 * requireCapability('roster.manage') gates both — same D-049 boundary
 * tests/roster-send-sign-in-link.test.ts documents, so this is a
 * source-property test rather than an invocation. writePersonDemographics()
 * itself is proven directly in tests/write-person-demographics.test.ts.
 */
describe('createScout / updateScout — demographics go to people, not scouts', () => {
  const src = readFileSync(
    new URL('../src/app/admin/(workspace)/advancement/lookups/actions.ts', import.meta.url),
    'utf8'
  );

  function body(name: string): string {
    const start = src.indexOf(`export async function ${name}`);
    expect(start, name).toBeGreaterThan(-1);
    const end = src.indexOf('\nexport async function', start + 1);
    return src.slice(start, end === -1 ? undefined : end);
  }

  /** Cut the balanced-paren call starting at `needle` (which must end in
   *  `(`) out of `src`, returning both the call text and what's left. Lets
   *  the doomed-field check ignore fields that are legitimately inside the
   *  writePersonDemographics(...) call while still catching one written
   *  anywhere else in the function. */
  function extractCall(src: string, needle: string): { call: string; rest: string } | null {
    const start = src.indexOf(needle);
    if (start === -1) return null;
    let depth = 1;
    let i = start + needle.length;
    for (; i < src.length && depth > 0; i++) {
      if (src[i] === '(') depth++;
      else if (src[i] === ')') depth--;
    }
    const call = src.slice(start, i);
    const rest = src.slice(0, start) + src.slice(i);
    return { call, rest };
  }

  const DOOMED_KEYS = [
    'address_line1:',
    'address_line2:',
    'city:',
    'state:',
    'zip:',
    'phone:',
    'email:',
    'health_form_date:',
    'birthdate:',
    'gender:',
    'bsa_member_id:',
    'things_we_should_know:'
  ];

  for (const name of ['createScout', 'updateScout']) {
    it(`${name}_WritesDemographicsOnlyThroughWritePersonDemographics`, () => {
      const b = body(name);
      const extracted = extractCall(b, 'writePersonDemographics(');
      expect(extracted, `${name}: no writePersonDemographics( call found`).not.toBeNull();
      for (const key of DOOMED_KEYS) {
        expect(
          extracted!.rest.includes(key),
          `${name}: "${key}" appears outside the writePersonDemographics() call`
        ).toBe(false);
      }
    });
  }

  it('CreateScout_CreatesTheLinkedPersonRow', () => {
    const b = body('createScout');
    expect(b).toMatch(/\.from\('people'\)[\s\S]*?\.insert\(/);
  });
});
