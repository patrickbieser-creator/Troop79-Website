import { describe, it, expect, vi } from 'vitest';
import { permanentDeleteGuard } from '../src/lib/event-signup-admin';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RosterTable } from '../src/app/admin/(workspace)/rosters/[id]/roster-table';
import type { RosterRow } from '../src/app/admin/(workspace)/rosters/[id]/page';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() })
}));

/**
 * Event roster table rework (Patrick, 2026-08-21): one line per name (the
 * adult/scout line-2 indicator is gone; participation, guests, answers and
 * notes move to their own columns) and a per-row Edit that opens the jobs &
 * commitments editor. Rendered without any dialog open, so jsdom's missing
 * showModal() is never reached.
 */
function row(over: Partial<RosterRow> & { id: number; name: string }): RosterRow {
  return {
    kind: 'adult',
    status: 'yes',
    participation: 'full',
    tierLabel: null,
    owed: 0,
    days: null,
    guests: 0,
    guestNote: null,
    drivesOut: false,
    drivesBack: false,
    vehicleSeatsOut: null,
    vehicleSeatsBack: null,
    rideOut: 'needs_ride',
    rideBack: 'needs_ride',
    carOut: null,
    carBack: null,
    groupBySet: {},
    slipReceived: false,
    paid: 0,
    balance: 0,
    settled: false,
    notes: null,
    household: 'Pieper',
    participantClass: 'adult',
    hostEntryId: null,
    claims: [],
    claimsDisplay: [],
    claimDetails: [],
    answers: [],
    leaderAnswers: {},
    healthFormDate: null,
    ...over
  };
}

const SLOTS = [
  { id: 11, label: 'Grubmaster' },
  { id: 12, label: 'Bring a table' }
];

function renderTable(rows: RosterRow[], opts: { guestMode?: 'none' | 'count' | 'named' } = {}) {
  return render(
    <RosterTable
      rows={rows}
      removedRows={[]}
      signupId={1}
      calendarEntryId={2}
      slots={SLOTS}
      groupSets={[]}
      guestMode={opts.guestMode ?? 'none'}
      // The Answers column exists only when the event asks families something
      // (Plans/Roster-Status-Tab.md item 7) — these fixtures assume it does.
      familyQuestionCount={1}
    />
  );
}

describe('RosterTable — one line per name', () => {
  it('NameCell_ShowsOnlyTheName_NoKindLine', () => {
    renderTable([row({ id: 1, name: 'Kevin Pieper', kind: 'adult', guests: 2 })]);
    const body = screen.getAllByRole('rowgroup')[1];
    const firstCell = within(body).getAllByRole('cell')[0];
    expect(firstCell.textContent?.trim()).toBe('Kevin Pieper');
  });

  it('Guests_Answers_Notes_HaveTheirOwnColumns_AndFeeSitsBesideBalance', () => {
    // The Guests (+N) column exists only in COUNT mode (Plans/Guests-As-
    // People.md); in named mode guests are rows of their own.
    renderTable([
      row({
        id: 1,
        name: 'Kevin Pieper',
        guests: 2,
        guestNote: 'cousins',
        notes: 'arriving late',
        owed: 30,
        answers: ['Tent size: 4-person']
      })
    ], { guestMode: 'count' });
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent?.replace(/[▲▼↕]/g, '').trim());
    for (const h of ['Guests', 'Answers', 'Notes', 'Fee', 'Balance']) expect(headers).toContain(h);
    // Participation is off the Attending grid (Patrick, 2026-08-22) — the tab IS attending.
    expect(headers).not.toContain('Participation');
    expect(headers.indexOf('Fee')).toBe(headers.indexOf('Balance') - 1);
    const body = screen.getAllByRole('rowgroup')[1];
    const cells = within(body).getAllByRole('cell').map((c) => c.textContent?.trim());
    expect(cells.some((c) => c?.startsWith('+2'))).toBe(true);
    expect(cells).toContain('Tent size: 4-person');
    expect(cells).toContain('arriving late');
  });

  it('DriverOnlyAndContributors_LiveOnTheOtherResponsesTab_WithParticipation', async () => {
    const user = userEvent.setup();
    renderTable([row({ id: 1, name: 'Kevin Pieper', participation: 'driver_only' }), row({ id: 2, name: 'Hazel', kind: 'scout' })]);
    let body = screen.getAllByRole('rowgroup')[1];
    expect(within(body).queryByText('Kevin Pieper')).toBeNull();
    await user.click(screen.getByRole('tab', { name: /other responses/i }));
    body = screen.getAllByRole('rowgroup')[1];
    expect(within(body).getByText('Kevin Pieper')).toBeTruthy();
    expect(within(body).getByText('Drv only')).toBeTruthy();
  });
});

