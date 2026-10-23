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

  it('Reminder_ToTwoScoutsOfOneParent_IsOneEmailToTheParent', async () => {
    const r = await made([older, younger]);
    expect(r.recipients.filter((x) => x.recipientId === parent)).toHaveLength(1);
  });

  it('Reminder_ToTwoScoutsOfOneParent_NamesBothScouts', async () => {
    const r = await made([older, younger]);
    expect(r.recipients.find((x) => x.recipientId === parent)?.people.map((p) => p.personId).sort()).toEqual([older, younger].sort());
  });
});

describe('who is skipped', () => {
  const answered = () => sb.from('meeting_intents').insert({ calendar_entry_id: meeting, person_id: younger, intent: 'not_coming', entered_by_person_id: parent });

  it('Reminder_SendsNothing_WhenPersonAlreadyAnswered', async () => {
    await answered();
    expect((await made([younger])).recipients).toEqual([]);
  });

  it('Reminder_SaysAlreadyAnswered_WhenPersonAlreadyAnswered', async () => {
    await answered();
    expect((await made([younger])).skipped.map((s) => s.reason)).toEqual(['already answered']);
  });

  it('Reminder_SendsNothing_WhenSentWithin24Hours', async () => {
    await made([younger]);
    expect((await made([younger])).recipients).toEqual([]);
  });

  it('Reminder_SaysRemindedLately_WhenSentWithin24Hours', async () => {
    await made([younger]);
    expect((await made([younger])).skipped.map((s) => s.reason)).toEqual(['reminded in the last 24 hours']);
  });
});

describe('the 24-hour dedupe holds in the database (qa-lead, P5b)', () => {
  const remindRows = async () => ((await sb.from('meeting_invites').select('id').eq('calendar_entry_id', meeting).eq('kind', 'remind').eq('invitee_person_id', younger)).data ?? []).length;

  it('Reminder_IsMintedOnce_WhenTwoSendsRace', async () => {
    await Promise.all([remind([younger]), remind([younger])]);
    expect(await remindRows()).toBe(1);
  });

  it('MintReminders_InsertsNothing_ForSomeoneRemindedWithin24Hours', async () => {
    await made([younger]);
    const row = { invitee_person_id: younger, recipient_person_id: parent, sent_to: 'x@example.com', invitee_epoch: 0, recipient_epoch: 0, expires_at: new Date(Date.now() + 86400_000).toISOString(), sent_by: null };
    const { data } = await sb.rpc('meeting_mint_reminders', { p_entry: meeting, p_since: new Date(Date.now() - 86400_000).toISOString(), p_rows: [row] });
    expect(data).toEqual([]);
  });
});

describe('a reminder row is not an invite', () => {
  const row = (o: Record<string, unknown>) => ({
    calendar_entry_id: meeting,
    topic_key: 'reminder',
    kind: 'remind',
    invitee_person_id: younger,
    recipient_person_id: parent,
    sent_to: 'x@example.com',
    invitee_epoch: 0,
    recipient_epoch: 0,
    token_hash: null,
    expires_at: new Date().toISOString(),
    ...o
  });

  it('Board_IgnoresReminderRows_WhenCountingInvites', async () => {
    await made([younger]);
    expect(await loadInviteRows(sb, meeting)).toEqual([]);
  });

  it('Reminder_Row_CarriesNoToken', async () => {
    await made([younger]);
    const { data } = await sb.from('meeting_invites').select('kind, topic_key, token_hash').eq('calendar_entry_id', meeting);
    expect(data).toEqual([{ kind: 'remind', topic_key: 'reminder', token_hash: null }]);
  });

  it('Reminder_Row_IsUnknown_ToTheLinkReader', async () => {
    await made([younger]);
    expect((await inspectInvite(sb, '0'.repeat(64))).state).toBe('unknown');
  });

  it('Reminder_Row_CannotBeAnswered_ByAnyToken', async () => {
    await made([younger]);
    expect((await respondToInvite(sb, '0'.repeat(64), 'accept', { loadCatalog: catalog })).ok).toBe(false);
  });

  it('Reminder_Row_WithAToken_IsRejected', async () => {
    const { error } = await sb.from('meeting_invites').insert(row({ token_hash: 'f'.repeat(64) }));
    expect(error?.message).toMatch(/meeting_invites_token_or_page/);
  });

  it('InviteRow_WithNoToken_IsRejected', async () => {
    const { error } = await sb.from('meeting_invites').insert(row({ kind: 'teach', topic_key: 'tenderfoot-1a' }));
    expect(error?.message).toMatch(/meeting_invites_token_or_page/);
  });
});
