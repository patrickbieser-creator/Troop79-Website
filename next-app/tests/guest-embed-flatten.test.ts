import { describe, it, expect } from 'vitest';
import { flattenGuestEmbed, type GuestEmbedRow } from '../src/lib/guest-people';

/**
 * The roster page reads guests with ONE embedded select (people → signup_entries → event_signups →
 * calendar_entries) instead of a 3-read serial chain; this pure helper unpacks that tree back into the four flat
 * arrays buildGuestTabRows takes. Pure - no database.
 */
const person = { id: 1, display_name: 'Grandma Pat', primary_phone: null, guest_host_household_id: 7, created_at: '2026-01-01T00:00:00Z' };

describe('flattenGuestEmbed', () => {
  it('FlattenGuestEmbed_WhenNoGuests_ReturnsEmptyArrays', () => {
    expect(flattenGuestEmbed([])).toEqual({ people: [], entries: [], signups: [], events: [] });
  });

  it('FlattenGuestEmbed_StripsTheEmbeddedEntriesFromThePersonRow', () => {
    const rows: GuestEmbedRow[] = [{ ...person, signup_entries: [] }];
    expect(flattenGuestEmbed(rows).people).toEqual([person]);
  });

  it('FlattenGuestEmbed_CarriesPersonIdOntoEachEntry', () => {
    const rows: GuestEmbedRow[] = [
      {
        ...person,
        signup_entries: [
          { id: 11, participant_class: 'adult', event_signup_id: 5, event_signups: { id: 5, calendar_entry_id: 9, calendar_entries: { id: 9, title: 'Campout', entry_date: '2026-06-01' } } }
        ]
      }
    ];
    expect(flattenGuestEmbed(rows).entries).toEqual([{ id: 11, person_id: 1, participant_class: 'adult', event_signup_id: 5 }]);
  });

  it('FlattenGuestEmbed_DedupesSignupsAndEventsSharedByTwoGuests', () => {
    const entry = (id: number) => ({
      id,
      participant_class: 'adult',
      event_signup_id: 5,
      event_signups: { id: 5, calendar_entry_id: 9, calendar_entries: { id: 9, title: 'Campout', entry_date: '2026-06-01' } }
    });
    const out = flattenGuestEmbed([
      { ...person, signup_entries: [entry(11)] },
      { ...person, id: 2, signup_entries: [entry(12)] }
    ]);
    expect(out.signups).toEqual([{ id: 5, calendar_entry_id: 9 }]);
    expect(out.events).toEqual([{ id: 9, title: 'Campout', entry_date: '2026-06-01' }]);
  });

  it('FlattenGuestEmbed_ToleratesEntriesWhoseSignupOrEventIsMissing', () => {
    const out = flattenGuestEmbed([
      { ...person, signup_entries: [{ id: 11, participant_class: 'adult', event_signup_id: 5, event_signups: null }] }
    ]);
    expect(out.entries).toHaveLength(1);
    expect(out.signups).toEqual([]);
    expect(out.events).toEqual([]);
  });
});
