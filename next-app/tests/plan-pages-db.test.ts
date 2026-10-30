import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { adminClient } from './helpers/admin-client';
import { TEST_PREFIX } from './helpers/signup-fixtures';
import { hashSecret } from '../src/lib/identity-challenge';
import { inviteExpiresAt } from '../src/lib/meeting-invites';
import { claimPlanPage, claimPlanPageTeacher, inspectPlanPage, mintPlanPage, revokePlanPages, supersedeOlderPlanPages } from '../src/lib/plan-pages';
import { familyWrite, uncachedLists } from '../src/lib/family-week';
import { PLAN_MAX } from '../src/lib/family-week-shared';
import { fetchAdvancementCatalog } from '../src/lib/advancement-catalog';

/**
 * Meeting Planner III, the plan's family link (/i/plan/<token>; qa-lead 2026-10-28).
 * Real local database. Test-owned rows only: a 2085 meeting (its links, picks and answers cascade with it).
 * A real parent and their scout are only read; their answers on the 2085 meeting go with it.
 */
const sb = adminClient();
let meeting = 0;
let parent = 0;
let scout = 0;
let otherScout = 0;
let epoch = 0;
const MEETING_DATE = '2085-03-04';

async function mint(opts: { expiresAt?: string; scouts?: number[] } = {}) {
  return mintPlanPage(sb, { entryId: meeting, recipientId: parent, epoch, scoutIds: opts.scouts ?? [scout], expiresAt: opts.expiresAt ?? inviteExpiresAt(MEETING_DATE) });
}
async function row(id: number) {
  const { data } = await sb.from('meeting_plan_pages').select('*').eq('id', id).single();
  return data as Record<string, unknown>;
}

beforeAll(async () => {
  await sb.from('calendar_entries').delete().like('title', `%${TEST_PREFIX}%`).gte('entry_date', '2085-01-01').lte('entry_date', '2085-12-31');
  const { data, error } = await sb.from('calendar_entries').insert({ entry_date: MEETING_DATE, category: 'Troop Meeting', title: `Troop Meeting ${TEST_PREFIX} PP` }).select('id').single();
  if (error) throw new Error(error.message);
  meeting = data!.id as number;
  // A real parent of an active scout, and another active scout who isn't theirs.
  const { data: active } = await sb.from('scouts').select('person_id').eq('active', true).not('person_id', 'is', null);
  const activeIds = ((active ?? []) as { person_id: number }[]).map((r) => r.person_id);
  const { data: rels } = await sb.from('relationships').select('person_id, related_person_id').eq('type', 'parent_of').in('related_person_id', activeIds);
  const rel = ((rels ?? []) as { person_id: number; related_person_id: number }[])[0];
  parent = rel.person_id;
  scout = rel.related_person_id;
  otherScout = activeIds.find((id) => id !== scout && !((rels ?? []) as { person_id: number; related_person_id: number }[]).some((r) => r.person_id === parent && r.related_person_id === id))!;
  const { data: p } = await sb.from('people').select('session_epoch').eq('id', parent).single();
  epoch = (p as { session_epoch: number }).session_epoch;
});

afterAll(async () => {
  await sb.from('meeting_topic_teachers').delete().eq('calendar_entry_id', meeting);
  await sb.from('meeting_classes').delete().eq('calendar_entry_id', meeting);
  await sb.from('meeting_topics').delete().eq('calendar_entry_id', meeting);
  await sb.from('calendar_entries').delete().eq('id', meeting);
});

