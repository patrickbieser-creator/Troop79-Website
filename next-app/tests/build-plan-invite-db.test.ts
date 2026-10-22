import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { adminClient } from './helpers/admin-client';
import { TEST_PREFIX } from './helpers/signup-fixtures';

/**
 * Build a Plan B3 (Plans/Build-A-Plan.md "Invite…", Decision 2): invites go out as ONE digest per recipient. Real local
 * database; the mail transport is mocked (no email leaves this machine), as are the admin actor and "today"
 * (2094-02-20, so the test's 2094 meeting is the next one). Test-owned rows only: the meeting deleted by id (its
 * invites, topics, intents by entry), fixture people, scouts, households, relationships, skills and ledger rows by id.
 */
const sb = adminClient();
const state = vi.hoisted(() => ({
  actor: null as null | { personId: number; subjectKind: 'adult' | 'scout'; capabilities: Set<string> },
  counter: null as null | { n: number },
  send: vi.fn(async (opts: { to: string[] }) => ({ status: 'sent', to: opts.to }))
}));

function counting(target: SupabaseClient, counter: { n: number }): SupabaseClient {
  return new Proxy(target, {
    get(t, prop, receiver) {
      const v = Reflect.get(t, prop, receiver);
      if ((prop === 'from' || prop === 'rpc') && typeof v === 'function') {
        return (...args: unknown[]) => {
          counter.n++;
          return (v as (...a: unknown[]) => unknown).apply(t, args);
        };
      }
      return v;
    }
  });
}

vi.mock('@/lib/supabase/server', async () => {
  const { adminClient: make } = await import('./helpers/admin-client');
  return { createAdminClient: () => (state.counter ? counting(make(), state.counter) : make()) };
});
vi.mock('@/lib/admin-actor', () => ({ resolveAdminActor: async () => state.actor }));
vi.mock('@/lib/email', () => ({ sendEmail: (opts: { to: string[] }) => state.send(opts) }));
vi.mock('@/lib/audit', () => ({ recordAudit: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), updateTag: vi.fn(), revalidateTag: vi.fn(), unstable_cache: (fn: unknown) => fn }));
vi.mock('@/lib/dates', async (orig) => ({ ...(await orig<typeof import('../src/lib/dates')>()), centralToday: () => '2094-02-20' }));

const { fetchAdvancementCatalog } = await import('../src/lib/advancement-catalog');
const { sendInviteDigests } = await import('../src/lib/meeting-invite-digest-send');
const { digestEmails, selection, tickId } = await import('../src/lib/meeting-invite-digest');
const actions = () => import('../src/app/(public)/planner/build-actions');
const loadCatalog = () => fetchAdvancementCatalog(sb);

let meeting = 0;
let older = 0; // 14 at the meeting, verified own address
let younger = 0; // 11 at the meeting
let parent = 0; // in the household, parent_of both; also asked to teach
let keys: string[] = [];
let finished = ''; // a top-level Tenderfoot requirement `younger` has signed off
const people: number[] = [];
const scoutIds: string[] = [];
const households: number[] = [];
const mail = (id: number) => `zzvitest-bai-${id}-${process.pid}@example.com`;

async function person(label: string, o: { email?: boolean; verified?: boolean; birthdate?: string } = {}): Promise<number> {
  const { data, error } = await sb
    .from('people')
    .insert({ display_name: `${TEST_PREFIX} BAI ${label}`, first_name: TEST_PREFIX, last_name: `BAI ${label}`, birthdate: o.birthdate ?? null, active: true })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  const id = data!.id as number;
  people.push(id);
  if (o.email) {
    const { error: e2 } = await sb.from('person_emails').insert({ person_id: id, email: mail(id), is_primary: true, verified_at: o.verified ? new Date().toISOString() : null });
    if (e2) throw new Error(e2.message);
  }
  return id;
}
async function scout(id: number): Promise<void> {
  const sid = `vitest-bai-${id}`;
  const { error } = await sb.from('scouts').insert({ id: sid, first_name: TEST_PREFIX, last_name: `BAI ${id}`, display_name: `${TEST_PREFIX} BAI ${id}`, person_id: id, active: true, current_rank: 'scout' });
  if (error) throw new Error(error.message);
  scoutIds.push(sid);
}

