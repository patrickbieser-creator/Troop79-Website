import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AdminActor } from '../src/lib/admin-actor';

/**
 * Where a Meeting Planner right meets the rest of the site (Plans/Meeting-Planner-II.md; qa-lead 2026-10-21):
 *   - the planner's stamp action answers viewers only, and only for the meeting the planner shows;
 *   - a view-only adult is not a leader to Menu Monster (leaderActor).
 */

const mocks = vi.hoisted(() => ({
  actor: null as AdminActor | null,
  nextEntryId: 500 as number | null
}));

vi.mock('../src/lib/admin-actor', async (orig) => ({
  ...(await orig<typeof import('../src/lib/admin-actor')>()),
  resolveAdminActor: async () => mocks.actor
}));
vi.mock('server-only', () => ({}));
vi.mock('../src/lib/supabase/server', () => ({ createAdminClient: () => ({}) }));
vi.mock('../src/lib/people-lists', () => ({ loadPlannerLists: async () => ({ meetingLabels: ['Troop Meeting'], leaderIds: [], pool: null }) }));
vi.mock('../src/lib/meeting-board', () => ({
  loadNextMeeting: async () => (mocks.nextEntryId == null ? null : { entryId: mocks.nextEntryId }),
  loadBoardStamp: async () => 'stamp-1'
}));

import { plannerStampAction } from '../src/app/(public)/planner/actions';
import { leaderActor } from '../src/app/(public)/library/_tools/menu-monster/typed-in-owner';

const actor = (capabilities: string[], subjectKind: 'adult' | 'scout' = 'adult'): AdminActor => ({
  kind: 'identity',
  label: 'Test Person',
  personId: 7,
  capabilities: new Set(capabilities) as AdminActor['capabilities'],
  legacyRole: null,
  subjectKind
});

beforeEach(() => {
  mocks.actor = null;
  mocks.nextEntryId = 500;
});

describe('plannerStampAction', () => {
  it('Viewer_GetsTheStamp_ForTheNextMeeting', async () => {
    mocks.actor = actor(['meeting_planner.view']);
    expect(await plannerStampAction(500)).toEqual({ ok: true, stamp: 'stamp-1' });
  });

  it('Viewer_IsRefused_ForAnyOtherMeeting', async () => {
    mocks.actor = actor(['meeting_planner.view']);
    expect(await plannerStampAction(499)).toEqual({ ok: false });
  });

  it('PersonWithoutAPlannerRight_IsRefused', async () => {
    mocks.actor = actor(['news.write']);
    expect(await plannerStampAction(500)).toEqual({ ok: false });
  });

  it('SignedOut_IsRefused', async () => {
    expect(await plannerStampAction(500)).toEqual({ ok: false });
  });

  it('NonIntegerId_IsRefused', async () => {
    mocks.actor = actor(['meeting_planner.view']);
    expect(await plannerStampAction(1.5)).toEqual({ ok: false });
  });
});

describe('Menu Monster leaderActor', () => {
  it('ViewOnlyAdult_IsNotALeader', async () => {
    mocks.actor = actor(['meeting_planner.view']);
    expect(await leaderActor()).toEqual({ ok: false, error: 'Only leaders can do that.' });
  });

  it('AdultWithALeaderRight_IsALeader', async () => {
    mocks.actor = actor(['calendar.write']);
    expect(await leaderActor()).toEqual({ personId: 7, label: 'Test Person' });
  });
});
