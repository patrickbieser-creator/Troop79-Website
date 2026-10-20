import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { TeachView } from '../src/lib/meeting-board-supply';
import type { MbScoutLines, StationTeachLine } from '../src/lib/meeting-board-rotations';
import type { RotationEditorData } from '../src/app/admin/(workspace)/advancement/meeting-plan/rotations-editor';
import type { MatchedCandidate } from '../src/app/admin/(workspace)/advancement/meetings/[id]/meeting-editor';

/**
 * Meeting board, Phase 3b, the screens of a merit badge night: the scout card (no pick list; "So far, you're in Group
 * B"; a badge holder helps), the teach section (stations, "I'll take this station", the rotation order), the leader's
 * rotations editor (dirty-gated; moves, helpers, adding a scout who didn't answer, "Start over from the draft") and the
 * meeting editor's tray (one card per station). Server actions are the mock boundary.
 */
const nav = vi.hoisted(() => ({ refresh: vi.fn() }));
const calls = vi.hoisted(() => ({ teach: vi.fn(), unteach: vi.fn(), saveRotations: vi.fn(), intent: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: nav.refresh, push: vi.fn() }) }));
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: () => ({}) }));
vi.mock('@/lib/advancement-catalog', () => ({ loadAdvancementCatalog: async () => ({}) }));
vi.mock('../src/app/admin/(workspace)/advancement/meeting-plan/actions', () => ({
  boardStampAction: vi.fn(),
  setMeetingBoardAction: vi.fn(),
  setMeetingStationsAction: vi.fn(),
  saveRotationsAction: calls.saveRotations
}));
vi.mock('../src/app/(public)/member/meeting/actions', () => ({
  meetingAddPickAction: vi.fn(),
  meetingRemovePickAction: vi.fn(),
  meetingSetOrderAction: vi.fn(),
  meetingSetNoteAction: vi.fn(),
  meetingSetIntentAction: calls.intent
}));
vi.mock('../src/app/(public)/member/meeting/teach-actions', () => ({
  meetingTeachAction: calls.teach,
  meetingUnteachAction: calls.unteach,
  meetingWithdrawOfferAction: vi.fn(),
  meetingTeacherIntentAction: vi.fn(),
  meetingPostOfferAction: vi.fn()
}));

const { ScoutBoard } = await import('../src/app/(public)/member/meeting/scout-board');
const { TeachBoard } = await import('../src/app/(public)/member/meeting/teach-board');
const { RotationsEditor } = await import('../src/app/admin/(workspace)/advancement/meeting-plan/rotations-editor');
const { MeetingEditor } = await import('../src/app/admin/(workspace)/advancement/meetings/[id]/meeting-editor');

beforeEach(() => {
  for (const f of [...Object.values(calls), nav.refresh]) f.mockReset();
});

const NIGHT: MbScoutLines = {
  hasBadge: false,
  helping: null,
  otherWork: false,
  group: 'B',
  stops: [
    { rotation: 1, title: 'Fire safety', place: 'Parking lot', teacher: 'Mr. Vest', free: false },
    { rotation: 2, title: 'Nutrition', place: null, teacher: '', free: true }
  ]
};

function scoutBoard(o: Partial<Parameters<typeof ScoutBoard>[0]> = {}) {
  return render(
    <ScoutBoard
      entryId={1}
      mode="merit_badge"
      mbName="Cooking"
      dayName="Sunday"
      subject={{ personId: 7, firstName: 'Finn', isSelf: true }}
      initial={{ personId: 7, intent: 'coming', picks: [] }}
      pickList={{ nextRankId: 'tenderfoot', groups: [], working: [], badges: [], offered: [] }}
      onBehalf={false}
      readOnly={false}
      {...o}
    />
  );
}

