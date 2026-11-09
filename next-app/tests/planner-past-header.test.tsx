import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import type { ThisWeek } from '../src/lib/this-week';

/**
 * A past meeting, view only (Patrick, 2026-11-09): the header says so, offers the past strip and a way back, and has
 * no Live toggle; This week offers "Earlier weeks". Both offer Print PDF.
 */
const fn = () => vi.fn(async () => ({ ok: true as const }));
vi.mock('../src/app/(public)/planner/this-week-actions', () =>
  Object.fromEntries(
    ['twAddFocusSetAction', 'twRemoveFocusAction', 'twSetStationsAction', 'twOrderStationsAction', 'twRotationMoveAction', 'twSetAlsoAction', 'twSetNightBadgeAction', 'twSetRoleAction', 'twSetTeacherAction', 'twSetPresentAction', 'twStampAction', 'twAddRequirementAction', 'twRemoveRequirementAction', 'twSplitGroupAction', 'twMergeGroupAction', 'twUnmergeGroupAction', 'twPreviewSplitAction', 'twApplySplitAction'].map((n) => [n, fn()])
  )
);
vi.mock('../src/app/(public)/planner/saved-plan-actions', () => ({ twSavePlanAction: fn(), twLoadPlanAction: fn(), twUpdatePlanAction: fn(), twDeletePlanAction: fn() }));
vi.mock('../src/app/(public)/planner/focus-actions', () => ({ focusSaveSetAction: fn(), focusSearchAction: fn() }));
vi.mock('../src/app/(public)/planner/planner-poller', () => ({ PlannerPoller: () => null }));
vi.mock('../src/app/(public)/planner/planner-client', () => ({
  usePlanner: () => ({ canEdit: false, canSeed: false, canEmail: false, sync: { run: (w: () => Promise<unknown>) => w() } }),
  SAVE_FAILED: 'That didn’t save.',
  PersonName: ({ name }: { name: string }) => name
}));
const { ThisWeekView } = await import('../src/app/(public)/planner/this-week-client');

const view: ThisWeek = {
  focus: [{ key: 'fg:1', setId: 1, name: 'Citizenship' }],
  badges: [],
  groups: [],
  sections: [],
  older: [],
  extras: [],
  helpers: [],
  coverage: { counted: 0, rankWork: 0, nothing: 0, pct: 0, groupsWithoutTeacher: 0 },
  answers: { scouts: { coming: 0, undecided: 0, notComing: 0, none: 0 }, adults: { coming: 0, undecided: 0, notComing: 0, none: 0 } },
  adultsNoAnswer: [],
  responses: { coming: { scouts: [], adults: [] }, undecided: { scouts: [], adults: [] }, not_coming: { scouts: [], adults: [] } },
  unplaced: [],
  everyone: [],
  rotation: null,
  doubles: []
};

const props = {
  entryId: 141,
  dayLabel: 'Sunday, November 8, 2026',
  title: 'Troop Meeting',
  weeks: [{ entryId: 141, dayLabel: 'Sun, Nov 8', planned: true, current: true }],
  view,
  sets: [],
  badges: [],
  stamp: 's',
  canSeed: false,
  isToday: false,
  live: { present: [] },
  meetingDate: '2026-11-08',
  savedPlans: []
};

afterEach(cleanup);

describe('Planner header, past meeting', () => {
  it('PastMeeting_SaysItIsViewOnly', () => {
    render(<ThisWeekView {...props} past={{ olderHref: null, newerHref: null }} />);
    expect(screen.getByText('Meeting Planner · Past meeting · view only')).toBeTruthy();
  });

  it('PastMeeting_HasNoLiveToggle', () => {
    render(<ThisWeekView {...props} past={{ olderHref: null, newerHref: null }} />);
    expect(screen.queryByRole('radio', { name: 'Live at the meeting' })).toBeNull();
  });

  it('PastMeeting_OffersBackToThisWeek', () => {
    render(<ThisWeekView {...props} past={{ olderHref: null, newerHref: null }} />);
    expect(screen.getByRole('link', { name: 'Back to this week' }).getAttribute('href')).toBe('/planner');
  });

  it('PastMeeting_OffersOlderWeeks_WhenThereAreSome', () => {
    render(<ThisWeekView {...props} past={{ olderHref: '/planner?meeting=100', newerHref: null }} />);
    expect(screen.getByRole('link', { name: '← Older' }).getAttribute('href')).toBe('/planner?meeting=100');
  });

  it('PastMeeting_OffersThePdf', () => {
    render(<ThisWeekView {...props} past={{ olderHref: null, newerHref: null }} />);
    expect(screen.getByRole('link', { name: 'Print PDF' }).getAttribute('href')).toBe('/planner/print/141');
  });
});

describe('Planner header, this week', () => {
  it('ThisWeek_OffersEarlierWeeks', () => {
    render(<ThisWeekView {...props} earlierHref="/planner?meeting=140" />);
    expect(screen.getByRole('link', { name: '← Earlier weeks' }).getAttribute('href')).toBe('/planner?meeting=140');
  });

  it('ThisWeek_KeepsTheLiveToggle', () => {
    render(<ThisWeekView {...props} />);
    expect(screen.getByRole('radio', { name: 'Live at the meeting' })).toBeTruthy();
  });
});
