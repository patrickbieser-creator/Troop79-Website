import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, within, fireEvent, waitFor } from '@testing-library/react';
import type { LiveView } from '../src/lib/meeting-live-shared';

/**
 * The read-only Meeting Live view (Plans/Meeting-Planner-II.md, P4a; prototypes/meeting-plan-II/phone/live.html):
 * rotation columns on desktop, one rotation at a time with a switcher on a phone, conflict lines, the retake star, and
 * a single "Start Meeting Live" for editors before anyone has started it.
 */
const mocks = vi.hoisted(() => ({
  start: vi.fn(),
  refresh: vi.fn(),
  moveScout: vi.fn(),
  setTeacher: vi.fn(),
  moveClass: vi.fn(),
  repeatClass: vi.fn(),
  removeClass: vi.fn(),
  addRotation: vi.fn(),
  dropRotation: vi.fn(),
  setLocation: vi.fn(),
  addClass: vi.fn(),
  setPresent: vi.fn(),
  addVisitor: vi.fn()
}));
vi.mock('../src/app/(public)/planner/live-actions', () => ({
  plannerLiveStartAction: mocks.start,
  plannerLiveMoveScoutAction: mocks.moveScout,
  plannerLiveSetTeacherAction: mocks.setTeacher,
  plannerLiveMoveClassAction: mocks.moveClass,
  plannerLiveRepeatClassAction: mocks.repeatClass,
  plannerLiveRemoveClassAction: mocks.removeClass,
  plannerLiveAddRotationAction: mocks.addRotation,
  plannerLiveDropRotationAction: mocks.dropRotation,
  plannerLiveSetLocationAction: mocks.setLocation,
  plannerLiveAddClassAction: mocks.addClass,
  plannerLiveSetPresentAction: mocks.setPresent,
  plannerLiveAddVisitorAction: mocks.addVisitor
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));

import { LiveBoard } from '../src/app/(public)/planner/live/live-board';

const card = (o: Partial<LiveView['cards'][number]> & Pick<LiveView['cards'][number], 'id'>): LiveView['cards'][number] => ({
  topicKey: 'tenderfoot-4a',
  rotation: 1,
  title: 'First aid basics',
  codeLabel: 'Tenderfoot 4a',
  kind: 'rank',
  teacher: { personId: 10, name: 'Dan V', present: false },
  members: [],
  repeats: [],
  conflicts: [],
  version: 1,
  ...o
});

const VIEW: LiveView = {
  started: false,
  rotations: [
    { number: 1, location: 'Main hall' },
    { number: 2, location: null }
  ],
  cards: [
    card({ id: 's:a', members: [{ personId: 1, name: 'Finn P', retake: false, present: false, visitor: false }, { personId: 2, name: 'Lily P', retake: true, present: false, visitor: false }], repeats: [2], conflicts: ['Finn P also in the Rotation 2 repeat of this class'] }),
    card({ id: 's:b', rotation: 2, teacher: { personId: 11, name: 'Rachel D', present: false }, members: [{ personId: 1, name: 'Finn P', retake: false, present: false, visitor: false }], repeats: [1], conflicts: ['Finn P also in the Rotation 1 repeat of this class'] }),
    card({ id: 's:c', rotation: null, topicKey: 'scout-1a', title: 'Oath, Law, motto, slogan', codeLabel: 'Scout 1a', teacher: null })
  ],
  pool: [{ personId: 4, name: 'Simon P', present: false, visitor: false }],
  overlaps: 1
};

afterEach(() => {
  cleanup();
  for (const m of Object.values(mocks)) m.mockReset();
});

describe('LiveBoard', () => {
  it('Viewer_SeesEveryRotation_AndNoControls', () => {
    render(<LiveBoard view={VIEW} canEdit={false} entryId={5} />);
    const cols = ['Not scheduled', 'Rotation 1', 'Rotation 2'].map((name) => screen.getByRole('region', { name }));
    expect([cols.length, screen.queryByRole('button', { name: /Start Meeting Live/ })]).toEqual([3, null]);
  });

  it('Card_ShowsTeacherScoutsRepeatAndConflict', () => {
    render(<LiveBoard view={VIEW} canEdit={false} entryId={5} />);
    const r1 = screen.getByRole('region', { name: 'Rotation 1' });
    expect([
      within(r1).getByText('Dan V') != null,
      within(r1).getByText('Repeat · also R2') != null,
      within(r1).getByText('Finn P also in the Rotation 2 repeat of this class') != null
    ]).toEqual([true, true, true]);
  });

  it('RetakeScout_GetsTheStar', () => {
    render(<LiveBoard view={VIEW} canEdit={false} entryId={5} />);
    expect([screen.getByLabelText('Lily P, retake: already completed this') != null, screen.queryByLabelText('Finn P, retake: already completed this')]).toEqual([true, null]);
  });

  it('Header_CountsOverlaps', () => {
    render(<LiveBoard view={VIEW} canEdit={false} entryId={5} />);
    expect(screen.getByText('1 overlap')).toBeTruthy();
  });

  it('NotScheduled_HoldsThePool_AndUnscheduledCards', () => {
    render(<LiveBoard view={VIEW} canEdit={false} entryId={5} />);
    const u = screen.getByRole('region', { name: 'Not scheduled' });
    expect([within(u).getByText('Simon P') != null, within(u).getByText('Oath, Law, motto, slogan') != null, within(u).getByText('No teacher yet') != null]).toEqual([true, true, true]);
  });

  it('RotationLocation_ShowsUnderItsHeading', () => {
    render(<LiveBoard view={VIEW} canEdit={false} entryId={5} />);
    expect(within(screen.getByRole('region', { name: 'Rotation 1' })).getByText('Main hall')).toBeTruthy();
  });

  it('Phone_SwitcherSelectsOneRotation', () => {
    render(<LiveBoard view={VIEW} canEdit={false} entryId={5} />);
    fireEvent.click(screen.getByRole('tab', { name: /Rotation 2/ }));
    expect([
      screen.getByRole('tab', { name: /Rotation 2/ }).getAttribute('aria-selected'),
      screen.getByRole('tab', { name: /Rotation 1/ }).getAttribute('aria-selected'),
      screen.getByRole('region', { name: 'Rotation 2' }).dataset.phone,
      screen.getByRole('region', { name: 'Rotation 1' }).dataset.phone
    ]).toEqual(['true', 'false', 'shown', 'hidden']);
  });

  it('Editor_SeesStartMeetingLive_BeforeStart', () => {
    render(<LiveBoard view={VIEW} canEdit entryId={5} />);
    expect(screen.getByRole('button', { name: 'Start Meeting Live' })).toBeTruthy();
  });

  it('Editor_SeesNoStart_OnceStarted', () => {
    render(<LiveBoard view={{ ...VIEW, started: true }} canEdit entryId={5} />);
    expect(screen.queryByRole('button', { name: 'Start Meeting Live' })).toBeNull();
  });

  it('Start_CallsTheAction_AndRefreshes', async () => {
    mocks.start.mockResolvedValue({ ok: true, stamp: 'x' });
    render(<LiveBoard view={VIEW} canEdit entryId={5} />);
    fireEvent.click(screen.getByRole('button', { name: 'Start Meeting Live' }));
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled());
    expect(mocks.start).toHaveBeenCalledWith({ entryId: 5 });
  });

  it('Start_SaysWhyWhenRefused', async () => {
    mocks.start.mockResolvedValue({ ok: false, error: 'That meeting has passed.' });
    render(<LiveBoard view={VIEW} canEdit entryId={5} />);
    fireEvent.click(screen.getByRole('button', { name: 'Start Meeting Live' }));
    expect(await screen.findByText('That meeting has passed.')).toBeTruthy();
  });
});

