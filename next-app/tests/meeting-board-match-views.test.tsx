import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MatchedCandidate } from '../src/app/admin/(workspace)/advancement/meetings/[id]/meeting-editor';

/**
 * Meeting board, Phase 3a, the screens: the board settings form (dirty-gated, a merit badge night needs its badge),
 * This Sunday's live match by block, the meeting editor's tray (matched sessions promote through onPromote, nothing
 * else), and the member page's "You're in First aid, your #2". Server actions are the mock boundary.
 */
const nav = vi.hoisted(() => ({ refresh: vi.fn() }));
const plan = vi.hoisted(() => ({ setBoard: vi.fn(), setStations: vi.fn(), saveRotations: vi.fn(), stamp: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: nav.refresh, push: vi.fn() }) }));
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: () => ({}) }));
vi.mock('@/lib/advancement-catalog', () => ({ loadAdvancementCatalog: async () => ({}) }));
vi.mock('../src/app/admin/(workspace)/advancement/meeting-plan/actions', () => ({ boardStampAction: plan.stamp, setMeetingBoardAction: plan.setBoard, setMeetingStationsAction: plan.setStations, saveRotationsAction: plan.saveRotations }));
vi.mock('../src/app/(public)/member/meeting/actions', () => ({
  meetingAddPickAction: vi.fn(),
  meetingRemovePickAction: vi.fn(),
  meetingSetOrderAction: vi.fn(),
  meetingSetNoteAction: vi.fn(),
  meetingSetIntentAction: vi.fn()
}));

const { BoardSettings } = await import('../src/app/admin/(workspace)/advancement/meeting-plan/board-settings');
const { ThisSundayView, MatchBlocks } = await import('../src/app/admin/(workspace)/advancement/meeting-plan/this-sunday');
const { MeetingEditor } = await import('../src/app/admin/(workspace)/advancement/meetings/[id]/meeting-editor');
const { ScoutBoard } = await import('../src/app/(public)/member/meeting/scout-board');
const { PlanNotice } = await import('../src/app/(public)/member/meeting/plan-notice');

beforeEach(() => {
  plan.setBoard.mockReset();
  plan.setStations.mockReset();
  plan.saveRotations.mockReset();
  nav.refresh.mockReset();
});

const BADGES = [
  { id: 'camping', name: 'Camping' },
  { id: 'cooking', name: 'Cooking' }
];
const creq = (id: number, code: string, label: string) => ({
  id,
  mb_id: 'cooking',
  parent_id: null,
  code,
  label,
  complete_rule: 'all' as const,
  complete_n: null,
  sort_order: id,
  venue: 'either' as const
});
const COOKING = [creq(1, '1', 'Health and safety'), creq(2, '2', 'Nutrition'), creq(3, '3', 'Plan a menu')];
const settings = (o: Partial<Parameters<typeof BoardSettings>[0]> = {}) =>
  render(<BoardSettings entryId={5} initial={{ mode: 'rank', mbId: '', blockCount: 2, stations: [] }} badges={BADGES} badgeReqs={[]} picks={0} {...o} />);

