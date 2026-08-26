import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  EDITABLE_SCOUT_FIELDS,
  SCOUT_FIELD_TABLE,
  SCOUT_FIELD_PEOPLE_COLUMN
} from '../src/lib/change-requests';

/**
 * approveChangeRequest's 'scout' apply step (Plans/Retire-Roster-Contact-
 * Columns.md): a scout's proposed changes used to write straight to
 * `scouts`; contact/demographic fields now go to the scout's linked person
 * row instead — SCOUT_FIELD_TABLE says which table each field belongs to.
 *
 * approveChangeRequest itself is gated by requireCapability('roster.manage')
 * and isn't invocable without a cookie this suite can't mock (same D-049
 * boundary tests/roster-send-sign-in-link.test.ts documents) — the routing
 * table is proven directly here, and that the action's source actually uses
 * it is proven by source inspection.
 */
describe('SCOUT_FIELD_TABLE — routes a scout change-request field to its table', () => {
  it('covers every editable scout field exactly once', () => {
    for (const field of EDITABLE_SCOUT_FIELDS) {
      expect(SCOUT_FIELD_TABLE[field], field).toBeDefined();
    }
  });

  it('keeps school/grade/swim class on scouts — facts about being a scout', () => {
    expect(SCOUT_FIELD_TABLE.school).toBe('scouts');
    expect(SCOUT_FIELD_TABLE.graduation_year).toBe('scouts');
    expect(SCOUT_FIELD_TABLE.swim_class).toBe('scouts');
  });

  it('routes contact/demographic fields to people', () => {
    for (const field of [
      'address_line1',
      'address_line2',
      'city',
      'state',
      'zip',
      'phone',
      'email',
      'birthdate',
      'things_we_should_know'
    ] as const) {
      expect(SCOUT_FIELD_TABLE[field], field).toBe('people');
    }
  });

  it('maps email/phone to their people column names', () => {
    expect(SCOUT_FIELD_PEOPLE_COLUMN.email).toBe('primary_email');
    expect(SCOUT_FIELD_PEOPLE_COLUMN.phone).toBe('primary_phone');
  });
});

describe('approveChangeRequest — source uses SCOUT_FIELD_TABLE to split the write', () => {
  const src = readFileSync(
    new URL(
      '../src/app/admin/(workspace)/advancement/roster/change-request-actions.ts',
      import.meta.url
    ),
    'utf8'
  );

  it('writes the scouts-table fields to scouts and the rest to the linked person', () => {
    expect(src).toMatch(/SCOUT_FIELD_TABLE\[f\]\s*===\s*'scouts'/);
    expect(src).toMatch(/\.from\('scouts'\)\.update\(scoutPatch\)/);
    expect(src).toMatch(/\.from\('people'\)\.update\(personPatch\)/);
  });
});
