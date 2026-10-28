import type { SuggestCard, SuggestionsData } from '../../src/lib/build-plan-suggest';

/** Build a Plan B5: a small Suggestions-mode payload (the shape lib/build-plan-suggest makes from the engine). */
export const card = (key: string, o: Partial<SuggestCard> = {}): SuggestCard => ({
  key,
  codeLabel: key,
  title: `Title ${key}`,
  kind: 'rank',
  eagle: false,
  ranks: ['tenderfoot'],
  rankId: 'tenderfoot',
  need: 2,
  groups: [{ part: null, scouts: ['Anjali S', 'Finn P'] }],
  best: { name: 'Dan K', note: null },
  others: [],
  skillName: 'Knots',
  adultOnly: false,
  youthTeachable: false,
  ...o
});

export const DATA: SuggestionsData = {
  ranks: [
    { id: 'scout', label: 'Scout' },
    { id: 'tenderfoot', label: 'Tenderfoot' }
  ],
  cards: [
    card('scout-2', { codeLabel: 'Scout 2', title: 'Flag', ranks: ['scout'], rankId: 'scout', need: 4, groups: [{ part: null, scouts: ['Leo K', 'Max B', 'Nia R', 'Omar T'] }], best: { name: 'Dan K', note: null }, others: [{ name: 'Finn P', note: 'Star scout' }] }),
    card('tenderfoot-4a', { codeLabel: 'Tenderfoot 4a', title: 'First aid' })
  ],
  scouts: [
    {
      id: 'a',
      name: 'Anjali S',
      patrol: 'Eagles',
      rankLabel: 'Scout',
      nextRankId: 'tenderfoot',
      items: [
        { key: 'tenderfoot-4a', codeLabel: 'Tenderfoot 4a', title: 'First aid', kind: 'rank', eagle: false, ranks: ['tenderfoot'] },
        { key: 'tenderfoot-3a', codeLabel: 'Tenderfoot 3a', title: 'Knots', kind: 'rank', eagle: false, ranks: ['tenderfoot'] },
        { key: 'tenderfoot-5', codeLabel: 'Tenderfoot 5', title: 'Buddy system', kind: 'rank', eagle: false, ranks: ['tenderfoot'] }
      ]
    }
  ],
  teachers: [{ id: 'a:7', personId: 7, name: 'Dan K', meta: 'ASM', scout: false, skills: ['Knots', 'First aid'], keys: ['scout-2', 'tenderfoot-4a'] }],
  campout: [{ codeLabel: 'TF 1b', title: 'Spend a night camping', scouts: ['Anjali S'], ranks: ['tenderfoot'], classes: ['C'] }],
  settings: [{ code: 'C', name: 'Campout' }, { code: '', name: 'Campout or outing' }]
};
