import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, within, fireEvent, waitFor } from '@testing-library/react';
import type { LiveView } from '../src/lib/meeting-live-shared';

/**
 * Rotations L0 on the Live screen (Plans/Build-A-Plan.md, "Rotations"): a "Needs attention (n)" strip at the top of a
 * started arrangement, each case marked in place too (problems-marked-in-place), each with its one-click fix through
 * Live's actions. Viewers see the strip without buttons. Keep hides a line for this visit only. "Coming, nothing
 * assigned" is now "Not in a class yet", and each chip says what the scout picked. Server actions are mocked.
 */
const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  moveScout: vi.fn(),
  setTeacher: vi.fn(),
  removeClass: vi.fn(),
  makeClass: vi.fn(),
  useClassTeacher: vi.fn()
}));
vi.mock('../src/app/(public)/planner/live-actions', () => ({
  plannerLiveStartAction: vi.fn(),
  plannerLiveMoveScoutAction: mocks.moveScout,
  plannerLiveSetTeacherAction: mocks.setTeacher,
  plannerLiveMoveClassAction: vi.fn(),
  plannerLiveRepeatClassAction: vi.fn(),
  plannerLiveRemoveClassAction: mocks.removeClass,
  plannerLiveAddRotationAction: vi.fn(),
  plannerLiveDropRotationAction: vi.fn(),
  plannerLiveSetLocationAction: vi.fn(),
  plannerLiveAddClassAction: vi.fn(),
  plannerLiveSetPresentAction: vi.fn(),
  plannerLiveAddVisitorAction: vi.fn(),
  plannerLiveDiscardAction: vi.fn(),
  plannerLiveMakeClassAction: mocks.makeClass,
  plannerLiveUseClassTeacherAction: mocks.useClassTeacher
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));

import { LiveBoard } from '../src/app/(public)/planner/live/live-board';

const member = (personId: number, name: string) => ({ personId, name, retake: false, present: false, visitor: false });
const VIEW: LiveView = {
  started: true,
  rotations: [
    { number: 1, location: null },
    { number: 2, location: null }
  ],
  cards: [
    {
      id: 'c:1',
      topicKey: 'scout-1a',
      rotation: 1,
      title: 'Oath',
      codeLabel: 'Scout 1a',
      kind: 'rank',
      teacher: { personId: 10, name: 'Dan K', present: false },
      members: [member(1, 'Finn P')],
      repeats: [],
      conflicts: [],
      version: 3
    },
    { id: 'c:2', topicKey: 'tenderfoot-4a', rotation: null, title: 'First aid', codeLabel: 'Tenderfoot 4a', kind: 'rank', teacher: null, members: [], repeats: [], conflicts: [], version: 1 }
  ],
  pool: [{ personId: 4, name: 'Anjali S', present: false, visitor: false, picks: ['Star 6 · Cyber Chip'] }],
  overlaps: 0,
  drift: [
    { id: 'o:star-6', kind: 'offering', key: 'star-6', label: 'Star 6', teacherId: 12 },
    { id: 'p:4:star-6', kind: 'pick', key: 'star-6', label: 'Star 6', personId: 4, name: 'Anjali S' },
    { id: 'x:c:1:1', kind: 'cant', classId: 'c:1', title: 'Oath', personId: 1, name: 'Finn P' },
    { id: 't:c:1:10:12', kind: 'teacher', classId: 'c:1', version: 3, title: 'Oath', plan: { personId: 12, name: 'Maria L' }, current: { personId: 10, name: 'Dan K' } },
    { id: 'r:c:2', kind: 'orphan', classId: 'c:2', version: 1, title: 'First aid' }
  ]
};
const strip = () => screen.getByRole('region', { name: /^Needs attention/ });
const ok = { ok: true, stamp: 's' };

afterEach(() => {
  cleanup();
  for (const m of Object.values(mocks)) m.mockReset();
});

describe('Needs attention (Rotations L0)', () => {
  it('Drift_Strip_ListsEachCase', () => {
    render(<LiveBoard view={VIEW} canEdit entryId={1} />);
    expect(within(strip()).getAllByRole('listitem').map((li) => li.querySelector('p')?.textContent)).toEqual([
      'Star 6 has no class',
      'Anjali S picked Star 6 · no class',
      'Finn P said Can’t make it · in Oath',
      'Oath: the plan says Maria L, the class has Dan K',
      'First aid is no longer on the plan'
    ]);
  });

  it('Drift_Strip_CountsInTheHeading', () => {
    render(<LiveBoard view={VIEW} canEdit entryId={1} />);
    expect(within(strip()).getByRole('heading', { name: 'Needs attention (5)' })).toBeTruthy();
  });

  it('Drift_NotStarted_HasNoStrip', () => {
    render(<LiveBoard view={{ ...VIEW, started: false, drift: [] }} canEdit entryId={1} />);
    expect(screen.queryByRole('region', { name: /^Needs attention/ })).toBeNull();
  });

  it('Drift_Viewer_NoButtons', () => {
    render(<LiveBoard view={VIEW} canEdit={false} entryId={1} />);
    expect([within(strip()).getAllByRole('listitem').length, within(strip()).queryAllByRole('button').length]).toEqual([5, 0]);
  });

  it('Drift_MakeClass_CallsTheAction', async () => {
    mocks.makeClass.mockResolvedValue(ok);
    render(<LiveBoard view={VIEW} canEdit entryId={1} />);
    fireEvent.click(within(strip()).getByRole('button', { name: 'Make a class' }));
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled());
    expect(mocks.makeClass.mock.calls).toEqual([[{ entryId: 1, key: 'star-6' }]]);
  });

  it('Drift_CreateClassAndPlace_CallsTheSameAction', async () => {
    mocks.makeClass.mockResolvedValue(ok);
    render(<LiveBoard view={VIEW} canEdit entryId={1} />);
    fireEvent.click(within(strip()).getByRole('button', { name: 'Create class and place' }));
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled());
    expect(mocks.makeClass.mock.calls).toEqual([[{ entryId: 1, key: 'star-6' }]]);
  });

  it('Drift_RemoveFromClass_MovesTheScoutOut', async () => {
    mocks.moveScout.mockResolvedValue(ok);
    render(<LiveBoard view={VIEW} canEdit entryId={1} />);
    fireEvent.click(within(strip()).getByRole('button', { name: 'Remove from class' }));
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled());
    expect(mocks.moveScout.mock.calls).toEqual([[{ entryId: 1, personId: 1, from: 'c:1', to: null }]]);
  });

  it('Drift_Keep_HidesForThisVisit_WritesNothing', () => {
    render(<LiveBoard view={VIEW} canEdit entryId={1} />);
    fireEvent.click(within(strip()).getByRole('button', { name: 'Keep' }));
    expect([within(strip()).getAllByRole('listitem').length, mocks.moveScout.mock.calls.length]).toEqual([4, 0]);
  });

  it('Drift_TeacherMismatch_ButtonsNameThePeople', () => {
    render(<LiveBoard view={VIEW} canEdit entryId={1} />);
    expect([within(strip()).getByRole('button', { name: 'Use Maria L' }) != null, within(strip()).getByRole('button', { name: 'Use Dan K' }) != null]).toEqual([true, true]);
  });

  it('Drift_TeacherMismatch_UsePlan_SetsTheClassTeacher', async () => {
    mocks.setTeacher.mockResolvedValue(ok);
    render(<LiveBoard view={VIEW} canEdit entryId={1} />);
    fireEvent.click(within(strip()).getByRole('button', { name: 'Use Maria L' }));
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled());
    expect(mocks.setTeacher.mock.calls).toEqual([[{ entryId: 1, classId: 'c:1', version: 3, teacherId: 12 }]]);
  });

  it('Drift_TeacherMismatch_UseClass_SetsThePlanTeacher', async () => {
    mocks.useClassTeacher.mockResolvedValue(ok);
    render(<LiveBoard view={VIEW} canEdit entryId={1} />);
    fireEvent.click(within(strip()).getByRole('button', { name: 'Use Dan K' }));
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled());
    expect(mocks.useClassTeacher.mock.calls).toEqual([[{ entryId: 1, classId: 'c:1', version: 3, teacherId: 10 }]]);
  });

  it('Drift_OrphanClass_RemoveClass_CallsRemove', async () => {
    mocks.removeClass.mockResolvedValue(ok);
    render(<LiveBoard view={VIEW} canEdit entryId={1} />);
    fireEvent.click(within(strip()).getByRole('button', { name: 'Remove class' }));
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled());
    expect(mocks.removeClass.mock.calls).toEqual([[{ entryId: 1, classId: 'c:2', version: 1 }]]);
  });

  it('Drift_OrphanClass_KeepAsExtra_Hides', () => {
    render(<LiveBoard view={VIEW} canEdit entryId={1} />);
    fireEvent.click(within(strip()).getByRole('button', { name: 'Keep as extra' }));
    expect(within(strip()).queryByText('First aid is no longer on the plan')).toBeNull();
  });

  it('Drift_StaleFix_SaysSomeoneElseChangedIt', async () => {
    mocks.makeClass.mockResolvedValue({ ok: false, error: 'x', stale: true });
    render(<LiveBoard view={VIEW} canEdit entryId={1} />);
    fireEvent.click(within(strip()).getByRole('button', { name: 'Make a class' }));
    expect(await screen.findByText('Someone else changed this. Here’s the latest.')).toBeTruthy();
  });

  it('Drift_MarkedInPlace_OnTheCard', () => {
    render(<LiveBoard view={VIEW} canEdit entryId={1} />);
    const card = screen.getByRole('article', { name: 'Oath' });
    expect([card.dataset.problem, within(card).getByText('Oath: the plan says Maria L, the class has Dan K') != null]).toEqual(['true', true]);
  });

  it('Drift_MarkedInPlace_OnTheScoutChip', () => {
    render(<LiveBoard view={VIEW} canEdit entryId={1} />);
    const card = screen.getByRole('article', { name: 'Oath' });
    expect(within(card).getByRole('button', { name: /^Finn P/ }).closest('li')?.dataset.problem).toBe('true');
  });

  it('Drift_MarkedInPlace_OnThePoolChip', () => {
    render(<LiveBoard view={VIEW} canEdit entryId={1} />);
    const pool = screen.getByRole('region', { name: /^Not in a class yet/ });
    expect(within(pool).getByRole('button', { name: /^Anjali S/ }).closest('li')?.dataset.problem).toBe('true');
  });
});