describe('the scout card on a merit badge night', () => {
  it('Scout_SeesNoPickList_OnMeritBadgeNight', () => {
    scoutBoard({ mbNight: null });
    expect([
      screen.getByText('Merit badge night: Cooking.') != null,
      screen.getByText('You’ll be assigned a rotation.') != null,
      screen.queryByText(/Pick up to 5/),
      screen.queryByRole('button', { pressed: false }),
      screen.queryByRole('radio', { name: 'Not sure yet' }),
      screen.getAllByRole('radio').map((r) => r.closest('label')?.textContent)
    ]).toEqual([true, true, null, null, null, ['Coming', 'Can’t make it']]);
  });

  it('Scout_SeesSoFarGroup_WithTheirNight_OnceDrafted', () => {
    scoutBoard({ mbNight: NIGHT });
    const card = screen.getByText('So far, you’re in Group B').closest('div')!;
    expect([within(card).getByText('Fire safety') != null, within(card).getByText(/Parking lot · Mr\. Vest/) != null, within(card).getByText('Free: help out') != null]).toEqual([true, true, true]);
  });

  it('Scout_WhoCantMakeIt_SeesNoGroup', () => {
    scoutBoard({ mbNight: NIGHT, initial: { personId: 7, intent: 'not_coming', picks: [] } });
    expect(screen.queryByText(/So far/)).toBeNull();
  });

  it('BadgeHolder_IsToldTheyHelpTeach_OrWorkOnSomethingElse', () => {
    scoutBoard({ mbNight: { ...NIGHT, hasBadge: true, group: null, stops: [] } });
    expect([screen.getByText('You have this badge, so you’ll help teach or work on something else.') != null, screen.queryByText('You’ll be assigned a rotation.')]).toEqual([true, null]);
  });

  it('BadgeHolder_SeesWhereALeaderPlacedThem', () => {
    scoutBoard({ mbNight: { ...NIGHT, hasBadge: true, group: null, stops: [], helping: 'Fire safety (Parking lot)' } });
    expect(screen.getByText('So far, you’re helping at Fire safety (Parking lot).')).toBeTruthy();
  });

  it('Parent_SeesTheirScoutsGroup_ByName', () => {
    scoutBoard({ mbNight: NIGHT, subject: { personId: 7, firstName: 'Finn', isSelf: false } });
    expect(screen.getByText('So far, Finn is in Group B')).toBeTruthy();
  });
});

const VIEW: TeachView = { personId: 9, kind: 'adult', intent: 'coming', count: 0, items: [], wanted: [], hasSkills: true, canAdd: true };
const STATIONS: StationTeachLine[] = [
  { key: 'cooking-1', index: 0, title: 'Fire safety', place: 'Parking lot', codes: 'Cooking 1', others: [], mine: false, visits: [] },
  { key: 'cooking-2', index: 1, title: 'Nutrition', place: null, codes: 'Cooking 2', others: ['Ms. Hale'], mine: false, visits: [] }
];
function teachBoard(view: Partial<TeachView> = {}, stations = STATIONS, o: Partial<Parameters<typeof TeachBoard>[0]> = {}) {
  return render(
    <TeachBoard
      entryId={1}
      mode="merit_badge"
      subject={{ personId: 9, firstName: 'Dan', isSelf: true }}
      initial={{ ...VIEW, ...view }}
      choices={{ skills: [], requirements: [], dates: [] }}
      onBehalf={false}
      readOnly={false}
      stations={stations}
      mbName="Cooking"
      stationFlags={['sign-off needs a counselor']}
      {...o}
    />
  );
}

describe('the teach section on a merit badge night', () => {
  it('Teacher_SeesTheBadgesStations_WithWhoTeachesEach', () => {
    teachBoard();
    expect([screen.getByText('Cooking stations') != null, screen.getByText('1. Fire safety') != null, screen.getByText(/Parking lot · Cooking 1 · No teacher yet/) != null, screen.getByText(/Teacher: Ms\. Hale/) != null]).toEqual([
      true,
      true,
      true,
      true
    ]);
  });

  it('Teacher_TakesAStation_ThroughTheTeachAction', async () => {
    calls.teach.mockResolvedValue({ ok: true, view: { ...VIEW, count: 1 } });
    teachBoard();
    await userEvent.click(screen.getAllByRole('button', { name: 'I’ll take this station' })[0]);
    expect(calls.teach).toHaveBeenCalledWith({ entryId: 1, personId: 9, onBehalf: false, key: 'cooking-1' });
  });

  it('Teacher_SeesTheirStation_AndTheRotationOrder_WithTheCounselorFlag', () => {
    teachBoard({ count: 1 }, [{ ...STATIONS[0], mine: true, visits: ['Rotation 1: Group A, 6 scouts', 'Rotation 2: Group B, 5 scouts (1 already done: helping out)'] }, STATIONS[1]]);
    expect([screen.getByText('Rotation 1: Group A, 6 scouts') != null, screen.getByText(/· sign-off needs a counselor/) != null, screen.getByRole('button', { name: 'Remove Fire safety' }) != null]).toEqual([true, true, true]);
  });

  it('Teacher_AThirdStation_SaysWhyInPlace', async () => {
    teachBoard({ count: 2 });
    await userEvent.click(screen.getAllByRole('button', { name: 'I’ll take this station' })[0]);
    expect([calls.teach.mock.calls.length, screen.getByRole('alert').textContent]).toEqual([0, 'You’re teaching 2. Remove one to add another.']);
  });

  it('Teacher_SeesRankCommitments_HeldForARegularMeeting', () => {
    teachBoard({ count: 1, items: [{ kind: 'topic', key: 'tenderfoot-3a', label: 'Knots', sub: 'Tenderfoot 3a', scouts: 0, names: [], flags: [], note: null, alsoOn: [] }] });
    expect([screen.getByText('Held for a regular meeting') != null, screen.getByRole('button', { name: 'Remove Knots' }) != null]).toEqual([true, true]);
  });

  it('Teacher_BeforeStationsAreSet_IsToldTheyCanTakeOneLater', () => {
    teachBoard({}, []);
    expect(screen.getByText(/A leader hasn’t set up the stations yet/)).toBeTruthy();
  });
});

