import { describe, it, expect } from 'vitest';
import { buildPlannerBoard, type PlannerInput } from '../src/lib/meeting-planner-board';
import type { BoardPick } from '../src/lib/meeting-board-shared';

/**
 * The This Sunday board, design 1a (Plans/Meeting-Planner-II.md; prototypes/meeting-plan-II/README.md "Screen 1"):
 * a pure view of v1's demand and supply. No matcher (tech-lead, 2026-10-21): Ready to teach is "a teacher and at least
 * one scout", and Meeting Live owns placement.
 */

const pick = (key: string, over: Partial<BoardPick> = {}): BoardPick => ({
  key,
  priority: null,
  later: false,
  note: null,
  firstAskedOn: '2026-10-25',
  enteredByPersonId: null,
  carriedFrom: null,
  ...over
});

const TF4A = { key: 'tenderfoot-4a', codeLabel: 'Tenderfoot 4a', title: 'First aid basics', kind: 'rank' as const, minutes: 30, rankId: 'tenderfoot' };
const SC2F = { key: 'second_class-2f', codeLabel: 'Second Class 2f', title: 'Build and light a fire', kind: 'rank' as const, minutes: 25, rankId: 'second_class' };
const S1A = { key: 'scout-1a', codeLabel: 'Scout 1a', title: 'Oath, Law, motto, slogan', kind: 'rank' as const, minutes: 15, rankId: 'scout' };

function input(over: Partial<PlannerInput> = {}): PlannerInput {
  return {
    meetingDate: '2026-10-25',
    scouts: [
      { personId: 1, name: 'Finn P', workingOn: 'Tenderfoot', workingOnRankId: 'tenderfoot', intent: null, picks: [pick('tenderfoot-4a')] },
      { personId: 2, name: 'Hazel S', workingOn: 'Tenderfoot', workingOnRankId: 'tenderfoot', intent: 'coming', picks: [] },
      { personId: 3, name: 'Todd M', workingOn: 'Second Class', workingOnRankId: 'second_class', intent: 'not_coming', picks: [pick('second_class-2f'), pick('tenderfoot-4a')] },
      { personId: 4, name: 'Adi A', workingOn: 'Scout', workingOnRankId: 'scout', intent: null, picks: [] },
      { personId: 5, name: 'Emory M', workingOn: 'Second Class', workingOnRankId: 'second_class', intent: 'undecided', picks: [] },
      { personId: 6, name: 'Ben B', workingOn: 'Scout', workingOnRankId: 'scout', intent: 'not_coming', picks: [] }
    ],
    adults: [
      { personId: 10, name: 'Dan V', intent: 'coming', canTeach: true },
      { personId: 11, name: 'Chris N', intent: 'undecided', canTeach: true },
      { personId: 12, name: 'Joe M', intent: null, canTeach: true },
      { personId: 13, name: 'Sara L', intent: 'not_coming', canTeach: true },
      { personId: 14, name: 'Alex S', intent: null, canTeach: false },
      { personId: 15, name: 'Karen O', intent: null, canTeach: false }
    ],
    topics: new Map([TF4A, SC2F, S1A].map((t) => [t.key, t])),
    // Alex S committed to Scout 1a; nobody asked for it.
    commitments: [{ key: 'scout-1a', personId: 14 }],
    teachersFor: new Map([['scout-1a', [14]]]),
    qualified: new Map([
      ['tenderfoot-4a', [10, 11, 12, 13]],
      ['second_class-2f', [10]]
    ]),
    requested: new Set<string>(),
    ...over
  };
}

describe('Ready to teach', () => {
  it('Ready_IsEmpty_WhenNoTopicHasATeacherAndAScout', () => {
    expect(buildPlannerBoard(input()).ready).toEqual([]);
  });

  it('Ready_ListsATopic_WithATeacherAndAScout', () => {
    const b = buildPlannerBoard(input({ teachersFor: new Map([['tenderfoot-4a', [10]], ['scout-1a', [14]]]), commitments: [{ key: 'tenderfoot-4a', personId: 10 }, { key: 'scout-1a', personId: 14 }] }));
    expect(b.ready.map((r) => [r.key, r.teachers.map((t) => t.name), r.scouts.map((s) => s.name)])).toEqual([['tenderfoot-4a', ['Dan V'], ['Finn P']]]);
  });
});

