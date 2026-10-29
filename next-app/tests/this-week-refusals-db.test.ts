import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { adminClient } from './helpers/admin-client';
import { TEST_PREFIX } from './helpers/signup-fixtures';

/**
 * The refusals at the action entry points (qa-lead 2026-10-28): a scout editor (the SPL) never publishes or asks by
 * email; Ask by email only for a class on the plan; a family answers only for their own household's scouts and only
 * on an open troop meeting. Real local database; the actor, the session and "today" (2085-02-20) are mocked.
 * Test-owned rows only: a 2085 meeting and a 2085 campout, deleted by id. Real people are only read.
 */
const sb = adminClient();
const state = vi.hoisted(() => ({
  actor: null as null | { personId: number; label: string; subjectKind: 'adult' | 'scout'; capabilities: Set<string> },
  session: null as null | { personId: number; subjectKind: 'adult' | 'scout' }
}));
vi.mock('@/lib/supabase/server', async () => {
  const { adminClient: make } = await import('./helpers/admin-client');
  return { createAdminClient: () => make() };
});
vi.mock('@/lib/admin-actor', () => ({ resolveAdminActor: async () => state.actor }));
vi.mock('@/lib/family-access', () => ({ getIdentitySessionIfValid: async () => state.session }));
vi.mock('@/lib/identity-session', async (orig) => ({ ...(await orig<typeof import('../src/lib/identity-session')>()), isEpochCurrent: async () => true }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), updateTag: vi.fn(), revalidateTag: vi.fn(), unstable_cache: (fn: unknown) => fn }));
vi.mock('@/lib/dates', async (orig) => ({ ...(await orig<typeof import('../src/lib/dates')>()), centralToday: () => '2085-02-20' }));

let meeting = 0;
let campout = 0;
let adult = 0;
let parent = 0;
let ownScout = 0;
let otherScout = 0;

beforeAll(async () => {
  await sb.from('calendar_entries').delete().like('title', `%${TEST_PREFIX}%`).gte('entry_date', '2085-01-01').lte('entry_date', '2085-12-31');
  const ins = async (category: string) => {
    const { data, error } = await sb.from('calendar_entries').insert({ entry_date: '2085-03-04', category, title: `${category} ${TEST_PREFIX} REF`, status: 'published' }).select('id').single();
    if (error) throw new Error(error.message);
    return data!.id as number;
  };
  meeting = await ins('Troop Meeting');
  campout = await ins('Campout / Overnight');
  const { data: leaders } = await sb.from('person_directory').select('person_id').eq('tab', 'leader').eq('in_picker', true).order('person_id').limit(1);
  adult = ((leaders ?? []) as { person_id: number }[])[0].person_id;
  // A parent sharing a household with an active scout, and a scout outside that household.
  const { data: active } = await sb.from('scouts').select('person_id').eq('active', true).not('person_id', 'is', null);
  const scoutIds = ((active ?? []) as { person_id: number }[]).map((r) => r.person_id);
  const { data: hm } = await sb.from('household_members').select('household_id, person_id');
  const rows = (hm ?? []) as { household_id: number; person_id: number }[];
  const { data: dir } = await sb.from('person_directory').select('person_id').in('tab', ['leader', 'adult']).eq('in_picker', true);
  const adults = new Set(((dir ?? []) as { person_id: number }[]).map((r) => r.person_id));
  const hit = rows.find((r) => adults.has(r.person_id) && rows.some((x) => x.household_id === r.household_id && scoutIds.includes(x.person_id)))!;
  parent = hit.person_id;
  const mine = new Set(rows.filter((r) => rows.some((x) => x.person_id === parent && x.household_id === r.household_id)).map((r) => r.person_id));
  ownScout = scoutIds.find((id) => mine.has(id))!;
  otherScout = scoutIds.find((id) => !mine.has(id))!;
});

afterAll(async () => {
  await sb.from('meeting_topic_picks').delete().in('calendar_entry_id', [meeting, campout]);
  await sb.from('meeting_intents').delete().in('calendar_entry_id', [meeting, campout]);
  await sb.from('meeting_topics').delete().in('calendar_entry_id', [meeting, campout]);
  await sb.from('calendar_entries').delete().in('id', [meeting, campout]);
});

describe('email is adults only', () => {
  it('ScoutEditor_IsRefused_WhenPublishing', async () => {
    state.actor = { personId: ownScout, label: 'SPL', subjectKind: 'scout', capabilities: new Set(['meeting_planner.edit']) };
    const { twPublishAction } = await import('../src/app/(public)/planner/this-week-publish-actions');
    expect((await twPublishAction({ entryId: meeting, everyone: false })).ok).toBe(false);
  });

  it('ScoutEditor_IsRefused_WhenAskingByEmail', async () => {
    state.actor = { personId: ownScout, label: 'SPL', subjectKind: 'scout', capabilities: new Set(['meeting_planner.edit']) };
    const { twAskTeacherAction } = await import('../src/app/(public)/planner/this-week-actions');
    expect((await twAskTeacherAction({ entryId: meeting, key: 'fr:tenderfoot', personId: adult })).ok).toBe(false);
  });

  it('AskByEmail_ForAClassNotOnThePlan_IsRefused', async () => {
    state.actor = { personId: adult, label: 'Leader', subjectKind: 'adult', capabilities: new Set(['meeting_planner.edit']) };
    const { twAskTeacherAction } = await import('../src/app/(public)/planner/this-week-actions');
    const res = await twAskTeacherAction({ entryId: meeting, key: 'tenderfoot-5', personId: adult });
    expect(res.ok ? 'sent' : res.error).toBe('That isn’t on this meeting’s plan.');
  });
});

describe('a family answers only for their own scouts, on an open meeting', () => {
  it('Family_CannotAnswerForAnotherHouseholdsScout', async () => {
    state.session = { personId: parent, subjectKind: 'adult' };
    const { familyWriteAction } = await import('../src/app/(public)/member/meeting/family-actions');
    expect((await familyWriteAction({ entryId: meeting, scoutId: otherScout, op: { op: 'answer', choice: 'ok' } })).ok).toBe(false);
  });

  it('Family_AnswersForTheirOwnScout', async () => {
    state.session = { personId: parent, subjectKind: 'adult' };
    const { familyWriteAction } = await import('../src/app/(public)/member/meeting/family-actions');
    expect((await familyWriteAction({ entryId: meeting, scoutId: ownScout, op: { op: 'answer', choice: 'ok' } })).ok).toBe(true);
  });

  it('Family_CannotAnswerOnACampout', async () => {
    state.session = { personId: parent, subjectKind: 'adult' };
    const { familyWriteAction } = await import('../src/app/(public)/member/meeting/family-actions');
    expect((await familyWriteAction({ entryId: campout, scoutId: ownScout, op: { op: 'answer', choice: 'ok' } })).ok).toBe(false);
  });
});
