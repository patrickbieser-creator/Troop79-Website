import { describe, it, expect } from 'vitest';
import type { MatchResult, MatchSession } from '../src/lib/meeting-board-match';
import { buildLiveView, joinNames, liveConflicts, placementAsMatch, snapshotFromMatch, type LiveClassIn, type SavedPlacement } from '../src/lib/meeting-live-shared';

/**
 * Meeting Live's pure side (Plans/Meeting-Planner-II.md, Decisions 8, 8a, 8c; the tech-lead's P4 spec sections 3 and
 * 6): conflict lines (never enforced), the snapshot the first Live write copies from the matcher, the adapter that
 * hands a saved placement to every match reader, and the view model the Live screen draws.
 */

const NAMES = new Map([
  [1, 'Finn P'],
  [2, 'Lily P'],
  [3, 'Owen R'],
  [10, 'Dan V'],
  [11, 'Rachel D']
]);
const nameOf = (id: number) => NAMES.get(id) ?? `#${id}`;
const cls = (o: Partial<LiveClassIn> & Pick<LiveClassIn, 'id'>): LiveClassIn => ({
  topicKey: 'tenderfoot-4a',
  rotation: 1,
  title: 'First aid basics',
  codeLabel: 'Tenderfoot 4a',
  kind: 'rank',
  teacherId: null,
  memberIds: [],
  position: 0,
  version: 1,
  ...o
});

describe('liveConflicts', () => {
  it('MeetingLive_FlagsConflict_WhenScoutInTwoRepeatsOfSameClass', () => {
    const r = liveConflicts([cls({ id: 'a', rotation: 1, memberIds: [1, 2] }), cls({ id: 'b', rotation: 2, memberIds: [1] })], nameOf);
    expect([r.lines.get('a'), r.lines.get('b'), r.count]).toEqual([['Finn P also in the Rotation 2 repeat of this class'], ['Finn P also in the Rotation 1 repeat of this class'], 1]);
  });

  it('FlagsConflict_WhenScoutInTwoClassesInOneRotation', () => {
    const r = liveConflicts([cls({ id: 'a', memberIds: [1, 3] }), cls({ id: 'b', topicKey: 'scout-1a', title: 'Oath, Law', memberIds: [1, 3] })], nameOf);
    expect([r.lines.get('a'), r.count]).toEqual([['Finn P and Owen R also in Oath, Law this rotation'], 1]);
  });

  it('FlagsConflict_WhenTeacherTeachesTwiceInOneRotation', () => {
    const r = liveConflicts([cls({ id: 'a', teacherId: 10 }), cls({ id: 'b', topicKey: 'scout-1a', title: 'Oath, Law', teacherId: 10 })], nameOf);
    expect([r.lines.get('b'), r.count]).toEqual([['Dan V is also teaching First aid basics this rotation'], 1]);
  });

  it('NoConflict_WhenDifferentScoutsInRepeats_OrSameScoutInDifferentRotations', () => {
    const r = liveConflicts(
      [cls({ id: 'a', rotation: 1, memberIds: [1] }), cls({ id: 'b', rotation: 2, memberIds: [2] }), cls({ id: 'c', topicKey: 'scout-1a', rotation: 2, memberIds: [1] })],
      nameOf
    );
    expect([r.count, [...r.lines.values()].flat()]).toEqual([0, []]);
  });

  it('UnscheduledClasses_NeverClashByRotation', () => {
    const r = liveConflicts([cls({ id: 'a', rotation: null, memberIds: [1], teacherId: 10 }), cls({ id: 'b', topicKey: 'scout-1a', rotation: null, memberIds: [1], teacherId: 10 })], nameOf);
    expect(r.count).toBe(0);
  });

  it('JoinNames_ReadsLikeASentence', () => {
    expect([joinNames(['A']), joinNames(['A', 'B']), joinNames(['A', 'B', 'C'])]).toEqual(['A', 'A and B', 'A, B and C']);
  });
});