beforeAll(async () => {
  await sb.from('calendar_entries').delete().like('title', `%${TEST_PREFIX}%`).gte('entry_date', '2094-01-01').lte('entry_date', '2094-12-31');
  const { data, error } = await sb.from('calendar_entries').insert({ entry_date: '2094-03-07', category: 'Troop Meeting', title: `Troop Meeting ${TEST_PREFIX}` }).select('id').single();
  if (error) throw new Error(error.message);
  meeting = data!.id;
  older = await person('Older', { email: true, verified: true, birthdate: '2080-01-01' });
  younger = await person('Younger', { email: true, verified: true, birthdate: '2083-01-01' });
  parent = await person('Parent', { email: true });
  for (const id of [older, younger]) await scout(id);
  const { data: h } = await sb.from('households').insert({ label: `${TEST_PREFIX} BAI family` }).select('id').single();
  households.push(h!.id);
  await sb.from('household_members').insert([older, younger, parent].map((person_id) => ({ household_id: h!.id, person_id })));
  await sb.from('relationships').insert([older, younger].map((related_person_id) => ({ person_id: parent, related_person_id, type: 'parent_of' })));

  const { data: tf } = await sb.from('rank_requirements').select('id, parent_id, code, venue, skill_id, sort_order').eq('rank_id', 'tenderfoot').order('sort_order');
  const rows = (tf ?? []) as { id: number; parent_id: number | null; code: string; venue: string; skill_id: string | null }[];
  const tops = rows.filter((r) => r.parent_id == null && r.venue !== 'outing' && r.code.toLowerCase() !== 'bor');
  const leaf = tops.find((r) => !rows.some((c) => c.parent_id === r.id))!;
  finished = `tenderfoot-${leaf.code}`;
  const { error: le } = await sb.from('ledger_entries').insert({ scout_id: `vitest-bai-${younger}`, kind: 'rank_requirement', code: finished, label: null, date: '2026-01-04', qty: 1, unit: 'complete' });
  if (le) throw new Error(le.message);
  const skilled = tops.filter((r) => r.skill_id && `tenderfoot-${r.code}` !== finished);
  keys = [...skilled.slice(0, 2), ...tops.filter((r) => !skilled.includes(r) && `tenderfoot-${r.code}` !== finished)].slice(0, 3).map((r) => `tenderfoot-${r.code}`);
  if (keys.length < 3 || !skilled.length) throw new Error('fixture: need three meeting-doable Tenderfoot requirements, one with a skill');
  await sb.from('teaching_skills').insert({ person_id: parent, skill_id: skilled[0].skill_id });
  const seeded = await sb.rpc('meeting_seed_many', { p_entry: meeting, p_keys: keys, p_actor: parent });
  if (seeded.error) throw new Error(seeded.error.message);
}, 60_000);

afterEach(async () => {
  await sb.from('meeting_invites').delete().eq('calendar_entry_id', meeting);
  state.send.mockClear();
  state.actor = null;
});

afterAll(async () => {
  await sb.from('meeting_topics').delete().eq('calendar_entry_id', meeting);
  await sb.from('meeting_intents').delete().eq('calendar_entry_id', meeting);
  await sb.from('calendar_entries').delete().eq('id', meeting);
  await sb.from('ledger_entries').delete().in('scout_id', scoutIds);
  await sb.from('teaching_skills').delete().in('person_id', people);
  await sb.from('relationships').delete().in('person_id', people);
  await sb.from('household_members').delete().in('household_id', households);
  await sb.from('households').delete().in('id', households);
  await sb.from('scouts').delete().in('id', scoutIds);
  await sb.from('person_emails').delete().in('person_id', people);
  await sb.from('people').delete().in('id', people);
});