describe('Not in a class yet', () => {
  it('NotInAClassYet_IsThePoolsName', () => {
    render(<LiveBoard view={VIEW} canEdit entryId={1} />);
    expect(screen.getByRole('heading', { name: 'Not in a class yet · 1' })).toBeTruthy();
  });

  it('NotInAClassYet_ShowsPick', () => {
    render(<LiveBoard view={VIEW} canEdit={false} entryId={1} />);
    const pool = screen.getByRole('region', { name: /^Not in a class yet/ });
    expect(within(pool).getByText('Star 6 · Cyber Chip')).toBeTruthy();
  });
});

/**
 * L0 qa (accessibility): a fix never drops focus on <body>. The fix buttons stay focusable while a write is out
 * (aria-disabled + a guard, not disabled); once the line goes, focus moves to the next line's first button, or to the
 * strip heading when no line follows; the persistent status says "Fixed · n left" or "All fixed".
 */
describe('Needs attention: focus after a fix (L0 qa)', () => {
  const without = (...ids: string[]): LiveView => ({ ...VIEW, drift: VIEW.drift.filter((d) => !ids.includes(d.id)) });
  async function fixed(name: string, next: LiveView, mock: keyof typeof mocks) {
    mocks[mock].mockResolvedValue(ok);
    const r = render(<LiveBoard view={VIEW} canEdit entryId={1} />);
    const button = within(strip()).getByRole('button', { name });
    button.focus();
    fireEvent.click(button);
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled());
    r.rerender(<LiveBoard view={next} canEdit entryId={1} />);
  }

  it('Fix_WhileSaving_ButtonStaysFocusable', () => {
    mocks.moveScout.mockReturnValue(new Promise(() => {}));
    render(<LiveBoard view={VIEW} canEdit entryId={1} />);
    const button = within(strip()).getByRole('button', { name: 'Remove from class' });
    fireEvent.click(button);
    expect([button.hasAttribute('disabled'), button.getAttribute('aria-disabled')]).toEqual([false, 'true']);
  });

  it('Fix_WhileSaving_SecondClickWritesNothing', () => {
    mocks.moveScout.mockReturnValue(new Promise(() => {}));
    render(<LiveBoard view={VIEW} canEdit entryId={1} />);
    fireEvent.click(within(strip()).getByRole('button', { name: 'Remove from class' }));
    fireEvent.click(within(strip()).getByRole('button', { name: 'Make a class' }));
    expect(mocks.makeClass).not.toHaveBeenCalled();
  });

  it('Fix_LineGoes_FocusMovesToTheNextLine', async () => {
    await fixed('Remove from class', without('x:c:1:1'), 'moveScout');
    expect(document.activeElement?.textContent).toBe('Use Maria L');
  });

  it('Fix_LineGoes_FocusNeverOnBody', async () => {
    await fixed('Remove from class', without('x:c:1:1'), 'moveScout');
    expect(document.activeElement === document.body).toBe(false);
  });

  it('Fix_LastLineInTheList_FocusesTheHeading', async () => {
    await fixed('Remove class', without('r:c:2'), 'removeClass');
    expect(document.activeElement).toBe(within(strip()).getByRole('heading'));
  });

  it('Fix_LineGoes_AnnouncesHowManyAreLeft', async () => {
    await fixed('Remove from class', without('x:c:1:1'), 'moveScout');
    expect(screen.getByRole('status').textContent).toBe('Fixed · 4 left');
  });

  it('Fix_LastLineOfAll_AnnouncesAllFixed', async () => {
    await fixed('Remove class', { ...VIEW, drift: [] }, 'removeClass');
    expect(screen.getByRole('status').textContent).toBe('All fixed');
  });

  it('Fix_LastLineOfAll_FocusesTheHeading', async () => {
    await fixed('Remove class', { ...VIEW, drift: [] }, 'removeClass');
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: /^Needs attention/ }));
  });

  it('Keep_FocusMovesToTheNextLine', () => {
    render(<LiveBoard view={VIEW} canEdit entryId={1} />);
    fireEvent.click(within(strip()).getByRole('button', { name: 'Keep' }));
    expect(document.activeElement?.textContent).toBe('Use Maria L');
  });

  it('KeepAsExtra_LastLine_FocusesTheHeading', () => {
    render(<LiveBoard view={VIEW} canEdit entryId={1} />);
    fireEvent.click(within(strip()).getByRole('button', { name: 'Keep as extra' }));
    expect(document.activeElement).toBe(within(strip()).getByRole('heading'));
  });

  it('Keep_AnnouncesHowManyAreLeft', () => {
    render(<LiveBoard view={VIEW} canEdit entryId={1} />);
    fireEvent.click(within(strip()).getByRole('button', { name: 'Keep' }));
    expect(screen.getByRole('status').textContent).toBe('Fixed · 4 left');
  });

  // L0 qa follow-up: a failed fix forgets the line, so a later change elsewhere doesn't steal focus or say "Fixed".
  it('Fix_Failed_LaterChangeDoesNotMoveFocus', async () => {
    mocks.moveScout.mockResolvedValue({ ok: false, error: 'Nope' });
    const r = render(<LiveBoard view={VIEW} canEdit entryId={1} />);
    fireEvent.click(within(strip()).getByRole('button', { name: 'Remove from class' }));
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled());
    within(strip()).getByRole('button', { name: 'Make a class' }).focus();
    r.rerender(<LiveBoard view={without('x:c:1:1')} canEdit entryId={1} />);
    expect(document.activeElement?.textContent).toBe('Make a class');
  });

  // L0 qa follow-up: "All fixed" belongs to that moment; new drift resets it, so the strip goes once that drift does.
  it('AllFixed_NewDriftThenNone_StripGoes', async () => {
    mocks.removeClass.mockResolvedValue(ok);
    const r = render(<LiveBoard view={VIEW} canEdit entryId={1} />);
    fireEvent.click(within(strip()).getByRole('button', { name: 'Remove class' }));
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled());
    r.rerender(<LiveBoard view={{ ...VIEW, drift: [] }} canEdit entryId={1} />);
    r.rerender(<LiveBoard view={VIEW} canEdit entryId={1} />);
    r.rerender(<LiveBoard view={{ ...VIEW, drift: [] }} canEdit entryId={1} />);
    expect(screen.queryByRole('region', { name: /^Needs attention/ })).toBeNull();
  });

  it('MakeClass_PartialNote_IsShown', async () => {
    mocks.makeClass.mockResolvedValue({ ...ok, note: 'Made the class; 1 scout couldn’t be placed: Ben T.' });
    render(<LiveBoard view={VIEW} canEdit entryId={1} />);
    fireEvent.click(within(strip()).getByRole('button', { name: 'Make a class' }));
    expect(await screen.findByText('Made the class; 1 scout couldn’t be placed: Ben T.')).toBeTruthy();
  });
});

describe('Needs attention: the pool chip names its problem (L0 qa)', () => {
  it('PoolChip_AccessibleName_IncludesTheProblem', () => {
    render(<LiveBoard view={VIEW} canEdit entryId={1} />);
    const pool = screen.getByRole('region', { name: /^Not in a class yet/ });
    expect(within(pool).getByRole('button', { name: /Anjali S picked Star 6 · no class/ })).toBeTruthy();
  });
});