const session = (o: Partial<MatchSession> & Pick<MatchSession, 'id' | 'keys' | 'half' | 'teacherId'>): MatchSession => ({
  unitId: o.id,
  block: 0,
  rotation: o.half + 1,
  group: null,
  coTeacherIds: [],
  via: 'topic',
  flags: [],
  scouts: [],
  ...o
});
const seat = (personId: number, key: string) => ({ personId, key, pickNo: null, via: 'pick' as const });
const MATCH: MatchResult = {
  blockCount: 12,
  sessions: [
    session({ id: '10:tenderfoot-4a:A', keys: ['tenderfoot-4a', 'tenderfoot-4b'], half: 0, teacherId: 10, scouts: [seat(1, 'tenderfoot-4a')] }),
    session({ id: '11:scout-1a', keys: ['scout-1a'], half: 1, teacherId: 11, scouts: [seat(2, 'scout-1a'), seat(3, 'scout-1a')] }),
    session({ id: '10:tenderfoot-4a:B', keys: ['tenderfoot-4a', 'tenderfoot-4b'], half: 1, teacherId: 10, scouts: [seat(3, 'tenderfoot-4b')] })
  ],
  assignments: [],
  wanted: [{ key: 'star-6', scoutIds: [1], weeks: 1, canTeach: [], blockedTeacherIds: [] }],
  offeredNoTakers: [
    { personId: 11, key: 'second-class-2f', skillId: null },
    { personId: 12, key: null, skillId: 'knots' }
  ],
  undecidedScouts: [],
  undecidedAdults: [],
  comingNothing: [{ personId: 4, suggestion: null }]
};

describe('snapshotFromMatch', () => {
  const snap = snapshotFromMatch(MATCH, (keys) => (keys.length > 1 ? 'First Aid' : null));

  it('Snapshot_CreatesRotationsOneAndTwo', () => {
    expect(snap.rotations).toEqual([
      { number: 1, location: null },
      { number: 2, location: null }
    ]);
  });

  it('Snapshot_PutsEachSessionInRotationHalfPlusOne_WithItsLeadKeyAndScouts', () => {
    expect(snap.classes.filter((c) => c.rotation != null).map((c) => [c.sourceKey, c.rotation, c.topicKey, c.title, c.teacherId, c.memberIds, c.position])).toEqual([
      ['10:tenderfoot-4a:A', 1, 'tenderfoot-4a', 'First Aid', 10, [1], 0],
      ['11:scout-1a', 2, 'scout-1a', null, 11, [2, 3], 0],
      ['10:tenderfoot-4a:B', 2, 'tenderfoot-4a', 'First Aid', 10, [3], 1]
    ]);
  });

  it('Snapshot_OfferedNoTakersWithATeacher_BecomeUnscheduledCards_SkillOffersLeftOut', () => {
    expect(snap.classes.filter((c) => c.rotation == null).map((c) => [c.sourceKey, c.topicKey, c.teacherId, c.memberIds])).toEqual([['offer:11:second-class-2f', 'second-class-2f', 11, []]]);
  });
});

const SAVED: SavedPlacement = {
  startedAt: '2094-03-01T21:00:00Z',
  rotations: [
    { number: 1, location: 'Main hall' },
    { number: 2, location: null },
    { number: 3, location: null }
  ],
  classes: [
    { id: 7, topicKey: 'tenderfoot-4a', title: 'First Aid', rotation: 2, teacherId: null, position: 0, version: 1, memberIds: [3] },
    { id: 5, topicKey: 'tenderfoot-4a', title: null, rotation: 1, teacherId: 10, position: 0, version: 1, memberIds: [1, 2] },
    { id: 9, topicKey: 'scout-1a', title: null, rotation: null, teacherId: 11, position: 0, version: 1, memberIds: [4] }
  ]
};


