import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { adminClient } from './helpers/admin-client';
import { TEST_PREFIX } from './helpers/signup-fixtures';

/**
 * F5 (Plans/Meeting-Planner-III-Family.md): the teacher card on the email link, /i/plan/<token>. The link writes
 * only for its recipient, only on its own meeting, under the same Sunday limit and adults-only rule as the signed-in
 * page, and an unknown link counts a failure toward the address's rate limit. Real local database; "today"
 * (2094-02-25), the request headers and the cache are mocked. Test-owned rows only: 2094 meetings and people, deleted
 * by id (their links and rows cascade).
 */
const sb = adminClient();
const IP = '203.0.113.94';
vi.mock('@/lib/supabase/server', async () => {
  const { adminClient: make } = await import('./helpers/admin-client');
  return { createAdminClient: () => make() };
});
vi.mock('next/headers', () => ({ headers: async () => new Headers({ 'x-forwarded-for': IP }) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), updateTag: vi.fn(), revalidateTag: vi.fn(), unstable_cache: (fn: unknown) => fn }));
vi.mock('@/lib/dates', async (orig) => ({ ...(await orig<typeof import('../src/lib/dates')>()), centralToday: () => '2094-02-25' }));

const actions = () => import('../src/app/(public)/i/plan/actions');

const entries: number[] = [];
const people: number[] = [];
const scoutIds: string[] = [];
let meeting1 = 0; // 2094-03-01
let meeting2 = 0; // 2094-03-08
let adult = 0;
let other = 0;
let junior = 0;

async function entry(date: string): Promise<number> {
  const { data, error } = await sb.from('calendar_entries').insert({ entry_date: date, category: 'Troop Meeting', title: `Troop Meeting ${TEST_PREFIX} PLT`, status: 'published' }).select('id').single();
  if (error) throw new Error(error.message);
  entries.push(data!.id);
  return data!.id as number;
}
async function person(label: string): Promise<number> {
  const { data, error } = await sb.from('people').insert({ display_name: `${TEST_PREFIX} PLT ${label}`, first_name: `${TEST_PREFIX} PLT`, last_name: label }).select('id').single();
  if (error) throw new Error(error.message);
  people.push(data!.id);
  return data!.id as number;
}
async function link(recipientId: number, o: { asTeacher?: boolean; scouts?: number[] } = {}) {
  const { mintPlanPage } = await import('../src/lib/plan-pages');
  const { data } = await sb.from('people').select('session_epoch').eq('id', recipientId).single();
  return mintPlanPage(sb, { entryId: meeting1, recipientId, epoch: (data as { session_epoch: number }).session_epoch, scoutIds: o.scouts ?? [], expiresAt: '2094-03-02T00:00:00Z', asTeacher: o.asTeacher ?? true });
}
/** Top-level Second Class requirements with no sub-requirements: 15 minutes each. */
async function leafKeys(n: number): Promise<string[]> {
  const { data } = await sb.from('rank_requirements').select('id, rank_id, code, parent_id').eq('rank_id', 'second-class');
  const rows = (data ?? []) as { id: number; rank_id: string; code: string; parent_id: number | null }[];
  return rows.filter((r) => r.parent_id == null && !rows.some((k) => k.parent_id === r.id)).slice(0, n).map((r) => `${r.rank_id}-${r.code}`);
}

beforeAll(async () => {
  await sb.from('calendar_entries').delete().like('title', `%${TEST_PREFIX} PLT%`).gte('entry_date', '2094-01-01').lte('entry_date', '2094-12-31');
  meeting1 = await entry('2094-03-01');
  meeting2 = await entry('2094-03-08');
  adult = await person('Adult');
  other = await person('Other');
  junior = await person('Junior');
  const id = `vitest-plt-${junior}`;
  const { error } = await sb.from('scouts').insert({ id, first_name: `${TEST_PREFIX} PLT`, last_name: 'Junior', display_name: `${TEST_PREFIX} PLT Junior`, person_id: junior, active: true, current_rank: 'first-class' });
  if (error) throw new Error(error.message);
  scoutIds.push(id);
});

afterEach(async () => {
  for (const e of entries) {
    await sb.from('meeting_night_badges').delete().eq('calendar_entry_id', e);
    await sb.from('meeting_classes').delete().eq('calendar_entry_id', e);
    await sb.from('meeting_topics').delete().eq('calendar_entry_id', e);
    await sb.from('meeting_teaching_offers').delete().eq('calendar_entry_id', e);
    await sb.from('meeting_intents').delete().eq('calendar_entry_id', e);
    await sb.from('meeting_plan_pages').delete().eq('calendar_entry_id', e);
  }
  await sb.from('meeting_invite_failures').delete().eq('ip', IP);
});

