import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { adminClient } from './helpers/admin-client';
import { TEST_PREFIX } from './helpers/signup-fixtures';
import { fetchAdvancementCatalog } from '../src/lib/advancement-catalog';
import { createPickInvites, inspectInvite, respondToInvite, scoutMayBeMailed } from '../src/lib/meeting-invites-db';
import { hashSecret } from '../src/lib/identity-challenge';
import { inviteAnswerAudit } from '../src/lib/meeting-invite-audit';

/**
 * Meeting invites, P2: scouts and parents (Plans/Matcher-Tune-Up.md T-5; qa-lead design review 2026-10-20). Real local
 * database. Test-owned rows only: a 2091 meeting deleted by id (its topics, picks, intents and invites cascade or are
 * deleted by entry), fixture people, scouts, households and relationships deleted by id.
 */
const sb = adminClient();
const catalog = () => fetchAdvancementCatalog(sb);

let meeting = 0;
let older = 0; // 14 at the meeting, verified own address
let younger = 0; // 11 at the meeting, own address too
let parent = 0; // in the household, parent_of both
let awayParent = 0; // parent_of older, NOT in the household
let stranger = 0; // an adult in another household
let otherScout = 0; // a scout in another household
let inactiveAdult = 0; // in the household, deactivated
let keys: string[] = [];
let outingKey = '';
const people: number[] = [];
const scoutIds: string[] = [];
const households: number[] = [];

async function person(label: string, o: { email?: string; verified?: boolean; birthdate?: string; active?: boolean } = {}): Promise<number> {
  const { data, error } = await sb
    .from('people')
    .insert({ display_name: `${TEST_PREFIX} PIK ${label}`, first_name: TEST_PREFIX, last_name: `PIK ${label}`, birthdate: o.birthdate ?? null, active: o.active ?? true })
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
  const sid = `vitest-pik-${id}`;
  const { error } = await sb.from('scouts').insert({ id: sid, first_name: TEST_PREFIX, last_name: `PIK ${id}`, display_name: `${TEST_PREFIX} PIK ${id}`, person_id: id, active: true, current_rank: 'scout' });
  if (error) throw new Error(error.message);
  scoutIds.push(sid);
}
async function household(members: number[]): Promise<void> {
  const { data } = await sb.from('households').insert({ label: `${TEST_PREFIX} PIK family` }).select('id').single();
  households.push(data!.id);
  await sb.from('household_members').insert(members.map((person_id) => ({ household_id: data!.id, person_id })));
}

beforeAll(async () => {
  const { data, error } = await sb.from('calendar_entries').insert({ entry_date: '2091-03-04', category: 'Troop Meeting', title: `Troop Meeting ${TEST_PREFIX}` }).select('id').single();
  if (error) throw new Error(error.message);
  meeting = data!.id;
  older = await person('Older', { email: `zzvitest-pik-older-${process.pid}@example.com`, verified: true, birthdate: '2077-01-01' });
  younger = await person('Younger', { email: `zzvitest-pik-younger-${process.pid}@example.com`, verified: true, birthdate: '2080-01-01' });
  parent = await person('Parent', { email: `zzvitest-pik-parent-${process.pid}@example.com` });
  awayParent = await person('AwayParent', { email: `zzvitest-pik-away-${process.pid}@example.com` });
  stranger = await person('Stranger', { email: `zzvitest-pik-stranger-${process.pid}@example.com` });
  otherScout = await person('OtherScout');
  inactiveAdult = await person('Inactive', { active: false });
  for (const id of [older, younger, otherScout]) await scout(id);
  await household([older, younger, parent, inactiveAdult]);
  await household([stranger, otherScout]);
  await household([awayParent]);
  await sb.from('relationships').insert(
    [
      [parent, older],
      [parent, younger],
      [awayParent, older]
    ].map(([person_id, related_person_id]) => ({ person_id, related_person_id, type: 'parent_of' }))
  );
  const { data: reqs } = await sb.from('rank_requirements').select('rank_id, code, venue').is('parent_id', null).eq('rank_id', 'tenderfoot').order('sort_order');
  const rows = (reqs ?? []) as { rank_id: string; code: string; venue: string }[];
  keys = rows.filter((r) => r.venue !== 'outing').slice(0, 6).map((r) => `${r.rank_id}-${r.code}`);
  outingKey = rows.filter((r) => r.venue === 'outing').map((r) => `${r.rank_id}-${r.code}`)[0] ?? '';
  if (keys.length < 6) throw new Error('fixture: need six meeting-doable Tenderfoot requirements');
});

