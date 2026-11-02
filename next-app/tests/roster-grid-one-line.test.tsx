import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
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
  nickname: null,
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
  // Created and Left follow the Reason on the Inactive tab (Patrick, 2026-11-01).
  it('InactiveTab_ReasonThenCreatedThenLeft', () => {
    render(
      <ScoutsTable
        scouts={[scout({ active: false, inactive_reason: 'dropped_out' })]}
        ranks={[]}
        rankLabel={{}}
        today="2026-08-27"
        only="inactive"
        dates={{ created: { 1: '2022-07-20' }, left: { A01: '2026-01-25' } }}
      />
    );
    const table = screen.getByRole('table');
    expect(headers(table).slice(-4)).toEqual(['Status', 'Reason', 'Created', 'Left']);
    expect(firstRowCells(table).slice(-4)).toEqual(['Inactive', 'Dropped out', 'Jul 20, 2022', 'Jan 25, 2026']);
  });

  it('ActiveTab_CreatedFollowsTheHealthForm_AndThereIsNoReasonOrLeft', () => {
    render(
      <ScoutsTable
        scouts={[scout({ health_form_date: '2026-05-01' })]}
        ranks={[]}
        rankLabel={{}}
        today="2026-08-27"
        only="active"
        dates={{ created: { 1: '2024-09-15' }, left: { A01: '2026-08-01' } }}
      />
    );
    const table = screen.getByRole('table');
    expect(headers(table).slice(-3)).toEqual(['Health Form', 'Created', 'Status']);
    expect(firstRowCells(table).slice(-3)).toEqual(['May 1, 2026', 'Sep 15, 2024', 'Active']);
  });

  it('Created_SortsByDate', () => {
    render(
      <ScoutsTable
        scouts={[
          scout({ person_id: 1, id: 'A01', display_name: 'Avery Scout' }),
          scout({ person_id: 2, id: 'A02', display_name: 'Blake Scout' })
        ]}
        ranks={[]}
        rankLabel={{}}
        today="2026-08-27"
        only="active"
        dates={{ created: { 1: '2025-01-05', 2: '2021-06-01' }, left: {} }}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /Created/ }));
    const names = within(screen.getByRole('table'))
      .getAllByRole('row')
      .slice(1)
      .map((r) => within(r).getAllByRole('cell')[1].textContent);
    expect(names).toEqual(['Blake Scout', 'Avery Scout']);
  });

  it('Left_SortsByDate', () => {
    render(
      <ScoutsTable
        scouts={[
          scout({ person_id: 1, id: 'A01', display_name: 'Avery Scout', active: false }),
          scout({ person_id: 2, id: 'A02', display_name: 'Blake Scout', active: false })
        ]}
        ranks={[]}
        rankLabel={{}}
        today="2026-08-27"
        only="inactive"
        dates={{ created: {}, left: { A01: '2023-10-22', A02: '2025-07-28' } }}
      />
    );
    const left = screen.getByRole('button', { name: /Left/ });
    fireEvent.click(left);
    fireEvent.click(left);
    const names = within(screen.getByRole('table'))
      .getAllByRole('row')
      .slice(1)
      .map((r) => within(r).getAllByRole('cell')[1].textContent);
    expect(names).toEqual(['Blake Scout', 'Avery Scout']);
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
        households={[{ id: 3, label: 'Vest' }]}
        householdByPerson={{ 5: 3 }}
        householdMembers={{ 3: ['Becky Vest', 'Nate Vest', 'A', 'B'] }}
        created={{ 5: '2026-07-20' }}
      />
    );
    const table = screen.getByRole('table');
    // Created follows the BSA ID (Patrick, 2026-11-01).
    expect(headers(table)).toEqual(['Name', 'Email', 'Phone', 'Roles', 'Household', 'BSA ID', 'Created', 'Status']);
    const cells = firstRowCells(table);
    expect(cells[0]).toBe('Becky Vest');
    expect(cells[4]).toBe('Vest (4)');
    expect(cells[5]).toBe('12345');
    expect(cells[6]).toBe('Jul 20, 2026');
    expect(cells[7]).toBe('Active');
  });

  it('Created_SortsByDate', () => {
    const p = (person_id: number, display_name: string): DirectoryPerson => ({
      person_id,
      display_name,
      primary_email: null,
      primary_phone: null,
      bsa_member_id: null,
      scout_id: null,
      inactive_reason: null,
      roles: '',
      tab: 'adult',
      in_picker: true,
      active: true,
      person_inactive_reason: null
    });
    render(
      <PeopleTable
        people={[p(1, 'Avery Adult'), p(2, 'Blake Adult')]}
        households={[]}
        householdByPerson={{}}
        householdMembers={{}}
        created={{ 1: '2026-10-15', 2: '2026-07-20' }}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /Created/ }));
    const names = within(screen.getByRole('table'))
      .getAllByRole('row')
      .slice(1)
      .map((r) => within(r).getAllByRole('cell')[0].textContent);
    expect(names).toEqual(['Blake Adult', 'Avery Adult']);
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
