import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PickListView, ScoutBoardView, TrayPick } from '../src/lib/meeting-board-picklist';

/**
 * /member/meeting (Phase 1): the scout's side of the board. Saves on tap; a pick while "Can't make it" asks when; a
 * 6th pick says why in place; ranking is optional. The server actions are the mock boundary.
 */
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
const calls = vi.hoisted(() => ({
  add: vi.fn(),
  remove: vi.fn(),
  order: vi.fn(),
  note: vi.fn(),
  intent: vi.fn()
}));
vi.mock('../src/app/(public)/member/meeting/actions', () => ({
  meetingAddPickAction: calls.add,
  meetingRemovePickAction: calls.remove,
  meetingSetOrderAction: calls.order,
  meetingSetNoteAction: calls.note,
  meetingSetIntentAction: calls.intent
}));

const { ScoutBoard } = await import('../src/app/(public)/member/meeting/scout-board');

const tray = (key: string, label: string, over: Partial<TrayPick> = {}): TrayPick => ({
  key,
  label,
  codeLabel: `Tenderfoot ${key.split('-')[1]}`,
  kind: 'rank',
  priority: null,
  later: false,
  note: null,
  firstAskedOn: '2026-10-18',
  enteredByPersonId: 7,
  carriedFrom: null,
  addedBy: null,
  ...over
});
const LIST: PickListView = {
  nextRankId: 'tenderfoot',
  groups: [
    {
      rankId: 'tenderfoot',
      title: 'Tenderfoot',
      next: true,
      rows: [
        { key: 'tenderfoot-1a', kind: 'rank', code: '1a', label: 'Pack for a campout', codeLabel: 'Tenderfoot 1a', outing: true, others: '' },
        { key: 'tenderfoot-3a', kind: 'rank', code: '3a', label: 'Knots', codeLabel: 'Tenderfoot 3a', outing: false, others: 'Finn P, Anjali S +4' },
        { key: 'tenderfoot-4a', kind: 'rank', code: '4a', label: 'First aid', codeLabel: 'Tenderfoot 4a', outing: false, others: '' },
        { key: 'tenderfoot-5a', kind: 'rank', code: '5a', label: 'Buddy system', codeLabel: 'Tenderfoot 5a', outing: false, others: '' }
      ]
    }
  ],
  working: [],
  badges: [{ key: 'mb:art', kind: 'mb', code: null, label: 'Art', codeLabel: 'Merit badge', outing: false, others: '' }]
};

function board(view: Partial<ScoutBoardView> = {}, over: Partial<Parameters<typeof ScoutBoard>[0]> = {}) {
  return render(
    <ScoutBoard
      entryId={1}
      mode="rank"
      mbName={null}
      blockCount={2}
      dayName="Sunday"
      subject={{ personId: 7, firstName: 'Finn', isSelf: true }}
      initial={{ personId: 7, intent: null, picks: [], ...view }}
      pickList={LIST}
      onBehalf={false}
      readOnly={false}
      {...over}
    />
  );
}
const ok = (view: Partial<ScoutBoardView>) => ({ ok: true as const, view: { personId: 7, intent: null, picks: [], ...view } });

beforeEach(() => {
  for (const f of Object.values(calls)) f.mockReset();
});

