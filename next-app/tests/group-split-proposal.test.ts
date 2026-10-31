import { describe, it, expect } from 'vitest';
import { buildFocusPlan, rankGroupKey, type FocusInput, type FocusProgress, type FocusScout } from '../src/lib/focus-plan';
import { proposeSplit, splitOffer } from '../src/lib/group-split-proposal';
import type { CatalogRankRequirement } from '../src/lib/advancement-catalog';

/** The auto planner's split (Plans/Meeting-Planner-III-Split-Groups.md, S3): bands by requirements done, what each
 *  group teaches, the extras the further-along band needs (meeting-class only, about 60 minutes), the offer over 8,
 *  and a preview that IS placement. Tiny real-shaped catalog. */

const RANKS = [
  ['scout', 'Scout'],
  ['tenderfoot', 'Tenderfoot'],
  ['second-class', 'Second Class'],
  ['first-class', 'First Class']
].map(([id, display_name], sort_order) => ({ id, display_name, sort_order }));

let nextId = 1;
function req(code: string, teach_minutes?: number, class_codes: string[] = []): CatalogRankRequirement {
  return { id: nextId++, rank_id: 'tenderfoot', parent_id: null, code, label: `Tenderfoot ${code}`, complete_rule: 'all', complete_n: null, sort_order: nextId, class_codes, skill_id: null, teach_minutes };
}
const RANK_REQS = [req('1'), req('2'), req('3'), req('4'), req('5'), req('6', 30), req('7', undefined, ['L']), req('8', undefined, ['O']), req('9')];

const TF = rankGroupKey('tenderfoot');
let pid = 500;
const scouts = (n: number): FocusScout[] => Array.from({ length: n }, () => ({ personId: ++pid, scoutId: `S${pid}`, name: `Scout ${pid}`, currentRank: 'scout', intent: null }));
const done = (...codes: string[]): FocusProgress => ({ rankCodes: new Set(codes.map((c) => `tenderfoot-${c}`)), mbCodes: new Set() });

function input(groups: [FocusScout[], FocusProgress][], focusKeys: string[], extra: Partial<FocusInput> = {}): FocusInput {
  return {
    ranks: RANKS,
    rankReqs: RANK_REQS,
    meritBadges: [],
    mbReqs: [],
    scouts: groups.flatMap(([s]) => s),
    progress: new Map(groups.flatMap(([s, p]) => s.map((x) => [x.scoutId, p] as const))),
    focusKeys,
    ...extra
  };
}
const ids = (s: FocusScout[]) => s.map((x) => x.personId);

describe('the offer', () => {
  it('Proposal_Offered_WhenGroupExceedsCap', () => {
    expect(splitOffer(input([[scouts(6), done()], [scouts(6), done('1', '3', '4')]], ['tenderfoot-1', 'tenderfoot-2']), TF)).not.toBeNull();
  });

  it('Proposal_NotOffered_AtTheCapOf8', () => {
    expect(splitOffer(input([[scouts(4), done()], [scouts(4), done('1', '3', '4')]], ['tenderfoot-1', 'tenderfoot-2']), TF)).toBeNull();
  });

  it('Proposal_NotOffered_WhenOneColumnAndNothingElseNeeded', () => {
    const all = done('2', '3', '4', '5', '6', '9');
    expect(splitOffer(input([[scouts(12), all]], ['tenderfoot-1']), TF)).toBeNull();
  });
});

describe('the proposal', () => {
  const fresh = scouts(6);
  const ahead = scouts(6);
  const base = input([[fresh, done()], [ahead, done('1', '3', '4')]], ['tenderfoot-1', 'tenderfoot-2']);

  it('Proposal_BandsScoutsByRequirementsDone', () => {
    const p = proposeSplit(base, TF, 2)!;
    expect(p.groups.map((g) => g.members)).toEqual([ids(fresh), ids(ahead)]);
  });

  it('Proposal_Group2Focus_IsWhatBand2NeedsMost_UnderSixtyMinutes', () => {
    // Group 2 shares 2 (both bands need it), then 5 (15) and 6 (30) fill it to 60; 9 would go over, 3 and 4 are done,
    // 7 is leadership-only and 8 needs the outdoors.
    const p = proposeSplit(base, TF, 2)!;
    expect([p.sections, p.adds, p.groups.map((g) => g.minutes)]).toEqual([
      [['tenderfoot-1', 'tenderfoot-2'], ['tenderfoot-2', 'tenderfoot-5', 'tenderfoot-6']],
      ['tenderfoot-5', 'tenderfoot-6'],
      [30, 60]
    ]);
  });

  it('Proposal_PreviewEqualsPlacement', () => {
    const p = proposeSplit(base, TF, 2)!;
    const real = buildFocusPlan({ ...base, focusKeys: [...base.focusKeys, ...p.adds], splits: new Map([[TF, p.sections]]) });
    expect(p.groups.map((g) => [g.key, g.label, g.members])).toEqual(real.groups.filter((g) => g.base === TF).map((g) => [g.key, g.label, g.members]));
  });

  it('Proposal_IgnoresTheGroupsCurrentSplit', () => {
    const already = { ...base, splits: new Map([[TF, [['tenderfoot-2'], ['tenderfoot-1']]]]) };
    expect(proposeSplit(already, TF, 2)).toEqual(proposeSplit(base, TF, 2));
  });

  it('Proposal_ThreeGroups_ThreeBands', () => {
    const [a, b, c] = [scouts(4), scouts(4), scouts(4)];
    const p = proposeSplit(input([[a, done()], [b, done('1')], [c, done('1', '2', '3', '4')]], ['tenderfoot-1', 'tenderfoot-2', 'tenderfoot-5']), TF, 3)!;
    expect(p.groups.map((g) => g.members)).toEqual([ids(a), ids(b), ids(c)]);
  });

  it('Proposal_ExtraNeedsTwoScouts', () => {
    const one = scouts(1);
    const p = proposeSplit(input([[scouts(6), done()], [scouts(5), done('1', '3', '4', '5', '6', '9')], [one, done('1', '3', '4')]], ['tenderfoot-1', 'tenderfoot-2']), TF, 2)!;
    expect(p.adds).toEqual([]);
  });

  it('Proposal_IsNull_WhenTheRankHasNoGroupTonight', () => {
    expect(proposeSplit(input([[scouts(12), done()]], ['second-class-1']), TF, 2)).toBeNull();
  });
});
