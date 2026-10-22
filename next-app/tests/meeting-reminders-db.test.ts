import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { adminClient } from './helpers/admin-client';
import { TEST_PREFIX } from './helpers/signup-fixtures';
import { fetchAdvancementCatalog } from '../src/lib/advancement-catalog';
import { createReminders, inspectInvite, loadInviteRows, respondToInvite } from '../src/lib/meeting-invites-db';

/**
 * Meeting Planner P5b: reminders (Plans/Meeting-Planner-II.md Decision 11). A reminder rides the meeting_invites
 * pipeline as kind 'remind' with NO token: it links to /member/meeting, so it can never be redeemed, and the board's
 * "who did we ask" counts never see it. Real local database; test-owned rows only (a 2092 meeting deleted by id, its
 * intents and invites deleted by entry; fixture people, scouts, households and relationships deleted by id).
 */
const sb = adminClient();
const catalog = () => fetchAdvancementCatalog(sb);

let meeting = 0;
let older = 0; // 14 at the meeting, verified own address
let younger = 0; // 11 at the meeting
let parent = 0; // in the household, parent_of both
const people: number[] = [];
const scoutIds: string[] = [];
const households: number[] = [];

async function person(label: string, o: { email?: string; verified?: boolean; birthdate?: string } = {}): Promise<number> {
  const { data, error } = await sb
    .from('people')
    .insert({ display_name: `${TEST_PREFIX} REM ${label}`, first_name: TEST_PREFIX, last_name: `REM ${label}`, birthdate: o.birthdate ?? null, active: true })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  const id = data!.id as number;
  people.push(id);
  if (o.email) {
    const { error: e2 } = await sb.from('person_emails').insert({ person_id: id, email: o.email, is_primary: true, verified_at: o.verified ? new Date().toISOString() : null });
    if (e2) throw new Error(e2.message);
  }
  return id;
}
async function scout(id: number): Promise<void> {
  const sid = `vitest-rem-${id}`;
  const { error } = await sb.from('scouts').insert({ id: sid, first_name: TEST_PREFIX, last_name: `REM ${id}`, display_name: `${TEST_PREFIX} REM ${id}`, person_id: id, active: true, current_rank: 'scout' });
  if (error) throw new Error(error.message);
  scoutIds.push(sid);
}

beforeAll(async () => {
  const { data, error } = await sb.from('calendar_entries').insert({ entry_date: '2092-11-02', category: 'Troop Meeting', title: `Troop Meeting ${TEST_PREFIX}` }).select('id').single();
  if (error) throw new Error(error.message);
  meeting = data!.id;
  older = await person('Older', { email: `zzvitest-rem-older-${process.pid}@example.com`, verified: true, birthdate: '2078-01-01' });
  younger = await person('Younger', { email: `zzvitest-rem-younger-${process.pid}@example.com`, verified: true, birthdate: '2081-01-01' });
  parent = await person('Parent', { email: `zzvitest-rem-parent-${process.pid}@example.com` });
  for (const id of [older, younger]) await scout(id);
  const { data: h } = await sb.from('households').insert({ label: `${TEST_PREFIX} REM family` }).select('id').single();
  households.push(h!.id);
  await sb.from('household_members').insert([older, younger, parent].map((person_id) => ({ household_id: h!.id, person_id })));
  await sb.from('relationships').insert([older, younger].map((related_person_id) => ({ person_id: parent, related_person_id, type: 'parent_of' })));
});

afterEach(async () => {
  await sb.from('meeting_invites').delete().eq('calendar_entry_id', meeting);
  await sb.from('meeting_intents').delete().eq('calendar_entry_id', meeting);
});

afterAll(async () => {
  await sb.from('calendar_entries').delete().eq('id', meeting);
  await sb.from('relationships').delete().in('person_id', people);
  await sb.from('household_members').delete().in('household_id', households);
  await sb.from('households').delete().in('id', households);
  await sb.from('scouts').delete().in('id', scoutIds);
  await sb.from('person_emails').delete().in('person_id', people);
  await sb.from('people').delete().in('id', people);
});

const remind = (ids: number[]) => createReminders(sb, { entryId: meeting, personIds: ids, sentBy: null }, { loadCatalog: catalog });
const made = async (ids: number[]) => {
  const r = await remind(ids);
  if (!r.ok) throw new Error(r.error);
  return r;
};

describe('who a reminder reaches', () => {
  it('Reminder_ToScout_GoesToParents', async () => {
    const r = await made([younger]);
    expect(r.recipients.map((x) => [x.recipientId, x.isScout])).toEqual([[parent, false]]);
  });

  it('Reminder_ToThirteenPlusVerifiedScout_AlsoGoesToScout', async () => {
    const r = await made([older]);
    expect(r.recipients.map((x) => [x.recipientId, x.isScout]).sort()).toEqual(
      [
        [older, true],
        [parent, false]
      ].sort()
    );
  });

  it('Reminder_ToTwoScoutsOfOneParent_IsOneEmail', async () => {
    const r = await made([older, younger]);
    const toParent = r.recipients.filter((x) => x.recipientId === parent);
    expect([toParent.length, toParent[0]?.people.map((p) => p.personId).sort()]).toEqual([1, [older, younger].sort()]);
  });
});

describe('who is skipped', () => {
  it('Reminder_IsSkipped_WhenPersonAlreadyAnswered', async () => {
    await sb.from('meeting_intents').insert({ calendar_entry_id: meeting, person_id: younger, intent: 'not_coming', entered_by_person_id: parent });
    const r = await made([younger]);
    expect([r.recipients.length, r.skipped.map((s) => s.reason)]).toEqual([0, ['already answered']]);
  });

  it('Reminder_IsSkipped_WhenSentWithin24Hours', async () => {
    await made([younger]);
    const again = await made([younger]);
    expect([again.recipients.length, again.skipped.map((s) => s.reason)]).toEqual([0, ['reminded in the last 24 hours']]);
  });
});

describe('a reminder row is not an invite', () => {
  it('Board_IgnoresReminderRows_WhenCountingInvites', async () => {
    await made([younger]);
    expect(await loadInviteRows(sb, meeting)).toEqual([]);
  });

  it('Reminder_Row_CannotBeRedeemed_ByAnyToken', async () => {
    await made([younger]);
    const { data } = await sb.from('meeting_invites').select('kind, topic_key, token_hash').eq('calendar_entry_id', meeting);
    const answer = await respondToInvite(sb, '0'.repeat(64), 'accept', { loadCatalog: catalog });
    const { error: withToken } = await sb.from('meeting_invites').insert({
      calendar_entry_id: meeting,
      topic_key: 'reminder',
      kind: 'remind',
      invitee_person_id: younger,
      recipient_person_id: parent,
      sent_to: 'x@example.com',
      invitee_epoch: 0,
      recipient_epoch: 0,
      token_hash: 'f'.repeat(64),
      expires_at: new Date().toISOString()
    });
    expect([data, (await inspectInvite(sb, '0'.repeat(64))).state, answer.ok, withToken != null]).toEqual([
      [{ kind: 'remind', topic_key: 'reminder', token_hash: null }],
      'unknown',
      false,
      true
    ]);
  });
});
