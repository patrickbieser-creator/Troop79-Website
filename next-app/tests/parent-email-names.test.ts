import { describe, it, expect } from 'vitest';
import { scoutFirstNames } from '../src/lib/parent-email';

/**
 * Parent emails name the family's own scouts by first name (Patrick, 2026-10-22): "Anjali", not "Anjali S". Two scouts
 * in one email who share a first name keep their last initial, those two only.
 */
describe('scoutFirstNames', () => {
  it('FirstName_FromAFullName', () => {
    expect(scoutFirstNames([{ personId: 7, name: 'Anjali Smith' }]).get(7)).toBe('Anjali');
  });

  it('FirstName_FromABoardName', () => {
    expect(scoutFirstNames([{ personId: 7, name: 'Anjali S' }]).get(7)).toBe('Anjali');
  });

  it('SameFirstName_Siblings_KeepTheirLastInitial', () => {
    const names = scoutFirstNames([
      { personId: 7, name: 'Sam Smith' },
      { personId: 8, name: 'Sam Jones' },
      { personId: 9, name: 'Leo Smith' }
    ]);
    expect([...names.values()]).toEqual(['Sam S', 'Sam J', 'Leo']);
  });

  it('SameScoutTwice_IsNotASibling', () => {
    const names = scoutFirstNames([
      { personId: 7, name: 'Anjali S' },
      { personId: 7, name: 'Anjali S' }
    ]);
    expect(names.get(7)).toBe('Anjali');
  });
});

/** L0 qa follow-up: same first name AND last initial gets a disambiguator (two letters of the last name, else a number). */
describe('scoutFirstNames: same first name and last initial', () => {
  it('SameFirstAndInitial_UsesTwoLettersOfTheLastName', () => {
    const names = scoutFirstNames([
      { personId: 7, name: 'Sam Smith' },
      { personId: 8, name: 'Sam Shah' }
    ]);
    expect([...names.values()]).toEqual(['Sam Sm', 'Sam Sh']);
  });

  it('SameFirstAndLastName_AreNumbered', () => {
    const names = scoutFirstNames([
      { personId: 7, name: 'Sam S' },
      { personId: 8, name: 'Sam S' }
    ]);
    expect([...names.values()]).toEqual(['Sam S 1', 'Sam S 2']);
  });
});
