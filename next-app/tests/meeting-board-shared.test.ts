import { describe, it, expect } from 'vitest';
import {
  boardName,
  carryForward,
  decideActFor,
  effectiveIntent,
  isPastSoftClose,
  onBehalfAccess,
  orderPicks,
  othersLabel,
  resolveBoardMode,
  summarizeBoard,
  type BoardPick
} from '../src/lib/meeting-board-shared';
import { buildPickList, isPickFinished, pickableKeys, rankTrees } from '../src/lib/meeting-board-picklist';
import type { CatalogMeritBadge, CatalogRank, CatalogRankRequirement } from '../src/lib/advancement-catalog';

/** Meeting board, Phase 1: the pure rules (board mode, names, intent, carry-forward, the pick list's order). */

const pick = (key: string, over: Partial<BoardPick> = {}): BoardPick => ({
  key,
  priority: null,
  later: false,
  note: null,
  firstAskedOn: '2026-10-04',
  enteredByPersonId: 1,
  carriedFrom: null,
  ...over
});

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
const TF4 = req('tenderfoot', '4a', 'First aid');
const REQS: CatalogRankRequirement[] = [
  req('tenderfoot', '1a', 'Pack for a campout', { venue: 'outing' }),
  TF4,
  req('tenderfoot', '4a.1', 'Cuts', { parent_id: TF4.id }),
  req('tenderfoot', '4a.2', 'Blisters', { parent_id: TF4.id }),
  req('tenderfoot', '3a', 'Knots'),
  req('tenderfoot', '9', 'Scout spirit'),
  req('tenderfoot', '10', 'Scoutmaster conference'),
  req('second-class', '2a', 'Map and compass'),
  req('first-class', '7a', 'Swim test')
];
const MBS: CatalogMeritBadge[] = [
  { id: 'cooking', name: 'Cooking', eagle: true },
  { id: 'art', name: 'Art', eagle: false },
  { id: 'chess', name: 'Chess', eagle: false }
];

describe('board mode', () => {
  it('Board_DefaultsClosed_ForNonMeetingCalendarEntry', () => {
    expect([
      resolveBoardMode({ boardMode: null, categoryBehavior: 'meeting', title: 'Troop Meeting' }),
      resolveBoardMode({ boardMode: null, categoryBehavior: null, title: 'Campout' }),
      resolveBoardMode({ boardMode: null, categoryBehavior: 'meeting', title: 'No Troop Meeting' }),
      resolveBoardMode({ boardMode: 'merit_badge', categoryBehavior: 'meeting', title: 'Troop Meeting' })
    ]).toEqual(['rank', 'closed', 'closed', 'merit_badge']);
  });
});

describe('names', () => {
  it('Scout_SeesWhoElsePicked_ByFirstNameLastInitial', () => {
    const names = ['Finn Parker', 'Anjali Shah', 'Leo Moss', 'Zoe Wu', 'Theo Park', 'Maya Cruz'].map(boardName);
    expect(othersLabel(names)).toBe('Finn P, Anjali S +4');
  });

  it('BoardName_HasNoPeriod_AndKeepsAOneWordName', () => {
    expect([boardName('Finn  Parker'), boardName('Cher'), othersLabel(['Finn P']), othersLabel([])]).toEqual(['Finn P', 'Cher', 'Finn P', '']);
  });
});

describe('intent', () => {
  it('Scout_PickImpliesComing_WhenNoIntentSet', () => {
    expect([effectiveIntent(null, [pick('a')]), effectiveIntent(null, []), effectiveIntent('undecided', [pick('a')])]).toEqual(['coming', null, 'undecided']);
  });

  it('Scout_LaterPickDoesNotImplyComing', () => {
    expect(effectiveIntent(null, [pick('a', { later: true })])).toBeNull();
  });

  it('Scout_NotComing_HidesPicksFromThisMeetingCounts_ButKeepsThemForNext', () => {
    const notComing = { personId: 2, intent: 'not_coming' as const, picks: [pick('tenderfoot-4a')] };
    const { counts, demand } = summarizeBoard([{ personId: 1, intent: null, picks: [pick('tenderfoot-4a')] }, notComing, { personId: 3, intent: null, picks: [] }]);
    const next = carryForward(notComing.picks, '2026-10-25', () => false);
    expect([demand.get('tenderfoot-4a'), counts.coming, counts.notComing, counts.noAnswer, counts.held, next.map((p) => p.key)]).toEqual([
      [1],
      1,
      1,
      1,
      1,
      ['tenderfoot-4a']
    ]);
  });

  it('SoftClose_IsSundayAt530Central', () => {
    expect([isPastSoftClose('2026-10-25', new Date('2026-10-25T22:29:00Z')), isPastSoftClose('2026-10-25', new Date('2026-10-25T22:30:00Z'))]).toEqual([false, true]);
  });
});

