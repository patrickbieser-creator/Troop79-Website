import { describe, it, expect } from 'vitest';
import { normalizeGuestRows, guestEntriesFor, guestHostKey, MAX_GUEST_ROWS } from '../src/lib/event-signup';

/**
 * Server-side normalization of the public form's `guests` field (Plans/
 * Participant-Classification.md): the action must never trust the JSON —
 * blank names drop, classes are validated, names trim and cap, duplicates
 * collapse, and the list is bounded.
 */
describe('normalizeGuestRows (pure)', () => {
  it('ParsesAJsonList_TrimsNames_AndKeepsValidClasses', () => {
    expect(normalizeGuestRows('[{"name":"  Sam Lee ","cls":"webelos"},{"name":"Aunt Jo","cls":"adult_guest","phone":" 414-555-0100 "}]')).toEqual([
      { personId: null, name: 'Sam Lee', cls: 'webelos', phone: null },
      { personId: null, name: 'Aunt Jo', cls: 'adult_guest', phone: '414-555-0100' }
    ]);
  });

  it('DropsBlankNames_AndRowsWithAnUnknownOrNonGuestClass', () => {
    expect(
      normalizeGuestRows('[{"name":"  ","cls":"webelos"},{"name":"X","cls":"scout"},{"name":"Y","cls":"parent"},{"name":"Z","cls":"cub_scout"}]')
    ).toEqual([{ personId: null, name: 'Z', cls: 'cub_scout', phone: null }]);
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

  it('KeepsARepickedPersonId_DropsAYouthPhone_AndDedupesByPersonId', () => {
    expect(
      normalizeGuestRows('[{"personId":501,"name":"Grandma Pat","cls":"adult_guest","phone":"414"},{"personId":501,"name":"Grandma Pat","cls":"adult_guest"},{"personId":7,"name":"Kid","cls":"webelos","phone":"555"}]')
    ).toEqual([
      { personId: 501, name: 'Grandma Pat', cls: 'adult_guest', phone: '414' },
      { personId: 7, name: 'Kid', cls: 'webelos', phone: null }
    ]);
    // A bogus personId is ignored (the row becomes a typed name).
    expect(normalizeGuestRows('[{"personId":"x","name":"Sam","cls":"webelos"}]')).toEqual([{ personId: null, name: 'Sam', cls: 'webelos', phone: null }]);
  });

  it('DropsARowToggledToCantMakeIt_AndTreatsAMissingFlagAsAttending', () => {
    expect(
      normalizeGuestRows('[{"name":"Stays","cls":"webelos"},{"name":"Skips","cls":"webelos","attending":false},{"name":"Also stays","cls":"cub_scout","attending":true}]')
    ).toEqual([
      { personId: null, name: 'Stays', cls: 'webelos', phone: null },
      { personId: null, name: 'Also stays', cls: 'cub_scout', phone: null }
    ]);
  });

  it('ReturnsEmpty_ForGarbageOrMissingInput', () => {
    expect(normalizeGuestRows('not json')).toEqual([]);
    expect(normalizeGuestRows('{"name":"x"}')).toEqual([]);
    expect(normalizeGuestRows(null)).toEqual([]);
    expect(normalizeGuestRows('')).toEqual([]);
  });
});

describe('guest payload helpers (pure)', () => {
  it('GuestHostKey_PrefersTheFirstAttendingAdult_ElseTheFirstAttendingMember_ElseNull', () => {
    expect(
      guestHostKey([
        { key: 's:1', person_kind: 'scout', status: 'yes', participation: 'full' },
        { key: 'a:1', person_kind: 'adult', status: 'yes', participation: 'driver_only' },
        { key: 'a:2', person_kind: 'adult', status: 'yes', participation: 'full' }
      ])
    ).toBe('a:2');
    expect(guestHostKey([{ key: 's:1', person_kind: 'scout', status: 'yes', participation: 'full' }])).toBe('s:1');
    expect(guestHostKey([{ key: 's:1', person_kind: 'scout', status: 'no' }])).toBeNull();
    // Guest rows never host other guests.
    expect(guestHostKey([{ key: 'g:1', guest: true, status: 'yes' }])).toBeNull();
  });

  it('GuestEntriesFor_BuildsTheRpcRows_ByPersonIdOrName_WithPhoneForAdultsOnly', () => {
    expect(
      guestEntriesFor(
        [
          { personId: 501, name: 'Grandma Pat', cls: 'adult_guest', phone: '414' },
          { personId: null, name: 'Kid', cls: 'webelos', phone: null }
        ],
        'a:2'
      )
    ).toEqual([
      { key: 'g:501', guest: true, guest_of_key: 'a:2', participant_class: 'adult_guest', person_id: 501, guest_name: null, guest_phone: '414', status: 'yes', participation: 'full' },
      { key: 'g:new1', guest: true, guest_of_key: 'a:2', participant_class: 'webelos', person_id: null, guest_name: 'Kid', guest_phone: null, status: 'yes', participation: 'full' }
    ]);
  });
});
