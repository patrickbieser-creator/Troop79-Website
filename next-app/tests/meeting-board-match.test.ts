import { describe, it, expect } from 'vitest';
import { engineSuggestions, matchBoard, nextRankCompletion, seatLines, seatsFor, teachingFor, teachingLines, type MatchInput, type MatchScout } from '../src/lib/meeting-board-match';
import { rankTrees } from '../src/lib/meeting-board-picklist';
import type { BoardPick, Intent } from '../src/lib/meeting-board-shared';
import type { SupplyInput, TeachContext, TeacherPerson } from '../src/lib/meeting-board-teach';
import type { CatalogRank, CatalogRankRequirement } from '../src/lib/advancement-catalog';

/**
 * Meeting board, Phase 3a (Plans/Meeting-Requests-And-Teaching-Offers.md, "Matching rules"): the live matcher, pure.
 * Fixture catalog and people only; nothing here touches the database.
 */

const RANKS: CatalogRank[] = [
  { id: 'scout', display_name: 'Scout', sort_order: 0 },
  { id: 'tenderfoot', display_name: 'Tenderfoot', sort_order: 1 },
  { id: 'second-class', display_name: 'Second Class', sort_order: 2 },
  { id: 'first-class', display_name: 'First Class', sort_order: 3 }
];
let rid = 0;
const req = (rank_id: string, code: string, label: string, o: Partial<CatalogRankRequirement> = {}): CatalogRankRequirement => ({
  id: ++rid,
  rank_id,
  parent_id: null,
  code,
  label,
  complete_rule: 'all',
  complete_n: null,
  sort_order: rid,
  venue: 'either',
  skill_id: null,
  ...o
});
const REQS: CatalogRankRequirement[] = [
  req('tenderfoot', '4a', 'First aid', { skill_id: 'first-aid' }),
  req('tenderfoot', '4b', 'Bites and stings', { skill_id: 'first-aid' }),
  req('tenderfoot', '4c', 'First aid kit', { skill_id: 'first-aid' }),
  req('tenderfoot', '3a', 'Knots', { skill_id: 'knots' }),
  req('tenderfoot', '3b', 'Lashings', { skill_id: 'knots' }),
  req('tenderfoot', '1a', 'Campout', { venue: 'outing' }),
  req('tenderfoot', '7a', 'Flag ceremony'),
  req('second-class', '2a', 'Map and compass', { skill_id: 'navigation' })
];
const CTX: TeachContext = {
  ranks: RANKS,
  rankReqs: REQS,
  trees: rankTrees(REQS),
  youthTeachable: new Map([
    ['first-aid', false],
    ['knots', true],
    ['navigation', true]
  ])
};
const FA = 'tenderfoot-4a';
const BITES = 'tenderfoot-4b';
const KNOTS = 'tenderfoot-3a';
const FLAG = 'tenderfoot-7a';

const adult = (personId: number, skills: string[] = [], o: Partial<TeacherPerson> = {}): TeacherPerson => ({
  personId,
  kind: 'adult',
  displayName: `Adult ${personId}`,
  firstName: 'Adult',
  lastName: String(personId),
  gender: 'M',
  skills: new Set(skills),
  counselorFor: new Set(),
  currentRank: null,
  rankCodes: new Set(),
  ...o
});
const pick = (key: string, o: Partial<BoardPick> = {}): BoardPick => ({
  key,
  priority: null,
  later: false,
  note: null,
  firstAskedOn: '2026-10-25',
  enteredByPersonId: null,
  carriedFrom: null,
  ...o
});
/** Picks ranked in the order given. */
const ranked = (...keys: string[]) => keys.map((k, i) => pick(k, { priority: i + 1 }));
const scout = (personId: number, picks: BoardPick[], o: Partial<MatchScout> = {}): MatchScout => ({
  personId,
  currentRank: 'scout',
  rankCodes: new Set(),
  intent: null,
  picks,
  ...o
});
const range = (from: number, n: number) => Array.from({ length: n }, (_, i) => from + i);

/** A teacher with their second session already spoken for (one scout, scout id 900+, in First aid): their topic can't
 *  split into a Group B, so it is genuinely full at 8. */
