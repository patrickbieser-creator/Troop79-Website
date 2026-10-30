import type { SuggestCard, SuggestionsData } from '../../src/lib/planner-suggest';

/** Planner III Suggestions: a small payload (the shape lib/planner-suggest makes from the engine). */
export const card = (key: string, o: Partial<SuggestCard> = {}): SuggestCard => ({
  key,
  codeLabel: key,
  title: `Title ${key}`,
  kind: 'rank',
  eagle: false,
  group: 'tenderfoot',
  mbId: null,
  need: 2,
  scouts: [
    { name: 'Anjali S', rankId: 'scout', rankLabel: 'Scout' },
    { name: 'Finn P', rankId: 'scout', rankLabel: 'Scout' }
  ],
  best: { name: 'Dan K', note: null },
  others: [],
  skillName: 'Knots',
  adultOnly: false,
  youthTeachable: false,
  ...o
});

const person = (name: string, rankId: string | null = null) => ({ name, rankId, rankLabel: rankId ?? 'New scout' });

export const DATA: SuggestionsData = {
  cards: [
    card('tenderfoot-4a', { codeLabel: 'Tenderfoot 4a', title: 'First aid' }),
    card('scout-2', {
      codeLabel: 'Scout 2',
      title: 'Flag',
      group: 'scout',
      need: 4,
      scouts: [person('Leo K'), person('Max B'), person('Nia R'), person('Omar T')],
      others: [{ name: 'Finn P', note: 'Star scout' }]
    }),
    card('first-aid-2', { codeLabel: 'First Aid 2', title: 'Wounds', kind: 'mb', group: 'mb', mbId: 'first-aid', eagle: true, scouts: [person('Veronica K', 'star'), person('Finn P', 'star')] }),
    card('first-aid-1', { codeLabel: 'First Aid 1', title: 'Explain', kind: 'mb', group: 'mb', mbId: 'first-aid', need: 1, scouts: [person('Veronica K', 'star')] })
  ],
  scouts: [
    {
      id: 'a',
      name: 'Anjali S',
      rankId: 'scout',
      rankLabel: 'Scout',
      patrol: 'Eagles',
      group: 'tenderfoot',
      reason: null,
      items: [
        { key: 'tenderfoot-4a', codeLabel: 'Tenderfoot 4a', title: 'First aid', kind: 'rank', eagle: false, group: 'tenderfoot', mbId: null },
        { key: 'tenderfoot-3a', codeLabel: 'Tenderfoot 3a', title: 'Knots', kind: 'rank', eagle: false, group: 'tenderfoot', mbId: null },
        { key: 'tenderfoot-5', codeLabel: 'Tenderfoot 5', title: 'Buddy system', kind: 'rank', eagle: false, group: 'tenderfoot', mbId: null }
      ]
    },
    { id: 'k', name: 'Kevin P', rankId: 'first-class', rankLabel: 'First Class', patrol: null, group: 'mb', reason: 'No merit badge in progress or with a counselor', items: [] }
  ],
  teachers: [{ id: 'a:7', personId: 7, name: 'Dan K', meta: 'ASM', scout: false, skills: ['Knots', 'First aid'], keys: ['scout-2', 'tenderfoot-4a'] }],
  campout: [{ codeLabel: 'TF 1b', title: 'Spend a night camping', scouts: ['Anjali S'], groups: ['tenderfoot'], classes: ['C'] }],
  settings: [
    { code: 'C', name: 'Campout' },
    { code: '', name: 'Campout or outing' }
  ]
};
