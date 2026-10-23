import { describe, it, expect } from 'vitest';
import { rankAbbrev } from '../src/lib/rank-abbrev';

/** The short rank names a tight label uses (Has/Needs' "Add Ten 3a · Square Knot use"), by id or by name. */
describe('rankAbbrev', () => {
  it('RankAbbrev_Map', () => {
    const ids = ['scout', 'tenderfoot', 'second-class', 'first-class', 'star', 'life', 'eagle'];
    const names = ['Scout', 'Tenderfoot', 'Second Class', 'First Class', 'Star', 'Life', 'Eagle'];
    expect([...ids, ...names].map((x) => rankAbbrev(x))).toEqual([
      ...['Scout', 'Ten', 'Sec', 'Fir', 'Star', 'Life', 'Eagle'],
      ...['Scout', 'Ten', 'Sec', 'Fir', 'Star', 'Life', 'Eagle']
    ]);
  });

  it('RankAbbrev_Unknown_KeepsTheName', () => {
    expect(rankAbbrev('Arrow of Light')).toBe('Arrow of Light');
  });
});