const busy = (personId: number, key = FA) => ({ teach: { personId, key }, scout: scout(900 + personId, [pick(key)]) });

function input(o: {
  scouts: MatchScout[];
  people?: TeacherPerson[];
  teach?: { personId: number; key: string }[];
  offers?: { personId: number; skillId: string }[];
  notComing?: number[];
  teacherIntents?: [number, Intent][];
}): MatchInput {
  const supply: SupplyInput = {
    topicTeachers: (o.teach ?? []).map((t) => ({ ...t, note: null })),
    skillOffers: (o.offers ?? []).map((t) => ({ ...t, note: null })),
    people: new Map((o.people ?? []).map((p) => [p.personId, p])),
    notComing: new Set(o.notComing ?? []),
    ctx: CTX
  };
  return { meetingDate: '2026-11-01', scouts: o.scouts, supply, teacherIntents: new Map(o.teacherIntents ?? []) };
}
const seated = (r: ReturnType<typeof matchBoard>, key: string) =>
  r.sessions
    .filter((s) => s.keys.includes(key))
    .flatMap((s) => s.scouts.map((x) => x.personId))
    .sort((a, b) => a - b);

describe('matcher: assignment', () => {
  it('Matcher_AssignsAtMostTwoTopics_EvenWithMoreSessionsOpen', () => {
    const r = matchBoard(
      input({
        scouts: [scout(1, ranked(FA, KNOTS, FLAG))],
        people: [adult(40, ['first-aid']), adult(41, ['knots']), adult(42)],
        teach: [
          { personId: 40, key: FA },
          { personId: 41, key: KNOTS },
          { personId: 42, key: FLAG }
        ]
      })
    );
    // Flag ceremony ends up with nobody (scout 1 is full at two): not a session, so it's on "Offered, no takers".
    expect([r.sessions.length, seatsFor(r, 1).map((s) => s.key), r.offeredNoTakers]).toEqual([2, [FA, KNOTS], [{ personId: 42, key: FLAG, skillId: null }]]);
  });

  it('Matcher_DropsASessionNobodyEndedUpIn_FromSessions', () => {
    const r = matchBoard(
      input({
        scouts: [scout(1, ranked(FA, KNOTS, FLAG))],
        people: [adult(40, ['first-aid']), adult(41, ['knots']), adult(42)],
        teach: [{ personId: 40, key: FA }, { personId: 41, key: KNOTS }, { personId: 42, key: FLAG }]
      })
    );
    expect([r.sessions.map((s) => s.keys[0]), r.sessions.every((s) => s.scouts.length > 0), r.offeredNoTakers.map((o) => o.key)]).toEqual([[FA, KNOTS], true, [FLAG]]);
  });

  it('Matcher_SuggestsDifferentHalves_ForAScoutsTwoSessions', () => {
    const r = matchBoard(
      input({
        scouts: [scout(1, ranked(FA, KNOTS)), scout(2, ranked(FA, KNOTS))],
        people: [adult(40, ['first-aid']), adult(41, ['knots'])],
        teach: [{ personId: 40, key: FA }, { personId: 41, key: KNOTS }]
      })
    );
    expect(r.sessions.map((s) => s.half).sort()).toEqual([0, 1]);
  });

  it('Matcher_StillMatches_WhenTheHalvesCantBeKeptApart', () => {
    // Scouts 1-3 each want two of three topics in a ring: no split of three sessions into two halves keeps everyone
    // apart. The halves are a guide, so every scout still gets both.
    const r = matchBoard(
      input({
        scouts: [scout(1, ranked(FA, KNOTS)), scout(2, ranked(KNOTS, FLAG)), scout(3, ranked(FLAG, FA))],
        people: [adult(40, ['first-aid']), adult(41, ['knots']), adult(42)],
        teach: [{ personId: 40, key: FA }, { personId: 41, key: KNOTS }, { personId: 42, key: FLAG }]
      })
    );
    expect([1, 2, 3].map((id) => seatsFor(r, id).length)).toEqual([2, 2, 2]);
  });

  it('Matcher_NumbersBlocks_FirstHalfThenSecond', () => {
    const r = matchBoard(
      input({
        scouts: [scout(1, ranked(FA, KNOTS)), scout(2, ranked(FA, KNOTS)), scout(3, [pick(FLAG)])],
        people: [adult(40, ['first-aid']), adult(41, ['knots']), adult(42)],
        teach: [{ personId: 40, key: FA }, { personId: 41, key: KNOTS }, { personId: 42, key: FLAG }]
      })
    );
    expect(r.sessions.map((s) => [s.block, s.half])).toEqual([
      [0, 0],
      [1, 0],
      [2, 1]
    ]);
  });

  it('Matcher_HasNoMeetingWideCap_ThirteenTeachersMakeThirteenSessions', () => {
    // Thirteen teachers, thirteen freeform topics, one scout each (Decision 8: MAX_BLOCKS is gone; rotations are open-ended).
    const ids = range(1, 13);
    const r = matchBoard(
      input({
        scouts: ids.map((id) => scout(id, [pick(`ff:topic ${id}`)])),
        people: ids.map((id) => adult(100 + id)),
        teach: ids.map((id) => ({ personId: 100 + id, key: `ff:topic ${id}` }))
      })
    );
    expect([r.sessions.length, r.blockCount, r.wanted.length]).toEqual([13, 13, 0]);
  });

  it('Matcher_CapsSessionAtEight_WhenTopicOversubscribed', () => {
    const b = busy(41);
    const r = matchBoard(input({ scouts: [...range(1, 10).map((id) => scout(id, [pick(KNOTS)])), b.scout], people: [adult(41, ['knots'])], teach: [{ personId: 41, key: KNOTS }, b.teach] }));
    expect([seated(r, KNOTS).length, r.comingNothing.length]).toEqual([8, 2]);
  });

  it('Matcher_SplitsOversubscribedTopic_WhenTeacherCanLeadASecondSession', () => {
    const r = matchBoard(input({ scouts: range(1, 10).map((id) => scout(id, [pick(KNOTS)])), people: [adult(41, ['knots'])], teach: [{ personId: 41, key: KNOTS }] }));
    expect(r.sessions.map((s) => [s.group, s.block, s.half, s.scouts.length])).toEqual([
      ['A', 0, 0, 5],
      ['B', 1, 1, 5]
    ]);
  });

  it('Matcher_PrefersLongestAsked_WhenTopicFull', () => {
    const b = busy(41);
    const scouts = [...range(1, 8).map((id) => scout(id, [pick(KNOTS)])), scout(9, [pick(KNOTS, { firstAskedOn: '2026-09-06' })]), b.scout];
    const r = matchBoard(input({ scouts, people: [adult(41, ['knots'])], teach: [{ personId: 41, key: KNOTS }, b.teach] }));
    expect([seated(r, KNOTS).includes(9), seated(r, KNOTS).includes(8)]).toEqual([true, false]);
  });

  it('Matcher_PrefersClosestToRankCompletion_WhenTopicFull', () => {
    const b = busy(41);
    const scouts = [...range(1, 8).map((id) => scout(id, [pick(KNOTS)])), scout(9, [pick(KNOTS)], { rankCodes: new Set(['tenderfoot-4a', 'tenderfoot-4b', 'tenderfoot-4c']) }), b.scout];
    const r = matchBoard(input({ scouts, people: [adult(41, ['knots'])], teach: [{ personId: 41, key: KNOTS }, b.teach] }));
    expect([seated(r, KNOTS).includes(9), seated(r, KNOTS).includes(8)]).toEqual([true, false]);
  });

  it('Matcher_HonorsScoutRanking_WhenTopicFull', () => {
    // Seven scouts and scout 9 rank Knots #1. Scout 8 ranks it #3 (behind two topics nobody teaches), and is closer to
    // Tenderfoot and has asked longer: their own ranking still decides, so 8 is the one left out.
    const scouts = [
      ...range(1, 7).map((id) => scout(id, ranked(KNOTS))),
      scout(8, ranked(FA, BITES, KNOTS).map((p) => ({ ...p, firstAskedOn: '2026-08-01' })), { rankCodes: new Set(['tenderfoot-3b', 'tenderfoot-7a']) }),
      scout(9, ranked(KNOTS))
    ];
    const r = matchBoard(input({ scouts: [...scouts, busy(41).scout], people: [adult(41, ['knots'])], teach: [{ personId: 41, key: KNOTS }, busy(41).teach] }));
    expect([seated(r, KNOTS).includes(9), seated(r, KNOTS).includes(8)]).toEqual([true, false]);
  });

  it('Matcher_RankedPickBeatsUnranked_WhenTopicFull', () => {
    const scouts = [...range(1, 8).map((id) => scout(id, [pick(KNOTS, { firstAskedOn: '2026-09-01' })])), scout(9, ranked(KNOTS))];
    const r = matchBoard(input({ scouts: [...scouts, busy(41).scout], people: [adult(41, ['knots'])], teach: [{ personId: 41, key: KNOTS }, busy(41).teach] }));
    expect([seated(r, KNOTS).includes(9), seated(r, KNOTS).length]).toEqual([true, 8]);
  });

  it('Matcher_GivesEveryoneOneBeforeAnyoneTwo', () => {
    // All unranked. Scouts 1-8 want Knots, then Flag ceremony. Scout 9 wants First aid (nobody teaches it), then Flag
    // ceremony, and loses every tie-break (asked last, highest id). Flag ceremony is everyone's second thing and has 8
    // seats for 9: scout 9 still gets in, because nobody gets a second topic before everyone has a first.
    const scouts = [...range(1, 8).map((id) => scout(id, [pick(KNOTS), pick(FLAG)])), scout(9, [pick(FA, { firstAskedOn: '2026-10-30' }), pick(FLAG, { firstAskedOn: '2026-10-30' })])];
    const r = matchBoard(input({ scouts: [...scouts, busy(42, BITES).scout], people: [adult(41, ['knots']), adult(42)], teach: [{ personId: 41, key: KNOTS }, { personId: 42, key: FLAG }, busy(42, BITES).teach] }));
    expect([seated(r, FLAG).includes(9), seated(r, FLAG).length]).toEqual([true, 8]);
  });

  it('Matcher_RankCompletionComesBeforeLongestAsked_WhenTopicFull', () => {
    // Scouts 1-7 are part way; scout 8 has asked longest but done nothing; scout 9 asked last and is nearly there.
    const mid = new Set(['tenderfoot-4a', 'tenderfoot-4b']);
    const scouts = [
      ...range(1, 7).map((id) => scout(id, [pick(KNOTS)], { rankCodes: mid })),
      scout(8, [pick(KNOTS, { firstAskedOn: '2026-08-01' })]),
      scout(9, [pick(KNOTS, { firstAskedOn: '2026-10-30' })], { rankCodes: new Set([...mid, 'tenderfoot-4c', FLAG]) })
    ];
    const r = matchBoard(input({ scouts: [...scouts, busy(41).scout], people: [adult(41, ['knots'])], teach: [{ personId: 41, key: KNOTS }, busy(41).teach] }));
    expect([seated(r, KNOTS).includes(9), seated(r, KNOTS).includes(8)]).toEqual([true, false]);
  });

  it('Matcher_BreaksAFullTie_ByPersonId_NotInputOrder', () => {
    const scouts = range(1, 9).map((id) => scout(id, [pick(KNOTS)])).reverse();
    const r = matchBoard(input({ scouts: [...scouts, busy(41).scout], people: [adult(41, ['knots'])], teach: [{ personId: 41, key: KNOTS }, busy(41).teach] }));
    expect(seated(r, KNOTS)).toEqual(range(1, 8));
  });

  it('Matcher_IgnoresLaterPicks_ForThisMeeting', () => {
    const r = matchBoard(input({ scouts: [scout(1, [pick(KNOTS, { later: true })])], people: [adult(41, ['knots'])], teach: [{ personId: 41, key: KNOTS }] }));
    expect([r.sessions.length, seatsFor(r, 1).length, r.offeredNoTakers]).toEqual([0, 0, [{ personId: 41, key: KNOTS, skillId: null }]]);
  });

  it('Matcher_IgnoresCantMakeItScouts', () => {
    const r = matchBoard(input({ scouts: [scout(1, [pick(KNOTS)], { intent: 'not_coming' }), scout(2, [pick(KNOTS)])], people: [adult(41, ['knots'])], teach: [{ personId: 41, key: KNOTS }] }));
    expect(seated(r, KNOTS)).toEqual([2]);
  });

  it('Matcher_AllowsAOneScoutSession_WhenATeacherCommitted', () => {
    const r = matchBoard(input({ scouts: [scout(1, [pick(KNOTS)])], people: [adult(41, ['knots'])], teach: [{ personId: 41, key: KNOTS }] }));
    expect(r.sessions.map((s) => [s.keys, s.teacherId, s.scouts.map((x) => x.personId)])).toEqual([[[KNOTS], 41, [1]]]);
  });

  it('ScoutLine_CarriesNoClassmates_TeacherLineDoes', () => {
    const r = matchBoard(input({ scouts: [scout(1, [pick(KNOTS)]), scout(2, [pick(KNOTS)])], people: [adult(41, ['knots'])], teach: [{ personId: 41, key: KNOTS }] }));
    const src = { catalog: { ranks: RANKS, rankRequirements: REQS, meritBadges: [], skills: [] }, people: new Map([[41, adult(41, ['knots'])]]), scoutNames: new Map([[1, 'Ann A'], [2, 'Bo B']]) };
    expect([seatLines(r, 1, src).map((l) => l.scouts), teachingLines(r, 41, src).map((l) => l.scouts)]).toEqual([[[]], [['Ann A', 'Bo B']]]);
  });

  it('Matcher_ShowsTheScoutsOwnNumber_WhenRanked', () => {
    const r = matchBoard(input({ scouts: [scout(1, ranked(FA, KNOTS)), scout(2, [pick(KNOTS)])], people: [adult(41, ['knots'])], teach: [{ personId: 41, key: KNOTS }] }));
    expect([seatsFor(r, 1)[0].pickNo, seatsFor(r, 2)[0].pickNo]).toEqual([2, null]);
  });
});

