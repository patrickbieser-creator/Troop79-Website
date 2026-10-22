import { describe, it, expect } from 'vitest';
import { isLikelyFit, likelyNames, pickMeeting, planRows, scoutLine, teacherLine } from '../src/lib/build-plan';

/**
 * Build a Plan B1 (Plans/Build-A-Plan.md), the pure half: the meeting the screen opens on, and which board rows a planner may remove. No database.
 */
describe('Build a Plan B1 (pure)', () => {
  it('BuildPlan_DefaultsToNextMeeting', () => {
    const meetings = [{ entryId: 11 }, { entryId: 12 }, { entryId: 13 }];
    expect([pickMeeting(meetings, undefined), pickMeeting(meetings, '13'), pickMeeting(meetings, '999')].map((m) => m?.entryId)).toEqual([11, 13, 11]);
  });

  it('PlanRows_OriginAndState_FollowTheBoard', () => {
    const p = (personId: number) => ({ personId, name: `P ${personId}` });
    const rows = planRows({
      ready: [{ key: 'scout-1a', codeLabel: 'Scout 1a', title: 'Oath', kind: 'rank', minutes: null, teachers: [p(9)], scouts: [p(1)] }],
      noTeacher: [{ key: 'tenderfoot-4a', codeLabel: 'Tenderfoot 4a', title: 'First aid', kind: 'rank', minutes: null, waiting: [p(2)], weeks: 1, canTeach: { coming: [], undecided: [], noAnswer: [], total: 0 }, seededBy: null }],
      offered: [{ key: 'scout-2', codeLabel: 'Scout 2', title: 'Flag', kind: 'rank', teachers: [p(9)], likelyFits: [], seededBy: 'Mindy K' }]
    });
    expect(rows.map((r) => [r.key, r.origin, r.seeded, r.state])).toEqual([
      ['scout-1a', 'scouts', false, 'ready'],
      ['tenderfoot-4a', 'scouts', false, 'needs-teacher'],
      ['scout-2', 'planner', true, 'needs-scouts']
    ]);
  });
});

/** Patrick, 2026-10-22: a row's scout line names the likely scouts, and says nothing when there are none. */
describe('Build a Plan row lines (pure)', () => {
  const RANKS = [
    { id: 'scout', display_name: 'Scout', sort_order: 1 },
    { id: 'tenderfoot', display_name: 'Tenderfoot', sort_order: 2 }
  ] as Parameters<typeof isLikelyFit>[2];

  it('ScoutLine_NamesThreeLikelyScouts_ThenHowManyMore', () => {
    expect(scoutLine({ scouts: 0 }, ['Anjali S', 'Finn P', 'Leo K', 'Max B', 'Nia R'])).toBe('Likely: Anjali S, Finn P, Leo K +2');
  });

  it('ScoutLine_NoSignupsAndNoLikelyScouts_IsNull', () => {
    expect(scoutLine({ scouts: 0 }, [])).toBeNull();
  });

  it('ScoutLine_WithSignups_KeepsTheSignedUpLine', () => {
    expect(scoutLine({ scouts: 3 }, ['Finn P'])).toBe('3 signed up');
  });

  it('TeacherLine_JustAddedRowNotCountedYet_IsNull', () => {
    expect(teacherLine({ teachers: [], canTeach: null })).toBeNull();
  });

  it('IsLikelyFit_RankKey_OnlyForScoutsWorkingOnThatRank', () => {
    expect([isLikelyFit({ currentRank: 'scout' }, 'tenderfoot-4a', RANKS), isLikelyFit({ currentRank: 'tenderfoot' }, 'tenderfoot-4a', RANKS)]).toEqual([true, false]);
  });

  // B6: the `topic == null` shortcut is gone; a mix with nothing open for the scout is not likely.
  it('IsLikelyFit_MixWithNothingOpen_IsNotLikely', () => {
    expect(isLikelyFit({ currentRank: 'tenderfoot' }, 'fg:7', RANKS)).toBe(false);
  });

  it('LikelyNames_LeavesOutScoutsWhoPickedIt', () => {
    const cands = [
      { name: 'Leo K', ticked: true, currentRank: 'scout' },
      { name: 'Finn P', ticked: false, currentRank: 'scout' },
      { name: 'Anjali S', ticked: true, currentRank: 'scout' }
    ];
    expect(likelyNames(cands, 'tenderfoot-4a', RANKS)).toEqual(['Anjali S', 'Leo K']);
  });
});
