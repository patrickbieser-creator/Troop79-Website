import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { adminClient } from './helpers/admin-client';
import { TEST_PREFIX } from './helpers/signup-fixtures';

/**
 * The refusals at the action entry points (qa-lead 2026-10-28): a family answers only for their own household's scouts
 * and only on an open troop meeting. (The SPL's email refusals live with the Emails screen's tests.) Real local database; the actor, the session and "today" (2085-02-20) are mocked.
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
vi.mock('next/headers', () => ({ headers: async () => new Headers({ 'x-forwarded-for': '203.0.113.79' }) }));
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
  await sb.from('meeting_plan_pages').delete().in('calendar_entry_id', [meeting, campout]);
  await sb.from('meeting_invite_failures').delete().eq('ip', '203.0.113.79');
  await sb.from('meeting_topic_picks').delete().in('calendar_entry_id', [meeting, campout]);
  await sb.from('meeting_intents').delete().in('calendar_entry_id', [meeting, campout]);
  await sb.from('meeting_topics').delete().in('calendar_entry_id', [meeting, campout]);
  await sb.from('calendar_entries').delete().in('id', [meeting, campout]);
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

describe('the email link answers only for the scouts it was minted for (Emails E2, qa-lead)', () => {
  async function link(scoutIds: number[]) {
    const { mintPlanPage } = await import('../src/lib/plan-pages');
    const { data } = await sb.from('people').select('session_epoch').eq('id', parent).single();
    return mintPlanPage(sb, { entryId: meeting, recipientId: parent, epoch: (data as { session_epoch: number }).session_epoch, scoutIds, expiresAt: '2085-03-05T00:00:00Z' });
  }

  it('TokenPage_CannotWrite_AScoutOffTheLink', async () => {
    const { token } = await link([ownScout]);
    const { planPageWriteAction } = await import('../src/app/(public)/i/plan/actions');
    expect((await planPageWriteAction({ token, scoutId: otherScout, op: { op: 'answer', choice: 'out' } })).ok).toBe(false);
  });

  it('TokenPage_AnswersForTheLinksOwnScout', async () => {
    const { token } = await link([ownScout]);
    const { planPageWriteAction } = await import('../src/app/(public)/i/plan/actions');
    expect((await planPageWriteAction({ token, scoutId: ownScout, op: { op: 'answer', choice: 'ok' } })).ok).toBe(true);
  });

  it('TokenPage_UnknownToken_IsRefused', async () => {
    const { planPageWriteAction } = await import('../src/app/(public)/i/plan/actions');
    expect((await planPageWriteAction({ token: 'f'.repeat(64), scoutId: ownScout, op: { op: 'answer', choice: 'ok' } })).ok).toBe(false);
  });
});

describe('the Emails screen is adults with the edit right only (Emails E3, Q9)', () => {
  it('ScoutEditor_IsRefused_WhenQueuingEmails', async () => {
    state.actor = { personId: ownScout, label: 'SPL', subjectKind: 'scout', capabilities: new Set(['meeting_planner.edit']) };
    const { emailsQueueAction } = await import('../src/app/(public)/planner/emails/actions');
    expect((await emailsQueueAction({ entryId: meeting, emails: [{ kind: 'plan', recipientId: parent, scoutIds: [ownScout] }] })).ok).toBe(false);
  });

  it('LeaderWithoutPlannerRights_CannotQueueEmails', async () => {
    state.actor = { personId: adult, label: 'Leader', subjectKind: 'adult', capabilities: new Set(['roster.edit', 'meeting_planner.view']) };
    const { emailsQueueAction } = await import('../src/app/(public)/planner/emails/actions');
    expect((await emailsQueueAction({ entryId: meeting, emails: [{ kind: 'plan', recipientId: parent, scoutIds: [ownScout] }] })).ok).toBe(false);
  });

  it('SendNext_IsRefused_ForAScoutEditor', async () => {
    state.actor = { personId: ownScout, label: 'SPL', subjectKind: 'scout', capabilities: new Set(['meeting_planner.edit']) };
    const { emailsSendNextAction } = await import('../src/app/(public)/planner/emails/actions');
    expect((await emailsSendNextAction({ entryId: meeting, batchId: '00000000-0000-4000-8000-000000000001' })).ok).toBe(false);
  });

  it('SendNext_RefusesAMalformedBatch', async () => {
    state.actor = { personId: adult, label: 'Leader', subjectKind: 'adult', capabilities: new Set(['meeting_planner.edit']) };
    const { emailsSendNextAction } = await import('../src/app/(public)/planner/emails/actions');
    expect((await emailsSendNextAction({ entryId: meeting, batchId: 'x' })).ok).toBe(false);
  });
});

describe('Send again is adults with the edit right only (qa-lead E3)', () => {
  it('ScoutEditor_IsRefused_WhenSendingAgain', async () => {
    state.actor = { personId: ownScout, label: 'SPL', subjectKind: 'scout', capabilities: new Set(['meeting_planner.edit']) };
    const { emailsRequeueAction } = await import('../src/app/(public)/planner/emails/actions');
    expect((await emailsRequeueAction({ entryId: meeting, ids: [1] })).ok).toBe(false);
  });
});