describe('placementAsMatch', () => {
  const m = placementAsMatch(SAVED);

  it('Adapter_ReturnsOneSessionPerClass_ByRotationThenPosition', () => {
    expect(m.sessions.map((s) => [s.id, s.keys, s.rotation, s.block, s.teacherId, s.title ?? null, s.scouts.map((x) => x.personId)])).toEqual([
      ['c:5', ['tenderfoot-4a'], 1, 0, 10, null, [1, 2]],
      ['c:7', ['tenderfoot-4a'], 2, 1, null, 'First Aid', [3]],
      ['c:9', ['scout-1a'], null, 2, 11, null, [4]]
    ]);
  });

  it('Adapter_GivesEachScoutTheirSeats', () => {
    expect(m.assignments.map((a) => [a.personId, a.seats.map((s) => s.sessionId)])).toEqual([
      [1, ['c:5']],
      [2, ['c:5']],
      [3, ['c:7']],
      [4, ['c:9']]
    ]);
  });

  it('Adapter_HasNoMatcherLists_WithoutTheBoard', () => {
    expect([m.wanted, m.offeredNoTakers, m.undecidedScouts, m.undecidedAdults, m.comingNothing]).toEqual([[], [], [], [], []]);
  });

  // qa-lead (P4a): after Live starts the member and admin screens must not go quiet.
  const pick = { key: 'scout-1a', priority: null, firstAskedOn: '2094-01-01', later: false, note: null, carriedFrom: null, enteredByPersonId: null };
  const board = [
    { personId: 1, intent: 'coming' as const, picks: [] },
    { personId: 6, intent: 'coming' as const, picks: [] },
    { personId: 7, intent: null, picks: [pick] },
    { personId: 8, intent: 'undecided' as const, picks: [] },
    { personId: 2, intent: 'undecided' as const, picks: [] },
    { personId: 9, intent: 'not_coming' as const, picks: [] },
    { personId: 10, intent: 'coming' as const, picks: [] }
  ];
  const withBoard = placementAsMatch(SAVED, board);

  it('Adapter_ComingNothing_IsComingMinusPlacedAndTeachers', () => {
    expect(withBoard.comingNothing).toEqual([
      { personId: 6, suggestion: null },
      { personId: 7, suggestion: null }
    ]);
  });

  it('Adapter_UndecidedScouts_SayWhetherTheyArePlaced', () => {
    expect(withBoard.undecidedScouts).toEqual([
      { personId: 2, placed: true },
      { personId: 8, placed: false }
    ]);
  });
});

describe('buildLiveView', () => {
  const view = buildLiveView({
    started: true,
    rotations: SAVED.rotations,
    classes: [
      cls({ id: 'c:5', rotation: 1, teacherId: 10, memberIds: [1, 2], version: 3 }),
      cls({ id: 'c:7', rotation: 2, teacherId: 11, memberIds: [1, 3], position: 0 }),
      cls({ id: 'c:9', topicKey: 'scout-1a', title: 'Oath, Law', rotation: null, memberIds: [] })
    ],
    nameOf,
    retake: (personId, key) => personId === 2 && key === 'tenderfoot-4a',
    pool: [3, 4]
  });

  it('MeetingLive_RepeatClass_InSecondRotation_WithDifferentScouts', () => {
    const [a, b] = ['c:5', 'c:7'].map((id) => view.cards.find((c) => c.id === id)!);
    expect([a.repeats, b.repeats, a.members.map((x) => x.name), b.members.map((x) => x.name)]).toEqual([[2], [1], ['Finn P', 'Lily P'], ['Finn P', 'Owen R']]);
  });

  it('MeetingLive_MarksRetake_WhenScoutAlreadyCompletedClass', () => {
    expect(view.cards.find((c) => c.id === 'c:5')!.members.map((x) => [x.name, x.retake])).toEqual([
      ['Finn P', false],
      ['Lily P', true]
    ]);
  });

  it('View_CountsOverlaps_AndPutsLinesOnBothCards', () => {
    expect([view.overlaps, view.cards.find((c) => c.id === 'c:7')!.conflicts]).toEqual([1, ['Finn P also in the Rotation 1 repeat of this class']]);
  });

  it('View_PoolLeavesOutAnyonePlaced', () => {
    expect(view.pool).toEqual([{ personId: 4, name: '#4', present: false, visitor: false }]);
  });

  it('View_CarriesEachCardsVersion_PreviewIsOne', () => {
    expect(view.cards.map((c) => c.version)).toEqual([3, 1, 1]);
  });

  it('View_NamesTheTeacher_OrNone', () => {
    expect(view.cards.map((c) => c.teacher?.name ?? null)).toEqual(['Dan V', 'Rachel D', null]);
  });
});
