import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { adminClient } from './helpers/admin-client';
import { TEST_PREFIX } from './helpers/signup-fixtures';
import { createTeachInvites, inspectInvite, respondToInvite } from '../src/lib/meeting-invites-db';
import { INVITE_SEND_CAP } from '../src/lib/meeting-invites';

/**
 * Meeting invites, P1 (Plans/Matcher-Tune-Up.md T-5, qa-lead review 2026-10-20): the database half against the real
 * local database. Every row is test-owned: fixture meetings are dated 2091 (and one in 2020) and deleted by id, which
 * cascades their topics, teachers and invites; fixture people and households are deleted by id.
 */
const sb = adminClient();

let meeting = 0;
let past = 0;
let adult = 0;
let noEmail = 0;
let scoutPerson = 0;
let leader = 0;
let topicKey = '';
let otherKeys: string[] = [];
const people: number[] = [];
const scoutIds: string[] = [];
const households: number[] = [];

async function entry(date: string): Promise<number> {
  const { data, error } = await sb.from('calendar_entries').insert({ entry_date: date, category: 'Troop Meeting', title: `Troop Meeting ${TEST_PREFIX}` }).select('id').single();
  if (error) throw new Error(error.message);
  return data!.id as number;
}
async function person(label: string, email: string | null): Promise<number> {
  const { data, error } = await sb.from('people').insert({ display_name: `${TEST_PREFIX} INV ${label}` }).select('id').single();
  if (error) throw new Error(error.message);
  const id = data!.id as number;
  people.push(id);
  if (email) {
    const { error: e2 } = await sb.from('person_emails').insert({ person_id: id, email, is_primary: true });
    if (e2) throw new Error(e2.message);
  }
  return id;
}

beforeAll(async () => {
  meeting = await entry('2091-03-04');
  past = await entry('2020-03-01');
  adult = await person('Adult', `zzvitest-inv-adult-${process.pid}@example.com`);
  noEmail = await person('NoEmail', null);
  leader = await person('Leader', null);
  scoutPerson = await person('Scout', `zzvitest-inv-scout-${process.pid}@example.com`);
  const sid = `vitest-inv-${scoutPerson}`;
  const { error } = await sb.from('scouts').insert({ id: sid, first_name: TEST_PREFIX, last_name: 'Scout', display_name: `${TEST_PREFIX} INV Scout`, person_id: scoutPerson, active: true, current_rank: 'scout' });
  if (error) throw new Error(error.message);
  scoutIds.push(sid);
  const { data: hh } = await sb.from('households').insert({ label: `${TEST_PREFIX} INV family` }).select('id').single();
  households.push(hh!.id);
  await sb.from('household_members').insert([adult, noEmail, scoutPerson].map((person_id) => ({ household_id: hh!.id, person_id })));
  const { data: reqs } = await sb.from('rank_requirements').select('rank_id, code').is('parent_id', null).eq('rank_id', 'tenderfoot').order('sort_order').limit(3);
  [topicKey, ...otherKeys] = ((reqs ?? []) as { rank_id: string; code: string }[]).map((r) => `${r.rank_id}-${r.code}`);
});

afterEach(async () => {
  for (const e of [meeting, past]) {
    await sb.from('meeting_invites').delete().eq('calendar_entry_id', e);
    await sb.from('meeting_topics').delete().eq('calendar_entry_id', e);
  }
  await sb.from('people').update({ session_epoch: 0 }).eq('id', adult);
});

afterAll(async () => {
  await sb.from('calendar_entries').delete().in('id', [meeting, past]);
  await sb.from('household_members').delete().in('household_id', households);
  await sb.from('households').delete().in('id', households);
  await sb.from('scouts').delete().in('id', scoutIds);
  await sb.from('person_emails').delete().in('person_id', people);
  await sb.from('people').delete().in('id', people);
});

const invite = async (personIds: number[] = [adult], entryId = meeting) => createTeachInvites(sb, { entryId, topicKey, personIds, sentBy: leader });
const firstToken = async () => {
  const r = await invite();
  if (!r.ok || !r.invites[0]) throw new Error('fixture: no invite minted');
  return r.invites[0];
};

