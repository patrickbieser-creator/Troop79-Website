import { describe, it, expect } from 'vitest';
import { rankAbbrev, shortRequirement } from '../src/lib/rank-abbrev';

/** The short rank names a tight label uses (Has/Needs' "Add Ten 3a · Square Knot use"), by id or by name. */
describe('rankAbbrev', () => {
  const CASES: [string, string][] = [
    ['scout', 'Scout'],
    ['tenderfoot', 'Ten'],
    ['second-class', 'Sec'],
    ['first-class', 'Fir'],
    ['star', 'Star'],
    ['life', 'Life'],
    ['eagle', 'Eagle'],
    ['Scout', 'Scout'],
    ['Tenderfoot', 'Ten'],
    ['Second Class', 'Sec'],
    ['First Class', 'Fir'],
    ['Star', 'Star'],
    ['Life', 'Life'],
    ['Eagle', 'Eagle']
  ];
  it.each(CASES)('RankAbbrev_Map %s', (input, short) => {
    expect(rankAbbrev(input)).toBe(short);
  });

  it('RankAbbrev_Unknown_KeepsTheName', () => {
    expect(rankAbbrev('Arrow of Light')).toBe('Arrow of Light');
  });
});

describe('shortRequirement', () => {
  it('ShortRequirement_RankCode_IsAbbreviated', () => {
    expect(shortRequirement('Second Class 2a', 'Fire')).toBe('Sec 2a · Fire');
  });

  it('ShortRequirement_MeritBadge_KeepsItsName', () => {
    expect(shortRequirement('First Aid 9', 'Rescues')).toBe('First Aid 9 · Rescues');
  });

  it('ShortRequirement_NoNumber_LeavesCodeAlone', () => {
    expect(shortRequirement('Focus', 'Knots')).toBe('Focus · Knots');
  });

  it('ShortRequirement_NoCode_IsTheTitle', () => {
    expect(shortRequirement('', 'Mix')).toBe('Mix');
  });
});
