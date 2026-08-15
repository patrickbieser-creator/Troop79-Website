import { describe, it, expect, afterEach } from 'vitest';
import { adminClient } from './helpers/admin-client';
import { loadHouseholdByKey } from '../src/lib/households';
import {
  diffFields,
  parseFieldValue,
  editableFieldsFor,
  fieldLabel,
  EDITABLE_PERSON_FIELDS,
  EDITABLE_SCOUT_FIELDS
} from '../src/lib/change-requests';

/**
 * The adult half of the family self-service flow: /profile now edits every
 * member of a household, not only its scouts, so `change_requests` carries a
 * second entity_type and the apply step is parameterised by it.
 *
 * Two things are worth pinning down. The FIELD CONTRACT is what both the
 * public submit form and the privileged apply step filter through — if they
 * ever disagree, a family could propose a column a leader's approval would
 * then write. And the HOUSEHOLD BOUNDARY is the whole authorization check
 * behind submitPersonChangeRequestAction, exactly as profile-tier2.test.ts
 * covers it for scouts: the action itself isn't unit-testable without a
 * cookie-mocking harness this suite doesn't have (Tests/CLAUDE.md), so this
 * exercises the data check its rejection depends on.
 */

describe('change-request field contract', () => {
  it('offers the adult field set for the adult entity type', () => {
    expect(editableFieldsFor('adult')).toEqual(EDITABLE_PERSON_FIELDS);
  });

  it('offers the scout field set for the scout entity type', () => {
    expect(editableFieldsFor('scout')).toEqual(EDITABLE_SCOUT_FIELDS);
  });

  it('never offers a field that would let a family edit troop-owned data', () => {
    // active, notes, bsa_member_id and merged_into_person_id are a leader's,
    // and display_name is derived — none may reach the people update.
    for (const forbidden of ['active', 'notes', 'bsa_member_id', 'merged_into_person_id', 'display_name']) {
      expect(EDITABLE_PERSON_FIELDS as readonly string[]).not.toContain(forbidden);
    }
  });

  it("offers an adult's birthdate — the troop needs it for adults on campouts", () => {
    expect(EDITABLE_PERSON_FIELDS as readonly string[]).toContain('birthdate');
  });

  it('withholds bsa_member_id, which comes from Scouting America and feeds the Scoutbook export', () => {
    // Paired with the birthdate case above on purpose: the two arrived in the
    // same conversation and the distinction between them is the decision.
    expect(EDITABLE_PERSON_FIELDS as readonly string[]).not.toContain('bsa_member_id');
  });

  it('labels the same column differently per entity type', () => {
    // 'email' is a scout column; 'primary_email' is the person one.
    expect(fieldLabel('scout', 'email')).toBe('Email');
    expect(fieldLabel('adult', 'primary_email')).toBe('Email');
  });

  it('falls back to the raw key for an unknown field rather than rendering undefined', () => {
    expect(fieldLabel('adult', 'not_a_column')).toBe('not_a_column');
  });
});

describe('diffFields', () => {
  const allowed = ['first_name', 'primary_email'];

  it('keeps only the fields that actually changed', () => {
    const changed = diffFields(
      { first_name: 'Dana', primary_email: 'dana@example.com' },
      { first_name: 'Dana', primary_email: 'dana.ruiz@example.com' },
      allowed
    );
    expect(changed).toEqual({ primary_email: 'dana.ruiz@example.com' });
  });

  it('treats null and undefined as the same absent value', () => {
    const changed = diffFields({ first_name: null }, { first_name: null }, allowed);
    expect(changed).toEqual({});
  });

  it('records a field being cleared', () => {
    const changed = diffFields({ primary_email: 'dana@example.com' }, { primary_email: null }, allowed);
    expect(changed).toEqual({ primary_email: null });
  });

  it('drops a proposed key that is not on the allowlist', () => {
    const changed = diffFields({}, { active: 'false', first_name: 'Dana' }, allowed);
    expect(changed).toEqual({ first_name: 'Dana' });
  });
});