describe('board settings', () => {
  it('BoardSettings_SaveIsGreyed_UntilSomethingChanges', () => {
    settings();
    expect([screen.getByRole('button', { name: 'Saved' }).hasAttribute('disabled'), screen.getByRole('button', { name: 'Discard changes' }).hasAttribute('disabled')]).toEqual([true, true]);
  });

  it('Leader_SetsThreeBlocks_AndSaves', async () => {
    plan.setBoard.mockResolvedValue({ ok: true });
    settings();
    await userEvent.click(screen.getByRole('radio', { name: '3 (on purpose)' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save board' }));
    expect(plan.setBoard).toHaveBeenCalledWith({ entryId: 5, mode: 'rank', mbId: null, blockCount: 3 });
  });

  it('BoardSettings_MeritBadgeNight_SaysWhy_WhenNoBadgeChosen', async () => {
    settings();
    await userEvent.click(screen.getByRole('radio', { name: 'Merit badge' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save board' }));
    expect([plan.setBoard.mock.calls.length, screen.getByRole('alert').textContent, screen.getByRole('combobox').getAttribute('aria-invalid')]).toEqual([
      0,
      'Can’t save yet: choose the badge for this night',
      'true'
    ]);
  });

  it('BoardSettings_SavesTheBadgeAndItsSuggestedStations_ForAMeritBadgeNight', async () => {
    plan.setStations.mockResolvedValue({ ok: true });
    settings({ badgeReqs: COOKING });
    await userEvent.click(screen.getByRole('radio', { name: 'Merit badge' }));
    await userEvent.selectOptions(screen.getByRole('combobox'), 'cooking');
    await userEvent.click(screen.getByRole('button', { name: 'Save board' }));
    expect(plan.setStations.mock.calls[0]?.[0]).toEqual({
      entryId: 5,
      mbId: 'cooking',
      stations: [
        { topicId: null, title: '1. Health and safety', location: '', codes: ['1'] },
        { topicId: null, title: '2. Nutrition', location: '', codes: ['2'] },
        { topicId: null, title: '3. Plan a menu', location: '', codes: ['3'] }
      ]
    });
  });

  it('Leader_EditsAStation_NameAndPlace_BeforeSaving', async () => {
    plan.setStations.mockResolvedValue({ ok: true });
    settings({ badgeReqs: COOKING });
    await userEvent.click(screen.getByRole('radio', { name: 'Merit badge' }));
    await userEvent.selectOptions(screen.getByRole('combobox'), 'cooking');
    const name = screen.getByRole('textbox', { name: 'Station 1' });
    await userEvent.clear(name);
    await userEvent.type(name, 'Fire safety');
    await userEvent.type(screen.getAllByRole('textbox', { name: 'Where (optional)' })[0], 'Parking lot');
    await userEvent.click(screen.getByRole('button', { name: 'Save board' }));
    expect(plan.setStations.mock.calls[0]?.[0].stations[0]).toEqual({ topicId: null, title: 'Fire safety', location: 'Parking lot', codes: ['1'] });
  });

  it('BoardSettings_MarksAStationWithNoName_InPlace_AndDoesNotSave', async () => {
    settings({ badgeReqs: COOKING });
    await userEvent.click(screen.getByRole('radio', { name: 'Merit badge' }));
    await userEvent.selectOptions(screen.getByRole('combobox'), 'cooking');
    await userEvent.clear(screen.getByRole('textbox', { name: 'Station 2' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save board' }));
    expect([plan.setStations.mock.calls.length, screen.getByRole('textbox', { name: 'Station 2' }).getAttribute('aria-invalid'), screen.getByText('Station 2 needs a name.') != null]).toEqual([0, 'true', true]);
  });

  const mbInitial = { mode: 'merit_badge' as const, mbId: 'cooking', blockCount: 2, stations: [{ topicId: 7, title: 'A', location: '', codes: ['1'] }, { topicId: 8, title: 'B', location: '', codes: ['2'] }, { topicId: 9, title: 'C', location: '', codes: ['3'] }] };

  it('BoardSettings_WarnsThatLeavingAMeritBadgeNight_RemovesItsStations_WithCounts_Announced', async () => {
    settings({ badgeReqs: COOKING, initial: mbInitial, stationTeachers: 2, arranged: true });
    await userEvent.click(screen.getByRole('radio', { name: 'Rank' }));
    expect(screen.getByRole('status').textContent).toBe('Saving removes 3 stations, 2 teacher sign-ups and the saved rotation groups.');
  });

  it('BoardSettings_DropWarning_CountsOneOfEach_InTheSingular', async () => {
    settings({ badgeReqs: COOKING, initial: { ...mbInitial, stations: mbInitial.stations.slice(0, 1) }, stationTeachers: 1 });
    await userEvent.selectOptions(screen.getByRole('combobox'), '');
    expect(screen.getByRole('status').textContent).toBe('Saving removes 1 station and 1 teacher sign-up.');
  });

  it('BoardSettings_StationRemoveButtons_SayWhichStation', () => {
    settings({ badgeReqs: COOKING, initial: mbInitial });
    expect(screen.getAllByRole('button', { name: /^Remove station \d$/ }).map((b) => b.getAttribute('aria-label'))).toEqual(['Remove station 1', 'Remove station 2', 'Remove station 3']);
  });

  it('BoardSettings_SaysPicksAreKept_WhenLeavingRank', async () => {
    settings({ picks: 4 });
    await userEvent.click(screen.getByRole('radio', { name: 'Closed' }));
    expect(screen.getByText(/4 picks are on this board now\. They aren’t lost/)).toBeTruthy();
  });

  it('BoardSettings_DiscardChanges_PutsTheSavedBoardBack', async () => {
    settings();
    await userEvent.click(screen.getByRole('radio', { name: 'Closed' }));
    await userEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect((screen.getByRole('radio', { name: 'Rank' }) as HTMLInputElement).checked).toBe(true);
  });

  it('BoardSettings_ShowsTheRpcReason_WhenRefused', async () => {
    plan.setBoard.mockResolvedValue({ ok: false, error: 'Teaching blocks are 1, 2 or 3.' });
    settings();
    await userEvent.click(screen.getByRole('radio', { name: '1' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save board' }));
    expect(screen.getByRole('alert').textContent).toBe('Teaching blocks are 1, 2 or 3.');
  });
});

const sundayData = {
  meeting: { entryId: 5, title: 'Troop Meeting', mode: 'rank' as const, dateLabel: 'Sunday, November 1, 2026' },
  board: { mode: 'rank' as const, mbId: '', blockCount: 2, badges: BADGES, stations: [], stationTeachers: 0, arranged: false, badgeReqs: [] },
  match: {
    sessions: 2,
    agendaHref: '/admin/calendar/5?tab=agenda',
    blocks: [
      {
        label: 'Block 1',
        sessions: [
          {
            id: '40:tenderfoot-4a',
            title: 'First Aid',
            codeLabel: 'Tenderfoot 4a, 4b',
            group: null,
            teacher: { personId: 40, name: 'Dan V', notes: ['from a First Aid offer'] },
            coTeachers: [],
            scouts: [
              { personId: 1, name: 'Anjali S', why: '#2' },
              { personId: 2, name: 'Leo M', why: 'placed' }
            ]
          }
        ]
      },
      { label: 'Block 2', sessions: [] }
    ]
  },
  stamp: 's',
  counts: { coming: 2, undecided: 1, notComing: 0, noAnswer: 3, picks: 2, held: 0 },
  adults: { coming: 1, undecided: 0, notComing: 0, teaching: 1 },
  topics: [],
  wanted: [{ key: 'tenderfoot-3a', label: 'Knots', codeLabel: 'Tenderfoot 3a', names: ['Finn P'], weeks: 2, canTeach: [], blocked: ['Karen O'] }],
  offered: [],
  skillOffers: [],
  undecidedAdults: [],
  notComingAdults: [],
  undecided: [{ personId: 2, name: 'Leo M', placed: 'First Aid' }],
  notComing: [],
  comingNothing: [{ personId: 3, name: 'Theo P', suggestion: 'Tenderfoot 3a, Knots' }],
  noAnswer: [],
  scouts: [],
  adultPeople: []
};

describe('Group Sessions: the match by block', () => {
  it('Leader_SeesMatchedSessionsPerBlock_WithTeacherScoutsAndWhy', () => {
    render(<MatchBlocks match={sundayData.match} />);
    const block1 = screen.getByRole('region', { name: 'Block 1' });
    expect([
      within(block1).getByText('First Aid') != null,
      within(block1).getByRole('link', { name: /Anjali S/ }).textContent,
      within(block1).getByRole('link', { name: /Leo M/ }).textContent,
      within(block1).getByText(/from a First Aid offer/) != null
    ]).toEqual([true, 'Anjali S #2', 'Leo M placed', true]);
  });

  it('EmptyBlock_IsCompressed_AndSaysNotFilled', () => {
    render(<MatchBlocks match={sundayData.match} />);
    const block2 = screen.getByRole('region', { name: 'Block 2' });
    expect([block2.textContent, block2.className.includes('blockEmpty')]).toEqual(['Block 2Not filled', true]);
  });

  it('Scouts_AndTeachers_CarryTheirOwnTints', () => {
    render(<MatchBlocks match={sundayData.match} />);
    const block1 = screen.getByRole('region', { name: 'Block 1' });
    const teacher = within(block1).getByText('Teacher').parentElement!;
    expect([within(block1).getByRole('link', { name: /Anjali S/ }).className.includes('scoutTint'), teacher.className.includes('adultTint')]).toEqual([true, true]);
  });
});

describe('This Sunday', () => {
  it('ThisSunday_HasNoLiveMatch_ItLivesOnGroupSessions', () => {
    render(<ThisSundayView data={sundayData} />);
    expect([screen.queryByRole('region', { name: 'Live match' }), screen.queryByRole('region', { name: 'Block 1' })]).toEqual([null, null]);
  });

  it('Stats_SitOnOneLine_ScoutsAndAdultsTinted', () => {
    render(<ThisSundayView data={sundayData} />);
    const scouts = screen.getByText('Scouts coming').parentElement!;
    const adults = screen.getByText('Adults coming').parentElement!;
    expect([scouts.parentElement === adults.parentElement, scouts.className.includes('scoutTint'), adults.className.includes('adultTint')]).toEqual([true, true, true]);
  });

  it('Leader_SeesComingWithNothingAssigned_WithTheEngineFallback', () => {
    render(<ThisSundayView data={sundayData} />);
    expect(screen.getByText('Engine: Tenderfoot 3a, Knots')).toBeTruthy();
  });

  it('Leader_SeesATeacherWithNoFreeBlock_OnTheWantedList', () => {
    render(<ThisSundayView data={sundayData} />);
    expect(screen.getByText('Karen O signed up, with no free block for it')).toBeTruthy();
  });

  it('Leader_SeesWhereANotSureYetScoutWasPlaced', () => {
    render(<ThisSundayView data={sundayData} />);
    expect(screen.getByText('· placed in First Aid')).toBeTruthy();
  });

  it('Leader_SeesTheBoardSettings_OnThisSunday', () => {
    render(<ThisSundayView data={sundayData} />);
    expect(screen.getByRole('region', { name: 'Board settings' })).toBeTruthy();
  });
});

const matched: MatchedCandidate = {
  id: '40:tenderfoot-4a',
  blockLabel: 'Block 1',
  title: 'First Aid',
  codeLabel: 'Tenderfoot 4a, 4b',
  group: null,
  teacher: 'Mr. Vest',
  flags: ['sign-off needs a counselor'],
  scouts: ['Anjali S', 'Finn P'],
  promote: {
    title: 'First Aid',
    description: 'Tenderfoot 4a, 4b · Block 1',
    track: 'Open Advancement',
    leaderName: 'Mr. Vest',
    skillId: 'first-aid',
    requirements: [
      { code: 'Tenderfoot 4a', label: 'First aid' },
      { code: 'Tenderfoot 4b', label: 'Bites' }
    ],
    scouts: ['Anjali S', 'Finn P']
  }
};
const ok = async () => ({ ok: true });
function editor(board: Parameters<typeof MeetingEditor>[0]['board'], onPromote = vi.fn(ok), sessions: Parameters<typeof MeetingEditor>[0]['sessions'] = []) {
  render(
    <MeetingEditor
      meeting={{ id: 9, status: 'draft', title: 'Troop Meeting' } as Parameters<typeof MeetingEditor>[0]['meeting']}
      board={board}
      entry={{ id: 5, entry_date: '2026-11-01' }}
      sessions={sessions}
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

describe('the meeting editor tray', () => {
  it('Tray_ShowsMatchedSessions_PrefilledFromTheBoard', () => {
    editor({ mode: 'rank', sessions: [matched], wanted: 1 });
    expect([screen.getByText('Block 1 · Tenderfoot 4a, 4b') != null, screen.getByText(/Teacher: Mr\. Vest · sign-off needs a counselor/) != null, screen.getByText(/2 scouts: Anjali S, Finn P/) != null]).toEqual([true, true, true]);
  });

  it('Leader_PromotesMatchedSession_ThroughTheExistingFlow', async () => {
    const onPromote = editor({ mode: 'rank', sessions: [matched], wanted: 0 });
    await userEvent.click(screen.getAllByRole('button', { name: 'Add to agenda' })[0]);
    expect([onPromote.mock.calls, await screen.findByText('Added ✓')]).toEqual([[[{ meetingId: 9, ...matched.promote }]], expect.anything()]);
  });

  it('Tray_MarksASessionAlreadyOnTheAgenda_AsAdded', () => {
    const onAgenda = { id: 1, meeting_id: 9, section: 'agenda', sort_order: 10, title: 'First Aid', description: 'Tenderfoot 4a, 4b · Block 1' } as Parameters<typeof MeetingEditor>[0]['sessions'][number];
    editor({ mode: 'rank', sessions: [matched], wanted: 0 }, vi.fn(ok), [onAgenda]);
    expect([screen.getByText('Added ✓') != null, screen.getByRole('button', { name: 'Add again' }) != null]).toEqual([true, true]);
  });

  it('Tray_SaysSo_WhenTheMeetingIsClosed', () => {
    editor({ mode: 'closed', sessions: [], wanted: 0 });
    expect(screen.getByText('This meeting has no board. Build the agenda by hand.')).toBeTruthy();
  });

  it('Tray_KeepsTheEngineSuggestions_UnderTheirOwnHeading', () => {
    editor({ mode: 'rank', sessions: [], wanted: 0 });
    expect([screen.getByText('Engine suggestions (ledger only)') != null, screen.getByText('Nothing matched yet.') != null]).toEqual([true, true]);
  });

  it('Tray_WithoutABoard_IsUnchanged', () => {
    editor(undefined);
    expect([screen.queryByText("From this week's board"), screen.getByText('Plan Suggestions') != null]).toEqual([null, true]);
  });
});

describe('the member page', () => {
  const scoutBoard = (o: Partial<Parameters<typeof ScoutBoard>[0]> = {}) =>
    render(
      <ScoutBoard
        entryId={1}
        mode="rank"
        mbName={null}
        blockCount={2}
        dayName="Sunday"
        subject={{ personId: 7, firstName: 'Finn', isSelf: true }}
        initial={{ personId: 7, intent: 'coming', picks: [] }}
        pickList={{ nextRankId: 'tenderfoot', groups: [], working: [], badges: [], offered: [] }}
        onBehalf={false}
        readOnly={false}
        {...o}
      />
    );
  const line = { block: 'Block 1', title: 'First aid', codeLabel: 'Tenderfoot 4a', pickNo: 2, placed: false, teacher: 'Mr. Vest', scouts: [] };

  it('Scout_SeesSoFar_FromTheLiveMatch', () => {
    scoutBoard({ assigned: [line, { ...line, block: 'Block 2', title: 'Knots', pickNo: null }] });
    expect(screen.getByText('So far, you’re in First aid, your #2, then Knots')).toBeTruthy();
  });

  it('Parent_SeesTheScoutsName_AndPickNumber', () => {
    scoutBoard({ subject: { personId: 7, firstName: 'Finn', isSelf: false }, assigned: [line] });
    expect(screen.getByText('So far, Finn is in First aid, pick #2')).toBeTruthy();
  });

  it('Scout_WhoCantMakeIt_SeesNoAssignment', () => {
    scoutBoard({ initial: { personId: 7, intent: 'not_coming', picks: [] }, assigned: [line] });
    expect(screen.queryByText(/you’re in/)).toBeNull();
  });

  it('Member_SeesALinkToTheAgenda_OnceItIsPublished_AndNoPersonalLine', () => {
    render(<PlanNotice planSet pastClose={false} entryId={5} />);
    expect([screen.getByRole('link', { name: 'see the agenda' }).getAttribute('href'), screen.queryByText(/you’re in/i)]).toEqual(['/events/5', null]);
  });

  it('Member_SeesThePlanIsSet_AfterTheSoftClose_WithNoAgendaYet', () => {
    render(<PlanNotice planSet={false} pastClose entryId={5} />);
    expect([screen.getByText('This week’s plan is set. You can still tell us you’re coming.') != null, screen.queryByRole('link')]).toEqual([true, null]);
  });

  it('Member_SeesNoPlanNotice_BeforeTheSoftClose', () => {
    const { container } = render(<PlanNotice planSet={false} pastClose={false} entryId={5} />);
    expect(container.textContent).toBe('');
  });

  it('Scout_PlacedByTheEngine_IsToldWhy', () => {
    scoutBoard({ assigned: [{ ...line, pickNo: null, placed: true }] });
    expect(screen.getByText('Picked from what you need next.')).toBeTruthy();
  });

  it('MemberPage_NeverSaysTooLate', () => {
    scoutBoard({ assigned: [line] });
    expect(document.body.textContent?.toLowerCase().includes('too late')).toBe(false);
  });
});