afterEach(async () => {
  await sb.from('meeting_invites').delete().eq('calendar_entry_id', meeting);
  await sb.from('meeting_topic_picks').delete().eq('calendar_entry_id', meeting);
  await sb.from('meeting_pick_lists').delete().eq('calendar_entry_id', meeting);
  await sb.from('meeting_intents').delete().eq('calendar_entry_id', meeting);
  await sb.from('meeting_topics').delete().eq('calendar_entry_id', meeting);
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

const offer = (scouts: number[], key = keys[0]) => createPickInvites(sb, { entryId: meeting, topicKey: key, scoutIds: scouts, sentBy: null }, { loadCatalog: catalog });
const linkFor = async (scoutId: number, recipientId: number, key = keys[0]) => {
  const r = await offer([scoutId], key);
  if (!r.ok) throw new Error(r.error);
  const rec = r.recipients.find((x) => x.recipientId === recipientId);
  if (!rec) throw new Error('fixture: no link for that recipient');
  return rec.scouts[0].token;
};
const answer = (token: string, a: 'accept' | 'decline') => respondToInvite(sb, token, a, { loadCatalog: catalog });
const picks = async (scoutId: number) => {
  const { data } = await sb.from('meeting_topic_picks').select('priority, meeting_topics(topic_key)').eq('calendar_entry_id', meeting).eq('person_id', scoutId).order('priority');
  return ((data ?? []) as unknown as { priority: number | null; meeting_topics: { topic_key: string } }[]).map((p) => [p.meeting_topics.topic_key, p.priority]);
};

describe('who an offer reaches', () => {
  it('Offer_ReachesTheParent_AndAScout13OrOlderWithAVerifiedAddress', async () => {
    const r = await offer([older]);
    expect(r.ok && r.recipients.map((x) => [x.recipientId, x.isScout]).sort()).toEqual([
      [older, true],
      [parent, false]
    ].sort());
  });

  it('Offer_NeverMailsAScoutUnder13_OnlyTheirParent', async () => {
    const r = await offer([younger]);
    expect(r.ok && r.recipients.map((x) => x.recipientId)).toEqual([parent]);
  });

  it('Offer_SkipsAParentOutsideTheScoutsHousehold', async () => {
    const r = await offer([older]);
    expect(r.ok && r.recipients.some((x) => x.recipientId === awayParent)).toBe(false);
  });

  it('Offer_ToTwoSiblings_IsOneEmailToTheParent_WithALinkEach', async () => {
    const r = await offer([older, younger]);
    const toParent = r.ok ? r.recipients.find((x) => x.recipientId === parent) : undefined;
    expect(toParent?.scouts.map((s) => s.scoutId).sort()).toEqual([older, younger].sort());
  });

  it('Offer_SkipsSomethingTheScoutCantPick', async () => {
    if (!outingKey) return;
    const r = await offer([older], outingKey);
    expect(r.ok && r.skipped.map((s) => s.reason)).toEqual(['already done, or not something they can pick']);
  });

  it('Scout_IsMailedFrom13_NotBefore', () => {
    expect([scoutMayBeMailed('2012-10-26', '2025-10-25'), scoutMayBeMailed('2012-10-25', '2025-10-25'), scoutMayBeMailed(null, '2025-10-25')]).toEqual([false, true, false]);
  });
});

describe('answering a scout invite', () => {
  it('ParentsYes_MakesItTheScoutsFirstPick_AndMarksThemComing', async () => {
    const token = await linkFor(younger, parent);
    await sb.rpc('meeting_add_pick', { p_entry: meeting, p_person: younger, p_actor: parent, p_leader: false, p_topic_key: keys[1], p_later: false, p_mark_coming: false, p_carry: [] });
    const res = await answer(token, 'accept');
    const { data: intent } = await sb.from('meeting_intents').select('intent').eq('calendar_entry_id', meeting).eq('person_id', younger).single();
    expect([res.ok, (await picks(younger))[0], intent!.intent]).toEqual([true, [keys[0], 1], 'coming']);
  });

  it('AYes_ClosesTheOtherLinksForThatScout', async () => {
    const r = await offer([older]);
    if (!r.ok) throw new Error(r.error);
    const parentLink = r.recipients.find((x) => x.recipientId === parent)!.scouts[0].token;
    const scoutLink = r.recipients.find((x) => x.recipientId === older)!.scouts[0].token;
    await answer(parentLink, 'accept');
    const { data } = await sb.from('meeting_invites').select('response').eq('recipient_person_id', older).eq('calendar_entry_id', meeting).single();
    expect([data!.response, (await answer(scoutLink, 'accept')).ok]).toEqual(['superseded', false]);
  });

  it('ANo_ClosesOnlyTheDeclinersOwnLink', async () => {
    const r = await offer([older]);
    if (!r.ok) throw new Error(r.error);
    await answer(r.recipients.find((x) => x.recipientId === parent)!.scouts[0].token, 'decline');
    const scoutLink = r.recipients.find((x) => x.recipientId === older)!.scouts[0].token;
    expect([(await inspectInvite(sb, scoutLink)).state, (await answer(scoutLink, 'accept')).ok]).toEqual(['open', true]);
  });

  it('AYesWithFivePicksAlready_ChangesNothing_AndTheLinkStaysOpen', async () => {
    const token = await linkFor(younger, parent);
    for (const k of keys.slice(1, 6)) {
      const { error } = await sb.rpc('meeting_add_pick', { p_entry: meeting, p_person: younger, p_actor: parent, p_leader: false, p_topic_key: k, p_later: false, p_mark_coming: false, p_carry: [] });
      if (error) throw new Error(error.message);
    }
    const before = await picks(younger);
    const res = await answer(token, 'accept');
    expect([res.ok, !res.ok && res.code, await picks(younger), (await inspectInvite(sb, token)).state]).toEqual([false, 'picks', before, 'open']);
  });

  it('SomeoneNoLongerTheScoutsParent_CantAnswer', async () => {
    const token = await linkFor(younger, parent);
    await sb.from('relationships').delete().eq('person_id', parent).eq('related_person_id', younger);
    const res = await answer(token, 'accept');
    await sb.from('relationships').insert({ person_id: parent, related_person_id: younger, type: 'parent_of' });
    expect([res.ok, !res.ok && res.state, await picks(younger)]).toEqual([false, 'void', []]);
  });

  it('AYesOnATopicAlreadyPicked_StillMarksTheScoutComing', async () => {
    const token = await linkFor(younger, parent);
    await sb.rpc('meeting_add_pick', { p_entry: meeting, p_person: younger, p_actor: parent, p_leader: false, p_topic_key: keys[0], p_later: false, p_mark_coming: false, p_carry: [] });
    await sb.from('meeting_intents').upsert({ calendar_entry_id: meeting, person_id: younger, intent: 'undecided', entered_by_person_id: parent });
    const res = await answer(token, 'accept');
    const { data } = await sb.from('meeting_intents').select('intent').eq('calendar_entry_id', meeting).eq('person_id', younger).single();
    expect([res.ok, data!.intent]).toEqual([true, 'coming']);
  });

  it('ALinkHeldByAParentOutsideTheHousehold_IsVoid', async () => {
    const raw = 'c'.repeat(64);
    const { data: p } = await sb.from('people').select('session_epoch').eq('id', awayParent).single();
    const { error } = await sb.from('meeting_invites').insert({
      calendar_entry_id: meeting, topic_key: keys[0], kind: 'pick', invitee_person_id: older, recipient_person_id: awayParent,
      sent_to: 'x@example.com', invitee_epoch: 0, recipient_epoch: p!.session_epoch, token_hash: await hashSecret(raw), expires_at: '2091-03-05T00:00:00Z'
    });
    if (error) throw new Error(error.message);
    const res = await answer(raw, 'accept');
    expect([res.ok, !res.ok && res.state, await picks(older)]).toEqual([false, 'void', []]);
  });

  it('ASpentLink_SaysAnswered_EvenIfTheTopicIsNoLongerPickable', async () => {
    const token = await linkFor(younger, parent);
    await answer(token, 'decline');
    const res = await answer(token, 'accept');
    expect([res.ok, !res.ok && res.state]).toEqual([false, 'answered']);
  });

  it('TwoYesesAtOnce_OnlyOneWins', async () => {
    const token = await linkFor(younger, parent);
    const [a, b] = await Promise.all([answer(token, 'accept'), answer(token, 'accept')]);
    expect([a.ok, b.ok].filter(Boolean).length).toBe(1);
  });
});

describe('the pick RPCs refuse anyone outside the household (qa-lead MUST 1)', () => {
  const add = (actor: number) =>
    sb.rpc('meeting_add_pick', { p_entry: meeting, p_person: younger, p_actor: actor, p_leader: false, p_topic_key: keys[0], p_later: false, p_mark_coming: true, p_carry: [] });

  it('AnUnrelatedAdult_IsRefused', async () => {
    expect((await add(stranger)).error).not.toBeNull();
  });

  it('AScoutInAnotherHousehold_IsRefused', async () => {
    expect((await add(otherScout)).error).not.toBeNull();
  });

  it('ADeactivatedAdultInTheHousehold_IsRefused', async () => {
    expect((await add(inactiveAdult)).error).not.toBeNull();
  });

  it('AnOutsiderReordering_IsRefused', async () => {
    const { error } = await sb.rpc('meeting_set_pick_order', { p_entry: meeting, p_person: younger, p_actor: stranger, p_leader: false, p_keys: [keys[0]], p_carry: [] });
    expect(error).not.toBeNull();
  });

  it('AParentOutsideTheHousehold_IsRefused', async () => {
    const { error } = await sb.rpc('meeting_add_pick', { p_entry: meeting, p_person: older, p_actor: awayParent, p_leader: false, p_topic_key: keys[0], p_later: false, p_mark_coming: true, p_carry: [] });
    expect(error).not.toBeNull();
  });
});

describe('the audit row for a parent answer names both (2026-10-22)', () => {
  it('ParentNo_AuditSummary_NamesParentScoutTopicAndDay', async () => {
    const token = await linkFor(younger, parent);
    const res = await answer(token, 'decline');
    const audit = res.ok ? await inviteAnswerAudit(sb, res, { loadCatalog: catalog }) : null;
    expect(audit?.entry.summary).toMatch(new RegExp(`^${TEST_PREFIX} P said not this week for ${TEST_PREFIX} Y: Ten \\S+ · .+ \\(Mar 4\\)$`));
  });
});