describe('matcher: teachers', () => {
  it('Matcher_SkillOfferCatchesRequirementPicks_WhenSkillMatches', () => {
    const r = matchBoard(input({ scouts: [scout(1, [pick(FA)]), scout(2, [pick(BITES)])], people: [adult(40, ['first-aid'])], offers: [{ personId: 40, skillId: 'first-aid' }] }));
    expect(r.sessions.map((s) => [s.keys, s.via, s.teacherId, s.scouts.map((x) => x.personId)])).toEqual([[[FA, BITES], 'offer', 40, [1, 2]]]);
  });

  it('Matcher_MergesSiblingPicksSharingASkill_IntoTheCommittedSession', () => {
    const r = matchBoard(input({ scouts: [scout(1, [pick(FA)]), scout(2, [pick(BITES)])], people: [adult(40, ['first-aid'])], teach: [{ personId: 40, key: FA }] }));
    expect(r.sessions.map((s) => [s.keys, s.scouts.length])).toEqual([[[FA, BITES], 2]]);
  });

  it('Matcher_DoesNotMergeSiblings_TheTeacherIsNotQualifiedFor', () => {
    // Committed to 4a without the skill (allowed, flagged): 4b is not pulled in on an unqualified teacher.
    const r = matchBoard(input({ scouts: [scout(1, [pick(FA)]), scout(2, [pick(BITES)])], people: [adult(40)], teach: [{ personId: 40, key: FA }] }));
    expect([r.sessions.map((s) => [s.keys, s.flags]), r.wanted.map((w) => w.key)]).toEqual([[[[FA], ['not_in_skills']]], [BITES]]);
  });

  it('Matcher_FlagsCounselorNeeded_WhenMbTeacherNotCounselor', () => {
    const r = matchBoard(
      input({
        scouts: [scout(1, [pick('mb:cooking')]), scout(2, [pick('mb:camping')])],
        people: [adult(40), adult(41, [], { counselorFor: new Set(['camping']) })],
        teach: [{ personId: 40, key: 'mb:cooking' }, { personId: 41, key: 'mb:camping' }]
      })
    );
    expect(Object.fromEntries(r.sessions.map((s) => [s.keys[0], s.flags]))).toEqual({ 'mb:cooking': ['needs_counselor'], 'mb:camping': [] });
  });

  it('Matcher_LetsATeacherLeadTwoSessions_AndListsTheThirdAsNoRoom', () => {
    const r = matchBoard(
      input({
        scouts: [scout(1, [pick(KNOTS)]), scout(2, [pick(KNOTS)]), scout(3, [pick(FLAG)]), scout(4, [pick(FLAG)]), scout(5, [pick(FA)])],
        people: [adult(41, ['knots'])],
        teach: [{ personId: 41, key: KNOTS }, { personId: 41, key: FLAG }, { personId: 41, key: FA }]
      })
    );
    expect([r.sessions.length, r.wanted.map((w) => [w.key, w.blockedTeacherIds])]).toEqual([2, [[FA, [41]]]]);
  });

  it('Matcher_LeavesOutCantMakeItTeachers', () => {
    const r = matchBoard(input({ scouts: [scout(1, [pick(KNOTS)])], people: [adult(41, ['knots'])], teach: [{ personId: 41, key: KNOTS }], notComing: [41] }));
    expect([r.sessions.length, r.wanted.map((w) => w.key)]).toEqual([0, [KNOTS]]);
  });

  it('Matcher_JuniorLeaderTeacher_IsNotSeatedInTheBlockTheyTeach', () => {
    const jl = adult(5, ['knots'], { kind: 'junior', currentRank: 'first-class' });
    const r = matchBoard(
      input({
        scouts: [scout(1, [pick(KNOTS)]), scout(5, ranked(FLAG), { currentRank: 'first-class' })],
        people: [jl, adult(42)],
        teach: [{ personId: 5, key: KNOTS }, { personId: 42, key: FLAG }]
      })
    );
    const knots = r.sessions.find((s) => s.keys.includes(KNOTS))!;
    expect([seatsFor(r, 5).map((s) => s.block).includes(knots.block), teachingFor(r, 5).map((s) => s.keys[0])]).toEqual([false, [KNOTS]]);
  });

  it('Matcher_SkipsATeacherWhoNoLongerQualifies', () => {
    const r = matchBoard(input({ scouts: [scout(1, [pick(KNOTS)])], people: [adult(41, ['knots'], { eligible: false })], teach: [{ personId: 41, key: KNOTS }] }));
    expect(r.sessions.length).toBe(0);
  });
});

