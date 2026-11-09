import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import { MbScoutGrid } from '../src/app/(public)/library/mb/[mbId]/mb-scout-grid';
import { buildProgressGrid, type RuleNode } from '../src/lib/mb-progress-grid';
import type { MbScoutLike, MbScoutSlot } from '../src/lib/mb-scout-progress';

/** Concept A2 on the merit badge page (Plans/MB-Scout-Progress-Grid.md): brackets instead of "Req N", a Progress
 *  column instead of the AWARD star, every cell announcing its code and state, earned scouts below a divider, and
 *  the superuser's "view as" scout highlighted. */

afterEach(cleanup);

const node = (code: string, children: RuleNode[] = [], complete_rule: 'all' | 'any' = 'all'): RuleNode => ({ code, label: `Req ${code}`, complete_rule, complete_n: null, children });
const TREE = [node('1', [node('1a'), node('1b')], 'any'), node('2'), node('3')];
const sc = (id: string, first: string, last: string): MbScoutLike => ({ id, first_name: first, last_name: last, current_rank: 'tenderfoot' });
const slot = (codes: string[], awarded = false): MbScoutSlot => ({ awarded, codes: new Set(codes), dates: new Map() });
const ANN = sc('A', 'Ann', 'Lee');
const BEN = sc('B', 'Ben', 'Ross');
const KIT = sc('K', 'Kit', 'Moe');
const grid = buildProgressGrid(
  TREE,
  [ANN, BEN, KIT],
  new Map([
    [ANN.id, slot(['1b'])],
    [BEN.id, slot(['1a', '2', '3'], true)],
    [KIT.id, slot([], true)]
  ])
);
const show = (highlightId: string | null = null) => render(<MbScoutGrid grid={grid} highlightId={highlightId} />);
const rowFor = (name: string) => screen.getByRole('rowheader', { name: new RegExp(name) }).closest('tr')!;

describe('MbScoutGrid', () => {
  it('Header_HasNoReqNRow', () => {
    show();
    expect(screen.queryByText(/Req \d/)).toBeNull();
  });

  it('Header_HasNoAwardStar', () => {
    show();
    expect(screen.queryByText(/AWARD|★|☆/)).toBeNull();
  });

  it('Header_ShowsTheChoiceBracket', () => {
    show();
    expect(screen.getByText('any 1')).toBeTruthy();
  });

  it('Header_CodeNamesItsBracket', () => {
    show();
    expect(screen.getByRole('columnheader', { name: '1a, any 1 of 1a–1b' })).toBeTruthy();
  });

  it('Cell_AnnouncesDone', () => {
    show();
    expect(within(rowFor('Ann L')).getByRole('img', { name: '1b done' })).toBeTruthy();
  });

  it('Cell_AnnouncesNotNeeded', () => {
    show();
    expect(within(rowFor('Ann L')).getByRole('img', { name: '1a not needed' })).toBeTruthy();
  });

  it('Cell_AnnouncesStillToDo', () => {
    show();
    expect(within(rowFor('Ann L')).getByRole('img', { name: '2 still to do' })).toBeTruthy();
  });

  it('Progress_ShowsMetOfTotal', () => {
    show();
    expect(within(rowFor('Ann L')).getByText('1 of 3')).toBeTruthy();
  });

  it('Earned_ShowsThePill', () => {
    show();
    expect(within(rowFor('Ben R')).getByText('Earned')).toBeTruthy();
  });

  it('CounselorOnly_ShowsTheCompleteBar', () => {
    show();
    expect(within(rowFor('Kit M')).getByText('All requirements complete')).toBeTruthy();
  });

  it('Earned_StartsBelowTheDivider', () => {
    show();
    expect(rowFor('Ben R').dataset.divider).toBe('true');
  });

  it('ViewAs_HighlightsThatScoutsRow', () => {
    show('A');
    expect(rowFor('Ann L').getAttribute('aria-current')).toBe('true');
  });

  it('ViewAs_LeavesOtherRowsPlain', () => {
    show('A');
    expect(rowFor('Ben R').getAttribute('aria-current')).toBeNull();
  });
});
