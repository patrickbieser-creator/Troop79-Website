import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { EDITABLE_SCOUT_FIELDS } from '../src/lib/change-requests';
import { mergeScoutRow, type ScoutCoreRow, type ScoutPersonContactRow } from '../src/lib/scout-row';

/**
 * Bug 2026-08-30 (Patrick): submitting a scout edit from /profile always
 * bounced with "Could not load this record" — queueChangeRequest still
 * selected EDITABLE_SCOUT_FIELDS straight from `scouts`, but the contact/
 * demographic columns were dropped from scouts by the people-spine work
 * (Plans/Retire-Roster-Contact-Columns.md). The /profile PAGE loader was
 * fixed to read through lib/scout-row at the time; the submit ACTION's own
 * current-values read was missed — greps couldn't see it because the column
 * list is built at runtime from EDITABLE_SCOUT_FIELDS, which is why
 * tests/no-roster-contact-column-reads.test.ts never caught it.
 *
 * Same source-inspection pattern as change-request-scout-apply.test.ts:
 * the action is behind requireHouseholdIdentity() and isn't invocable
 * without a cookie harness this suite doesn't have.
 */
describe('scout change-request submit — current values come from the scouts+people merge', () => {
  const src = readFileSync(new URL('../src/app/(public)/profile/actions.ts', import.meta.url), 'utf8');

  it('loads the scout current row through loadScoutRows, not a scouts-table select', () => {
    expect(src).toMatch(/loadScoutRows\(/);
  });

  it('keeps no generic per-table current-values read a caller could point at dropped columns', () => {
    expect(src).not.toMatch(/\.from\(table\)/);
  });

  it('mergeScoutRow carries every EDITABLE_SCOUT_FIELD, so the diff sees real current values', () => {
    const core: ScoutCoreRow = {
      id: 'tscout',
      first_name: 'Test',
      last_name: 'Scout',
      display_name: 'Test Scout',
      patrol: null,
      current_rank: null,
      active: true,
      inactive_reason: null,
      school: 'Milwaukee Middle',
      graduation_year: 2030,
      swim_class: 'swimmer',
      junior_leader_override: null,
      person_id: 42
    };
    const person: ScoutPersonContactRow = {
      id: 42,
      address_line1: '1 Main St',
      address_line2: null,
      city: 'Milwaukee',
      state: 'WI',
      zip: '53202',
      primary_phone: '414-555-0100',
      primary_email: 'scout@example.com',
      birthdate: '2012-05-01',
      gender: 'F',
      bsa_member_id: null,
      health_form_date: null,
      things_we_should_know: null
    };
    const merged = mergeScoutRow(core, person) as unknown as Record<string, unknown>;
    for (const field of EDITABLE_SCOUT_FIELDS) {
      expect(field in merged, field).toBe(true);
    }
  });
});