describe('matcher: undecided and unmatched', () => {
  it('Matcher_PlacesUndecidedScout_ByEngineSuggestion', () => {
    // Next rank Tenderfoot, nothing done: the engine's order is 4a, 4b, 4c, 3a…; only Knots (3a) is live.
    const r = matchBoard(
      input({ scouts: [scout(1, [pick(KNOTS)]), scout(2, [], { intent: 'undecided' })], people: [adult(41, ['knots'])], teach: [{ personId: 41, key: KNOTS }] })
    );
    expect([seatsFor(r, 2).map((s) => [s.key, s.via]), r.undecidedScouts]).toEqual([[[KNOTS, 'placed']], [{ personId: 2, placed: true }]]);
  });

  it('Matcher_PlacesUndecidedScoutsLast_WhenTopicFull', () => {
    const scouts = [...range(1, 8).map((id) => scout(id, [pick(KNOTS)])), scout(9, [pick(KNOTS, { firstAskedOn: '2026-08-01' })], { intent: 'undecided' })];
    const r = matchBoard(input({ scouts: [...scouts, busy(41).scout], people: [adult(41, ['knots'])], teach: [{ personId: 41, key: KNOTS }, busy(41).teach] }));
    expect(seated(r, KNOTS).includes(9)).toBe(false);
  });

  it('Matcher_OffersUndecidedAdult_WantedNoTeacherTopicsInTheirSkills', () => {
    const r = matchBoard(
      input({ scouts: [scout(1, [pick(KNOTS), pick(FA)])], people: [adult(50, ['knots']), adult(51, ['first-aid'])], teacherIntents: [[50, 'undecided'], [51, 'coming']] })
    );
    expect(r.undecidedAdults).toEqual([{ personId: 50, fits: [KNOTS] }]);
  });

  it('Matcher_ListsWantedNoTeacher_WhenDemandUnmet', () => {
    const r = matchBoard(
      input({ scouts: [scout(1, [pick(FA, { firstAskedOn: '2026-10-11' })]), scout(2, [pick(FA)])], people: [adult(40, ['first-aid']), adult(41, ['knots'])] })
    );
    expect(r.wanted).toEqual([{ key: FA, scoutIds: [1, 2], weeks: 3, canTeach: [40], blockedTeacherIds: [] }]);
  });

  it('Matcher_ListsOfferedNoTakers_ForAnIdleSkillOffer', () => {
    const r = matchBoard(input({ scouts: [scout(1, [pick(KNOTS)])], people: [adult(40, ['first-aid'])], offers: [{ personId: 40, skillId: 'first-aid' }] }));
    expect(r.offeredNoTakers).toEqual([{ personId: 40, key: null, skillId: 'first-aid' }]);
  });

  it('Matcher_ListsComingWithNothing_WithTheEnginesNextSuggestion', () => {
    const r = matchBoard(input({ scouts: [scout(1, [], { intent: 'coming' }), scout(2, [pick(KNOTS)])] }));
    expect(r.comingNothing).toEqual([
      { personId: 1, suggestion: FA },
      { personId: 2, suggestion: FA }
    ]);
  });

  it('EngineSuggestions_SkipFinishedAndOutingOnly', () => {
    expect(engineSuggestions({ currentRank: 'scout', rankCodes: new Set([FA]) }, CTX)).toEqual([BITES, 'tenderfoot-4c', KNOTS, 'tenderfoot-3b', FLAG]);
  });

  it('RankCompletion_IsTheShareOfTheNextRanksLeavesDone', () => {
    expect(nextRankCompletion({ currentRank: 'scout', rankCodes: new Set([FA, BITES]) }, CTX)).toBeCloseTo(2 / 7);
  });
});

