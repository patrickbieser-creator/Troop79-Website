import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { adminClient } from './helpers/admin-client';
import { TEST_PREFIX } from './helpers/signup-fixtures';
import { hashSecret } from '../src/lib/identity-challenge';
import { inviteExpiresAt } from '../src/lib/meeting-invites';
import { claimPlanPage, inspectPlanPage, mintPlanPage, revokePlanPages, supersedeOlderPlanPages } from '../src/lib/plan-pages';
import { familyWrite, uncachedLists } from '../src/lib/family-week';
import { SUGGESTION_CAP } from '../src/lib/family-week-shared';
import { fetchAdvancementCatalog } from '../src/lib/advancement-catalog';
import { publishPlan } from '../src/lib/plan-publish';
import type { ThisWeek } from '../src/lib/this-week';

/**
 * Meeting Planner III, the published plan's family link (/i/plan/<token>; qa-lead 2026-10-28) and Publish snapshot.
 * Real local database. Test-owned rows only: a 2085 meeting (its links, snapshots, picks and answers cascade with it).
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
  return mintPlanPage(sb, { entryId: meeting, recipientId: parent, epoch, scoutIds: opts.scouts ?? [scout], snapshotN: 1, expiresAt: opts.expiresAt ?? inviteExpiresAt(MEETING_DATE) });
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
    const page = await mintPlanPage(sb, { entryId: meeting, recipientId: parent, epoch, scoutIds: [scout, otherScout], snapshotN: 1, expiresAt: inviteExpiresAt(MEETING_DATE) });
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
  it('SuggestionsOverTheCap_AreRejectedServerSide', async () => {
    const catalog = await fetchAdvancementCatalog(sb as never);
    await sb.from('meeting_scout_suggestions').delete().eq('calendar_entry_id', meeting).eq('person_id', scout);
    const w = { meeting: { entryId: meeting, date: MEETING_DATE }, actorPersonId: parent, scoutPersonId: scout, catalog };
    const keys = await requestableKeys(catalog, 0, SUGGESTION_CAP + 1);
    const lists = await uncachedLists(sb);
    const results = [];
    for (const key of keys) results.push((await familyWrite(sb, w, { op: 'suggest', key, on: true }, { lists })).ok);
    expect(results).toEqual([...keys.slice(0, SUGGESTION_CAP).map(() => true), false]);
  });

  it('SuggestionsAtOnce_CannotPassTheCap', async () => {
    const catalog = await fetchAdvancementCatalog(sb as never);
    await sb.from('meeting_scout_suggestions').delete().eq('calendar_entry_id', meeting).eq('person_id', scout);
    const keys = await requestableKeys(catalog, 6, SUGGESTION_CAP + 3);
    const lists = await uncachedLists(sb);
    const w = { meeting: { entryId: meeting, date: MEETING_DATE }, actorPersonId: parent, scoutPersonId: scout, catalog };
    await Promise.all(keys.map((key) => familyWrite(sb, w, { op: 'suggest', key, on: true }, { lists })));
    const { count } = await sb.from('meeting_scout_suggestions').select('topic_key', { count: 'exact', head: true }).eq('calendar_entry_id', meeting).eq('person_id', scout);
    expect(count).toBe(SUGGESTION_CAP);
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
});

/** Badges the scout hasn't earned: always on their own pick list, so always suggestable. */
async function requestableKeys(catalog: Awaited<ReturnType<typeof fetchAdvancementCatalog>>, from: number, n: number): Promise<string[]> {
  const { data: sid } = await sb.from('scouts').select('id').eq('person_id', scout).single();
  const { data: earned } = await sb.from('mb_progress').select('mb_id').eq('scout_id', (sid as { id: string }).id).eq('awarded', true);
  const done = new Set(((earned ?? []) as { mb_id: string }[]).map((r) => r.mb_id));
  return catalog.meritBadges.filter((m) => !done.has(m.id)).slice(from, from + n).map((m) => `mb:${m.id}`);
}

describe('publish', () => {
  const view: ThisWeek = {
    focus: [{ key: 'fg:0', setId: null, name: 'Test focus' }],
    badges: [],
    groups: [],
    sections: [],
    older: [],
    extras: [],
    helpers: [],
    coverage: { counted: 0, rankWork: 0, nothing: 0, pct: 0, groupsWithoutTeacher: 0 },
    answers: { scouts: { coming: 0, undecided: 0, notComing: 0, none: 0 }, adults: { coming: 0, undecided: 0, notComing: 0, none: 0 } },
    adultsNoAnswer: [],
    unplaced: [],
    everyone: []
  };

  it('DoublePublish_AtOnce_LandsOneSnapshot', async () => {
    const input = { meeting: { entryId: meeting, date: MEETING_DATE }, view, scouts: [{ personId: scout, name: 'Test Scout' }], actorPersonId: parent, everyone: false };
    const results = await Promise.all([publishPlan(sb, input), publishPlan(sb, input)]);
    const { count } = await sb.from('meeting_plan_snapshots').select('n', { count: 'exact', head: true }).eq('calendar_entry_id', meeting);
    expect([results.filter((r) => r.ok).length, count]).toEqual([1, 1]);
  });

  it('Republish_WithNothingChanged_MakesNoNewSnapshot', async () => {
    await publishPlan(sb, { meeting: { entryId: meeting, date: MEETING_DATE }, view, scouts: [{ personId: scout, name: 'Test Scout' }], actorPersonId: parent, everyone: false });
    const { count } = await sb.from('meeting_plan_snapshots').select('n', { count: 'exact', head: true }).eq('calendar_entry_id', meeting);
    expect(count).toBe(1);
  });

  it('Publish_WhoseEmailDidNotGoOut_LeavesNoLink', async () => {
    // The suite never mails anyone (vitest.config strips the Resend key): every send is 'skipped', so no link stays.
    const before = (await sb.from('meeting_plan_pages').select('id', { count: 'exact', head: true }).eq('calendar_entry_id', meeting).eq('snapshot_n', 2)).count;
    await publishPlan(sb, { meeting: { entryId: meeting, date: MEETING_DATE }, view, scouts: [{ personId: scout, name: 'Test Scout' }], actorPersonId: parent, everyone: true });
    const after = (await sb.from('meeting_plan_pages').select('id', { count: 'exact', head: true }).eq('calendar_entry_id', meeting).eq('snapshot_n', 2)).count;
    expect([before, after]).toEqual([0, 0]);
  });
});