const EDITOR: RotationEditorData = {
  entryId: 5,
  stations: [
    { index: 0, topicId: 70, title: 'Fire safety', location: null },
    { index: 1, topicId: 71, title: 'Nutrition', location: null }
  ],
  schedules: [
    [0, 1],
    [1, 0]
  ],
  groups: [
    [
      { personId: 1, name: 'Anjali S', patrol: 'Hawks', skips: [], isNew: false, undecided: false },
      { personId: 2, name: 'Finn P', patrol: 'Hawks', skips: [1], isNew: false, undecided: false }
    ],
    [{ personId: 3, name: 'Leo M', patrol: 'Owls', skips: [], isNew: false, undecided: true }]
  ],
  holders: [{ personId: 4, name: 'Maya C', patrol: 'Foxes', undecided: false, placement: null }],
  noAnswer: [{ personId: 5, name: 'Theo P', patrol: 'Owls', awarded: false, skips: [] }],
  arranged: false
};

describe('the rotations editor', () => {
  it('Leader_SeesGroupsByRotation_WithFinishedStations', () => {
    render(<RotationsEditor data={EDITOR} />);
    const a = screen.getByRole('region', { name: 'Group A' });
    expect([within(a).getAllByRole('listitem').map((l) => l.textContent).slice(0, 2), within(a).getByText(/done: Nutrition/) != null]).toEqual([['Fire safety', 'Nutrition'], true]);
  });

  it('RotationsEditor_SaveIsGreyed_UntilSomethingMoves', () => {
    render(<RotationsEditor data={EDITOR} />);
    expect([screen.getByRole('button', { name: 'Saved' }).hasAttribute('disabled'), screen.getByRole('button', { name: 'Discard changes' }).hasAttribute('disabled')]).toEqual([true, true]);
  });

  it('Leader_MovesAScoutToAnotherGroup_AndSaves_PinningEveryoneShown', async () => {
    calls.saveRotations.mockResolvedValue({ ok: true });
    render(<RotationsEditor data={EDITOR} />);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Move Finn P to' }), '1');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Place Maya C' }), 'st:70');
    await userEvent.click(screen.getByRole('button', { name: 'Save rotations' }));
    expect(calls.saveRotations).toHaveBeenCalledWith({
      entryId: 5,
      placements: [
        { personId: 1, placement: { kind: 'group', group: 0 } },
        { personId: 2, placement: { kind: 'group', group: 1 } },
        { personId: 3, placement: { kind: 'group', group: 1 } },
        { personId: 4, placement: { kind: 'helper', topicId: 70 } }
      ]
    });
  });

  it('Leader_AddsAScoutWhoDidntAnswer_ToAGroup', async () => {
    calls.saveRotations.mockResolvedValue({ ok: true });
    render(<RotationsEditor data={EDITOR} />);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Add Theo P' }), '0');
    expect([within(screen.getByRole('region', { name: 'Group A' })).getByText('Theo P') != null, screen.getByText(/added by you/) != null, screen.queryByRole('combobox', { name: 'Add Theo P' })]).toEqual([true, true, null]);
  });

  it('Leader_DiscardsMoves_BackToTheSavedGroups', async () => {
    render(<RotationsEditor data={EDITOR} />);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Move Finn P to' }), '1');
    await userEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(within(screen.getByRole('region', { name: 'Group A' })).getByText('Finn P')).toBeTruthy();
  });

  it('RotationsEditor_FlagsAGroupOverEight_ButStillSaves', async () => {
    const big = { ...EDITOR, groups: [Array.from({ length: 9 }, (_, i) => ({ personId: 10 + i, name: `Scout ${i}`, patrol: null, skips: [], isNew: false, undecided: false })), []] };
    render(<RotationsEditor data={big} />);
    expect([screen.getByText('9 is over the 8 cap. Move someone.') != null, screen.getByText(/You can still save/) != null]).toEqual([true, true]);
  });

  it('Leader_StartsOverFromTheDraft_AfterConfirming', async () => {
    calls.saveRotations.mockResolvedValue({ ok: true });
    render(<RotationsEditor data={{ ...EDITOR, arranged: true }} />);
    await userEvent.click(screen.getByRole('button', { name: 'Start over from the draft' }));
    expect(calls.saveRotations).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Start over' }));
    expect(calls.saveRotations).toHaveBeenCalledWith({ entryId: 5, placements: [] });
  });

  it('RotationsEditor_StartOver_IsGreyed_WhenTheseAreTheDraft', () => {
    render(<RotationsEditor data={EDITOR} />);
    expect(screen.getByRole('button', { name: 'Start over from the draft' }).hasAttribute('disabled')).toBe(true);
  });

  it('RotationsEditor_SaysToSetStationsFirst', () => {
    render(<RotationsEditor data={{ ...EDITOR, stations: [], groups: [], schedules: [] }} />);
    expect(screen.getByText(/Set the stations above first/)).toBeTruthy();
  });
});