describe('parseFieldValue', () => {
  it('parses graduation_year as a number so the diff compares like with like', () => {
    expect(parseFieldValue('graduation_year', '2031')).toBe(2031);
  });

  it('falls back to null for an unparseable graduation_year rather than storing NaN', () => {
    expect(parseFieldValue('graduation_year', 'next year')).toBeNull();
  });

  it('treats an empty field as null, not an empty string', () => {
    expect(parseFieldValue('primary_email', '   ')).toBeNull();
  });

  it('trims a text field', () => {
    expect(parseFieldValue('first_name', '  Dana  ')).toBe('Dana');
  });
});

describe('adult household boundary', () => {
  let householdIds: number[] = [];
  let personIds: number[] = [];
  let scoutIds: string[] = [];

  afterEach(async () => {
    const admin = adminClient();
    if (scoutIds.length > 0) await admin.from('scouts').delete().in('id', scoutIds);
    if (personIds.length > 0) await admin.from('household_members').delete().in('person_id', personIds);
    if (personIds.length > 0) await admin.from('people').delete().in('id', personIds);
    if (householdIds.length > 0) await admin.from('households').delete().in('id', householdIds);
    householdIds = [];
    personIds = [];
    scoutIds = [];
  });

  /** A household with one active scout and one adult, both on the spine. */
  async function makeHousehold(
    admin: ReturnType<typeof adminClient>,
    label: string,
    suffix: string
  ): Promise<{ householdId: number; adultPersonId: number }> {
    const { data: household, error: hhErr } = await admin
      .from('households')
      .insert({ label: `[TEST] ${label}` })
      .select('id')
      .single();
    if (hhErr || !household) throw hhErr ?? new Error('no household');
    const householdId = (household as { id: number }).id;
    householdIds.push(householdId);

    const { data: people, error: peopleErr } = await admin
      .from('people')
      .insert([
        { first_name: 'Scout', last_name: label, display_name: `Scout ${label}`, active: true },
        { first_name: 'Adult', last_name: label, display_name: `Adult ${label}`, active: true }
      ])
      .select('id, display_name');
    if (peopleErr || !people) throw peopleErr ?? new Error('no people');
    const rows = people as { id: number; display_name: string }[];
    const scoutPersonId = rows.find((p) => p.display_name.startsWith('Scout'))!.id;
    const adultPersonId = rows.find((p) => p.display_name.startsWith('Adult'))!.id;
    personIds.push(scoutPersonId, adultPersonId);

    const scoutId = `TST${suffix}`;
    const { error: scoutErr } = await admin.from('scouts').insert({
      id: scoutId,
      first_name: 'Scout',
      last_name: label,
      display_name: `Scout ${label}`,
      active: true,
      household_id: householdId,
      person_id: scoutPersonId
    });
    if (scoutErr) throw scoutErr;
    scoutIds.push(scoutId);

    const { error: memberErr } = await admin.from('household_members').insert([
      { household_id: householdId, person_id: scoutPersonId },
      { household_id: householdId, person_id: adultPersonId }
    ]);
    if (memberErr) throw memberErr;

    return { householdId, adultPersonId };
  }

  it("lists a household's own adult as a member", async () => {
    const admin = adminClient();
    const mine = await makeHousehold(admin, 'Alpha', 'A1');

    const party = await loadHouseholdByKey(String(mine.householdId));
    expect(party).not.toBeNull();
    expect(party!.adults.some((a) => a.personId === mine.adultPersonId)).toBe(true);
  });

  it("never lists another household's adult, so a cross-household edit is rejected", async () => {
    const admin = adminClient();
    const mine = await makeHousehold(admin, 'Bravo', 'B1');
    const theirs = await makeHousehold(admin, 'Charlie', 'C1');

    const party = await loadHouseholdByKey(String(mine.householdId));
    expect(party).not.toBeNull();
    // This is the exact predicate submitPersonChangeRequestAction rejects on.
    expect(party!.adults.some((a) => a.personId === theirs.adultPersonId)).toBe(false);
  });
});