describe('RosterTable — jobs & commitments Edit', () => {
  it('EveryRow_HasAnEditButton_ForJobsAndCommitments', () => {
    renderTable([row({ id: 1, name: 'Kevin Pieper' }), row({ id: 2, name: 'Hazel Stollenwerk', kind: 'scout' })]);
    expect(screen.getAllByRole('button', { name: /^edit/i })).toHaveLength(2);
  });

  it('EditButton_OpensTheJobsEditor_ListingEverySlot_WithCurrentClaimsChecked', async () => {
    const user = userEvent.setup();
    // jsdom has no showModal/close — stub them so the effect that mirrors
    // state onto the <dialog> can run.
    HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    });
    HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    });
    renderTable([
      row({
        id: 1,
        name: 'Kevin Pieper',
        claims: ['Grubmaster'],
        claimsDisplay: ['Grubmaster — Sat dinner'],
        claimDetails: [{ slotId: 11, comment: 'Sat dinner' }]
      })
    ]);
    await user.click(screen.getByRole('button', { name: /^edit/i }));
    // Labels carry the job code first ("GRBM Grubmaster") since the job-code columns (2026-08-23).
    const grub = screen.getByRole('checkbox', { name: /Grubmaster/ }) as HTMLInputElement;
    const table = screen.getByRole('checkbox', { name: /Bring a table/ }) as HTMLInputElement;
    expect(grub.checked).toBe(true);
    expect(table.checked).toBe(false);
    expect((screen.getByDisplayValue('Sat dinner') as HTMLInputElement).value).toBe('Sat dinner');
  });
});

describe('RosterTable — participant class', () => {
  it('ClassColumn_ShowsEachRowsClassLabel', () => {
    renderTable([
      row({ id: 1, name: 'Kevin Pieper', participantClass: 'adult' }),
      row({ id: 2, name: 'Hazel Stollenwerk', kind: 'scout', participantClass: 'junior_leader' }),
      row({ id: 3, name: 'Sam Lee', kind: 'scout', participantClass: 'webelos', hostEntryId: 1 })
    ]);
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent?.replace(/[▲▼↕]/g, '').trim());
    expect(headers).toContain('Class');
    // Shorthand on the grid (Plans/Roster-Status-Tab.md item 4); the full
    // label rides along in the cell's title.
    expect(screen.getByText('JL').closest('td')?.getAttribute('title')).toMatch(/^Junior Leader\./);
    expect(screen.getByText('W').closest('td')?.getAttribute('title')).toMatch(/^Webelos\./);
    expect(screen.getAllByText('A').length).toBeGreaterThan(0);
  });

  it('EditDialog_OffersAClassSelect_DefaultingToTheRowsClass', async () => {
    const user = userEvent.setup();
    HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    });
    HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    });
    renderTable([row({ id: 2, name: 'Hazel Stollenwerk', kind: 'scout', participantClass: 'junior_leader' })]);
    await user.click(screen.getByRole('button', { name: /^edit/i }));
    const select = screen.getByRole('combobox', { name: /class/i }) as HTMLSelectElement;
    expect(select.value).toBe('junior_leader');
    expect([...select.options].map((o) => o.value)).toEqual([
      'adult', 'scout', 'junior_leader', 'webelos', 'cub_scout', 'youth_guest', 'adult_guest'
    ]);
  });

  it('AddAGuest_OpensAFormWithNameClassAndHost', async () => {
    const user = userEvent.setup();
    HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    });
    HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    });
    renderTable([row({ id: 1, name: 'Kevin Pieper' })]);
    await user.click(screen.getByRole('button', { name: /add a guest/i }));
    expect(screen.getByRole('textbox', { name: /guest name/i })).toBeTruthy();
    const cls = screen.getByRole('combobox', { name: /guest class/i }) as HTMLSelectElement;
    expect([...cls.options].map((o) => o.value)).toEqual(['webelos', 'cub_scout', 'youth_guest', 'adult_guest']);
    const host = screen.getByRole('combobox', { name: /brought by/i }) as HTMLSelectElement;
    expect([...host.options].some((o) => o.textContent === 'Kevin Pieper')).toBe(true);
  });
});

describe('permanentDeleteGuard — hard delete of a Removed roster row', () => {
  const clean = { status: 'cancelled', ledgerRows: 0, hostedGuests: 0, carsDriven: 0 };
  it('OnlyRemovedRows_WithNothingLinked_MayBeDeleted', () => {
    expect(permanentDeleteGuard(clean)).toEqual({ ok: true });
    expect(permanentDeleteGuard({ ...clean, status: 'yes' }).ok).toBe(false);
    expect(permanentDeleteGuard({ ...clean, status: 'no' }).ok).toBe(false);
  });

  it('LinkedData_BlocksTheDelete_AndTheMessageNamesEachReasonAndHowToClearIt', () => {
    // Patrick, 2026-08-23: "provide the reason why it cannot be permanently
    // removed, and offer suggestions as to how those other items could be undone".
    const money = permanentDeleteGuard({ ...clean, ledgerRows: 2 });
    expect(money.ok).toBe(false);
    expect(money.error).toMatch(/2 ledger rows .* Money tab/);
    expect(money.error).toMatch(/void the payment/);
    const guests = permanentDeleteGuard({ ...clean, hostedGuests: 1 });
    expect(guests.error).toMatch(/1 guest row is attached .* host/);
    expect(guests.error).toMatch(/remove those guests first/);
    const car = permanentDeleteGuard({ ...clean, carsDriven: 1 });
    expect(car.error).toMatch(/still lists them as driver/);
    expect(car.error).toMatch(/Rides & assignments/);
    const all = permanentDeleteGuard({ ...clean, ledgerRows: 1, hostedGuests: 2, carsDriven: 1 });
    expect(all.error).toMatch(/ledger row .*; 2 guest rows .*; a car /);
    expect(all.error).toMatch(/leave the row as Removed/);
  });
});
