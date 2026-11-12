import { describe, it, expect, afterEach } from 'vitest';
import { adminClient } from './helpers/admin-client';
import { TEST_PREFIX } from './helpers/signup-fixtures';

/**
 * A merge moves permissions and sign-off initials to the person kept (20270101150000_merge_moves_permissions).
 * Found 2026-11-12: a treasurer's finance permissions stayed on her merged-away duplicate, so the record she signs in
 * as had no finance access. Real local DB, test-owned people and ZQM… codes.
 */
const admin = adminClient();
let people: number[] = [];

afterEach(async () => {
  await admin.from('leaders').delete().like('code', 'ZQM%');
  if (people.length) {
    await admin.from('person_capabilities').delete().in('person_id', people);
    await admin.from('people').update({ merged_into_person_id: null }).in('id', people);
    await admin.from('people').delete().in('id', people);
  }
  people = [];
});

async function person(name: string): Promise<number> {
  const { data, error } = await admin.from('people').insert({ display_name: `${TEST_PREFIX} ${name}` }).select('id').single();
  if (error || !data) throw new Error(`fixture person: ${error?.message}`);
  people.push(data.id as number);
  return data.id as number;
}
const merge = async (keep: number, dup: number) => {
  const { error } = await admin.rpc('merge_people', { p_survivor: keep, p_loser: dup, p_decided_by: 'ZZ Vitest' });
  if (error) throw new Error(`merge_people: ${error.message}`);
};
const caps = async (id: number) =>
  ((await admin.from('person_capabilities').select('capability').eq('person_id', id).order('capability')).data ?? []).map((r) => r.capability);

describe('merge moves permissions and initials', () => {
  it('Merge_MovesTheDuplicatesPermissions_ToThePersonKept', async () => {
    const keep = await person('Kara keep');
    const dup = await person('Kara dup');
    await admin.from('person_capabilities').insert([
      { person_id: dup, capability: 'finance.manage' },
      { person_id: dup, capability: 'finance.view' }
    ]);
    await merge(keep, dup);
    expect({ keep: await caps(keep), dup: await caps(dup) }).toEqual({ keep: ['finance.manage', 'finance.view'], dup: [] });
  });

  it('Merge_APermissionBothHeld_StaysOnce', async () => {
    const keep = await person('Kara keep');
    const dup = await person('Kara dup');
    await admin.from('person_capabilities').insert([
      { person_id: keep, capability: 'finance.view' },
      { person_id: dup, capability: 'finance.view' }
    ]);
    await merge(keep, dup);
    expect(await caps(keep)).toEqual(['finance.view']);
  });

  it('Merge_MovesTheDuplicatesInitials_WhenThePersonKeptHasNone', async () => {
    const keep = await person('Kara keep');
    const dup = await person('Kara dup');
    await admin.from('leaders').insert({ code: 'ZQMA', name: 'Kara dup', is_person: true, can_login: false, person_id: dup });
    await merge(keep, dup);
    expect((await admin.from('leaders').select('person_id, retired_at').eq('code', 'ZQMA').single()).data).toEqual({
      person_id: keep,
      retired_at: null
    });
  });

  it('Merge_TheDuplicatesActiveInitialsWin_WhenThePersonKeptHasOnlyRetiredOnes', async () => {
    const keep = await person('Kara keep');
    const dup = await person('Kara dup');
    await admin.from('leaders').insert([
      { code: 'ZQMK', name: 'Kara keep', is_person: true, can_login: false, person_id: keep, retired_at: '2026-01-01T00:00:00Z' },
      { code: 'ZQMD', name: 'Kara dup', is_person: true, can_login: false, person_id: dup }
    ]);
    await merge(keep, dup);
    const rows = (await admin.from('leaders').select('code, person_id, retired_at').like('code', 'ZQM%').order('code')).data;
    expect(rows).toEqual([
      { code: 'ZQMD', person_id: keep, retired_at: null },
      { code: 'ZQMK', person_id: null, retired_at: '2026-01-01T00:00:00+00:00' }
    ]);
  });

  it('Merge_RetiresAndReleasesTheDuplicatesInitials_WhenThePersonKeptHasTheirOwn', async () => {
    const keep = await person('Kara keep');
    const dup = await person('Kara dup');
    await admin.from('leaders').insert([
      { code: 'ZQMK', name: 'Kara keep', is_person: true, can_login: false, person_id: keep },
      { code: 'ZQMD', name: 'Kara dup', is_person: true, can_login: true, person_id: dup }
    ]);
    await merge(keep, dup);
    const { data } = await admin.from('leaders').select('person_id, archived_person_id, is_person, can_login, retired_at').eq('code', 'ZQMD').single();
    expect({ ...data, retired: data?.retired_at != null, retired_at: undefined }).toEqual({
      person_id: null,
      archived_person_id: dup,
      is_person: false,
      can_login: false,
      retired: true,
      retired_at: undefined
    });
  });
});
