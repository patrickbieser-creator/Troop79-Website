import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { adminClient } from './helpers/admin-client';
import { TEST_PREFIX } from './helpers/signup-fixtures';
import { personIdsWithEmail } from '../src/lib/parent-email';

/** The P.S.'s one read (L0 qa follow-up): who has an address on file, any person_emails row, verified or not. */
const sb = adminClient();
const people: number[] = [];

beforeAll(async () => {
  for (const label of ['With', 'Unverified', 'Without']) {
    const { data, error } = await sb.from('people').insert({ display_name: `${TEST_PREFIX} PED ${label}`, first_name: TEST_PREFIX, last_name: `PED ${label}` }).select('id').single();
    if (error) throw new Error(error.message);
    people.push(data!.id as number);
  }
  const rows = [
    { person_id: people[0], email: `zzvitest-ped-${people[0]}@example.com`, is_primary: true, verified_at: new Date().toISOString() },
    { person_id: people[1], email: `zzvitest-ped-${people[1]}@example.com`, is_primary: true, verified_at: null }
  ];
  const { error } = await sb.from('person_emails').insert(rows);
  if (error) throw new Error(error.message);
});

afterAll(async () => {
  await sb.from('person_emails').delete().in('person_id', people);
  await sb.from('people').delete().in('id', people);
});

describe('personIdsWithEmail', () => {
  it('PersonIdsWithEmail_AnyAddressCounts_NoneDoesNot', async () => {
    expect([...(await personIdsWithEmail(sb, people))].sort()).toEqual([people[0], people[1]].sort());
  });
});
