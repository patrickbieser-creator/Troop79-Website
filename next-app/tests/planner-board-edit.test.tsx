import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within, act } from '@testing-library/react';
import type { PlannerBoard } from '../src/lib/meeting-planner-board';
import type { PersonDrawer } from '../src/lib/meeting-planner-drawer';

/**
 * The planner board for an editor (Plans/Meeting-Planner-II.md P2a): names open the person drawer, Assign sits beside
 * each person who could teach a request, "+ Add an offer" opens the offer drawer, Enter for someone finds a person.
 * Build a Plan B4 retired the nudges with the Offered card (Build's Invite… offers a class).
 * A viewer gets none of it. The server actions are mocked; their rules are tested in planner-actions.test.ts.
 */

const calls = vi.hoisted(() => ({
  open: vi.fn(),
  answer: vi.fn(),
  pick: vi.fn(),
  teach: vi.fn(),
  assign: vi.fn(),
  offer: vi.fn(),
  choices: vi.fn(),
  request: vi.fn(),
  remind: vi.fn(),
  refresh: vi.fn()
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: calls.refresh }) }));
vi.mock('../src/app/(public)/planner/actions', () => ({
  plannerStampAction: vi.fn(async () => ({ ok: false })),
  plannerOpenPersonAction: calls.open,
  plannerSetAnswerAction: calls.answer,
  plannerTogglePickAction: calls.pick,
  plannerToggleTeachAction: calls.teach,
  plannerAssignAction: calls.assign,
  plannerAddOfferAction: calls.offer,
  plannerOfferChoicesAction: calls.choices,
  plannerSendRequestAction: calls.request,
  plannerSendRemindersAction: calls.remind
}));
vi.mock('../src/app/(public)/planner/build-actions', () => ({ plannerAddOfferingAction: vi.fn() }));

import { PlannerBoardView } from '../src/app/(public)/planner/board-view';
import { PlannerProvider } from '../src/app/(public)/planner/planner-client';

const p = (personId: number, name: string) => ({ personId, name });
const counts = { coming: 1, undecided: 0, notComing: 0, noAnswer: 1, total: 2 };
const empty = { coming: [], undecided: [], notComing: [], noAnswer: [] };
const BOARD: PlannerBoard = {
  attendance: { scouts: counts, adults: counts },
  ready: [],
  noTeacher: [
    {
      key: 'tenderfoot-4a',
      codeLabel: 'Tenderfoot 4a',
      title: 'First aid basics',
      kind: 'rank',
      minutes: 30,
      waiting: [p(1, 'Finn P')],
      weeks: 1,
      canTeach: { coming: [{ ...p(11, 'Dan V'), status: 'Coming', requested: false }], undecided: [], noAnswer: [], total: 1 }
    }
  ],
  offered: [{ key: 'scout-1a', codeLabel: 'Scout 1a', title: 'Oath, Law, motto, slogan', kind: 'rank', teachers: [p(14, 'Alex S')], likelyFits: [p(4, 'Adi A')] }],
  haventAnswered: { scouts: [], adults: [] },
  whosComing: { scouts: [{ ...p(1, 'Finn P'), detail: 'First aid basics', nothingYet: false }], adults: [] },
  notSure: [],
  cantMakeIt: [],
  everyone: { scouts: { ...empty, coming: [{ ...p(1, 'Finn P'), tag: '1 pick' }] }, adults: { ...empty, coming: [{ ...p(11, 'Dan V'), tag: 'Free' }] } }
};

const SCOUT_DRAWER: PersonDrawer = {
  kind: 'scout',
  personId: 1,
  name: 'Finn P',
  sub: 'Working on Tenderfoot',
  intent: null,
  shown: 'coming',
  picked: 1,
  max: 5,
  options: [
    { key: 'tenderfoot-4a', title: 'First aid basics', meta: 'Tenderfoot 4a · no teacher yet', on: true, section: 'board' },
    { key: 'tenderfoot-3a', title: 'Knots', meta: 'Tenderfoot 3a · no teacher yet', on: false, section: 'more' }
  ]
};

/** The server's answer to ticking Knots on: what changed, not the whole drawer. */
const KNOTS_ON = { key: 'tenderfoot-3a', on: true, count: 2, intent: null, shown: 'coming' as const };

function renderBoard(canEdit = true, canEmail = true, board: PlannerBoard = BOARD) {
  return render(
    <PlannerProvider entryId={500} canEdit={canEdit} canEmail={canEmail} adults={[p(11, 'Dan V')]} stamp="s1">
      <PlannerBoardView board={board} heading={null} entryId={500} />
    </PlannerProvider>
  );
}

