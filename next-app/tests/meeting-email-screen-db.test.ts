import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { adminClient } from './helpers/admin-client';
import { TEST_PREFIX } from './helpers/signup-fixtures';
import { fetchAdvancementCatalog } from '../src/lib/advancement-catalog';
import { fetchPeopleLists } from '../src/lib/people-lists';
import { loadBoardScouts } from '../src/lib/meeting-board';
import { loadScoutFamilies, scoutRecipientsMany } from '../src/lib/meeting-invites-db';
import { buildThisWeek } from '../src/lib/this-week';
import { loadThisWeekData } from '../src/lib/this-week-db';
import { buildQueue } from '../src/lib/meeting-email-screen';
import { prepareEmail } from '../src/lib/meeting-email-prepare';
import type { EmailRow } from '../src/lib/meeting-emails';

/**
 * Emails E3: the server re-decides what the screen asks to send (recipients, addresses, plans), and a plan email's
 * link and buttons. Real local families are only read; the meeting (2087) and its links are test-owned and cascade.
 */
const sb = adminClient();
const DATE = '2087-04-06';
let meeting = 0;
let scout = 0;
let parent = 0;
let parentEmail = '';
let other = 0;

beforeAll(async () => {
  await sb.from('calendar_entries').delete().like('title', `%${TEST_PREFIX}%`).eq('entry_date', DATE);
  const { data } = await sb.from('calendar_entries').insert({ entry_date: DATE, category: 'Troop Meeting', title: `Troop Meeting ${TEST_PREFIX} E3`, status: 'published' }).select('id').single();
  meeting = data!.id as number;
  const board = (await loadBoardScouts(sb)).filter((s) => !s.isTest);
  const ids = board.map((s) => s.personId);
  const rec = await scoutRecipientsMany(sb, await loadScoutFamilies(sb, ids), ids, DATE);
  const hit = ids.find((id) => (rec.get(id) ?? []).some((r) => !r.isScout))!;
  scout = hit;
  const p = rec.get(hit)!.find((r) => !r.isScout)!;
  parent = p.recipientId;
  parentEmail = p.sentTo;
  other = ids.find((id) => id !== hit && !(rec.get(id) ?? []).some((r) => r.recipientId === parent))!;
}, 60_000);

afterAll(async () => {
  await sb.from('calendar_entries').delete().eq('id', meeting);
});

async function queue(reqs: Parameters<typeof buildQueue>[5]) {
  const catalog = await fetchAdvancementCatalog(sb as never);
  const lists = await fetchPeopleLists(sb);
  const m = { entryId: meeting, date: DATE };
  const view = buildThisWeek((await loadThisWeekData(sb, m, lists, catalog)).input);
  return buildQueue(sb, m, view, lists, catalog, reqs);
}

describe('the server re-decides the queue', () => {
  it('Queue_UsesTheServersAddress_ForAnAllowedParent', async () => {
    const r = await queue([{ kind: 'plan', recipientId: parent, scoutIds: [scout] }]);
    expect(r.ok && r.emails.map((e) => e.sentTo)).toEqual([parentEmail]);
  }, 60_000);

  it('Queue_RefusesARecipientWhoIsntTheScoutsParent', async () => {
    const r = await queue([{ kind: 'plan', recipientId: parent, scoutIds: [other] }]);
    expect([r.ok && r.emails.length, r.ok && r.refused.length]).toEqual([0, 1]);
  }, 60_000);

  it('Queue_RefusesATeacherInviteForAGroupNotOnThePlan', async () => {
    const r = await queue([{ kind: 'teacher', recipientId: parent, group: 'fr:eagle' }]);
    expect(r.ok && r.emails.length).toBe(0);
  }, 60_000);

  it('Queue_StoresThePlanAsEmailed', async () => {
    const r = await queue([{ kind: 'plan', recipientId: parent, scoutIds: [scout] }]);
    expect(Object.keys((r.ok && r.emails[0].planSent) || {})).toEqual([String(scout)]);
  }, 60_000);
});

describe('a plan email', () => {
  const row = (): EmailRow => ({
    id: 1,
    calendar_entry_id: meeting,
    kind: 'plan',
    batch_id: '00000000-0000-4000-8000-000000000009',
    recipient_person_id: parent,
    sent_to: parentEmail,
    about: { scouts: [scout] },
    plan_sent: { [String(scout)]: { name: 'Lily', kind: 'rank', group: 'fr:second-class', groupName: 'Second Class', teachers: [], items: [{ key: 'second-class-6a', code: '6a', label: 'First aid' }], helpName: null } },
    subject: null,
    body_md_override: null,
    status: 'sending',
    failure: null
  });

  it('PlanEmail_CarriesTheAnswerButtons_OnANewFamilyLink', async () => {
    const p = await prepareEmail(sb, row(), { meeting: { entryId: meeting, date: DATE }, focus: 'First aid' });
    expect(['?a=ok', '?a=change', '?a=out'].every((a) => p.html.includes(a))).toBe(true);
  });

  it('PlanEmail_SaysOpensAreSeen', async () => {
    const p = await prepareEmail(sb, row(), { meeting: { entryId: meeting, date: DATE }, focus: 'First aid' });
    expect(p.text).toContain('Troop 79 can see when this email is opened.');
  });

  it('PlanEmail_Undo_RemovesTheLink', async () => {
    const before = (await sb.from('meeting_plan_pages').select('id', { count: 'exact', head: true }).eq('calendar_entry_id', meeting)).count ?? 0;
    const p = await prepareEmail(sb, row(), { meeting: { entryId: meeting, date: DATE }, focus: 'First aid' });
    await p.undo!();
    expect((await sb.from('meeting_plan_pages').select('id', { count: 'exact', head: true }).eq('calendar_entry_id', meeting)).count).toBe(before);
  });
});
