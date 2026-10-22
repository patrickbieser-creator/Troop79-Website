import { describe, it, expect } from 'vitest';
import { pickMeeting, planRows, rankSuggestions } from '../src/lib/build-plan';
import type { PlanSession } from '../src/lib/meeting-plan-types';

/**
 * Build a Plan B1 (Plans/Build-A-Plan.md), the pure half: the meeting the screen opens on, the Suggested column's
 * ranking, and which board rows a planner may remove. No database.
 */
const session = (key: string, scouts: number, extra: Partial<PlanSession> = {}): PlanSession => ({
  id: 1,
  key,
  tier: 'new',
  kind: 'rank',
  codeLabel: key,
  title: `Title ${key}`,
  eagle: false,
  skillId: null,
  skillName: null,
  youthTeachable: false,
  adultOnly: false,
  groupPart: null,
  scouts: Array.from({ length: scouts }, (_, i) => ({ id: `s${i}`, name: `Scout ${i}`, patrol: null, rankId: 'scout', rankLabel: 'Scout' })),
  adultTeachers: [{ code: '1', name: 'Dan Kowalski' }],
  counselors: [],
  scoutTeachers: [],
  ...extra
});

describe('Build a Plan B1 (pure)', () => {
  it('BuildPlan_DefaultsToNextMeeting', () => {
    const meetings = [{ entryId: 11 }, { entryId: 12 }, { entryId: 13 }];
    expect([pickMeeting(meetings, undefined), pickMeeting(meetings, '13'), pickMeeting(meetings, '999')].map((m) => m?.entryId)).toEqual([11, 13, 11]);
  });

  it('BuildPlan_HidesSuggestionsAlreadyOnThePlan', () => {
    const plan = { sessions: [session('tenderfoot-4a', 6), session('scout-2', 3), session('tenderfoot-4a', 2, { groupPart: 'B' }), session('first-aid-2', 4)] };
    expect(rankSuggestions(plan, new Set(['first-aid-2'])).map((x) => [x.key, x.need])).toEqual([
      ['tenderfoot-4a', 8],
      ['scout-2', 3]
    ]);
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
