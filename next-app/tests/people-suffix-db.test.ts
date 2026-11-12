import { describe, it, expect, afterAll } from 'vitest';
import { adminClient } from './helpers/admin-client';
import { TEST_PREFIX } from './helpers/signup-fixtures';

/**
 * people.suffix (2026-11-12): "Sr.", "Jr.", "III". The derived display name is
 * nickname-or-first + last + suffix, and a suffix-only change reaches the
 * leader name and the scouts mirror like any other name change. Test-owned
 * rows only.
 */
const admin = adminClient();
const LAST = `${TEST_PREFIX}Suffix`;

async function person(first: string, extra: Record<string, unknown> = {}) {
  const { data, error } = await admin
    .from('people')
    .insert({ first_name: first, last_name: LAST, display_name: 'whatever', ...extra })
    .select('id, display_name, suffix')
    .single();
  if (error || !data) throw new Error(error?.message);
  return data as { id: number; display_name: string; suffix: string | null };
}
async function displayOf(id: number) {
  const { data } = await admin.from('people').select('display_name').eq('id', id).single();
  return (data as { display_name: string }).display_name;
}

afterAll(async () => {
  const { data } = await admin.from('people').select('id').eq('last_name', LAST);
  const ids = (data ?? []).map((r) => r.id);
  if (ids.length) {
    await admin.from('leaders').delete().in('person_id', ids);
    await admin.from('scouts').delete().in('person_id', ids);
    await admin.from('people').delete().in('id', ids);
  }
});

describe('name suffix', () => {
  it('NewPerson_WithASuffix_IsShownAfterTheLastName', async () => {
    expect((await person('Gabe', { suffix: 'Sr.' })).display_name).toBe(`Gabe ${LAST} Sr.`);
  });

  it('NewPerson_WithANicknameAndSuffix_ShowsBoth', async () => {
    expect((await person('Robert', { nickname: 'Bob', suffix: 'Jr.' })).display_name).toBe(`Bob ${LAST} Jr.`);
  });

  it('Suffix_IsTrimmed', async () => {
    expect((await person('Henry', { suffix: '  III ' })).suffix).toBe('III');
  });

  it('BlankSuffix_IsStoredAsNull', async () => {
    expect((await person('Thomas', { suffix: '   ' })).suffix).toBeNull();
  });

  it('Leader_SettingASuffix_UpdatesTheDisplayName', async () => {
    const p = await person('Walter');
    await admin.from('people').update({ suffix: 'Jr.' }).eq('id', p.id);
    expect(await displayOf(p.id)).toBe(`Walter ${LAST} Jr.`);
  });

  it('Leader_ClearingASuffix_DropsItFromTheDisplayName', async () => {
    const p = await person('Arthur', { suffix: 'Sr.' });
    await admin.from('people').update({ suffix: null }).eq('id', p.id);
    expect(await displayOf(p.id)).toBe(`Arthur ${LAST}`);
  });

  it('Suffix_LongerThanTenCharacters_IsRefused', async () => {
    const { error } = await admin
      .from('people')
      .insert({ first_name: 'Long', last_name: LAST, display_name: 'x', suffix: 'Esquire the Third' });
    expect(error).not.toBeNull();
  });

  it('LeaderName_FollowsASuffixOnlyUpdate', async () => {
    const p = await person('Edward');
    const code = `ZS${p.id}`;
    await admin.from('leaders').insert({ code, name: 'x', role: 'Test', is_person: true, person_id: p.id });
    await admin.from('people').update({ suffix: 'Sr.' }).eq('id', p.id);
    const { data } = await admin.from('leaders').select('name').eq('code', code).single();
    await admin.from('leaders').delete().eq('code', code);
    expect(data?.name).toBe(`Edward ${LAST} Sr.`);
  });
});
