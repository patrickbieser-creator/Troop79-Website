import { describe, it, expect } from 'vitest';
import { calendarReturn } from '../src/lib/calendar-return';

/**
 * The link back from an event page to the calendar position the visitor came
 * from (Plans/Calendar-Detail-And-Signup-Split.md, step 1).
 *
 * Pure over search params, so it belongs in the `db` project with the other
 * unit tests — and it is worth testing precisely because the failure mode is
 * quiet: a dropped param doesn't break anything, it just silently dumps
 * someone back at the top of the list.
 */

describe('calendarReturn', () => {
  it('Return_GoesToThePlainCalendar_WhenTheVisitorCarriedNoPosition', () => {
    const r = calendarReturn({});
    expect(r.href).toBe('/events');
    expect(r.hasPosition).toBe(false);
    expect(r.label).toBe('Back to the calendar');
  });

  it('Return_GoesToThePlainCalendar_WhenThereAreNoParamsAtAll', () => {
    expect(calendarReturn(undefined).href).toBe('/events');
  });

  it('Return_CarriesTheWholeBrowsingPosition_WhenTheVisitorHadOne', () => {
    const r = calendarReturn({
      view: 'month',
      m: '2026-10',
      category: 'Campout / Overnight',
      q: 'tent'
    });
    const url = new URL(r.href, 'https://example.test');
    expect(url.pathname).toBe('/events');
    expect(url.searchParams.get('view')).toBe('month');
    expect(url.searchParams.get('m')).toBe('2026-10');
    expect(url.searchParams.get('category')).toBe('Campout / Overnight');
    expect(url.searchParams.get('q')).toBe('tent');
    expect(r.hasPosition).toBe(true);
  });

  it('Return_NamesTheMonth_WhenComingBackFromTheGrid', () => {
    expect(calendarReturn({ view: 'month', m: '2026-10' }).label).toBe('Back to October 2026');
  });

  it('Return_StaysGeneric_WhenComingBackFromTheList', () => {
    // A list has no single place-name to promise, so don't invent one.
    expect(calendarReturn({ category: 'Fundraiser' }).label).toBe('Back to the calendar');
  });

  it('Return_StaysGeneric_WhenTheMonthIsNotAMonth', () => {
    expect(calendarReturn({ view: 'month', m: '2026-13' }).label).toBe('Back to the calendar');
    expect(calendarReturn({ view: 'month', m: 'banana' }).label).toBe('Back to the calendar');
  });

  it('Return_DropsParamsTheCalendarDoesNotRead', () => {
    // A tracking tag or a hand-edited key must not be reflected back into a
    // link this app generates.
    const r = calendarReturn({ view: 'month', utm_source: 'newsletter', evil: '</a>' });
    const url = new URL(r.href, 'https://example.test');
    expect(url.searchParams.get('view')).toBe('month');
    expect(url.searchParams.has('utm_source')).toBe(false);
    expect(url.searchParams.has('evil')).toBe(false);
  });

  it('Return_EscapesValues_SoAStrayCharacterCannotEscapeTheQueryString', () => {
    const r = calendarReturn({ q: 'a&b=c d' });
    expect(r.href).toContain('q=a%26b%3Dc+d');
    expect(new URL(r.href, 'https://example.test').searchParams.get('q')).toBe('a&b=c d');
  });

  it('Return_TakesTheFirstValue_WhenAParamIsRepeated', () => {
    expect(
      new URL(calendarReturn({ view: ['month', 'list'] }).href, 'https://example.test')
        .searchParams.get('view')
    ).toBe('month');
  });

  it('Return_IgnoresEmptyValues_SoABlankSearchDoesNotTravel', () => {
    const r = calendarReturn({ q: '   ', category: '' });
    expect(r.href).toBe('/events');
    expect(r.hasPosition).toBe(false);
  });
});