afterAll(async () => {
  await sb.from('calendar_entries').delete().in('id', entries);
  await sb.from('scouts').delete().in('id', scoutIds);
  await sb.from('people').delete().in('id', people);
});

describe('a teacher answers from the email link', () => {
  it('TeacherLink_CanCommitToTeach_AsRecipientOnly', async () => {
    const { token } = await link(adult);
    const [key] = await leafKeys(1);
    // Anything naming someone else is ignored: who is written for comes only from the link.
    const r = await (await actions()).planPageTeachAction({ token, op: { op: 'teach', key, personId: other } as never });
    const { data } = await sb.from('meeting_topic_teachers').select('person_id, entered_by_person_id').eq('calendar_entry_id', meeting1);
    expect([r.ok, data]).toEqual([true, [{ person_id: adult, entered_by_person_id: adult }]]);
  });

  it('ScoutsOnlyLink_TeachWrite_IsRefused', async () => {
    const { token } = await link(adult, { asTeacher: false, scouts: [junior] });
    const r = await (await actions()).planPageTeachAction({ token, op: { op: 'intent', intent: 'coming' } });
    expect(r.ok).toBe(false);
  });

  it('PlanLinkTeacher_CannotOfferOnAnotherMeeting', async () => {
    const { token } = await link(adult);
    const r = await (await actions()).planPageTeachAction({ token, op: { op: 'offer', what: { type: 'ff', title: 'Knife sharpening' }, entryIds: [meeting1, meeting2] } });
    const { count } = await sb.from('meeting_topics').select('id', { count: 'exact', head: true }).in('calendar_entry_id', [meeting1, meeting2]).eq('topic_key', 'ff:knife sharpening');
    expect([r.ok ? 'posted' : r.field, count]).toEqual(['dates', 0]);
  });

  it('PlanLinkTeacher_OffersForThisSunday', async () => {
    const { token } = await link(adult);
    const r = await (await actions()).planPageTeachAction({ token, op: { op: 'offer', what: { type: 'ff', title: 'Knife sharpening' }, entryIds: [meeting1] } });
    expect(r.ok).toBe(true);
  });

  it('PlanLinkTeacher_ClearTakeMeOff_ReleasesOnlyTheirOwnRows', async () => {
    const [mine, theirs] = await leafKeys(2);
    const { token } = await link(adult);
    const act = await actions();
    await act.planPageTeachAction({ token, op: { op: 'teach', key: mine } });
    const { token: otherToken } = await link(other);
    await act.planPageTeachAction({ token: otherToken, op: { op: 'teach', key: theirs } });
    await act.planPageTeachAction({ token, op: { op: 'clear', takeOff: true } });
    const { data } = await sb.from('meeting_topic_teachers').select('person_id').eq('calendar_entry_id', meeting1);
    expect((data ?? []).map((r) => (r as { person_id: number }).person_id)).toEqual([other]);
  });

  it('PlanLinkTeacher_NoteIsSavedForTheRecipient', async () => {
    const { token } = await link(adult);
    const act = await actions();
    await act.planPageTeachAction({ token, op: { op: 'intent', intent: 'not_coming' } });
    await act.planPageTeachAction({ token, op: { op: 'note', note: 'Out of town' } });
    const { data } = await sb.from('meeting_intents').select('person_id, note').eq('calendar_entry_id', meeting1).not('note', 'is', null);
    expect(data).toEqual([{ person_id: adult, note: 'Out of town' }]);
  });

  it('PlanLinkTeacher_RespectsTeachLimits', async () => {
    const { token } = await link(adult);
    const act = await actions();
    const keys = await leafKeys(4);
    for (const key of keys.slice(0, 3)) await act.planPageTeachAction({ token, op: { op: 'teach', key } });
    const fourth = await act.planPageTeachAction({ token, op: { op: 'teach', key: keys[3] } });
    expect(fourth.ok ? 'taken' : fourth.error).toBe('You’re at 3 classes, the most for one Sunday. Drop one to take this.');
  });

  it('PlanLinkJuniorLeader_CannotTakeAdultsOnlyClass', async () => {
    await sb.from('meeting_night_badges').insert({ calendar_entry_id: meeting1, mb_id: 'first-aid' });
    const { token } = await link(junior, { scouts: [junior] });
    const r = await (await actions()).planPageTeachAction({ token, op: { op: 'teach', key: 'fr:mb:first-aid' } });
    const { count } = await sb.from('meeting_topic_teachers').select('person_id', { count: 'exact', head: true }).eq('calendar_entry_id', meeting1).eq('person_id', junior);
    expect([r.ok ? 'taken' : r.error, count]).toEqual(['Adults only: a registered counselor teaches the merit badge.', 0]);
  });

  it('UnknownToken_TeachWrite_CountsAFailure', async () => {
    await (await actions()).planPageTeachAction({ token: 'f'.repeat(64), op: { op: 'intent', intent: 'coming' } });
    const { count } = await sb.from('meeting_invite_failures').select('ip', { count: 'exact', head: true }).eq('ip', IP);
    expect(count).toBe(1);
  });

  it('ClosedLink_TeachWrite_CountsNoFailure', async () => {
    const { token, id } = await link(adult);
    await sb.from('meeting_plan_pages').update({ revoked_at: new Date().toISOString() }).eq('id', id);
    const r = await (await actions()).planPageTeachAction({ token, op: { op: 'intent', intent: 'coming' } });
    const { count } = await sb.from('meeting_invite_failures').select('ip', { count: 'exact', head: true }).eq('ip', IP);
    expect([r.ok, count]).toEqual([false, 0]);
  });
});

