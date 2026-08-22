import { describe, it, expect } from 'vitest';
import { normalizeGuestRows, MAX_GUEST_ROWS } from '../src/lib/event-signup';

/**
 * Server-side normalization of the public form's `guests` field (Plans/
 * Participant-Classification.md): the action must never trust the JSON —
 * blank names drop, classes are validated, names trim and cap, duplicates
 * collapse, and the list is bounded.
 */
describe('normalizeGuestRows (pure)', () => {
  it('ParsesAJsonList_TrimsNames_AndKeepsValidClasses', () => {
    expect(normalizeGuestRows('[{"name":"  Sam Lee ","cls":"webelos"},{"name":"Aunt Jo","cls":"adult_guest"}]')).toEqual([
      { name: 'Sam Lee', cls: 'webelos' },
      { name: 'Aunt Jo', cls: 'adult_guest' }
    ]);
  });

  it('DropsBlankNames_AndRowsWithAnUnknownOrNonGuestClass', () => {
    expect(
      normalizeGuestRows('[{"name":"  ","cls":"webelos"},{"name":"X","cls":"scout"},{"name":"Y","cls":"parent"},{"name":"Z","cls":"cub_scout"}]')
    ).toEqual([{ name: 'Z', cls: 'cub_scout' }]);
  });

  it('CollapsesDuplicates_CapsTheCount_AndTruncatesLongNames', () => {
    const many = JSON.stringify(
      Array.from({ length: MAX_GUEST_ROWS + 5 }, (_, i) => ({ name: `Guest ${i}`, cls: 'youth_guest' }))
    );
    expect(normalizeGuestRows(many)).toHaveLength(MAX_GUEST_ROWS);
    expect(normalizeGuestRows('[{"name":"Sam","cls":"webelos"},{"name":"sam","cls":"webelos"}]')).toHaveLength(1);
    const long = 'A'.repeat(200);
    expect(normalizeGuestRows(`[{"name":"${long}","cls":"webelos"}]`)[0].name.length).toBeLessThanOrEqual(80);
  });

  it('ReturnsEmpty_ForGarbageOrMissingInput', () => {
    expect(normalizeGuestRows('not json')).toEqual([]);
    expect(normalizeGuestRows('{"name":"x"}')).toEqual([]);
    expect(normalizeGuestRows(null)).toEqual([]);
    expect(normalizeGuestRows('')).toEqual([]);
  });
});
