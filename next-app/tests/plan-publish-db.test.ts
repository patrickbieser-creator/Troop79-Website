import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { adminClient } from './helpers/admin-client';
import { TEST_PREFIX } from './helpers/signup-fixtures';
import { publishPlan } from '../src/lib/plan-publish';
import type { ThisWeek } from '../src/lib/this-week';

/**
 * Publish snapshot's promises (qa-lead 2026-10-28): one email per recipient however many of their scouts it covers,
 * test scouts never emailed, and publishing again with nothing changed reaches only the families the last send
 * missed. The sender is injected (nothing is mailed); real local families are only read. Test-owned rows only: a 2085
 * meeting, its snapshots and links cascade with it.
 */
const sb = adminClient();
const MEETING_DATE = '2085-03-04';
let meeting = 0;
let siblings: { personId: number; name: string }[] = [];
let other: { personId: number; name: string } = { personId: 0, name: '' };
let testScout: { personId: number; name: string; isTest: true } = { personId: 0, name: '', isTest: true };

const view = (focus: string): ThisWeek => ({
  focus: [{ key: 'fg:0', setId: null, name: focus }],
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
});
type Sent = { to: string[] };
function sender(fail: (to: string) => boolean = () => false) {
  const sent: Sent[] = [];
  const send = vi.fn(async (_ms: number, opts: { to: string[] }) => {
    sent.push({ to: opts.to });
    return { status: fail(opts.to[0]) ? ('failed' as const) : ('sent' as const) };
  });
  return { sent, send: send as never };
}
const publish = (scouts: { personId: number; name: string; isTest?: boolean }[], focus: string, send: never, everyone = false) =>
  publishPlan(sb, { meeting: { entryId: meeting, date: MEETING_DATE }, view: view(focus), scouts, actorPersonId: siblings[0].personId, everyone }, { send });

async function scoutsOf() {
  const { data } = await sb.from('scouts').select('person_id, display_name, people(is_test)').eq('active', true).not('person_id', 'is', null);
  return ((data ?? []) as unknown as { person_id: number; display_name: string; people: { is_test: boolean } | null }[]).map((r) => ({
    personId: r.person_id,
    name: r.display_name,
    isTest: r.people?.is_test === true
  }));
}

beforeAll(async () => {
  await sb.from('calendar_entries').delete().like('title', `%${TEST_PREFIX}%`).gte('entry_date', '2085-01-01').lte('entry_date', '2085-12-31');
  const { data, error } = await sb.from('calendar_entries').insert({ entry_date: MEETING_DATE, category: 'Troop Meeting', title: `Troop Meeting ${TEST_PREFIX} PUB` }).select('id').single();
  if (error) throw new Error(error.message);
  meeting = data!.id as number;
  // A household with two active scouts (siblings), another family's scout, and a test scout: real rows, read only.
  const all = await scoutsOf();
  const { data: hm } = await sb.from('household_members').select('household_id, person_id').in('person_id', all.map((s) => s.personId));
  const byHousehold = new Map<number, number[]>();
  for (const r of (hm ?? []) as { household_id: number; person_id: number }[]) byHousehold.set(r.household_id, [...(byHousehold.get(r.household_id) ?? []), r.person_id]);
  const pair = [...byHousehold.values()].find((ids) => ids.length >= 2 && ids.every((id) => !all.find((s) => s.personId === id)?.isTest))!;
  siblings = pair.slice(0, 2).map((id) => ({ personId: id, name: all.find((s) => s.personId === id)!.name }));
  const otherId = [...byHousehold.values()].find((ids) => ids.length === 1 && !all.find((s) => s.personId === ids[0])?.isTest && !pair.includes(ids[0]))![0];
  other = { personId: otherId, name: all.find((s) => s.personId === otherId)!.name };
  const t = all.find((s) => s.isTest)!;
  testScout = { personId: t.personId, name: t.name, isTest: true };
});

beforeEach(async () => {
  await sb.from('meeting_plan_pages').delete().eq('calendar_entry_id', meeting);
  await sb.from('meeting_plan_snapshots').delete().eq('calendar_entry_id', meeting);
});

afterAll(async () => {
  await sb.from('calendar_entries').delete().eq('id', meeting);
});

describe('publish', () => {
  it('Publish_SendsOneEmailPerRecipient_ForSiblings', async () => {
    const { sent, send } = sender();
    await publish(siblings, 'Sibling night', send);
    const addresses = sent.map((x) => x.to[0]);
    expect([addresses.length > 0, new Set(addresses).size === addresses.length]).toEqual([true, true]);
  });

  it('Publish_NamesBothSiblings_InOneEmailPerParent', async () => {
    const { sent, send } = sender();
    const res = await publish(siblings, 'Sibling night two', send);
    expect([sent.length > 0, res.ok && res.families === sent.length]).toEqual([true, true]);
  });

  it('Publish_NeverEmailsATestScoutsFamily', async () => {
    const { sent, send } = sender();
    await publish([testScout], 'Test scout night', send);
    expect(sent).toEqual([]);
  });

  it('Publish_RecordsWhoItWasMeantFor', async () => {
    const { send } = sender();
    const res = await publish([...siblings, other], 'Count night', send);
    const { data } = await sb.from('meeting_plan_snapshots').select('emailed, meant').eq('calendar_entry_id', meeting).single();
    expect(data).toEqual({ emailed: res.ok ? res.emailed : -1, meant: res.ok ? res.families : -1 });
  });

  it('PublishAgain_WithNothingChanged_ReachesOnlyTheFamiliesItMissed', async () => {
    // Learn the other family's address from a dry run, then fail exactly that one.
    const probe = sender();
    await publish([other], 'Probe night', probe.send);
    const firstMissed = probe.sent[0]?.to[0] ?? '';
    const first = sender((to) => to === firstMissed);
    await sb.from('meeting_plan_pages').delete().eq('calendar_entry_id', meeting);
    await sb.from('meeting_plan_snapshots').delete().eq('calendar_entry_id', meeting);
    await publish([...siblings, other], 'Retry night', first.send);
    const again = sender();
    await publish([...siblings, other], 'Retry night', again.send);
    expect(again.sent.map((x) => x.to[0])).toEqual([firstMissed]);
  });

  it('PublishAgain_WhenEveryFamilyHasIt_IsRefused', async () => {
    const { send } = sender();
    await publish(siblings, 'Done night', send);
    const res = await publish(siblings, 'Done night', send);
    expect(res.ok).toBe(false);
  });
});
