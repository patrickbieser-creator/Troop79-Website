import { describe, it, expect, afterAll } from 'vitest';
import { adminClient } from './helpers/admin-client';
import { TEST_PREFIX } from './helpers/signup-fixtures';

/**
 * people.nickname (2026-10-20): display_name is derived by trigger as
 * nickname-or-first + last for anyone with a first and last name, whoever
 * writes the row; a scout's name mirror follows. Test-owned rows only.
 */
const admin = adminClient();
const LAST = `${TEST_PREFIX}Nick`;

async function person(first: string, extra: Record<string, unknown> = {}) {
  const { data, error } = await admin
    .from('people')
    .insert({ first_name: first, last_name: LAST, display_name: 'whatever', ...extra })
    .select('id, display_name')
    .single();
  if (error || !data) throw new Error(error?.message);
  return data as { id: number; display_name: string };
}
async function displayOf(id: number) {
  const { data } = await admin.from('people').select('display_name').eq('id', id).single();
  return (data as { display_name: string }).display_name;
}

afterAll(async () => {
  const { data } = await admin.from('people').select('id').eq('last_name', LAST);
  const ids = (data ?? []).map((r) => r.id);
  if (ids.length) {
    await admin.from('scouts').delete().in('person_id', ids);
    await admin.from('people').delete().in('id', ids);
  }
  await admin.from('people').delete().like('display_name', `${TEST_PREFIX} Guest%`);
});

describe('display name from nickname', () => {
  it('NewPerson_IsShownByFirstAndLast_WhenNoNickname', async () => {
    expect((await person('Rebecca')).display_name).toBe(`Rebecca ${LAST}`);
  });

  it('NewPerson_IsShownByNickname_WhenSet', async () => {
    expect((await person('Rebecca', { nickname: 'Becky' })).display_name).toBe(`Becky ${LAST}`);
  });

  it('Leader_SettingANickname_UpdatesTheDisplayName', async () => {
    const p = await person('Nathaniel');
    await admin.from('people').update({ nickname: 'Nate' }).eq('id', p.id);
    expect(await displayOf(p.id)).toBe(`Nate ${LAST}`);
  });

  it('Leader_ClearingANickname_FallsBackToFirstName', async () => {
    const p = await person('Robert', { nickname: 'Robbie' });
    await admin.from('people').update({ nickname: '  ' }).eq('id', p.id);
    expect(await displayOf(p.id)).toBe(`Robert ${LAST}`);
  });

  it('Writer_CannotSetADisplayNameThatDisagreesWithTheName', async () => {
    const p = await person('Winnefred', { nickname: 'Winnie' });
    await admin.from('people').update({ display_name: 'Someone Else' }).eq('id', p.id);
    expect(await displayOf(p.id)).toBe(`Winnie ${LAST}`);
  });

  it('Guest_WithNoFirstOrLastName_KeepsTheirGivenName', async () => {
    const { data } = await admin
      .from('people')
      .insert({ display_name: `${TEST_PREFIX} Guest Chase's Mom` })
      .select('display_name')
      .single();
    expect(data?.display_name).toBe(`${TEST_PREFIX} Guest Chase's Mom`);
  });

  it('Leader_Name_FollowsANicknameOnlyUpdate', async () => {
    const p = await person('Michael');
    const code = `ZZ${p.id}`;
    await admin.from('leaders').insert({ code, name: 'x', role: 'Test', is_person: true, person_id: p.id });
    await admin.from('people').update({ nickname: 'Mike' }).eq('id', p.id);
    const { data } = await admin.from('leaders').select('name').eq('code', code).single();
    await admin.from('leaders').delete().eq('code', code);
    expect(data?.name).toBe(`Mike ${LAST}`);
  });

  it('Scout_NameMirror_FollowsTheNickname', async () => {
    const p = await person('Aditya');
    const scoutId = `ZZ${p.id}`.slice(0, 8);
    await admin.from('scouts').insert({ id: scoutId, first_name: 'Aditya', last_name: LAST, display_name: 'x', person_id: p.id, active: true });
    await admin.from('people').update({ nickname: 'Adi' }).eq('id', p.id);
    const { data } = await admin.from('scouts').select('display_name').eq('id', scoutId).single();
    expect(data?.display_name).toBe(`Adi ${LAST}`);
  });
});