beforeEach(() => {
  // jsdom has no <dialog> modal API.
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  calls.open.mockResolvedValue({ ok: true, drawer: SCOUT_DRAWER, stamp: 's1' });
  calls.choices.mockResolvedValue({ ok: true, choices: [{ key: 'tenderfoot-3a', codeLabel: 'Tenderfoot 3a', label: 'Knots' }] });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('a viewer', () => {
  it('Viewer_GetsNoButtons_InsideTheProvider', () => {
    renderBoard(false);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
});

describe('an editor', () => {
  it('Editor_NameOpensTheirDrawer', async () => {
    renderBoard();
    fireEvent.click(screen.getAllByRole('button', { name: 'Finn P' })[0]);
    expect(await screen.findByText('Working on Tenderfoot')).toBeTruthy();
  });

  it('Drawer_TickingAPick_SavesItForTheScout', async () => {
    calls.pick.mockResolvedValue({ ok: true, tick: KNOTS_ON, stamp: 's2' });
    renderBoard();
    fireEvent.click(screen.getAllByRole('button', { name: 'Finn P' })[0]);
    fireEvent.click(await screen.findByRole('checkbox', { name: /Knots/ }));
    await waitFor(() => expect(calls.pick).toHaveBeenCalledWith({ entryId: 500, personId: 1, key: 'tenderfoot-3a', on: true }));
  });

  it('Drawer_TickingAPick_DoesNotRefreshTheBoard', async () => {
    calls.pick.mockResolvedValue({ ok: true, tick: KNOTS_ON, stamp: 's2' });
    renderBoard();
    fireEvent.click(screen.getAllByRole('button', { name: 'Finn P' })[0]);
    fireEvent.click(await screen.findByRole('checkbox', { name: /Knots/ }));
    await waitFor(() => expect(calls.pick).toHaveBeenCalled());
    await act(async () => {});
    expect(calls.refresh).not.toHaveBeenCalled();
  });

  it('Drawer_ClosingAfterATick_RefreshesTheBoardOnce', async () => {
    calls.pick.mockResolvedValue({ ok: true, tick: KNOTS_ON, stamp: 's2' });
    renderBoard();
    fireEvent.click(screen.getAllByRole('button', { name: 'Finn P' })[0]);
    fireEvent.click(await screen.findByRole('checkbox', { name: /Knots/ }));
    fireEvent.click(await screen.findByRole('checkbox', { name: /First aid/ }));
    await waitFor(() => expect(calls.pick).toHaveBeenCalledTimes(2));
    await act(async () => {});
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(calls.refresh).toHaveBeenCalledTimes(1));
  });

  it('Drawer_ClosingWithoutAChange_DoesNotRefreshTheBoard', async () => {
    renderBoard();
    fireEvent.click(screen.getAllByRole('button', { name: 'Finn P' })[0]);
    await screen.findByRole('checkbox', { name: /Knots/ });
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await act(async () => {});
    expect(calls.refresh).not.toHaveBeenCalled();
  });

  it('Drawer_TickingAPick_FlipsTheBoxBeforeTheServerAnswers', async () => {
    calls.pick.mockReturnValue(new Promise(() => {}));
    renderBoard();
    fireEvent.click(screen.getAllByRole('button', { name: 'Finn P' })[0]);
    fireEvent.click(await screen.findByRole('checkbox', { name: /Knots/ }));
    expect(screen.getByRole('checkbox', { name: /Knots/ }).getAttribute('aria-checked')).toBe('true');
  });

  it('Drawer_ARefusal_PutsTheBoxBack', async () => {
    calls.pick.mockResolvedValue({ ok: false, error: 'You have 5 picks.' });
    renderBoard();
    fireEvent.click(screen.getAllByRole('button', { name: 'Finn P' })[0]);
    fireEvent.click(await screen.findByRole('checkbox', { name: /Knots/ }));
    await screen.findByRole('alert');
    expect(screen.getByRole('checkbox', { name: /Knots/ }).getAttribute('aria-checked')).toBe('false');
  });

  it('Drawer_OtherOptions_StayClickableWhileATickSaves', async () => {
    calls.pick.mockReturnValue(new Promise(() => {}));
    renderBoard();
    fireEvent.click(screen.getAllByRole('button', { name: 'Finn P' })[0]);
    fireEvent.click(await screen.findByRole('checkbox', { name: /Knots/ }));
    expect(screen.getByRole('checkbox', { name: /First aid/ }).hasAttribute('disabled')).toBe(false);
  });

  it('Drawer_ASecondTick_WaitsForTheFirstWrite', async () => {
    let finish: (v: unknown) => void = () => {};
    calls.pick.mockReturnValueOnce(new Promise((r) => (finish = r))).mockResolvedValue({ ok: true, tick: { ...KNOTS_ON, key: 'tenderfoot-4a', on: false, count: 1 }, stamp: 's3' });
    renderBoard();
    fireEvent.click(screen.getAllByRole('button', { name: 'Finn P' })[0]);
    fireEvent.click(await screen.findByRole('checkbox', { name: /Knots/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /First aid/ }));
    await act(async () => {});
    const before = calls.pick.mock.calls.length;
    await act(async () => finish({ ok: true, tick: KNOTS_ON, stamp: 's2' }));
    await waitFor(() => expect([before, calls.pick.mock.calls.length]).toEqual([1, 2]));
  });

  it('Drawer_TheFivePickCap_CountsTicksNotYetSaved', async () => {
    calls.pick.mockReturnValue(new Promise(() => {}));
    calls.open.mockResolvedValue({
      ok: true,
      drawer: { ...SCOUT_DRAWER, picked: 4, options: [...SCOUT_DRAWER.options, { key: 'tenderfoot-5a', title: 'Swim', meta: '', on: false, section: 'more' }] },
      stamp: 's1'
    });
    renderBoard();
    fireEvent.click(screen.getAllByRole('button', { name: 'Finn P' })[0]);
    fireEvent.click(await screen.findByRole('checkbox', { name: /Knots/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Swim/ }));
    expect([(await screen.findByRole('alert')).textContent, calls.pick.mock.calls.length]).toEqual(['Already 5 picks. Untick one to add another.', 1]);
  });

  it('Drawer_TakesTheCountTheServerReturns', async () => {
    calls.pick.mockResolvedValue({ ok: true, tick: { ...KNOTS_ON, count: 3 }, stamp: 's2' });
    renderBoard();
    fireEvent.click(screen.getAllByRole('button', { name: 'Finn P' })[0]);
    fireEvent.click(await screen.findByRole('checkbox', { name: /Knots/ }));
    expect(await screen.findByText(/Picks · 3 of 5/)).toBeTruthy();
  });

  it('Drawer_ARefusal_IsSaidInPlace', async () => {
    calls.pick.mockResolvedValue({ ok: false, error: 'You have 5 picks.' });
    renderBoard();
    fireEvent.click(screen.getAllByRole('button', { name: 'Finn P' })[0]);
    fireEvent.click(await screen.findByRole('checkbox', { name: /Knots/ }));
    expect((await screen.findByRole('alert')).textContent).toBe('You have 5 picks.');
  });

  it('Drawer_AtFivePicks_SaysWhyWithoutSaving', async () => {
    calls.open.mockResolvedValue({ ok: true, drawer: { ...SCOUT_DRAWER, picked: 5 }, stamp: 's1' });
    renderBoard();
    fireEvent.click(screen.getAllByRole('button', { name: 'Finn P' })[0]);
    fireEvent.click(await screen.findByRole('checkbox', { name: /Knots/ }));
    expect([(await screen.findByRole('alert')).textContent, calls.pick.mock.calls.length]).toEqual(['Already 5 picks. Untick one to add another.', 0]);
  });

  it('Editor_AssignsAQualifiedTeacher', async () => {
    calls.assign.mockResolvedValue({ ok: true, stamp: 's2' });
    renderBoard();
    fireEvent.click(screen.getByRole('button', { name: 'Assign Dan V to First aid basics' }));
    expect(await screen.findByText('✓ Assigned')).toBeTruthy();
  });

  it('Assign_WhenTheConnectionDrops_SaysSoInPlace', async () => {
    calls.assign.mockRejectedValue(new Error('network'));
    renderBoard();
    fireEvent.click(screen.getByRole('button', { name: 'Assign Dan V to First aid basics' }));
    expect((await screen.findByRole('alert')).textContent).toBe('That didn’t save. Check your connection and try again.');
  });

  it('EnterForSomeone_FindsAPersonByName', () => {
    renderBoard();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Find a person' }), { target: { value: 'dan' } });
    const list = screen.getByText('Dan V', { selector: 'span' }).closest('ul')!;
    expect(within(list).getAllByRole('button')).toHaveLength(1);
  });

  it('AddOffer_WithoutATeacher_MarksTheTeacherList', async () => {
    renderBoard();
    fireEvent.click(screen.getAllByRole('button', { name: '+ Add an offer' })[0]);
    fireEvent.change(await screen.findByRole('searchbox', { name: 'Search requirements and merit badges' }), { target: { value: 'knots' } });
    fireEvent.click(await screen.findByRole('button', { name: /Knots/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Add offer' }));
    expect([(await screen.findByRole('alert')).textContent, calls.offer.mock.calls.length]).toEqual(['Choose who teaches it.', 0]);
  });

  it('AddOffer_WithATeacher_SavesIt', async () => {
    calls.offer.mockResolvedValue({ ok: true, drawer: SCOUT_DRAWER, stamp: 's2' });
    renderBoard();
    fireEvent.click(screen.getAllByRole('button', { name: '+ Add an offer' })[0]);
    fireEvent.change(await screen.findByRole('searchbox', { name: 'Search requirements and merit badges' }), { target: { value: 'knots' } });
    fireEvent.click(await screen.findByRole('button', { name: /Knots/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Dan V', pressed: false }));
    fireEvent.click(screen.getByRole('button', { name: 'Add offer' }));
    await waitFor(() => expect(calls.offer).toHaveBeenCalledWith({ entryId: 500, personId: 11, what: { key: 'tenderfoot-3a' } }));
  });
});

describe('email (P2b)', () => {
  it('AdultEditor_SeesSendRequest', () => {
    renderBoard();
    expect(screen.getByRole('button', { name: 'Send Dan V a request to teach First aid basics' })).toBeTruthy();
  });

  it('Spl_SeesNoEmailButtons_AndIsToldAdultsSendThem', () => {
    renderBoard(true, false);
    expect([screen.queryByRole('button', { name: /request to teach/ }), screen.getByText('Requests are emailed by adults.') != null]).toEqual([null, true]);
  });

  it('SendRequest_ShowsRequestSent', async () => {
    calls.request.mockResolvedValue({ ok: true, sent: ['Dan V'], skipped: [], stamp: 's2' });
    renderBoard();
    fireEvent.click(screen.getByRole('button', { name: 'Send Dan V a request to teach First aid basics' }));
    expect(await screen.findByText('✓ Request sent')).toBeTruthy();
  });
});

describe('reminders (P5b)', () => {
  const WAITING: PlannerBoard = { ...BOARD, haventAnswered: { scouts: [p(4, 'Adi A')], adults: [p(12, 'Kim L')] } };

  it('AdultEditor_RemindsEveryone_AfterOneConfirm', async () => {
    calls.remind.mockResolvedValue({ ok: true, sent: ['Adi A', 'Kim L'], reminded: [4, 12], skipped: [], stamp: 's2' });
    renderBoard(true, true, WAITING);
    fireEvent.click(screen.getByRole('button', { name: 'Remind everyone…' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send reminders' }));
    expect([await screen.findByText('✓ Reminded 2 people · just now') != null, calls.remind.mock.calls[0][0]]).toEqual([true, { entryId: 500, personIds: [4, 12] }]);
  });

  it('SendReminders_SendsOnce_WhenDoubleClicked', async () => {
    calls.remind.mockReturnValue(new Promise(() => {}));
    renderBoard(true, true, WAITING);
    fireEvent.click(screen.getByRole('button', { name: 'Remind everyone…' }));
    const send = screen.getByRole('button', { name: 'Send reminders' });
    act(() => {
      send.click();
      send.click();
    });
    expect(calls.remind).toHaveBeenCalledTimes(1);
  });

  it('SendReminders_IsDisabled_WhileSending', async () => {
    calls.remind.mockReturnValue(new Promise(() => {}));
    renderBoard(true, true, WAITING);
    fireEvent.click(screen.getByRole('button', { name: 'Remind everyone…' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send reminders' }));
    expect((await screen.findByRole('button', { name: 'Sending…' })).hasAttribute('disabled')).toBe(true);
  });

  it('Spl_SeesNoRemindButton', () => {
    renderBoard(true, false, WAITING);
    expect(screen.queryByRole('button', { name: 'Remind everyone…' })).toBeNull();
  });

  it('Drawer_Remind_ForSomeoneWhoHasntAnswered', async () => {
    calls.open.mockResolvedValue({ ok: true, drawer: { ...SCOUT_DRAWER, shown: null, picked: 0 }, stamp: 's1' });
    calls.remind.mockResolvedValue({ ok: false, error: 'They’ve already answered.' });
    renderBoard();
    fireEvent.click(screen.getAllByRole('button', { name: 'Finn P' })[0]);
    fireEvent.click(await screen.findByRole('button', { name: 'Remind Finn P' }));
    expect((await screen.findByRole('alert')).textContent).toBe('They’ve already answered.');
  });
});