describe('ScoutBoard', () => {
  it('Scout_PickWhileNotComing_AsksWhen_DefaultsLater', async () => {
    calls.add.mockResolvedValue(ok({ intent: 'not_coming', picks: [tray('tenderfoot-4a', 'First aid', { later: true })] }));
    board({ intent: 'not_coming' });
    await userEvent.click(screen.getByRole('button', { name: /First aid/ }));
    const ask = screen.getByRole('group', { name: 'When' });
    const later = within(ask).getByRole('button', { name: 'Later' });
    expect([document.activeElement === later, calls.add.mock.calls.length]).toEqual([true, 0]);
    await userEvent.click(later);
    expect(calls.add).toHaveBeenCalledWith({ entryId: 1, personId: 7, onBehalf: false, key: 'tenderfoot-4a', later: true, markComing: false });
  });

  it('Scout_PickWhileNotComing_AtSundaysMeeting_MarksComing', async () => {
    calls.add.mockResolvedValue(ok({ intent: 'coming', picks: [tray('tenderfoot-4a', 'First aid')] }));
    board({ intent: 'not_coming' });
    await userEvent.click(screen.getByRole('button', { name: /First aid/ }));
    await userEvent.click(screen.getByRole('button', { name: 'At Sunday’s meeting' }));
    expect(calls.add.mock.calls[0][0]).toMatchObject({ later: false, markComing: true });
  });

  it('Scout_CanSavePicks_WithoutRanking', async () => {
    calls.add.mockResolvedValue(ok({ picks: [tray('tenderfoot-4a', 'First aid')] }));
    board();
    await userEvent.click(screen.getByRole('button', { name: /First aid/ }));
    expect([calls.add.mock.calls[0][0], calls.order.mock.calls.length, await screen.findByText('Your picks (1 of 5)')]).toEqual([
      { entryId: 1, personId: 7, onBehalf: false, key: 'tenderfoot-4a' },
      0,
      expect.anything()
    ]);
  });

  it('Scout_IsRefusedSixthPick_SaysWhyInPlace', async () => {
    const five = ['a', 'b', 'c', 'd', 'e'].map((k) => tray(`tenderfoot-9${k}`, `Thing ${k}`));
    board({ picks: five });
    await userEvent.click(screen.getByRole('button', { name: /Knots/ }));
    expect([screen.getByRole('alert').textContent, calls.add.mock.calls.length]).toEqual(['You have 5. Take one off to add this.', 0]);
  });

  it('Scout_TapsAPickedRow_TakesItOff', async () => {
    calls.remove.mockResolvedValue(ok({}));
    board({ picks: [tray('tenderfoot-4a', 'First aid')] });
    await userEvent.click(screen.getByRole('button', { name: /^4a ?First aid/, pressed: true }));
    expect(calls.remove.mock.calls[0][0]).toMatchObject({ key: 'tenderfoot-4a' });
  });

  it('Scout_SeesWhoElsePicked_ByFirstNameLastInitial', () => {
    board();
    expect(screen.getByRole('button', { name: /Knots/ }).textContent).toContain('Finn P, Anjali S +4');
  });

  it('OutingOnlyRow_IsDisabled_AndSaysNeedsAnOuting', () => {
    board();
    const b = screen.getByRole('button', { name: /Pack for a campout/ }) as HTMLButtonElement;
    expect([b.disabled, b.textContent?.includes('Needs an outing')]).toEqual([true, true]);
  });

  it('Intent_IsAThreeWayRadioGroup_ThatSavesOnTap', async () => {
    calls.intent.mockResolvedValue(ok({ intent: 'undecided' }));
    board();
    const group = screen.getByRole('radiogroup', { name: 'Are you coming?' });
    expect(within(group).getAllByRole('radio').map((r) => (r as HTMLInputElement).labels?.[0]?.textContent)).toEqual(['Coming', 'Not sure yet', 'Can’t make it']);
    await userEvent.click(within(group).getByRole('radio', { name: 'Not sure yet' }));
    expect([calls.intent.mock.calls[0][0].intent, await screen.findByText('We’ll find something that fits.')]).toEqual(['undecided', expect.anything()]);
  });

  it('NotComing_SaysPicksAreSavedForNextWeek', () => {
    board({ intent: 'not_coming', picks: [tray('tenderfoot-4a', 'First aid')] });
    expect(screen.getByText('Got it. Your picks are saved for next week.')).toBeTruthy();
  });

  it('Lede_SaysPickUpToFive_YoullDoOneOrTwo', () => {
    board();
    expect(screen.getByText('Pick up to 5 things to work on. You’ll do one or two of them.')).toBeTruthy();
  });

  it('Ranking_PutThemInOrder_SavesTheCurrentOrder_ThenArrowsMove', async () => {
    const picks = [tray('tenderfoot-3a', 'Knots'), tray('tenderfoot-4a', 'First aid')];
    calls.order.mockResolvedValueOnce(ok({ picks: picks.map((p, i) => ({ ...p, priority: i + 1 })) }));
    calls.order.mockResolvedValueOnce(ok({ picks: [{ ...picks[1], priority: 1 }, { ...picks[0], priority: 2 }] }));
    board({ picks });
    await userEvent.click(screen.getByRole('button', { name: 'Put them in order' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Move First aid up' }));
    expect(calls.order.mock.calls.map((c) => c[0].keys)).toEqual([
      ['tenderfoot-3a', 'tenderfoot-4a'],
      ['tenderfoot-4a', 'tenderfoot-3a']
    ]);
  });

  it('Tray_ShowsLaterPicks_AndWhoAddedThem', () => {
    board({ picks: [tray('tenderfoot-4a', 'First aid', { later: true, addedBy: 'Dana R' })] });
    expect(screen.getByText('Tenderfoot 4a · For a later meeting · added by Dana R')).toBeTruthy();
  });

  it('Parent_SeesTheScoutsName_InTheQuestionAndTray', () => {
    board({}, { subject: { personId: 7, firstName: 'Finn', isSelf: false } });
    expect([screen.getByRole('radiogroup', { name: 'Is Finn coming?' }), screen.getByText('Finn’s picks (0 of 5)')]).toHaveLength(2);
  });

  it('MeritBadgeNight_HasNoPickList_JustTheBadgeAndComing', () => {
    board({}, { mode: 'merit_badge', mbName: 'Cooking' });
    expect([
      screen.getByText('Merit badge night: Cooking.'),
      screen.getByText('You’ll be assigned a rotation.'),
      screen.queryByRole('button', { name: /First aid/ }),
      screen.getAllByRole('radio').length
    ]).toEqual([expect.anything(), expect.anything(), null, 2]);
  });

  it('ReadOnly_ProxyView_CannotTap', async () => {
    board({}, { readOnly: true });
    await userEvent.click(screen.getByRole('button', { name: /First aid/ }));
    expect(calls.add.mock.calls.length).toBe(0);
  });
});
