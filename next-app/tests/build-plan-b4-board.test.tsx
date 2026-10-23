import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import type { PlannerBoard } from '../src/lib/meeting-planner-board';

/**
 * Build a Plan B4 (Plans/Build-A-Plan.md "Consolidation", Decision 4), Who's coming: the tab is renamed and sits second;
 * the seed drawer, the Meeting focus strip and the class cards that Build's rows now carry (Ready, Offered no takers)
 * are gone, replaced by an "Edit the plan" link to /planner/build for this meeting; "+ Add an offer" stays (Decision
 * 10a) and a teacher-less offer goes through Build's own add. Server actions are mocked.
 */
const calls = vi.hoisted(() => ({ add: vi.fn(), offer: vi.fn(), choices: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: calls.refresh }), usePathname: () => '/planner' }));
vi.mock('../src/app/(public)/planner/actions', () => ({
  plannerStampAction: vi.fn(async () => ({ ok: false })),
  plannerOpenPersonAction: vi.fn(),
  plannerSetAnswerAction: vi.fn(),
  plannerTogglePickAction: vi.fn(),
  plannerToggleTeachAction: vi.fn(),
  plannerAssignAction: vi.fn(),
  plannerAddOfferAction: calls.offer,
  plannerOfferChoicesAction: calls.choices,
  plannerSendRequestAction: vi.fn(),
  plannerSendRemindersAction: vi.fn()
}));
vi.mock('../src/app/(public)/planner/build-actions', () => ({ plannerAddOfferingAction: calls.add }));

const { PlannerBoardView } = await import('../src/app/(public)/planner/board-view');
const { PlannerProvider } = await import('../src/app/(public)/planner/planner-client');
const { PlannerTabs } = await import('../src/app/(public)/planner/planner-tabs');

const p = (personId: number, name: string) => ({ personId, name });
const counts = { coming: 1, undecided: 0, notComing: 0, noAnswer: 1, total: 2 };
const empty = { coming: [], undecided: [], notComing: [], noAnswer: [] };
const BOARD: PlannerBoard = {
  attendance: { scouts: counts, adults: counts },
  ready: [{ key: 'star-6', codeLabel: 'Star 6', title: 'Cyber Chip for grade', kind: 'rank', minutes: 15, teachers: [p(10, 'Patrick B')], scouts: [p(2, 'Anjali S')], seededBy: 'Pat B' }],
  noTeacher: [],
  offered: [{ key: 'scout-1a', codeLabel: 'Scout 1a', title: 'Oath, Law, motto, slogan', kind: 'rank', teachers: [p(14, 'Alex S')], likelyFits: [p(4, 'Adi A')] }],
  haventAnswered: { scouts: [p(4, 'Adi A')], adults: [] },
  whosComing: { scouts: [{ ...p(1, 'Finn P'), detail: 'First aid basics', nothingYet: false }], adults: [] },
  notSure: [],
  cantMakeIt: [],
  everyone: { scouts: { ...empty, coming: [{ ...p(1, 'Finn P'), tag: '1 pick' }] }, adults: empty }
};

function renderBoard(o: { canEdit?: boolean; canSeed?: boolean } = {}) {
  return render(
    <PlannerProvider entryId={500} canEdit={o.canEdit ?? true} canEmail canSeed={o.canSeed ?? true} adults={[p(11, 'Dan V')]} stamp="s1">
      <PlannerBoardView board={BOARD} heading={null} entryId={500} />
    </PlannerProvider>
  );
}

beforeEach(() => {
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  calls.choices.mockResolvedValue({ ok: true, choices: [{ key: 'tenderfoot-3a', codeLabel: 'Tenderfoot 3a', label: 'Knots' }] });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Who's coming", () => {
  it('WhoComing_TabRenamed', () => {
    render(<PlannerTabs active="board" />);
    expect(screen.getAllByRole('tab').map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
      ['Who’s coming', '/planner'],
      ['Build a Plan', '/planner/build'],
      ['Invite', '/planner/invite'],
      ['Meeting Live', '/planner/live'],
      ['Focus sets', '/planner/focus-sets'],
      ['Has/Needs', '/planner/has-needs']
    ]);
  });

  it('Board_HasNoSeedDrawer', () => {
    renderBoard();
    expect([screen.queryByRole('button', { name: 'Seed this meeting' }), screen.queryByText('Meeting focus'), screen.getByRole('link', { name: 'Edit the plan' }).getAttribute('href')]).toEqual([
      null,
      null,
      '/planner/build?meeting=500'
    ]);
  });

  it('Board_ClassCardsMovedToBuild', () => {
    renderBoard();
    expect([screen.queryByRole('heading', { name: /Ready to teach/ }), screen.queryByRole('heading', { name: /Offered, no takers/ }), screen.getByRole('heading', { name: /Haven’t answered/ }) != null]).toEqual([
      null,
      null,
      true
    ]);
  });

  it('Board_KeepsOneAddAnOffer', () => {
    renderBoard();
    expect(screen.getAllByRole('button', { name: '+ Add an offer' })).toHaveLength(1);
  });

  it('Viewer_SeesThePlanLink_NotEdit', () => {
    renderBoard({ canEdit: false, canSeed: false });
    expect([screen.queryByRole('link', { name: 'Edit the plan' }), screen.getByRole('link', { name: 'See the plan' }).getAttribute('href')]).toEqual([null, '/planner/build?meeting=500']);
  });

  it('AddOffer_NoTeacher_GoesThroughBuildsAdd', async () => {
    calls.add.mockResolvedValue({ ok: true, added: ['tenderfoot-3a'], teachers: {}, prior: 's1', stamp: 's2' });
    renderBoard();
    fireEvent.click(screen.getByRole('button', { name: '+ Add an offer' }));
    fireEvent.change(await screen.findByRole('searchbox', { name: 'Search requirements and merit badges' }), { target: { value: 'knots' } });
    fireEvent.click(await screen.findByRole('button', { name: /Knots/ }));
    fireEvent.click(screen.getByRole('button', { name: /No teacher yet/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Add offer' }));
    await waitFor(() => expect([calls.add.mock.calls[0]?.[0], calls.offer.mock.calls.length]).toEqual([{ entryId: 500, keys: ['tenderfoot-3a'] }, 0]));
  });
});
