import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { adminClient } from './helpers/admin-client';
import { TEST_PREFIX } from './helpers/signup-fixtures';

/**
 * Planned, asked, confirmed, C1 (Plans/Meeting-Planner-III-Confirmations.md): the answer tables. An answer moves the
 * board's stamp (open tabs refresh), a merge keeps every answer for the person kept, and the tables stay closed to the
 * public keys. Real local database (migration 20261231970000_meeting_answers). Test-owned rows only.
 */
const sb = adminClient();
let entry = 0;
const people: number[] = [];

async function person(label: string): Promise<number> {
  const { data, error } = await sb
    .from('people')
    .insert({ display_name: `${TEST_PREFIX} ANS ${label}`, first_name: TEST_PREFIX, last_name: `ANS ${label}`, active: true })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  people.push(data!.id as number);
  return data!.id as number;
}
const stamp = async () => (await sb.rpc('meeting_board_stamp', { p_entry: entry })).data as string;

beforeAll(async () => {
  await sb.from('calendar_entries').delete().like('title', `%${TEST_PREFIX} ANS%`).eq('entry_date', '2088-03-05');
  const { data, error } = await sb.from('calendar_entries').insert({ entry_date: '2088-03-05', category: 'Troop Meeting', title: `Troop Meeting ${TEST_PREFIX} ANS` }).select('id').single();
  if (error) throw new Error(error.message);
  entry = data!.id as number;
});

afterAll(async () => {
  if (entry) await sb.from('calendar_entries').delete().eq('id', entry);
  if (people.length) await sb.from('people').delete().in('id', people);
});

describe('answer tables', () => {
  it('ATeacherAnswer_MovesTheBoardStamp', async () => {
    const who = await person('Stamp');
    const before = await stamp();
    const { error } = await sb.from('meeting_teacher_answers').insert({ calendar_entry_id: entry, person_id: who, group_key: 'fr:scout', answer: 'yes', answered_plan: { group: 'fr:scout', itemKeys: ['scout-1a'], title: 'Scout group' } });
    expect([error, (await stamp()) !== before]).toEqual([null, true]);
  });

  it('AScoutAnswer_MovesTheBoardStamp', async () => {
    const who = await person('Scout');
    const before = await stamp();
    const { error } = await sb.from('meeting_scout_answers').insert({ calendar_entry_id: entry, person_id: who, answered_plan: { name: 'X', kind: 'rank', group: 'fr:scout', groupName: 'Scout', teachers: [], items: [], helpName: null } });
    expect([error, (await stamp()) !== before]).toEqual([null, true]);
  });

  it('AnAnswerIsYesOrNo', async () => {
    const who = await person('Bad');
    const { error } = await sb.from('meeting_teacher_answers').insert({ calendar_entry_id: entry, person_id: who, group_key: 'fr:scout', answer: 'maybe' });
    expect(error?.message).toMatch(/check/);
  });

  it('Merge_KeepsEveryAnswerForThePersonKept', async () => {
    const [keep, dup] = [await person('Keep'), await person('Dup')];
    await sb.from('meeting_teacher_answers').insert([
      { calendar_entry_id: entry, person_id: dup, group_key: 'fr:tenderfoot', answer: 'yes' },
      { calendar_entry_id: entry, person_id: dup, group_key: 'fr:scout', answer: 'no', note: 'away' },
      { calendar_entry_id: entry, person_id: keep, group_key: 'fr:scout', answer: 'yes' }
    ]);
    const { error } = await sb.rpc('merge_people', { p_survivor: keep, p_loser: dup, p_decided_by: 'vitest' });
    const { data } = await sb.from('meeting_teacher_answers').select('person_id, group_key, answer').eq('calendar_entry_id', entry).in('person_id', [keep, dup]).order('group_key');
    expect([error, data]).toEqual([
      null,
      [
        { person_id: keep, group_key: 'fr:scout', answer: 'yes' },
        { person_id: keep, group_key: 'fr:tenderfoot', answer: 'yes' }
      ]
    ]);
  });

  // A planner can enter a teacher's answer for them (Patrick, 2026-11-01): a merge keeps who entered it.
  it('Merge_KeepsWhoEnteredAnAnswer_OnBothSides', async () => {
    const [keep, dup, leaderKeep, leaderDup] = [await person('EKeep'), await person('EDup'), await person('LKeep'), await person('LDup')];
    await sb.from('meeting_teacher_answers').insert([
      { calendar_entry_id: entry, person_id: dup, group_key: 'fr:first_class', answer: 'yes', entered_by_person_id: leaderKeep },
      { calendar_entry_id: entry, person_id: keep, group_key: 'fr:second_class', answer: 'yes', entered_by_person_id: leaderDup }
    ]);
    const merged = await sb.rpc('merge_people', { p_survivor: keep, p_loser: dup, p_decided_by: 'vitest' });
    await sb.rpc('merge_people', { p_survivor: leaderKeep, p_loser: leaderDup, p_decided_by: 'vitest' });
    const { data } = await sb.from('meeting_teacher_answers').select('person_id, group_key, entered_by_person_id').eq('calendar_entry_id', entry).in('person_id', [keep, dup]).order('group_key');
    expect([merged.error, data]).toEqual([
      null,
      [
        { person_id: keep, group_key: 'fr:first_class', entered_by_person_id: leaderKeep },
        { person_id: keep, group_key: 'fr:second_class', entered_by_person_id: leaderKeep }
      ]
    ]);
  });
});
