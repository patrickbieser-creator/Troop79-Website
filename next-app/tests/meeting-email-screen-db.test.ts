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

describe('already emailed (qa-lead E3 #2)', () => {
  it('Queue_RefusesAFamilyAlreadyEmailed', async () => {
    await sb.from('meeting_emails').insert({ calendar_entry_id: meeting, kind: 'plan', batch_id: '00000000-0000-4000-8000-0000000000aa', recipient_person_id: parent, sent_to: parentEmail, about: { scouts: [scout] }, status: 'sent' });
    const r = await queue([{ kind: 'plan', recipientId: parent, scoutIds: [scout] }]);
    await sb.from('meeting_emails').delete().eq('calendar_entry_id', meeting);
    expect([r.ok && r.emails.length, r.ok && r.refused.length]).toEqual([0, 1]);
  }, 60_000);

  it('Queue_AllowsADeliberateResend', async () => {
    await sb.from('meeting_emails').insert({ calendar_entry_id: meeting, kind: 'plan', batch_id: '00000000-0000-4000-8000-0000000000ab', recipient_person_id: parent, sent_to: parentEmail, about: { scouts: [scout] }, status: 'sent' });
    const r = await queue([{ kind: 'plan', recipientId: parent, scoutIds: [scout], resend: true }]);
    await sb.from('meeting_emails').delete().eq('calendar_entry_id', meeting);
    expect(r.ok && r.emails.length).toBe(1);
  }, 60_000);

  it('Queue_RefusesAMalformedRecipient', async () => {
    const r = await queue([{ kind: 'plan', recipientId: 'x' as unknown as number, scoutIds: [scout] }]);
    expect(r.ok).toBe(false);
  }, 60_000);
});

/** F5: a household email's link carries the recipient's teacher card when they may teach on the meeting date. */
describe('the plan link for someone who teaches', () => {
  const youth: number[] = [];
  const asTeacherOf = async (html: string) => {
    const token = /\/i\/plan\/([0-9a-f]{64})/.exec(html)?.[1];
    if (!token) return null;
    const { inspectPlanPage } = await import('../src/lib/plan-pages');
    const page = (await inspectPlanPage(sb, token)).page;
    return page ? { asTeacher: page.asTeacher, scouts: page.scoutIds } : null;
  };
  const base = (o: Partial<EmailRow>): EmailRow => ({
    id: 1,
    calendar_entry_id: meeting,
    kind: 'plan',
    batch_id: '00000000-0000-4000-8000-000000000019',
    recipient_person_id: parent,
    sent_to: parentEmail,
    about: { scouts: [scout] },
    plan_sent: { [String(scout)]: { name: 'Lily', kind: 'rank', group: 'fr:second-class', groupName: 'Second Class', teachers: [], items: [], helpName: null } },
    subject: null,
    body_md_override: null,
    status: 'sending',
    failure: null,
    ...o
  });

  afterAll(async () => {
    await sb.from('scouts').delete().in('person_id', youth);
    await sb.from('people').delete().in('id', youth);
  });

  it('ParentWhoTeaches_PlanLinkHasAsTeacher', async () => {
    const p = await prepareEmail(sb, base({}), { meeting: { entryId: meeting, date: DATE }, focus: 'First aid' });
    expect(await asTeacherOf(p.html)).toEqual({ asTeacher: true, scouts: [scout] });
  });

  it('AdultReminder_MintsTeacherOnlyPlanLink', async () => {
    const p = await prepareEmail(sb, base({ kind: 'reminder', about: { scouts: [] }, plan_sent: {} }), { meeting: { entryId: meeting, date: DATE }, focus: 'First aid' });
    expect(await asTeacherOf(p.html)).toEqual({ asTeacher: true, scouts: [] });
  });

  // Every active adult may teach (loadTeacherPeople), so the recipient who can't is a scout who isn't a Junior Leader,
  // emailed at their own address.
  it('RecipientWhoCannotTeach_PlanLinkIsScoutsOnly', async () => {
    const { data: who } = await sb.from('people').insert({ display_name: `${TEST_PREFIX} E3 Young`, first_name: `${TEST_PREFIX} E3`, last_name: 'Young' }).select('id').single();
    const young = (who as { id: number }).id;
    youth.push(young);
    await sb.from('scouts').insert({ id: `vitest-e3-${young}`, first_name: `${TEST_PREFIX} E3`, last_name: 'Young', display_name: `${TEST_PREFIX} E3 Young`, person_id: young, active: true, current_rank: 'scout' });
    const row = base({ recipient_person_id: young, about: { scouts: [young] }, plan_sent: { [String(young)]: { name: 'Young', kind: 'rank', group: 'fr:tenderfoot', groupName: 'Tenderfoot', teachers: [], items: [], helpName: null } } });
    const p = await prepareEmail(sb, row, { meeting: { entryId: meeting, date: DATE }, focus: 'First aid' });
    expect(await asTeacherOf(p.html)).toEqual({ asTeacher: false, scouts: [young] });
  });
});