describe('Requests with no teacher', () => {
  it('NoTeacher_ListsWantedTopics_WithWhoIsWaiting', () => {
    const b = buildPlannerBoard(input());
    expect(b.noTeacher.map((r) => [r.key, r.waiting.map((s) => s.name)])).toEqual([['tenderfoot-4a', ['Finn P']]]);
  });

  it('NoTeacher_LeavesOutPicksOfScoutsWhoCantCome', () => {
    // Todd can't come, so his Second Class 2f pick waits for a later meeting and asks for no teacher.
    expect(buildPlannerBoard(input()).noTeacher.some((r) => r.key === 'second_class-2f')).toBe(false);
  });

  it('NoTeacher_GroupsEveryoneQualified_ByAnswer_LeavingOutCant', () => {
    const row = buildPlannerBoard(input()).noTeacher[0];
    expect({ coming: row.canTeach.coming.map((p) => p.name), undecided: row.canTeach.undecided.map((p) => p.name), noAnswer: row.canTeach.noAnswer.map((p) => p.name) }).toEqual({
      coming: ['Dan V'],
      undecided: ['Chris N'],
      noAnswer: ['Joe M']
    });
  });

  it('NoTeacher_CountsAQualifiedTeacherWithACommitment_AsComing', () => {
    const b = buildPlannerBoard(input({ commitments: [{ key: 'scout-1a', personId: 12 }], teachersFor: new Map([['scout-1a', [12]]]) }));
    const joe = b.noTeacher[0].canTeach.coming.find((p) => p.name === 'Joe M');
    expect(joe?.status).toBe('Coming · teaching 1');
  });

  it('NoTeacher_MarksAPersonAlreadyRequested', () => {
    const row = buildPlannerBoard(input({ requested: new Set(['tenderfoot-4a:12']) })).noTeacher[0];
    expect(row.canTeach.noAnswer[0].requested).toBe(true);
  });

  it('NoTeacher_SaysHowManyWeeksItHasBeenAsked', () => {
    const scouts = input().scouts.map((s) => (s.personId === 1 ? { ...s, picks: [pick('tenderfoot-4a', { firstAskedOn: '2026-10-11' })] } : s));
    expect(buildPlannerBoard(input({ scouts })).noTeacher[0].weeks).toBe(2);
  });
});

describe('Offered, no takers yet', () => {
  it('Offered_ListsATopicATeacherOffered_ThatNoScoutPicked', () => {
    const b = buildPlannerBoard(input());
    expect(b.offered.map((o) => [o.key, o.teachers.map((t) => t.name)])).toEqual([['scout-1a', ['Alex S']]]);
  });

  it('Offered_LikelyFits_LeaveOutAScoutWhoFinishedIt', () => {
    // The nudge list (v1's scoutCandidates) only offers what a scout can still pick, so the board says the same.
    expect(buildPlannerBoard(input({ finished: new Set(['scout-1a:4']) })).offered[0].likelyFits).toEqual([]);
  });

  it('Offered_LikelyFits_AreScoutsWorkingOnThatRank_WhoCanStillCome', () => {
    // Adi works on Scout and hasn't answered; Ben works on Scout but can't make it.
    expect(buildPlannerBoard(input()).offered[0].likelyFits.map((s) => s.name)).toEqual(['Adi A']);
  });
});