describe('matcher: determinism', () => {
  const rich = () =>
    input({
      scouts: [
        ...range(1, 11).map((id) => scout(id, id % 2 ? ranked(KNOTS, FA, FLAG) : [pick(FA), pick(BITES), pick('mb:cooking')], { rankCodes: new Set(id % 3 ? [] : ['tenderfoot-3b']) })),
        scout(20, [], { intent: 'undecided' }),
        scout(21, [pick(FLAG, { later: true })]),
        scout(22, [pick(KNOTS)], { intent: 'not_coming' })
      ],
      people: [adult(40, ['first-aid']), adult(41, ['knots']), adult(42), adult(43, ['first-aid']), adult(44, [], { counselorFor: new Set(['cooking']) })],
      teach: [
        { personId: 41, key: KNOTS },
        { personId: 42, key: FLAG },
        { personId: 44, key: 'mb:cooking' },
        { personId: 43, key: BITES }
      ],
      offers: [{ personId: 40, skillId: 'first-aid' }],
      teacherIntents: [[42, 'undecided']]
    });
  const reversed = (i: MatchInput): MatchInput => ({
    ...i,
    scouts: [...i.scouts].reverse().map((s) => ({ ...s, picks: [...s.picks].reverse() })),
    supply: {
      ...i.supply,
      topicTeachers: [...i.supply.topicTeachers].reverse(),
      skillOffers: [...i.supply.skillOffers].reverse(),
      people: new Map([...i.supply.people].reverse())
    },
    teacherIntents: new Map([...i.teacherIntents].reverse())
  });

  it('Matcher_SameInput_GivesTheSameMatch', () => {
    expect(JSON.stringify(matchBoard(rich()))).toBe(JSON.stringify(matchBoard(rich())));
  });

  it('Matcher_IsOrderIndependent_WhenInputsAreShuffled', () => {
    expect(JSON.stringify(matchBoard(reversed(rich())))).toBe(JSON.stringify(matchBoard(rich())));
  });

  it('Matcher_NeverExceedsTheCaps_OnABusyBoard', () => {
    const r = matchBoard(rich());
    const bad = [
      ...r.sessions.filter((s) => s.scouts.length > 8).map((s) => `over 8: ${s.id}`),
      ...r.assignments.filter((a) => a.seats.length > 2).map((a) => `over 2: ${a.personId}`),
      ...r.assignments.filter((a) => new Set(a.seats.map((s) => s.block)).size < a.seats.length).map((a) => `same block: ${a.personId}`)
    ];
    expect([bad, r.assignments.length > 0]).toEqual([[], true]);
  });
});