const CHOICES = {
  teachers: [
    { personId: 10, name: 'Dan V' },
    { personId: 12, name: 'Jenna M' }
  ],
  topics: [{ key: 'scout-1a', label: 'Scout 1a · Oath, Law, motto, slogan' }],
  scouts: [
    { personId: 4, name: 'Simon P' },
    { personId: 5, name: 'Emory M' }
  ]
};
const ok = { ok: true, stamp: 'x' };
const editor = (v: Partial<LiveView> = {}) => render(<LiveBoard view={{ ...VIEW, started: true, ...v }} canEdit entryId={5} choices={CHOICES} />);

describe('LiveBoard editing (P4b)', () => {
  it('Viewer_SeesNoEditingControls', () => {
    render(<LiveBoard view={{ ...VIEW, started: true }} canEdit={false} entryId={5} choices={CHOICES} />);
    expect([
      screen.queryAllByRole('group', { name: /^Move .* to$/ }).length,
      screen.queryByRole('button', { name: /^Teacher:/ }),
      screen.queryByRole('button', { name: '+ Add rotation' })
    ]).toEqual([0, null, null]);
  });

  it('Editor_MoveTo_MovesTheClass', async () => {
    mocks.moveClass.mockResolvedValue(ok);
    editor();
    const r1 = screen.getByRole('region', { name: 'Rotation 1' });
    fireEvent.click(within(within(r1).getByRole('group', { name: 'Move First aid basics to' })).getByRole('button', { name: 'Rotation 2' }));
    await waitFor(() => expect(mocks.moveClass).toHaveBeenCalledWith({ entryId: 5, classId: 's:a', version: 1, rotation: 2 }));
  });

  it('StaleWrite_SaysSoAndRefreshes', async () => {
    mocks.moveClass.mockResolvedValue({ ok: false, stale: true, error: 'x' });
    editor();
    const r1 = screen.getByRole('region', { name: 'Rotation 1' });
    fireEvent.click(within(within(r1).getByRole('group', { name: 'Move First aid basics to' })).getByRole('button', { name: 'Not scheduled' }));
    expect(await screen.findByText('Someone else changed this. Here’s the latest.')).toBeTruthy();
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it('Editor_DragsACardOntoARotation', async () => {
    mocks.moveClass.mockResolvedValue(ok);
    window.matchMedia = vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }) as never;
    editor();
    const data = new Map<string, string>();
    const dataTransfer = { setData: (k: string, v: string) => data.set(k, v), getData: (k: string) => data.get(k) ?? '', types: ['application/x-live'], effectAllowed: 'move', dropEffect: 'move' };
    const r1 = screen.getByRole('region', { name: 'Rotation 1' });
    fireEvent.dragStart(within(r1).getByRole('article', { name: 'First aid basics' }), { dataTransfer });
    fireEvent.drop(screen.getByRole('region', { name: 'Rotation 2' }), { dataTransfer });
    await waitFor(() => expect(mocks.moveClass).toHaveBeenCalledWith({ entryId: 5, classId: 's:a', version: 1, rotation: 2 }));
  });

  it('Editor_PicksATeacherFromTheSheet', async () => {
    mocks.setTeacher.mockResolvedValue(ok);
    editor();
    fireEvent.click(within(screen.getByRole('region', { name: 'Rotation 1' })).getByRole('button', { name: 'Teacher: Dan V. Change' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /Jenna M/ }));
    await waitFor(() => expect(mocks.setTeacher).toHaveBeenCalledWith({ entryId: 5, classId: 's:a', version: 1, teacherId: 12 }));
  });

  it('Editor_RemovesAScoutFromAClass', async () => {
    mocks.moveScout.mockResolvedValue(ok);
    editor();
    fireEvent.click(within(screen.getByRole('region', { name: 'Rotation 2' })).getByRole('button', { name: /^Finn P/ }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /Remove from this class/ }));
    await waitFor(() => expect(mocks.moveScout).toHaveBeenCalledWith({ entryId: 5, personId: 1, from: 's:b', to: null }));
  });

  it('Editor_PutsAPoolScoutInAClass', async () => {
    mocks.moveScout.mockResolvedValue(ok);
    editor();
    fireEvent.click(within(screen.getByRole('region', { name: 'Not scheduled' })).getByRole('button', { name: /^Simon P/ }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^First aid basics · Rotation 2/ }));
    await waitFor(() => expect(mocks.moveScout).toHaveBeenCalledWith({ entryId: 5, personId: 4, from: null, to: 's:b' }));
  });

  it('Editor_AddsARotation', async () => {
    mocks.addRotation.mockResolvedValue(ok);
    editor();
    fireEvent.click(screen.getAllByRole('button', { name: '+ Add rotation' })[0]);
    await waitFor(() => expect(mocks.addRotation).toHaveBeenCalledWith({ entryId: 5, expectMax: 2 }));
  });

  it('Editor_AddsAnOfferToARotation', async () => {
    mocks.addClass.mockResolvedValue(ok);
    editor();
    fireEvent.click(within(screen.getByRole('region', { name: 'Rotation 2' })).getByRole('button', { name: '+ Add an offer' }));
    const dlg = screen.getByRole('dialog');
    fireEvent.change(within(dlg).getByLabelText('What'), { target: { value: 'scout-1a' } });
    fireEvent.change(within(dlg).getByLabelText('Teacher'), { target: { value: '12' } });
    fireEvent.click(within(dlg).getByRole('button', { name: 'Add to Rotation 2' }));
    await waitFor(() => expect(mocks.addClass).toHaveBeenCalledWith({ entryId: 5, key: 'scout-1a', title: null, teacherId: 12, rotation: 2 }));
  });
});

