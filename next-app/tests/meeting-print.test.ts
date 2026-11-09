import { describe, it, expect } from 'vitest';
import { buildPrintPlan } from '@/lib/meeting-print';
import type { ThisWeek } from '@/lib/this-week';

/**
 * The printed meeting plan (Patrick, 2026-11-09): every group with its teachers, requirements and scouts, a box per
 * requirement still to do, for the end of the meeting and the advancement cross-check. Pure model; the PDF draws it.
 */
const row = (personId: number, name: string, marks: Record<string, 'open' | 'part'>, extra: Record<string, unknown> = {}) => ({
  personId,
  name,
  rank: 'tenderfoot',
  rankName: 'Tenderfoot',
  intent: 'coming',
  groupKey: 'fr:tenderfoot',
  homeKey: 'fr:tenderfoot',
  marks,
  homeMarks: {},
  note: '',
  ...extra
});

const view = {
  focus: [{ key: 'fg:1', setId: 1, name: 'First aid' }],
  badges: [{ mbId: 'climbing', name: 'Climbing', direct: true }],
  groups: [{ key: 'fr:tenderfoot', kind: 'rank', title: 'Tenderfoot group', teachers: [{ personId: 9, name: 'Mr. Vest' }] }],
  sections: [
    {
      key: 'fr:tenderfoot',
      kind: 'rank',
      title: 'Tenderfoot group',
      columns: [
        { key: 'tenderfoot-4a', code: '4a', label: 'Show first aid' },
        { key: 'tenderfoot-4b', code: '4b', label: 'Describe' }
      ],
      rows: [
        row(2, 'Ben Jones', { 'tenderfoot-4b': 'open' }),
        row(1, 'Ava Smith', { 'tenderfoot-4a': 'open', 'tenderfoot-4b': 'part' }),
        row(3, 'Cal Lee', { 'tenderfoot-4a': 'open' }, { intent: 'not_coming' })
      ]
    },
    { key: 'none', kind: 'none', title: 'Nothing tonight', columns: [], rows: [] }
  ],
  extras: [
    {
      key: 'mb:cooking',
      title: 'Cooking',
      codeLabel: 'MB',
      teachers: [],
      scouts: [
        { personId: 1, name: 'Ava Smith', intent: 'coming' },
        { personId: 3, name: 'Cal Lee', intent: 'not_coming' }
      ]
    }
  ],
  rotation: null
} as unknown as ThisWeek;

const meta = { title: 'Troop Meeting', dateLabel: 'Sunday, November 8, 2026', printedAt: 'Nov 9, 2026, 8:00 PM' };

describe('buildPrintPlan', () => {
  it('PrintPlan_NamesTheFocusAndBadgesOfTheNight', () => {
    expect(buildPrintPlan(view, meta).focus).toBe('First aid + Climbing');
  });

  it('PrintPlan_ListsAGroupsTeachers', () => {
    expect(buildPrintPlan(view, meta).sections[0].teachers).toBe('Mr. Vest');
  });

  it('PrintPlan_MarksEachCellToDoPartOrDone', () => {
    const ava = buildPrintPlan(view, meta).sections[0].rows.find((r) => r.name === 'Ava Smith');
    expect(ava?.cells).toEqual(['todo', 'part']);
  });

  it('PrintPlan_ShowsAnUnmarkedCellAsAlreadyDone', () => {
    const ben = buildPrintPlan(view, meta).sections[0].rows.find((r) => r.name === 'Ben Jones');
    expect(ben?.cells).toEqual(['done', 'todo']);
  });

  it('PrintPlan_SortsScoutsByName', () => {
    expect(buildPrintPlan(view, meta).sections[0].rows.map((r) => r.name)).toEqual(['Ava Smith', 'Ben Jones']);
  });

  it('PrintPlan_LeavesOutScoutsWhoCantCome_AndListsThemOnce', () => {
    expect(buildPrintPlan(view, meta).cantCome).toEqual(['Cal Lee']);
  });

  it('PrintPlan_DropsEmptySections', () => {
    expect(buildPrintPlan(view, meta).sections.map((s) => s.title)).toEqual(['Tenderfoot group']);
  });

  it('PrintPlan_ListsClassesWithTheirComingScouts', () => {
    expect(buildPrintPlan(view, meta).classes).toEqual([{ label: 'MB Cooking', teachers: 'No teacher yet', scouts: ['Ava Smith'] }]);
  });

  it('PrintPlan_NamesAClassOnce_WhenItsCodeLabelAlreadySaysIt', () => {
    const board = { ...view, extras: [{ key: 'life-BoR', title: 'Board of review', codeLabel: 'Life board of review', teachers: [], scouts: [{ personId: 1, name: 'Ava Smith', intent: 'coming' }] }] } as unknown as ThisWeek;
    expect(buildPrintPlan(board, meta).classes[0].label).toBe('Life board of review');
  });
});