describe('sending', () => {
  it('Leader_InvitesAnAdult_TheRowKeepsOnlyAHash', async () => {
    const sent = await firstToken();
    const { data } = await sb.from('meeting_invites').select('token_hash, sent_to, expires_at').eq('id', sent.inviteId).single();
    expect([data!.token_hash === sent.token, /^[0-9a-f]{64}$/.test(data!.token_hash), data!.sent_to === sent.sentTo, data!.expires_at.startsWith('2091-03-05T00:00:00')]).toEqual([false, true, true, true]);
  });

  it('Send_SkipsAScout_AndSomeoneWithNoEmail', async () => {
    const r = await invite([adult, noEmail, scoutPerson]);
    expect(r.ok && [r.invites.map((i) => i.personId), r.skipped.map((s) => [s.personId, s.reason])]).toEqual([
      [adult],
      [
        [noEmail, 'no email on file'],
        [scoutPerson, 'invites go to adults for now']
      ]
    ]);
  });

  it('Send_RefusesAPastMeeting', async () => {
    expect((await invite([adult], past)).ok).toBe(false);
  });

  it('Send_RefusesMoreThanTheCap_WhateverTheDialogSent', async () => {
    const many = Array.from({ length: INVITE_SEND_CAP + 1 }, (_, i) => 900_000_000 + i);
    expect((await invite(many)).ok).toBe(false);
  });

  it('Resend_SkipsSomeoneInvitedToTheSameTopicLately', async () => {
    await invite();
    const again = await invite();
    expect(again.ok && [again.invites.length, again.skipped[0]?.reason]).toEqual([0, 'already invited in the last 24 hours']);
  });
});

describe('answering', () => {
  it('OpeningTheLink_ConsumesNothing', async () => {
    const sent = await firstToken();
    await inspectInvite(sb, sent.token);
    const second = await inspectInvite(sb, sent.token);
    expect([second.state, second.invite?.topicKey]).toEqual(['open', topicKey]);
  });

  it('Yes_AddsTheTeachingCommitment_AndTheLinkThenSaysAnswered', async () => {
    const sent = await firstToken();
    const res = await respondToInvite(sb, sent.token, 'accept');
    const { data: topic } = await sb.from('meeting_topics').select('id').eq('calendar_entry_id', meeting).eq('topic_key', topicKey).single();
    const { count } = await sb.from('meeting_topic_teachers').select('topic_id', { count: 'exact', head: true }).eq('topic_id', topic!.id).eq('person_id', adult);
    expect([res.ok, count, (await inspectInvite(sb, sent.token)).state]).toEqual([true, 1, 'answered']);
  });

  it('TwoTapsAtOnce_OnlyOneWins', async () => {
    const sent = await firstToken();
    const [a, b] = await Promise.all([respondToInvite(sb, sent.token, 'decline'), respondToInvite(sb, sent.token, 'decline')]);
    expect([a.ok, b.ok].filter(Boolean).length).toBe(1);
  });

  it('No_RecordsDeclined_AndAddsNoCommitment', async () => {
    const sent = await firstToken();
    const res = await respondToInvite(sb, sent.token, 'decline');
    const { data } = await sb.from('meeting_invites').select('response').eq('id', sent.inviteId).single();
    const { count } = await sb.from('meeting_topics').select('id', { count: 'exact', head: true }).eq('calendar_entry_id', meeting);
    expect([res.ok, data!.response, count]).toEqual([true, 'declined', 0]);
  });

  it('SignOutEverywhere_VoidsAnOpenInvite', async () => {
    const sent = await firstToken();
    await sb.from('people').update({ session_epoch: 1 }).eq('id', adult);
    const res = await respondToInvite(sb, sent.token, 'accept');
    expect([res.ok, !res.ok && res.state]).toEqual([false, 'void']);
  });

  it('AnExpiredLink_CantBeAnswered', async () => {
    const sent = await firstToken();
    await sb.from('meeting_invites').update({ expires_at: '2020-01-01T00:00:00Z' }).eq('id', sent.inviteId);
    const res = await respondToInvite(sb, sent.token, 'accept');
    expect([res.ok, !res.ok && res.state]).toEqual([false, 'expired']);
  });

  it('WhenTheTeachSignupRefuses_TheInviteStaysOpen', async () => {
    for (const key of otherKeys) {
      const { error } = await sb.rpc('meeting_teach_topic', { p_person: adult, p_actor: adult, p_leader: false, p_entries: [meeting], p_topic_key: key, p_title: null, p_note: null });
      if (error) throw new Error(error.message);
    }
    const sent = await firstToken();
    const res = await respondToInvite(sb, sent.token, 'accept');
    expect([res.ok, !res.ok && res.code, (await inspectInvite(sb, sent.token)).state]).toEqual([false, 'full', 'open']);
  });

  it('AnUppercasedLink_StillWorks', async () => {
    const sent = await firstToken();
    expect((await inspectInvite(sb, sent.token.toUpperCase())).state).toBe('open');
  });

  it('AMadeUpToken_IsUnknown', async () => {
    expect((await respondToInvite(sb, 'f'.repeat(64), 'accept')).ok).toBe(false);
  });
});