describe('LiveBoard add a scout (qa-lead, P4b)', () => {
  it('AddScout_ListsOnlyScoutsInNoClass', () => {
    render(
      <LiveBoard
        view={{ ...VIEW, started: true }}
        canEdit
        entryId={5}
        choices={{ ...CHOICES, scouts: [...CHOICES.scouts, { personId: 1, name: 'Finn P' }] }}
      />
    );
    fireEvent.click(within(screen.getByRole('region', { name: 'Not scheduled' })).getByRole('button', { name: 'Add a scout to Oath, Law, motto, slogan' }));
    const dlg = screen.getByRole('dialog');
    expect([within(dlg).queryByRole('button', { name: /^Finn P/ }), within(dlg).getByRole('button', { name: /^Simon P/ }) != null]).toEqual([null, true]);
  });
});

describe('LiveBoard attendance (P4c)', () => {
  const here = { ...VIEW, started: true, cards: VIEW.cards.map((c) => ({ ...c, members: c.members.map((m) => ({ ...m, present: m.personId === 1 })) })) };
  const open = { open: true, note: null };

  it('Viewer_SeesTheRedBanner', () => {
    render(<LiveBoard view={here} canEdit={false} entryId={5} attendance={open} />);
    expect(screen.getByRole('alert').textContent).toContain('View only: you can’t record attendance here.');
  });

  it('PresentScout_ShowsACheck', () => {
    render(<LiveBoard view={here} canEdit={false} entryId={5} attendance={open} />);
    expect(within(screen.getByRole('region', { name: 'Rotation 2' })).getByLabelText('Finn P, here').textContent).toBe('✓ Finn P');
  });

  it('Editor_MarksAScoutNotPresent_FromTheSheet', async () => {
    mocks.setPresent.mockResolvedValue(ok);
    render(<LiveBoard view={here} canEdit entryId={5} choices={CHOICES} attendance={open} />);
    fireEvent.click(within(screen.getByRole('region', { name: 'Rotation 2' })).getByRole('button', { name: /^Finn P/ }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /Mark not present/ }));
    await waitFor(() => expect(mocks.setPresent).toHaveBeenCalledWith({ entryId: 5, personId: 1, present: false }));
  });

  it('NotTheMeetingDay_SaysSo_AndOffersNoToggle', () => {
    render(<LiveBoard view={here} canEdit entryId={5} choices={CHOICES} attendance={{ open: false, note: 'Attendance opens on Sun, Oct 25.' }} />);
    expect(screen.getByText('Attendance opens on Sun, Oct 25.')).toBeTruthy();
    fireEvent.click(within(screen.getByRole('region', { name: 'Rotation 2' })).getByRole('button', { name: /^Finn P/ }));
    expect(within(screen.getByRole('dialog')).queryByRole('button', { name: /Mark (not present|here)/ })).toBeNull();
  });

  it('Editor_AddsAVisitorByName', async () => {
    mocks.addVisitor.mockResolvedValue(ok);
    render(<LiveBoard view={here} canEdit entryId={5} choices={CHOICES} attendance={open} />);
    fireEvent.click(within(screen.getByRole('region', { name: 'Rotation 1' })).getByRole('button', { name: 'Add a scout to First aid basics' }));
    const dlg = screen.getByRole('dialog');
    fireEvent.change(within(dlg).getByLabelText('Find a name'), { target: { value: 'Pat Q' } });
    fireEvent.click(within(dlg).getByRole('button', { name: '+ Add “Pat Q” as a visitor' }));
    await waitFor(() => expect(mocks.addVisitor).toHaveBeenCalledWith({ entryId: 5, name: 'Pat Q', to: 's:a' }));
  });
});
