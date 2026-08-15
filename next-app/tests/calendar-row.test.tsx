import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { CalendarBrowser } from '../src/app/(public)/events/calendar-browser';
import type { CalendarEntryPublic } from '../src/lib/calendar';
import type { CalendarCategoryRow } from '../src/lib/calendar-categories';

/**
 * The calendar list row after it became a link (step 3 of
 * Plans/Calendar-Detail-And-Signup-Split.md).
 *
 * The rule these guard is the one that is easy to break and impossible to see:
 * the date pill, the title and the category all OPEN the event, but the row
 * exposes exactly ONE focusable link. Implemented as three <a>s it would look
 * identical and sound like three identical links per row, on ~105 rows.
 *
 * jsdom computes no layout, so it cannot prove the stretched overlay covers
 * the pill — that was checked in a real browser with elementFromPoint. What it
 * CAN prove is the link count, the accessible name, and that the signup
 * control is a separate second stop rather than nested inside the first.
 */

const CATEGORIES: CalendarCategoryRow[] = [
  {
    label: 'Campout / Overnight',
    color: '#3d5a3e',
    sort_order: 1,
    behavior: null,
    template: null,
    credit_kind: null,
    credit_unit: null,
    counts_as_activity: true
  } as CalendarCategoryRow
];

function entry(over: Partial<CalendarEntryPublic> = {}): CalendarEntryPublic {
  return {
    id: 1,
    entry_date: '2099-10-09',
    end_date: null,
    day_note: null,
    category: 'Campout / Overnight',
    title: 'Fall Campout',
    description: null,
    location: 'High Cliff State Park',
    start_time: null,
    end_time: null,
    on_calendar: true,
    show_on_homepage: false,
    featured: false,
    promo_start: null,
    promo_end: null,
    excerpt: null,
    hero_media_id: null,
    auto_archive_at: null,
    hasSignup: false,
    ...over
  } as CalendarEntryPublic;
}

function renderList(upcoming: CalendarEntryPublic[], past: CalendarEntryPublic[] = []) {
  return render(<CalendarBrowser upcoming={upcoming} past={past} categories={CATEGORIES} />);
}

/** The <li> holding a given event title. */
function row(title: string): HTMLElement {
  const heading = screen.getByText(title);
  const li = heading.closest('li');
  if (!li) throw new Error(`no row for ${title}`);
  return li;
}

describe('calendar row linking', () => {
  it('Row_ExposesExactlyOneLink_NamedByTheEventTitle', () => {
    renderList([entry()]);
    const links = within(row('Fall Campout')).getAllByRole('link');
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveProperty('textContent', 'Fall Campout');
  });

  it('Row_LinksToTheEventsOwnPage', () => {
    renderList([entry({ id: 42 })]);
    const link = within(row('Fall Campout')).getByRole('link');
    expect(link.getAttribute('href')).toContain('/events/42');
  });

  it('Row_OffersNoSignupControl_WhenTheEntryHasNoSignup', () => {
    renderList([entry({ hasSignup: false })]);
    expect(within(row('Fall Campout')).queryByRole('link', { name: /sign up/i })).toBeNull();
  });

  it('Row_OffersSignupAsASecondSeparateLink_WhenTheEntryHasOne', () => {
    // Two stops, not one and not three: the row itself, then signup.
    renderList([entry({ hasSignup: true })]);
    const links = within(row('Fall Campout')).getAllByRole('link');
    expect(links).toHaveLength(2);
    expect(links.map((a) => a.textContent)).toEqual(['Fall Campout', 'Sign up']);
  });

  it('Row_NeverNestsTheSignupLinkInsideTheRowLink', () => {
    // <a> inside <a> is invalid and behaves unpredictably — the whole reason
    // the row uses a stretched overlay rather than wrapping itself in a link.
    renderList([entry({ hasSignup: true })]);
    const [rowLink, signupLink] = within(row('Fall Campout')).getAllByRole('link');
    expect(rowLink.contains(signupLink)).toBe(false);
    expect(signupLink.closest('a')).toBe(signupLink);
  });

  it('Row_ShowsSignupToEveryone_SinceNoSessionIsKnownHere', () => {
    // Anonymous visitors see it too (Patrick, 2026-08-15) — the gate is behind
    // the link, not in front of it. This component is given no session at all,
    // so rendering the control proves it isn't conditional on one.
    renderList([entry({ hasSignup: true })]);
    expect(within(row('Fall Campout')).getByRole('link', { name: 'Sign up' })).toBeTruthy();
  });

  it('Row_CarriesTheBrowsingPosition_SoTheEventPageCanOfferAWayBack', () => {
    // Default view is the list with no filter, so nothing to carry yet — the
    // href stays clean rather than growing empty params.
    renderList([entry({ id: 7 })]);
    expect(within(row('Fall Campout')).getByRole('link').getAttribute('href')).toBe('/events/7');
  });
});
