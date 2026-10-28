import { describe, it, expect } from 'vitest';
import { allRows, buildPickList, isPickFinished, pickableKeys, rankTrees, topicWords } from '../src/lib/meeting-board-picklist';
import { assessTeacher, topicSkill } from '../src/lib/meeting-board-teach';
import type { CatalogMeritBadge, CatalogMeritBadgeRequirement, CatalogRank, CatalogRankRequirement } from '../src/lib/advancement-catalog';

/**
 * Seeded topics in a scout's pick list (Meeting Planner P3; tech-lead's spec section 2): a focus group (one pick, one
 * class) and a single merit badge requirement come first under "Focus"; a seeded rank requirement stays in its
 * rank group, marked focus. Neither a focus group nor a merit badge requirement is ever "finished" (retakes allowed).
 */
const RANKS: CatalogRank[] = [
  { id: 'scout', display_name: 'Scout', sort_order: 0 },
  { id: 'tenderfoot', display_name: 'Tenderfoot', sort_order: 1 }
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
  class_codes: [] as string[],
  skill_id: null,
  ...o
});
const TF4 = req('tenderfoot', '4a', 'First aid');
const REQS: CatalogRankRequirement[] = [TF4, req('tenderfoot', '4a.1', 'Cuts', { parent_id: TF4.id, teach_minutes: 5 }), req('tenderfoot', '3a', 'Knots')];
const MBS: CatalogMeritBadge[] = [{ id: 'first-aid', name: 'First Aid', eagle: true }];
let mid = 100;
const mbReq = (code: string, label: string, o: Partial<CatalogMeritBadgeRequirement> = {}): CatalogMeritBadgeRequirement => ({
  id: ++mid,
  mb_id: 'first-aid',
  parent_id: null,
  code,
  label,
  complete_rule: 'all',
  complete_n: null,
  sort_order: mid,
  class_codes: [] as string[],
  ...o
});
const FA9 = mbReq('9', 'Head and spine injuries');
const MB_REQS: CatalogMeritBadgeRequirement[] = [FA9, mbReq('9a', 'Signs of a concussion', { parent_id: FA9.id, teach_minutes: 10 })];

const focus = [
  { key: 'fg:7', label: 'First aid night', codeLabel: 'Focus' },
  { key: 'first-aid-9', label: 'Head and spine injuries', codeLabel: 'First Aid 9' },
  { key: 'tenderfoot-4a', label: 'First aid', codeLabel: 'Tenderfoot 4a' }
];
const view = () => buildPickList({ currentRank: 'scout', ranks: RANKS, rankReqs: REQS, mbs: MBS, mbProgress: [], rankCodes: new Set(), focus });

describe('the pick list', () => {
  it('SeededFocus_ComesFirst_UnderMeetingFocus', () => {
    expect((view().focus ?? []).map((r) => [r.key, r.kind, r.label])).toEqual([
      ['fg:7', 'focus', 'First aid night'],
      ['first-aid-9', 'focus', 'Head and spine injuries']
    ]);
  });

  it('SeededRankRequirement_StaysInItsRankGroup_MarkedFocus', () => {
    const rows = view().groups[0].rows;
    expect([rows.find((r) => r.key === 'tenderfoot-4a')?.focus, rows.find((r) => r.key === 'tenderfoot-3a')?.focus ?? false]).toEqual([true, false]);
  });

  it('SeededMbReq_AppearsInScoutPickList_AndIsPickable', () => {
    expect(['fg:7', 'first-aid-9', 'tenderfoot-4a'].every((k) => pickableKeys(view()).has(k))).toBe(true);
  });

  it('AllRows_ListsEachKeyOnce_FocusFirst', () => {
    const keys = allRows(view()).map((r) => r.key);
    expect([keys[0], keys.filter((k) => k === 'tenderfoot-4a').length]).toEqual(['fg:7', 1]);
  });
});