describe('the family link', () => {
  it('RawToken_IsNeverStored_OnlyItsPepperedHash', async () => {
    const page = await mint();
    const r = await row(page.id);
    expect([r.token_hash === page.token, r.token_hash === (await hashSecret(page.token))]).toEqual([false, true]);
  });

  it('Token_ExpiresAt6pmCentral_OnTheMeetingDay', async () => {
    const page = await mint();
    expect(new Date(String((await row(page.id)).expires_at)).toISOString()).toBe(new Date(inviteExpiresAt(MEETING_DATE)).toISOString());
  });

  it('GET_WritesNothing_AndChangesNoState', async () => {
    const page = await mint();
    const before = await row(page.id);
    await inspectPlanPage(sb, page.token);
    expect(await row(page.id)).toEqual(before);
  });

  it('OpenLink_ShowsOnlyItsOwnScouts', async () => {
    const page = await mint();
    expect((await inspectPlanPage(sb, page.token)).page?.scoutIds).toEqual([scout]);
  });

  it('UnknownExpiredAndRevokedLinks_AllReadClosed', async () => {
    const expired = await mint({ expiresAt: '2001-01-01T00:00:00Z' });
    const states = [(await inspectPlanPage(sb, 'f'.repeat(64))).state, (await inspectPlanPage(sb, expired.token)).state];
    expect(states).toEqual(['closed', 'closed']);
  });

  it('WriteAfterExpiry_IsRejected', async () => {
    const expired = await mint({ expiresAt: '2001-01-01T00:00:00Z' });
    expect(await claimPlanPage(sb, expired.token, scout)).toEqual({ ok: false, state: 'expired' });
  });

  it('Token_CannotAnswerForAnotherHouseholdsScout', async () => {
    const page = await mint();
    expect(await claimPlanPage(sb, page.token, otherScout)).toEqual({ ok: false, state: 'scope' });
  });

  it('Claim_RefusesAScoutTheRecipientMayNoLongerAnswerFor', async () => {
    // The scout is on the link, but the recipient isn't (or is no longer) in their household: the household rule wins.
    const page = await mintPlanPage(sb, { entryId: meeting, recipientId: parent, epoch, scoutIds: [scout, otherScout], expiresAt: inviteExpiresAt(MEETING_DATE) });
    expect(await claimPlanPage(sb, page.token, otherScout)).toEqual({ ok: false, state: 'scope' });
  });

  it('Claim_CountsTheWrite', async () => {
    const page = await mint();
    await claimPlanPage(sb, page.token, scout);
    expect((await row(page.id)).write_count).toBe(1);
  });

  it('Republish_SupersedesThePreviousLink', async () => {
    const old = await mint();
    const next = await mint();
    await supersedeOlderPlanPages(sb, { id: next.id, entryId: meeting, recipientId: parent });
    expect([(await claimPlanPage(sb, old.token, scout)).ok, (await claimPlanPage(sb, next.token, scout)).ok]).toEqual([false, true]);
  });

  it('Revoke_ClosesEveryOpenLinkOfTheMeeting', async () => {
    const page = await mint();
    await revokePlanPages(sb, meeting);
    expect((await claimPlanPage(sb, page.token, scout)).ok).toBe(false);
  });
});

describe('family writes', () => {
  it('FamilyWrite_RequestsAtOnce_CannotPassFourThings', async () => {
    const catalog = await fetchAdvancementCatalog(sb as never);
    await sb.from('meeting_scout_suggestions').delete().eq('calendar_entry_id', meeting).eq('person_id', scout);
    const lists = await uncachedLists(sb);
    const keys = await requestableKeys(catalog, 6, PLAN_MAX + 2);
    const w = { meeting: { entryId: meeting, date: MEETING_DATE }, actorPersonId: parent, scoutPersonId: scout, catalog };
    await Promise.all(keys.map((key) => familyWrite(sb, w, { op: 'suggest', key, on: true }, { lists })));
    const { count } = await sb.from('meeting_scout_suggestions').select('topic_key', { count: 'exact', head: true }).eq('calendar_entry_id', meeting).eq('person_id', scout);
    expect(count! <= PLAN_MAX).toBe(true);
  });

  it('FamilyWrite_RefusesRequest_OverSixtyMinutes', async () => {
    const catalog = await fetchAdvancementCatalog(sb as never);
    await sb.from('meeting_scout_suggestions').delete().eq('calendar_entry_id', meeting).eq('person_id', scout);
    const w = { meeting: { entryId: meeting, date: MEETING_DATE }, actorPersonId: parent, scoutPersonId: scout, catalog };
    const lists = await uncachedLists(sb);
    // Two whole badges: 45 minutes each.
    const keys = await requestableKeys(catalog, 0, 2);
    const results = [];
    for (const key of keys) results.push(await familyWrite(sb, w, { op: 'suggest', key, on: true }, { lists }));
    expect([results[0].ok, results[1].ok ? '' : (results[1] as { error: string }).error]).toEqual([true, expect.stringMatching(/^That needs 45 min, and .+ plan has 15 left\.$/)]);
  });

  it('Family_CannotSuggest_SomethingOffTheList', async () => {
    const catalog = await fetchAdvancementCatalog(sb as never);
    const w = { meeting: { entryId: meeting, date: MEETING_DATE }, actorPersonId: parent, scoutPersonId: scout, catalog };
    expect((await familyWrite(sb, w, { op: 'suggest', key: 'ff:anything', on: true }, { lists: await uncachedLists(sb) })).ok).toBe(false);
  });

  it('Family_CannotUntick_ARequirementNotInTheirPlan', async () => {
    const catalog = await fetchAdvancementCatalog(sb as never);
    const w = { meeting: { entryId: meeting, date: MEETING_DATE }, actorPersonId: parent, scoutPersonId: scout, catalog };
    expect((await familyWrite(sb, w, { op: 'item', key: 'tenderfoot-1a', on: false }, { lists: await uncachedLists(sb) })).ok).toBe(false);
  });

  it('Answer_IsSavedForTheScout', async () => {
    const catalog = await fetchAdvancementCatalog(sb as never);
    await familyWrite(sb, { meeting: { entryId: meeting, date: MEETING_DATE }, actorPersonId: parent, scoutPersonId: scout, catalog }, { op: 'answer', choice: 'out' });
    const { data } = await sb.from('meeting_intents').select('intent').eq('calendar_entry_id', meeting).eq('person_id', scout).single();
    expect((data as { intent: string }).intent).toBe('not_coming');
  });

  it('Answer_ChangeReadsComing', async () => {
    const catalog = await fetchAdvancementCatalog(sb as never);
    await familyWrite(sb, { meeting: { entryId: meeting, date: MEETING_DATE }, actorPersonId: parent, scoutPersonId: scout, catalog }, { op: 'answer', choice: 'change' });
    const { data } = await sb.from('meeting_intents').select('intent').eq('calendar_entry_id', meeting).eq('person_id', scout).single();
    expect((data as { intent: string }).intent).toBe('coming');
  });

  it('NotSureYet_ClearsTheAnswer_KeepsTheHelperRow', async () => {
    const catalog = await fetchAdvancementCatalog(sb as never);
    const w = { meeting: { entryId: meeting, date: MEETING_DATE }, actorPersonId: parent, scoutPersonId: scout, catalog };
    await familyWrite(sb, w, { op: 'answer', choice: 'ok' });
    await sb.from('meeting_scout_helpers').insert({ calendar_entry_id: meeting, person_id: scout, group_key: 'fr:tenderfoot', set_by_person_id: parent });
    await familyWrite(sb, w, { op: 'unsure' });
    const [{ data }, { count }] = await Promise.all([
      sb.from('meeting_intents').select('intent').eq('calendar_entry_id', meeting).eq('person_id', scout).single(),
      sb.from('meeting_scout_helpers').select('person_id', { count: 'exact', head: true }).eq('calendar_entry_id', meeting).eq('person_id', scout)
    ]);
    expect([(data as { intent: string }).intent, count]).toEqual(['undecided', 1]);
  });
});

