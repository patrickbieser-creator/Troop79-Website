import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import type { ThisWeek, TwPerson } from '../src/lib/this-week';

/** Live at the meeting (Plans/Completed/Meeting-Planner-III.md, Decision 10): the plan as session cards; tap to check in
 *  on the meeting day only; can't-come scouts aren't listed; Helping teach has no teacher slot. */
const m = vi.hoisted(() => ({ present: vi.fn(async () => ({ ok: true as const, stamp: 's' })), canEdit: true }));
vi.mock('../src/app/(public)/planner/this-week-actions', () => ({ twSetPresentAction: m.present }));
vi.mock('../src/app/(public)/planner/planner-client', () => ({
  usePlanner: () => ({ canEdit: m.canEdit, sync: { run: (w: () => Promise<unknown>) => w() } }),
  SAVE_FAILED: 'That didn’t save.'
}));
const { LiveView } = await import('../src/app/(public)/planner/this-week-live');

const p = (personId: number, name: string, intent: TwPerson['intent'] = 'coming'): TwPerson => ({ personId, name, rank: 'scout', rankName: 'Scout', intent });
const view: ThisWeek = {
  focus: [{ key: 'fg:1', setId: 1, name: 'Citizenship' }],
  badges: [],
  groups: [
    {
      key: 'fr:tenderfoot',
      kind: 'rank',
      refId: 'tenderfoot',
      name: 'Tenderfoot',
      subtitle: 'Working on Tenderfoot',
      columns: [{ key: 'tenderfoot-7a', code: '7a', label: 'Flag', need: 2, subs: [] }],
      members: [p(1, 'Adi A'), p(2, 'Ben B', 'not_coming')],
      teachers: [],
      candidates: []
    }
  ],
  sections: [],
  older: [],
  extras: [],
  helpers: [p(3, 'Finn P')],
  coverage: { counted: 2, rankWork: 2, nothing: 0, pct: 100, groupsWithoutTeacher: 1 },
  answers: { scouts: { coming: 2, undecided: 0, notComing: 1, none: 0 }, adults: { coming: 0, undecided: 0, notComing: 0, none: 0 } },
  adultsNoAnswer: [],
  unplaced: [],
  everyone: []
};

afterEach(() => {
  cleanup();
  m.present.mockClear();
});

describe('Live at the meeting', () => {
  it('Live_ShowsOneCardPerGroup_AndHelpingTeach', () => {
    render(<LiveView entryId={1} view={view} isToday present={[]} />);
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(['Tenderfoot group', 'Helping teach']);
  });

  it('Live_LeavesOutScoutsWhoCantCome', () => {
    render(<LiveView entryId={1} view={view} isToday present={[]} />);
    expect(screen.queryByRole('button', { name: /Ben B/ })).toBeNull();
  });

  it('Live_HelpingTeach_HasNoTeacherSlot', () => {
    render(<LiveView entryId={1} view={view} isToday present={[]} />);
    const card = screen.getByRole('heading', { name: 'Helping teach' }).closest('section')!;
    expect(within(card).queryByText('No teachers yet')).toBeNull();
  });

  it('Live_TapOnTheMeetingDay_ChecksTheScoutIn', async () => {
    render(<LiveView entryId={1} view={view} isToday present={[]} />);
    screen.getByRole('button', { name: 'Adi A' }).click();
    await vi.waitFor(() => expect(m.present).toHaveBeenCalledWith({ entryId: 1, personId: 1, present: true }));
  });

  it('Live_BeforeTheMeetingDay_NamesAreNotTappable', () => {
    render(<LiveView entryId={1} view={view} isToday={false} present={[]} />);
    expect((screen.getByRole('button', { name: 'Adi A' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