const STATION_CARD: MatchedCandidate = {
  id: 'station:70',
  blockLabel: 'Station 1',
  title: 'Fire safety',
  codeLabel: 'Cooking 1',
  group: null,
  teacher: '',
  flags: [],
  scouts: ['Anjali S'],
  promote: { title: 'Fire safety', description: 'Cooking 1 · Rotations 1: Group A, 2: Group B', track: 'Merit Badge', leaderName: null, skillId: null, requirements: [{ code: 'Cooking 1', label: 'Health' }], scouts: ['Anjali S'] }
};

describe('the meeting editor tray on a merit badge night', () => {
  const ok = async () => ({ ok: true as const });
  function editor(onPromote = vi.fn(ok)) {
    render(
      <MeetingEditor
        meeting={{ id: 9, status: 'draft', title: 'Cooking night' } as Parameters<typeof MeetingEditor>[0]['meeting']}
        board={{ mode: 'merit_badge', sessions: [STATION_CARD], wanted: 1 }}
        entry={{ id: 5, entry_date: '2094-01-04' }}
        sessions={[]}
        candidates={[]}
        onUpdateMeeting={vi.fn(ok)}
        onSetStatus={vi.fn(ok)}
        onCreateSession={vi.fn(ok)}
        onUpdateSession={vi.fn(ok)}
        onDeleteSession={vi.fn(ok)}
        onMoveSession={vi.fn(ok)}
        onPromote={onPromote}
        onDeleteMeeting={vi.fn(ok)}
      />
    );
    return onPromote;
  }

  it('Tray_ShowsOneCardPerStation_WithNoTeacherYet', () => {
    editor();
    expect([screen.getByText('Station 1 · Cooking 1') != null, screen.getByText(/No teacher yet/) != null, screen.getByText('1 station has no teacher yet.') != null]).toEqual([true, true, true]);
  });

  it('Leader_PromotesAStation_NeverAutoPublished', async () => {
    const onPromote = editor();
    await userEvent.click(screen.getAllByRole('button', { name: 'Add to agenda' })[0]);
    expect(onPromote).toHaveBeenCalledWith({ meetingId: 9, ...STATION_CARD.promote });
  });
});

describe('the rotations editor for a youth leader', () => {
  it('YouthLeader_SeesTheGroups_ReadOnly', () => {
    render(<RotationsEditor data={EDITOR} readOnly />);
    expect([screen.queryByRole('button', { name: 'Saved' }), screen.getByRole('combobox', { name: 'Move Finn P to' }).hasAttribute('disabled'), screen.queryByRole('button', { name: 'Start over from the draft' })]).toEqual([null, true, null]);
  });
});
