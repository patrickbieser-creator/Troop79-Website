import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { ScoutsTable } from '../src/app/admin/(workspace)/advancement/roster/scouts-table';
import type { ScoutRow } from '../src/app/admin/(workspace)/advancement/roster/scout-form';
import { PeopleTable, type DirectoryPerson } from '../src/app/admin/(workspace)/advancement/roster/people-table';
import { GuestsTable } from '../src/app/admin/(workspace)/advancement/roster/guests-table';
import type { GuestTabRow } from '../src/lib/guest-people';

/**
 * One line per person on every roster grid (Patrick, 2026-08-27): the second
 * lines — a scout's inactive reason, a household's member count, a guest's
 * event date — become their own columns, and Status is the LAST column on
 * every grid so the tabs read alike.
 */
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock('../src/app/admin/(workspace)/advancement/roster/scout-form', () => ({ ScoutForm: () => null }));
vi.mock('../src/app/admin/(workspace)/advancement/roster/person-actions', () => ({
  getPersonDetail: vi.fn(),
  searchPeople: vi.fn()
}));
vi.mock('../src/app/admin/(workspace)/advancement/roster/guest-actions', () => ({
  forgetGuest: vi.fn(),
  promoteGuest: vi.fn()
}));

const headers = (table: HTMLElement) =>
  within(table)
    .getAllByRole('columnheader')
    .map((th) => th.textContent?.replace(/[↕↑↓]/g, '').trim());
const firstRowCells = (table: HTMLElement) =>
  within(within(table).getAllByRole('row')[1])
    .getAllByRole('cell')
    .map((td) => td.textContent?.trim());

const scout = (over: Partial<ScoutRow>): ScoutRow => ({
  person_id: 1,
  id: 'A01',
  first_name: 'Avery',
  last_name: 'Scout',
  display_name: 'Avery Scout',
  patrol: null,
  current_rank: null,
  bsa_member_id: null,
  birthdate: null,
  gender: null,
  school: null,
  graduation_year: null,
  swim_class: null,
  junior_leader_override: null,
  active: true,
  inactive_reason: null,
  address_line1: null,
  address_line2: null,
  city: null,
  state: null,
  zip: null,
  phone: null,
  email: null,
  health_form_date: null,
  things_we_should_know: null,
  ...over
});

describe('Scouts grid', () => {
  it('InactiveTab_PutsTheReasonInItsOwnLastColumn', () => {
    render(
      <ScoutsTable
        scouts={[scout({ active: false, inactive_reason: 'dropped_out' })]}
        ranks={[]}
        rankLabel={{}}
        today="2026-08-27"
        only="inactive"
      />
    );
    const table = screen.getByRole('table');
    expect(headers(table).slice(-2)).toEqual(['Status', 'Reason']);
    const cells = firstRowCells(table);
    expect(cells[cells.length - 2]).toBe('Inactive');
    expect(cells[cells.length - 1]).toBe('Dropped out');
  });

  it('ActiveTab_HasNoReasonColumn', () => {
    render(<ScoutsTable scouts={[scout({})]} ranks={[]} rankLabel={{}} today="2026-08-27" only="active" />);
    expect(headers(screen.getByRole('table')).slice(-1)).toEqual(['Status']);
  });
});

describe('Leaders / Adults grid', () => {
  it('Household_CountInParens_BsaId_ThenStatusLast', () => {
    const p: DirectoryPerson = {
      person_id: 5,
      display_name: 'Becky Vest',
      primary_email: 'b@example.org',
      primary_phone: '414-555-0100',
      bsa_member_id: '12345',
      scout_id: null,
      inactive_reason: null,
      roles: 'adult_leader',
      tab: 'leader',
      in_picker: true,
      active: true,
      person_inactive_reason: null
    };
    render(
      <PeopleTable
        people={[p]}
        roles={[]}
        relationships={[]}
        households={[{ id: 3, label: 'Vest' }]}
        householdByPerson={{ 5: 3 }}
        householdMembers={{ 3: ['Becky Vest', 'Nate Vest', 'A', 'B'] }}
        nameById={{}}
      />
    );
    const table = screen.getByRole('table');
    expect(headers(table)).toEqual(['Name', 'Email', 'Phone', 'Roles', 'Household', 'BSA ID', 'Status']);
    const cells = firstRowCells(table);
    expect(cells[0]).toBe('Becky Vest');
    expect(cells[4]).toBe('Vest (4)');
    expect(cells[5]).toBe('12345');
    expect(cells[6]).toBe('Active');
  });
});

describe('Guests grid', () => {
  it('EventDate_IsItsOwnColumn', () => {
    const g: GuestTabRow = {
      personId: 9,
      name: 'Evan Guest',
      hostHouseholdId: 3,
      hostLabel: 'Vest',
      lastClass: null,
      lastEventTitle: 'Fall Campout',
      lastEventDate: '2026-10-03',
      phone: null,
      forgetNudge: false
    };
    render(<GuestsTable rows={[g]} />);
    const table = screen.getByRole('table');
    expect(headers(table)).toEqual(['Guest', 'Guest of', 'Class', 'Last event', 'Date', 'Phone', 'Actions']);
    const cells = firstRowCells(table);
    expect(cells[3]).toBe('Fall Campout');
    expect(cells[4]).toBe('Oct 3, 2026');
  });
});
