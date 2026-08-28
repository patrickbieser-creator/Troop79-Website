import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { CalendarEditor } from '../src/app/admin/(workspace)/calendar/calendar-editor';
import type { CalendarEntryRow } from '../src/app/admin/(workspace)/calendar/entry-form';

/**
 * The admin calendar list row after the Roll Call list folded in (Patrick,
 * 2026-08-24): one line per event, letter status pills that open each layer,
 * initials for the author, a 12-character location, and no Import CSV.
 */
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams()
}));

function row(over: Partial<CalendarEntryRow>): CalendarEntryRow {
  return {
    id: 109,
    title: 'PLC Meeting',
    entry_date: '2099-08-30',
    end_date: null,
    start_time: '16:00:00',
    end_time: '17:30:00',
    day_note: null,
    category: 'Leadership / Planning',
    location: 'Northwoods, 1572 E Capitol Drive',
    author_name: 'Patrick Bieser',
    on_calendar: true,
    show_on_homepage: false,
    featured: false,
    hero_media: null,
    hasAgenda: false,
    agendaStatus: null,
    signupStatus: null,
    ...over
  } as unknown as CalendarEntryRow;
}

function renderList(rows: CalendarEntryRow[]) {
  return render(
    <CalendarEditor
      rows={rows}
      categories={[]}
      q=""
      category=""
      tab="upcoming"
      newOpen={false}
      windowActive={false}
      onCreate={vi.fn()}
      onUpdate={vi.fn()}
      onDelete={vi.fn()}
      onMerge={vi.fn()}
      onClone={vi.fn()}
      onSetPromoted={vi.fn()}
    />
  );
}

describe('Calendar list — one line per event', () => {
  it('Columns_AreDateEventCategoryStatusGoingAuthorLocationPromotedActions', () => {
    renderList([row({})]);
    // Sortable headers carry a direction glyph; only the words matter here.
    const headers = screen.getAllByRole('columnheader').map((h) => (h.textContent ?? '').replace(/[^A-Za-z]/g, ''));
    expect(headers).toEqual(['Date', 'Event', 'Category', 'Status', 'Going', 'Author', 'Location', 'Promoted', 'Actions']);
  });

  it('StatusAndGoingHeaders_CarryHelpBadges_InsteadOfALedeParagraph', () => {
    // The pill legend moved out of the page lede into a ? beside the column
    // it explains (2026-08-25, Brad's split); copy from admin/help.tsx.
    renderList([row({})]);
    expect(screen.getByRole('button', { name: 'Help: Status pills' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Help: Going' })).toBeTruthy();
  });

  // Patrick, 2026-08-25: "one more column … which indicates the number going
  // … right after status and before author. If the number is 0 display nothing."
  it('Going_IsTheSignupHeadcount_AndBlankWhenZeroOrNoSignup', () => {
    renderList([
      row({ id: 1, title: 'Fall Campout', signupId: 8, signupStatus: 'open', going: 23 }),
      row({ id: 2, title: 'Empty signup', signupId: 9, signupStatus: 'open', going: 0 }),
      row({ id: 3, title: 'PLC Meeting', going: null })
    ]);
    const going = (title: string) => within(screen.getByRole('link', { name: title }).closest('tr')!).getAllByRole('cell')[4];
    expect(going('Fall Campout').textContent).toBe('23');
    expect(going('Empty signup').textContent).toBe('');
    expect(going('PLC Meeting').textContent).toBe('');
  });

  it('Date_IsTheDayOnly_WithWeekdayAndTimeOnHover', () => {
    renderList([row({})]);
    const cell = screen.getByText('Aug 30, 2099');
    expect(cell.getAttribute('title')).toBe('Sunday, August 30, 2099 · 4:00 PM – 5:30 PM');
  });

  it('Author_IsInitials_WithTheFullNameOnHover', () => {
    renderList([row({})]);
    expect(screen.getByText('PBieser').getAttribute('title')).toBe('Patrick Bieser');
  });

  it('Location_IsTwelveCharacters_WithTheRestOnHover', () => {
    renderList([row({})]);
    expect(screen.getByText('Northwoods,…').getAttribute('title')).toBe('Northwoods, 1572 E Capitol Drive');
  });

  it('StatusPills_OpenTheirLayers', () => {
    renderList([row({ agendaId: 5, agendaStatus: 'draft', signupId: 8, signupStatus: 'open', attendance: { scouts: 12, adults: 3 } })]);
    // Every pill opens the workbench on its tab (2026-08-25) — the list is
    // the hub; nothing routes out to a standalone layer screen.
    expect(screen.getByRole('link', { name: 'Agenda draft' }).getAttribute('href')).toBe('/admin/calendar/109?tab=agenda');
    expect(screen.getByRole('link', { name: 'Signup open' }).getAttribute('href')).toBe('/admin/calendar/109?tab=signup');
    expect(screen.getByRole('link', { name: /Roll call taken — 12 scouts \+ 3 adults/ }).getAttribute('href')).toBe('/admin/calendar/109?tab=roll-call');
    expect(screen.queryByRole('img', { name: /calendar/ })).toBeNull(); // on-calendar is the norm — no O
  });

  it('OffCalendar_ShowsARedO_InItsOwnColumn', () => {
    renderList([row({ on_calendar: false })]);
    expect(screen.getByRole('img', { name: /Off calendar/ }).textContent).toBe('O');
  });

  it('RowActions_AreEditCloneMergeDelete_AndNothingElse', () => {
    renderList([row({})]);
    const actions = within(screen.getAllByRole('row')[1]);
    expect(actions.getByRole('link', { name: 'Edit' })).toBeTruthy();
    expect(actions.getByRole('button', { name: 'Clone' })).toBeTruthy();
    expect(actions.getByRole('button', { name: 'Merge…' })).toBeTruthy();
    expect(actions.getByRole('button', { name: 'Delete' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Roll Call|Agenda/ })).toBeNull();
  });

  it('Toolbar_HasNoActionsMenu_AndKeepsAddSearchAndCategory', () => {
    renderList([row({})]);
    expect(screen.queryByRole('combobox', { name: 'Calendar actions' })).toBeNull();
    expect(screen.getByRole('button', { name: '+ Add Event' })).toBeTruthy();
    expect(screen.getByLabelText('Search calendar entries')).toBeTruthy();
    expect(screen.getByLabelText('Filter by category')).toBeTruthy();
  });
});