describe('carry-forward', () => {
  it('Scout_PicksCarryForward_WhenPriorMeetingDidNotTeachThem', () => {
    const out = carryForward([pick('tenderfoot-4a', { firstAskedOn: '2026-09-20', later: true, priority: 2 }), pick('tenderfoot-3a', { priority: 1 })], '2026-10-18', () => false);
    expect(out.map((p) => [p.key, p.firstAskedOn, p.later, p.priority, p.carriedFrom])).toEqual([
      ['tenderfoot-4a', '2026-09-20', false, 2, '2026-10-18'],
      ['tenderfoot-3a', '2026-10-04', false, 1, '2026-10-18']
    ]);
  });

  it('Scout_FinishedPickDropsOff_WhenLedgerSatisfiesIt', () => {
    const trees = rankTrees(REQS);
    const ctx = { currentRank: 'scout', ranks: RANKS, trees, rankCodes: new Set(['tenderfoot-4a.1', 'tenderfoot-4a.2']), awardedMbs: new Set(['cooking']) };
    const out = carryForward([pick('tenderfoot-4a', { priority: 1 }), pick('tenderfoot-3a', { priority: 2 }), pick('mb:cooking'), pick('mb:art')], '2026-10-18', (k) => isPickFinished(k, ctx));
    expect(out.map((p) => [p.key, p.priority])).toEqual([
      ['tenderfoot-3a', 1],
      ['mb:art', null]
    ]);
  });

  it('Scout_PickDropsOff_WhenTheirRankIsPastIt', () => {
    const ctx = { currentRank: 'second-class', ranks: RANKS, trees: rankTrees(REQS), rankCodes: new Set<string>(), awardedMbs: new Set<string>() };
    expect([isPickFinished('tenderfoot-3a', ctx), isPickFinished('first-class-7a', ctx)]).toEqual([true, false]);
  });

  it('Scout_UnrankedPicksSortAfterRanked_InCatalogOrder', () => {
    const order = new Map([['a', 1], ['b', 2], ['c', 3]]);
    expect(orderPicks([pick('c'), pick('b', { priority: 1 }), pick('a')], (k) => order.get(k) ?? 99).map((p) => p.key)).toEqual(['b', 'a', 'c']);
  });
});

describe('pick list', () => {
  const view = () =>
    buildPickList({
      currentRank: 'scout',
      ranks: RANKS,
      rankReqs: REQS,
      mbs: MBS,
      mbProgress: [
        { mb_id: 'cooking', awarded: false, has_any_req: true },
        { mb_id: 'chess', awarded: true, has_any_req: true }
      ],
      rankCodes: new Set(['tenderfoot-3a']),
      othersByKey: new Map([['tenderfoot-4a', ['Finn P', 'Anjali S', 'Leo M']]])
    });

  it('Scout_SeesNextRankRequirementsFirst_WhenOpeningPickList', () => {
    const v = view();
    expect(v.groups.map((g) => [g.rankId, g.next, g.rows.map((r) => r.code)])).toEqual([
      ['tenderfoot', true, ['4a', '1a']], // catalog sort order
      ['second-class', false, ['2a']],
      ['first-class', false, ['7a']]
    ]);
  });

  it('PickList_LeavesOutFinished_NotPlannable_AndEarlySmConference', () => {
    const codes = view().groups[0].rows.map((r) => r.code);
    // 3a is on the ledger; 9 (Scout spirit) is never planned; 10 waits for 95% of the rank.
    expect(['3a', '9', '10'].filter((c) => codes.includes(c))).toEqual([]);
  });

  it('PickList_DisablesOutingOnlyRows', () => {
    const v = view();
    expect([v.groups[0].rows.find((r) => r.code === '1a')!.outing, pickableKeys(v).has('tenderfoot-1a')]).toEqual([true, false]);
  });

  it('Scout_CanPickHigherRankOrMeritBadge_WhenNotNextInOrder', () => {
    const keys = pickableKeys(view());
    expect(['first-class-7a', 'mb:cooking', 'mb:art'].every((k) => keys.has(k))).toBe(true);
  });

  it('PickList_BadgesInProgressFirst_AwardedBadgesAbsent', () => {
    const v = view();
    expect([v.working.map((r) => r.key), v.badges.map((r) => r.key)]).toEqual([['mb:cooking'], ['mb:art']]);
  });

  it('PickList_ShowsWhoElsePicked', () => {
    expect(view().groups[0].rows.find((r) => r.code === '4a')!.others).toBe('Finn P, Anjali S +1');
  });
});

describe('who may act', () => {
  const base = { actorPersonId: 10, actorIsScout: false, targetPersonId: 20, householdScoutPersonIds: [20], leader: false };
  it('Parent_CanPickForHouseholdScout', () => {
    expect(decideActFor(base)).toBe(true);
  });
  it('Parent_CannotPickForOtherFamilysScout', () => {
    expect(decideActFor({ ...base, householdScoutPersonIds: [21] })).toBe(false);
  });
  it('Scout_CannotPickForSibling', () => {
    expect(decideActFor({ ...base, actorIsScout: true })).toBe(false);
  });
  it('Leader_CanPickForAnyone', () => {
    expect(decideActFor({ ...base, householdScoutPersonIds: [], leader: true })).toBe(true);
  });
});

describe('on behalf', () => {
  it('Leader_OnAPasswordOnlySession_GetsReadOnly', () => {
    expect([
      onBehalfAccess({ holdsMeetingPlan: true, actorIsScout: false, hasVerifiedSignIn: true }),
      onBehalfAccess({ holdsMeetingPlan: true, actorIsScout: false, hasVerifiedSignIn: false }),
      onBehalfAccess({ holdsMeetingPlan: true, actorIsScout: true, hasVerifiedSignIn: true }),
      onBehalfAccess({ holdsMeetingPlan: false, actorIsScout: false, hasVerifiedSignIn: true })
    ]).toEqual(['edit', 'read-only', 'none', 'none']);
  });
});