describe('who is coming', () => {
  it('Attendance_CountsScouts_APickMeaningComing', () => {
    expect(buildPlannerBoard(input()).attendance.scouts).toEqual({ coming: 2, undecided: 1, notComing: 2, noAnswer: 1, total: 6 });
  });

  it('Attendance_CountsAdults_ACommitmentMeaningComing', () => {
    expect(buildPlannerBoard(input()).attendance.adults).toEqual({ coming: 2, undecided: 1, notComing: 1, noAnswer: 2, total: 6 });
  });

  it('HaventAnswered_ListsScoutsAndAdultsWithNoAnswer', () => {
    const b = buildPlannerBoard(input());
    expect([b.haventAnswered.scouts.map((p) => p.name), b.haventAnswered.adults.map((p) => p.name)]).toEqual([['Adi A'], ['Joe M', 'Karen O']]);
  });

  it('WhosComing_SaysWhatAScoutPicked', () => {
    const finn = buildPlannerBoard(input()).whosComing.scouts.find((s) => s.name === 'Finn P');
    expect([finn?.detail, finn?.nothingYet]).toEqual(['First aid basics', false]);
  });

  it('WhosComing_FlagsAComingScoutWithNoPicks', () => {
    const hazel = buildPlannerBoard(input()).whosComing.scouts.find((s) => s.name === 'Hazel S');
    expect([hazel?.detail, hazel?.nothingYet]).toEqual(['Nothing picked: will be placed by rank', true]);
  });

  it('WhosComing_SaysWhatAnAdultIsTeaching', () => {
    const alex = buildPlannerBoard(input()).whosComing.adults.find((a) => a.name === 'Alex S');
    expect(alex?.detail).toBe('Teaching: Oath, Law, motto, slogan');
  });

  it('WhosComing_FlagsAComingAdultWhoIsntTeaching', () => {
    const dan = buildPlannerBoard(input()).whosComing.adults.find((a) => a.name === 'Dan V');
    expect([dan?.detail, dan?.nothingYet]).toEqual(['Not teaching yet: free to assign', true]);
  });

  it('CantMakeIt_SaysHowManyPicksAreSavedForLater', () => {
    const todd = buildPlannerBoard(input()).cantMakeIt.find((p) => p.name === 'Todd M');
    expect(todd?.saved).toBe(2);
  });

  it('NotSure_ListsScoutsAndAdults', () => {
    expect(buildPlannerBoard(input()).notSure.map((p) => p.name)).toEqual(['Emory M', 'Chris N']);
  });
});

describe('the Everyone wall', () => {
  it('Everyone_TagsAComingScout_WithTheirPickCount', () => {
    const tile = buildPlannerBoard(input()).everyone.scouts.coming.find((t) => t.name === 'Finn P');
    expect(tile?.tag).toBe('1 pick');
  });

  it('Everyone_TagsACantScoutWithPicks_AsPicksSaved', () => {
    const tile = buildPlannerBoard(input()).everyone.scouts.notComing.find((t) => t.name === 'Todd M');
    expect(tile?.tag).toBe('Picks saved');
  });

  it('Everyone_TagsANoAnswerScout_WithTheRankTheyreWorkingOn', () => {
    expect(buildPlannerBoard(input()).everyone.scouts.noAnswer[0]).toMatchObject({ name: 'Adi A', tag: 'Scout' });
  });

  it('Everyone_TagsAdults_TeachingFreeOrCanTeach', () => {
    const e = buildPlannerBoard(input()).everyone.adults;
    expect([e.coming.map((t) => `${t.name}:${t.tag}`), e.noAnswer.map((t) => `${t.name}:${t.tag}`)]).toEqual([
      ['Alex S:Teaching 1', 'Dan V:Free'],
      ['Joe M:Can teach', 'Karen O:']
    ]);
  });
});

describe('edge cases', () => {
  it('Topic_MissingFromTheCatalog_ShowsItsKey', () => {
    const scouts = input().scouts.map((s) => (s.personId === 1 ? { ...s, picks: [pick('gone-9z')] } : s));
    expect(buildPlannerBoard(input({ scouts })).noTeacher[0].title).toBe('gone-9z');
  });

  it('Teacher_NotOnTheBoard_StillShowsByPersonId', () => {
    const b = buildPlannerBoard(input({ commitments: [{ key: 'scout-1a', personId: 99 }], teachersFor: new Map([['scout-1a', [99]]]) }));
    expect(b.offered[0].teachers[0].name).toBe('Person 99');
  });
});