describe('the page', () => {
  /** Every element in a server component's returned tree. */
  function walk(node: unknown, out: { type: unknown; props: Record<string, unknown> }[] = []) {
    if (Array.isArray(node)) node.forEach((n) => walk(n, out));
    else if (node && typeof node === 'object' && 'props' in node) {
      const el = node as { type: unknown; props: Record<string, unknown> };
      out.push(el);
      walk(el.props.children, out);
    }
    return out;
  }

  it('GET_WithTeacherCard_WritesNothing', async () => {
    const { token, id } = await link(adult);
    const snapshot = async () => {
      const [page, intents, teachers, topics] = await Promise.all([
        sb.from('meeting_plan_pages').select('*').eq('id', id).single(),
        sb.from('meeting_intents').select('person_id', { count: 'exact', head: true }).eq('calendar_entry_id', meeting1),
        sb.from('meeting_topic_teachers').select('person_id', { count: 'exact', head: true }).eq('calendar_entry_id', meeting1),
        sb.from('meeting_topics').select('id', { count: 'exact', head: true }).eq('calendar_entry_id', meeting1)
      ]);
      return [page.data, intents.count, teachers.count, topics.count];
    };
    const before = await snapshot();
    const Page = (await import('../src/app/(public)/i/plan/[token]/page')).default;
    const tree = await Page({ params: Promise.resolve({ token }), searchParams: Promise.resolve({}) });
    const client = walk(tree).find((e) => 'teacher' in e.props);
    expect([(client?.props.teacher as { week: { personId: number } } | null)?.week.personId, await snapshot()]).toEqual([adult, before]);
  });

  it('JuniorLeadersOwnLink_ShowsOnlyTheTeachingCard', async () => {
    const { token } = await link(junior, { scouts: [junior] });
    const Page = (await import('../src/app/(public)/i/plan/[token]/page')).default;
    const tree = await Page({ params: Promise.resolve({ token }), searchParams: Promise.resolve({}) });
    const client = walk(tree).find((e) => 'teacher' in e.props);
    expect([(client?.props.teacher as { week: { personId: number } } | null)?.week.personId, (client?.props.week as { scouts: unknown[] } | null)?.scouts.length ?? 0]).toEqual([junior, 0]);
  });

  it('LinkPage_OffersOnlyThatMeetingsDate', async () => {
    const { token } = await link(adult);
    const Page = (await import('../src/app/(public)/i/plan/[token]/page')).default;
    const tree = await Page({ params: Promise.resolve({ token }), searchParams: Promise.resolve({}) });
    const client = walk(tree).find((e) => 'teacher' in e.props);
    expect((client?.props.teacher as { choices: { dates: { entryId: number }[] } }).choices.dates.map((d) => d.entryId)).toEqual([meeting1]);
  });
});

describe('the teach core is not reachable as a server action', () => {
  it('TeachCore_IsNotAServerAction', () => {
    const src = readFileSync(path.resolve(__dirname, '../src/lib/teach-write.ts'), 'utf8');
    expect([/^\s*['"]use server['"]/m.test(src), src.includes("import 'server-only'")]).toEqual([false, true]);
  });

  it('NoServerActionFile_ExportsAFunctionTakingActorPersonId', () => {
    const files: string[] = [];
    const walkDir = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const p = path.join(dir, f);
        if (statSync(p).isDirectory()) walkDir(p);
        else if (/\.tsx?$/.test(f)) files.push(p);
      }
    };
    walkDir(path.resolve(__dirname, '../src'));
    const bad = files.filter((f) => {
      const src = readFileSync(f, 'utf8');
      if (!/^\s*['"]use server['"]/.test(src.replace(/^(\s*(\/\/[^\n]*|\/\*[\s\S]*?\*\/))*/, ''))) return false;
      return [...src.matchAll(/export\s+async\s+function\s+\w+\s*\(([^)]*)\)/g)].some((m) => m[1].includes('actorPersonId'));
    });
    expect(bad).toEqual([]);
  });
});