describe('finished and words', () => {
  const ctx = { currentRank: 'tenderfoot', ranks: RANKS, trees: rankTrees(REQS), rankCodes: new Set<string>(), awardedMbs: new Set(['first-aid']) };

  it('FocusGroup_IsOnePick_NotFinished', () => {
    expect([isPickFinished('fg:7', ctx), isPickFinished('first-aid-9', ctx)]).toEqual([false, false]);
  });

  it('MbReqWords_NameTheBadgeAndCode_WithItsParts', () => {
    const w = topicWords('first-aid-9', RANKS, REQS, MBS, undefined, { mbReqs: MB_REQS });
    expect([w?.codeLabel, w?.label, w?.kind, w?.parts.map((p) => p.code), w?.minutes]).toEqual(['First Aid 9', 'Head and spine injuries', 'mb', ['9a'], 10]);
  });

  it('FocusGroupWords_TakeTheirTitle_AndTheirMembersAsParts', () => {
    const w = topicWords('fg:7', RANKS, REQS, MBS, new Map([['fg:7', 'First aid night']]), { mbReqs: MB_REQS, members: new Map([['fg:7', ['tenderfoot-4a.1', 'first-aid-9a']]]) });
    expect([w?.codeLabel, w?.label, w?.kind, w?.parts.map((p) => [p.code, p.label]), w?.minutes]).toEqual([
      'Focus',
      'First aid night',
      'focus',
      [
        ['Tenderfoot 4a.1', 'Cuts'],
        ['First Aid 9a', 'Signs of a concussion']
      ],
      15
    ]);
  });
});

describe('teachers', () => {
  const ctx = { ranks: RANKS, rankReqs: REQS, trees: rankTrees(REQS), youthTeachable: new Map<string, boolean>() };
  const junior = { personId: 1, kind: 'junior' as const, displayName: 'Maya S', firstName: 'Maya', lastName: 'S', gender: null, skills: new Set<string>(), counselorFor: new Set<string>(), currentRank: 'scout', rankCodes: new Set<string>() };

  it('MbReqAndFocusGroup_AreQualified_WithNoFlags_LikeFreeform', () => {
    expect([assessTeacher(junior, 'first-aid-9', ctx), assessTeacher(junior, 'fg:7', ctx)]).toEqual([
      { qualified: true, flags: [], refused: false },
      { qualified: true, flags: [], refused: false }
    ]);
  });

  it('FocusKeys_HaveNoSkill', () => {
    expect([topicSkill('fg:7', RANKS, REQS), topicSkill('first-aid-9', RANKS, REQS)]).toEqual([null, null]);
  });
});

describe('session words (qa-lead, P3)', () => {
  const catalog = { ranks: RANKS, rankRequirements: REQS, meritBadges: MBS };

  it('SeededMbReqSession_ReadsFirstAid9_NotTheKey', async () => {
    const { sessionWords } = await import('../src/lib/meeting-board-match');
    const w = sessionWords(['first-aid-9'], catalog, new Map(), undefined, { mbReqs: MB_REQS });
    expect([w.title, w.codeLabel, w.minutes]).toEqual(['Head and spine injuries', 'First Aid 9', 10]);
  });

  it('FocusGroupSession_HasItsTitleAndParts', async () => {
    const { sessionWords } = await import('../src/lib/meeting-board-match');
    const w = sessionWords(['fg:7'], catalog, new Map(), new Map([['fg:7', 'First aid night']]), { mbReqs: MB_REQS, members: new Map([['fg:7', ['tenderfoot-4a.1', 'first-aid-9a']]]) });
    expect([w.title, w.codeLabel, w.parts.map((p) => p.code), w.minutes]).toEqual(['First aid night', 'Focus', ['Tenderfoot 4a.1', 'First Aid 9a'], 15]);
  });

  it('TrayPick_OfAnUnseededFocusGroup_KeepsItsTitle', async () => {
    const { trayPicks } = await import('../src/lib/meeting-board-picklist');
    const v = buildPickList({ currentRank: 'scout', ranks: RANKS, rankReqs: REQS, mbs: MBS, mbProgress: [], rankCodes: new Set() });
    const pick = { key: 'fg:7', priority: null, later: false, note: null, firstAskedOn: '2026-10-25', enteredByPersonId: null, carriedFrom: null };
    const [t] = trayPicks([pick], { view: v, ranks: RANKS, rankReqs: REQS, mbs: MBS, names: new Map(), scoutPersonId: 1, viewerPersonId: 1, titles: new Map([['fg:7', 'First aid night']]), more: { mbReqs: MB_REQS } });
    expect([t.label, t.codeLabel]).toEqual(['First aid night', 'Focus']);
  });
});