const send = (teach: { key: string; personIds: number[] }[], pick: { key: string; scoutIds: number[] }[]) =>
  sendInviteDigests(sb, { entryId: meeting, teach, pick, sentBy: null }, { loadCatalog });
const sentTo = () => state.send.mock.calls.map((c) => (c[0] as { to: string[] }).to[0]).sort();
const asAdultEditor = () => (state.actor = { personId: parent, subjectKind: 'adult', capabilities: new Set(['meeting_planner.edit']) });

describe('one digest per recipient', () => {
  it('Invite_Digest_OneEmailPerRecipient', async () => {
    await send([{ key: keys[0], personIds: [parent] }], [{ key: keys[0], scoutIds: [older, younger] }, { key: keys[1], scoutIds: [older, younger] }]);
    expect(sentTo()).toEqual([mail(older), mail(parent)].sort());
  });

  it('Invite_ToScout_GoesToParents', async () => {
    await send([], [{ key: keys[0], scoutIds: [younger] }]);
    expect(sentTo()).toEqual([mail(parent)]);
  });

  it('Invite_ToThirteenPlusVerifiedScout_AlsoGoesToScout', async () => {
    await send([], [{ key: keys[0], scoutIds: [older] }]);
    expect(sentTo()).toEqual([mail(older), mail(parent)].sort());
  });
});

describe('who is refused', () => {
  it('Invite_RefusesScoutWhoAlreadyFinishedKey', async () => {
    const res = await send([], [{ key: finished, scoutIds: [younger] }]);
    expect(res.ok && res.skipped.map((s) => s.reason.split(' (')[0])).toEqual(['already done, or not something they can pick']);
  });

  it('Invite_SkipsDuplicateWithin24Hours', async () => {
    await send([], [{ key: keys[0], scoutIds: [younger] }]);
    state.send.mockClear();
    await send([], [{ key: keys[0], scoutIds: [younger] }]);
    expect(state.send).not.toHaveBeenCalled();
  });

  it('ScoutEditor_IsRefused_WhenInviting', async () => {
    state.actor = { personId: older, subjectKind: 'scout', capabilities: new Set(['meeting_planner.edit']) };
    const res = await (await actions()).plannerSendInvitesAction({ entryId: meeting, teach: [], pick: [{ key: keys[0], scoutIds: [younger] }] });
    expect(res).toEqual({ ok: false, error: 'Only adults send email.' });
  });
});

describe('the sheet', () => {
  it('Invite_SheetCounts_MatchDigestEmails', async () => {
    asAdultEditor();
    const { plannerInviteSheetAction, plannerSendInvitesAction } = await actions();
    const sheet = await plannerInviteSheetAction({ entryId: meeting });
    if (!sheet.ok) throw new Error(sheet.error);
    // Tick this test's own people only: everyone else in the local mirror stays unticked.
    const mine = new Set([parent, older, younger]);
    const ticks = new Set(
      sheet.sections.flatMap((s) => [
        ...s.teachers.filter((p) => mine.has(p.personId)).map((p) => tickId('teach', s.key, p.personId)),
        ...s.scouts.filter((p) => mine.has(p.personId)).map((p) => tickId('pick', s.key, p.personId))
      ])
    );
    const promised = digestEmails(sheet.sections, ticks);
    if (promised < 2) throw new Error("fixture: the sheet should offer this test's parent and scouts");
    await plannerSendInvitesAction({ entryId: meeting, ...selection(sheet.sections, ticks) });
    expect(state.send.mock.calls.length).toBe(promised);
  }, 60_000);

  it('Invite_LoadsSheet_InBoundedRoundTrips', async () => {
    asAdultEditor();
    const { plannerInviteSheetAction } = await actions();
    const trips = async (key?: string) => {
      state.counter = { n: 0 };
      try {
        const res = await plannerInviteSheetAction({ entryId: meeting, key });
        if (!res.ok) throw new Error(res.error);
        return state.counter.n;
      } finally {
        state.counter = null;
      }
    };
    expect(await trips(keys[0])).toBe(await trips());
  }, 60_000);
});
