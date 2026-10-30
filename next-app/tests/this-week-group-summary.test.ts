import { describe, it, expect } from 'vitest';
import { groupSummary } from '../src/lib/this-week';
import type { AdvancementCatalog } from '../src/lib/advancement-catalog';

/**
 * Live's card corner: a very short "what's taught" (Patrick, 2026-10-30, replacing "0 of 8 here"). The planners' own
 * focus names first ("Scout Intro", "First Aid"); a group no focus covers falls back to its requirements' skills.
 */
const req = (id: number, rank_id: string, code: string, skill_id: string | null, parent_id: number | null = null) => ({
  id, rank_id, parent_id, code, label: code, complete_rule: 'all' as const, complete_n: null, sort_order: id, class_codes: [], skill_id
});
const catalog = {
  ranks: [{ id: 'scout' }, { id: 'tenderfoot' }],
  rankRequirements: [
    req(1, 'scout', '4a', 'knots'),
    req(2, 'scout', '5', 'tools'),
    req(3, 'scout', '6', null),
    req(4, 'tenderfoot', '4a', 'first-aid'),
    req(5, 'tenderfoot', '4a.1', null, 4)
  ],
  meritBadges: [],
  meritBadgeRequirements: [],
  skills: [
    { id: 'knots', name: 'Knots & Lashings' },
    { id: 'tools', name: 'Woods Tools' },
    { id: 'first-aid', name: 'First Aid' }
  ]
} as unknown as AdvancementCatalog;

describe('groupSummary', () => {
  it('Summary_IsTheFocusName_ThatCoversTheGroup', () => {
    const focus = [
      { title: 'Scout Intro', members: ['scout-4a', 'scout-5'] },
      { title: 'First Aid', members: ['tenderfoot-4a', 'tenderfoot-4a.1'] }
    ];
    expect(groupSummary(['tenderfoot-4a.1'], focus, catalog)).toBe('First Aid');
  });

  it('Summary_ListsEachFocusOnce_InFocusOrder', () => {
    const focus = [
      { title: 'Knots & Ropes', members: ['scout-4a'] },
      { title: 'Knifes', members: ['scout-5'] }
    ];
    expect(groupSummary(['scout-5', 'scout-4a'], focus, catalog)).toBe('Knots & Ropes · Knifes');
  });

  it('Summary_FallsBackToSkills_WhenNoFocusCoversTheGroup', () => {
    expect(groupSummary(['scout-4a', 'scout-5', 'scout-6', 'tenderfoot-4a.1'], [], catalog)).toBe('Knots & Lashings · Woods Tools · First Aid');
  });

  it('Summary_IsEmpty_WhenNothingNamesIt', () => {
    expect(groupSummary(['scout-6', 'first-aid-1'], [], catalog)).toBe('');
  });
});