/** Badges the scout hasn't earned: always on their own pick list, so always suggestable. */
async function requestableKeys(catalog: Awaited<ReturnType<typeof fetchAdvancementCatalog>>, from: number, n: number): Promise<string[]> {
  const { data: sid } = await sb.from('scouts').select('id').eq('person_id', scout).single();
  const { data: earned } = await sb.from('mb_progress').select('mb_id').eq('scout_id', (sid as { id: string }).id).eq('awarded', true);
  const done = new Set(((earned ?? []) as { mb_id: string }[]).map((r) => r.mb_id));
  return catalog.meritBadges.filter((m) => !done.has(m.id)).slice(from, from + n).map((m) => `mb:${m.id}`);
}

/** F5 (Plans/Meeting-Planner-III-Family.md): a link can also carry its recipient's teacher card. */
describe('the teacher link', () => {
  const teacherLink = (scouts: number[] = []) =>
    mintPlanPage(sb, { entryId: meeting, recipientId: parent, epoch, scoutIds: scouts, expiresAt: inviteExpiresAt(MEETING_DATE), asTeacher: true });

  it('ScoutOnlyLink_CannotWriteAsTeacher', async () => {
    const page = await mint();
    expect(await claimPlanPageTeacher(sb, page.token)).toEqual({ ok: false, state: 'scope' });
  });

  it('TeacherLink_ClaimsForItsRecipient', async () => {
    const page = await teacherLink();
    expect(await claimPlanPageTeacher(sb, page.token)).toEqual({ ok: true, pageId: page.id, entryId: meeting, recipientId: parent });
  });

  it('TeacherLink_WithNoScouts_IsAllowedOnlyWithAsTeacher', async () => {
    const asTeacher = await teacherLink();
    const scoutsOnly = await sb
      .from('meeting_plan_pages')
      .insert({ calendar_entry_id: meeting, recipient_person_id: parent, recipient_epoch: epoch, token_hash: 'e'.repeat(64), scout_person_ids: [], expires_at: inviteExpiresAt(MEETING_DATE) });
    expect([(await inspectPlanPage(sb, asTeacher.token)).page?.asTeacher, scoutsOnly.error?.message]).toEqual([true, expect.stringMatching(/meeting_plan_pages_scout_person_ids_check/)]);
  });

  it('TeacherClaim_RefusesExpiredSupersededRevoked', async () => {
    const expired = await mintPlanPage(sb, { entryId: meeting, recipientId: parent, epoch, scoutIds: [], expiresAt: '2001-01-01T00:00:00Z', asTeacher: true });
    const old = await teacherLink();
    const next = await teacherLink();
    await supersedeOlderPlanPages(sb, { id: next.id, entryId: meeting, recipientId: parent });
    const before = [(await claimPlanPageTeacher(sb, expired.token)).ok, (await claimPlanPageTeacher(sb, old.token)).ok];
    await revokePlanPages(sb, meeting);
    expect([...before, (await claimPlanPageTeacher(sb, next.token)).ok]).toEqual([false, false, false]);
  });

  it('TeacherAndScoutWrites_ShareTheWriteLimit', async () => {
    const page = await teacherLink([scout]);
    await sb.from('meeting_plan_pages').update({ write_count: 199 }).eq('id', page.id);
    const scoutWrite = await claimPlanPage(sb, page.token, scout);
    expect([scoutWrite.ok, await claimPlanPageTeacher(sb, page.token)]).toEqual([true, { ok: false, state: 'limit' }]);
  });
});
