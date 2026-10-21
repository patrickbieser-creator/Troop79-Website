import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import { PlannerBoardView } from '../src/app/(public)/planner/board-view';
import type { PlannerBoard } from '../src/lib/meeting-planner-board';

/**
 * The read-only planner board (Plans/Meeting-Planner-II.md, P1): a viewer sees everything (Decision 4) and there are no
 * controls yet (P2 adds them for editors).
 */

const p = (personId: number, name: string) => ({ personId, name });
const counts = { coming: 2, undecided: 1, notComing: 1, noAnswer: 2, total: 6 };
const wall = { coming: [{ ...p(1, 'Finn P'), tag: '1 pick' }], undecided: [], notComing: [{ ...p(3, 'Todd M'), tag: 'Picks saved' }], noAnswer: [{ ...p(4, 'Adi A'), tag: 'Scout' }] };

const BOARD: PlannerBoard = {
  attendance: { scouts: counts, adults: counts },
  ready: [{ key: 'star-6', codeLabel: 'Star 6', title: 'Cyber Chip for grade', kind: 'rank', minutes: 15, teachers: [p(10, 'Patrick B')], scouts: [p(2, 'Anjali S')] }],
  noTeacher: [
    {
      key: 'tenderfoot-4a',
      codeLabel: 'Tenderfoot 4a',
      title: 'First aid basics',
      kind: 'rank',
      minutes: 30,
      waiting: [p(1, 'Finn P')],
      weeks: 3,
      canTeach: {
        coming: [{ ...p(11, 'Dan V'), status: 'Coming', requested: false }],
        undecided: [],
        noAnswer: [{ ...p(12, 'Joe M'), status: 'Hasn’t answered · a request invites them', requested: true }],
        total: 2
      }
    }
  ],
  offered: [{ key: 'scout-1a', codeLabel: 'Scout 1a', title: 'Oath, Law, motto, slogan', kind: 'rank', teachers: [p(14, 'Alex S')], likelyFits: [p(4, 'Adi A')] }],
  haventAnswered: { scouts: [p(4, 'Adi A')], adults: [p(15, 'Karen O')] },
  whosComing: { scouts: [{ ...p(1, 'Finn P'), detail: 'First aid basics', nothingYet: false }], adults: [{ ...p(11, 'Dan V'), detail: 'Not teaching yet: free to assign', nothingYet: true }] },
  notSure: [p(5, 'Emory M')],
  cantMakeIt: [{ ...p(3, 'Todd M'), saved: 2 }],
  everyone: { scouts: wall, adults: { coming: [], undecided: [], notComing: [], noAnswer: [] } }
};

afterEach(cleanup);

describe('PlannerBoardView', () => {
  it('Viewer_SeesFullBoard_WithNoControls', () => {
    render(<PlannerBoardView board={BOARD} heading={<h1>Sunday</h1>} />);
    for (const h of ['Ready to teach', 'Requests with no teacher', 'Offered, no takers yet', 'Haven’t answered', 'Who’s coming', 'Everyone']) {
      expect(screen.getByRole('heading', { name: new RegExp(h) })).toBeTruthy();
    }
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('NoTeacher_ShowsWhoCanTeach_GroupedByAnswer', () => {
    render(<PlannerBoardView board={BOARD} heading={null} />);
    const list = screen.getByText('2 people can teach this').closest('details')!;
    expect(within(list).getByText('Coming · 1')).toBeTruthy();
    expect(within(list).getByText('Haven’t answered · 1')).toBeTruthy();
  });

  it('NoTeacher_SaysWhenARequestWasAlreadySent', () => {
    render(<PlannerBoardView board={BOARD} heading={null} />);
    expect(screen.getByText(/a request invites them · request sent/)).toBeTruthy();
  });

  it('NoTeacher_SaysHowLongItHasBeenAsked', () => {
    render(<PlannerBoardView board={BOARD} heading={null} />);
    expect(screen.getByText('1 scout waiting · asked 3 weeks running')).toBeTruthy();
  });

  it('CantMakeIt_ShowsPicksSavedForLater', () => {
    render(<PlannerBoardView board={BOARD} heading={null} />);
    expect(screen.getByText('Todd M · 2 saved for later')).toBeTruthy();
  });

  it('ReadyToTeach_ShowsItsEmptyState', () => {
    render(<PlannerBoardView board={{ ...BOARD, ready: [] }} heading={null} />);
    expect(screen.getByText(/Nothing is ready yet/)).toBeTruthy();
  });

  it('Offered_ListsLikelyFits', () => {
    render(<PlannerBoardView board={BOARD} heading={null} />);
    const row = screen.getByText('Oath, Law, motto, slogan').closest('li')!;
    expect(within(row).getByText('Adi A')).toBeTruthy();
  });

  it('NoTeacher_SaysTheTimeOnce', () => {
    render(<PlannerBoardView board={BOARD} heading={null} />);
    expect(screen.getByText('about 30 min')).toBeTruthy();
  });
});
