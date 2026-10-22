import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { adminClient } from './helpers/admin-client';
import { TEST_PREFIX } from './helpers/signup-fixtures';

/**
 * /member/meeting after P5a/P5c (Plans/Meeting-Planner-II.md, Decision 10): a merit badge night is just a meeting. A
 * meeting with a board row (v1's merit badge nights had one; the stored mode is gone) shows the ordinary pick list. Real
 * local database; the sign-in and "which meeting is next" seams are mocked to the fixture. Fixtures are dated 2092.
 */
const sb = adminClient();
const state = vi.hoisted(() => ({ entryId: 0, personId: 0 }));
vi.mock('@/lib/supabase/server', async () => {
  const { adminClient: make } = await import('./helpers/admin-client');
  return { createAdminClient: () => make() };
});
vi.mock('@/lib/member-viewer', () => ({
  resolveMemberViewer: async () => ({ kind: 'own', switchOptions: [] }),
  loadProxyFamily: async () => ({ personIds: [] })
}));
vi.mock('@/lib/family-access', () => ({ getIdentitySessionIfValid: async () => ({ personId: state.personId, subjectKind: 'scout' }) }));
vi.mock('@/lib/identity-session', () => ({ isEpochCurrent: async () => true }));
vi.mock('@/lib/admin-actor', () => ({ resolveAdminActor: async () => null, actorHas: () => false }));
vi.mock('@/lib/meeting-board', async (orig) => {
  const real = await orig<typeof import('@/lib/meeting-board')>();
  return { ...real, loadNextMeeting: (s: Parameters<typeof real.loadMeetingById>[0]) => real.loadMeetingById(s, state.entryId) };
});
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => '/member/meeting' }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), updateTag: vi.fn(), unstable_cache: (fn: unknown) => fn }));

let scoutId = '';

beforeAll(async () => {
  const { data: entry, error: e1 } = await sb
    .from('calendar_entries')
    .insert({ entry_date: '2092-05-04', category: 'Troop Meeting', title: `Troop Meeting ${TEST_PREFIX}` })
    .select('id')
    .single();
  if (e1) throw new Error(e1.message);
  state.entryId = entry!.id as number;
  const { error: e2 } = await sb.from('meeting_boards').insert({ calendar_entry_id: state.entryId });
  if (e2) throw new Error(e2.message);
  const { data: p, error: e3 } = await sb.from('people').insert({ display_name: `${TEST_PREFIX} MMP Ann`, first_name: `${TEST_PREFIX} MMP`, last_name: 'Ann' }).select('id').single();
  if (e3) throw new Error(e3.message);
  state.personId = p!.id as number;
  scoutId = `vitest-mmp-${state.personId}`;
  const { error: e4 } = await sb
    .from('scouts')
    .insert({ id: scoutId, first_name: `${TEST_PREFIX} MMP`, last_name: 'Ann', display_name: `${TEST_PREFIX} MMP Ann`, person_id: state.personId, active: true, current_rank: 'scout' });
  if (e4) throw new Error(e4.message);
});

afterAll(async () => {
  await sb.from('meeting_boards').delete().eq('calendar_entry_id', state.entryId);
  await sb.from('calendar_entries').delete().eq('id', state.entryId);
  await sb.from('scouts').delete().eq('id', scoutId);
  await sb.from('people').delete().eq('id', state.personId);
});

describe('/member/meeting on a meeting with a board row', () => {
  it('MemberMeetingPage_ShowsRankBoard_WhenTheMeetingHasABoardRow', async () => {
    const { default: Page } = await import('../src/app/(public)/member/meeting/page');
    const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }));
    expect([html.includes('Merit badge night'), html.includes('Your picks')]).toEqual([false, true]);
  });
});
