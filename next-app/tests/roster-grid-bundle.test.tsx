import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RosterTable } from '../src/app/admin/(workspace)/rosters/[id]/roster-table';
import type { RosterRow } from '../src/app/admin/(workspace)/rosters/[id]/page';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() })
}));

/**
 * Roster grid bundle (Plans/Roster-Status-Tab.md — Patrick, 2026-08-22, built
 * in one pass): the main grid is the 99% case — attending people only, narrow
 * stacked-header columns, one column per group set, no Household / Status /
 * Slip, feature columns only when the event uses the feature. Everything
 * else (declines, waitlist, removed) lives on its own tab.
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
    guestName: null,
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

const SETS = [
  { id: 31, label: 'Patrols' },
  { id: 32, label: 'Tents' }
];

function renderTable(
  rows: RosterRow[],
  opts: { removed?: RosterRow[]; slots?: Parameters<typeof RosterTable>[0]['slots']; groupSets?: { id: number; label: string }[]; familyQuestionCount?: number; hasCarSets?: boolean } = {}
) {
  return render(
    <RosterTable
      rows={rows}
      removedRows={opts.removed ?? []}
      signupId={1}
      calendarEntryId={2}
      slots={opts.slots ?? []}
      groupSets={opts.groupSets ?? []}
      familyQuestionCount={opts.familyQuestionCount ?? 0}
      hasCarSets={opts.hasCarSets ?? true}
    />
  );
}

const headers = () => screen.getAllByRole('columnheader').map((h) => h.textContent?.replace(/[▲▼↕]/g, '').replace(/\s+/g, ' ').trim());
const bodyCells = () => within(screen.getAllByRole('rowgroup')[1]).getAllByRole('cell').map((c) => c.textContent?.trim());

describe('Roster grid — main tab is attending people only', () => {
  it('MainGrid_ListsOnlyYesEntries_AndHasNoStatusOrHouseholdColumn', () => {
    renderTable([
      row({ id: 1, name: 'Kevin Pieper' }),
      row({ id: 2, name: 'Sam Decline', status: 'no' }),
      row({ id: 3, name: 'Wendy Waitlist', status: 'waitlist' })
    ]);
    const body = screen.getAllByRole('rowgroup')[1];
    expect(within(body).getAllByRole('row')).toHaveLength(1);
    expect(within(body).getByText('Kevin Pieper')).toBeTruthy();
    expect(headers()).not.toContain('Status');
    expect(headers()).not.toContain('Household');
    expect(headers()).not.toContain('Slip');
  });

  it('OtherTab_ShowsDeclinedWaitlistedAndRemoved_WithStatus_AndACount', async () => {
    const user = userEvent.setup();
    renderTable(
      [row({ id: 1, name: 'Kevin Pieper' }), row({ id: 2, name: 'Sam Decline', status: 'no' }), row({ id: 3, name: 'Wendy Waitlist', status: 'waitlist' })],
      { removed: [row({ id: 4, name: 'Rex Removed', status: 'cancelled' })] }
    );
    const tab = screen.getByRole('tab', { name: /other responses/i });
    expect(tab.textContent).toContain('3');
    await user.click(tab);
    const body = screen.getAllByRole('rowgroup')[1];
    const names = within(body).getAllByRole('row').map((r) => within(r).getAllByRole('cell')[0].textContent?.trim());
    expect(names).toEqual(expect.arrayContaining(['Sam Decline', 'Wendy Waitlist', 'Rex Removed']));
    expect(names).not.toContain('Kevin Pieper');
    expect(within(body).getByText('Waitlist')).toBeTruthy();
    expect(within(body).getByText('Declined')).toBeTruthy();
    expect(within(body).getByText('Removed')).toBeTruthy();
    // A removed person can come back from here.
    expect(screen.getByRole('button', { name: /put back/i })).toBeTruthy();
  });
});

describe('Roster grid — narrow transport columns', () => {
  it('DrivingAndRide_AreFourStackedColumns_WithBareNumbersAndShortNames', () => {
    renderTable([
      row({ id: 1, name: 'Patrick Bieser', drivesOut: true, drivesBack: true, vehicleSeatsOut: 4, vehicleSeatsBack: 4, rideOut: null, rideBack: null }),
      row({ id: 2, name: 'Anjali Sankpal-Tatera', kind: 'scout', participantClass: 'scout', carOut: 'Patrick Bieser', carBack: null, rideBack: 'meeting_there' })
    ]);
    const h = headers();
    expect(h).toContain('Driving To');
    expect(h).toContain('Driving From');
    expect(h).toContain('Ride To');
    expect(h).toContain('Ride From');
    expect(h).not.toContain('Driving');
    expect(h).not.toContain('Ride');
    const body = screen.getAllByRole('rowgroup')[1];
    const [patrick, anjali] = within(body).getAllByRole('row').map((r) => within(r).getAllByRole('cell').map((c) => c.textContent?.trim()));
    expect(patrick).toContain('4');
    expect(patrick.some((c) => /seats/i.test(c ?? ''))).toBe(false);
    expect(anjali).toContain('PBieser');
    expect(anjali).toContain('meeting');
    // A driver is assigned to their own car by default — the Ride cells say so.
    expect(patrick.filter((c) => c === 'PBieser')).toHaveLength(2);
  });
});

describe('Roster grid — one column per group set, feature columns only when used', () => {
  it('GroupSets_EachGetTheirOwnColumn_HeadedByTheSetLabel', () => {
    renderTable([row({ id: 1, name: 'Hazel', kind: 'scout', participantClass: 'scout', groupBySet: { 31: 'Kraken', 32: 'Tent 2' } })], {
      groupSets: SETS
    });
    expect(headers()).toContain('Patrols');
    expect(headers()).toContain('Tents');
    expect(headers()).not.toContain('Groups');
    expect(bodyCells()).toContain('Kraken');
    expect(bodyCells()).toContain('Tent 2');
  });

  it('TransportColumns_Disappear_WhenTheEventHasNoCarSets_AndNotesGetTheRoom', () => {
    // A service project: no Drivers block, jobs + notes carry the day (Patrick, 2026-08-22).
    renderTable([row({ id: 1, name: 'Kevin Pieper', notes: 'bringing the big cooler and a tent canopy', claimsDisplay: ['Grill — Sat lunch'] })], {
      slots: [{ id: 11, label: 'Grill' }],
      hasCarSets: false
    });
    const h = headers();
    for (const t of ['Driving To', 'Driving From', 'Ride To', 'Ride From']) expect(h).not.toContain(t);
    expect(h).toContain('GRLL'); // the job's code column (one per job)
    expect(h).toContain('Notes');
    const note = screen.getByText('bringing the big cooler and a tent canopy').closest('td') as HTMLElement;
    // No one-line clamp class when there is room — the full note shows.
    expect(note.className).not.toMatch(/noteCell/);
  });

  it('EditDialog_IsDataDriven_NoTransportationWithoutCarSets_NoJobsWithoutSlots', async () => {
    // Patrick, 2026-08-22 (the Unity Church service project): "the edit dialog also needs to be
    // data-driven because it is also asking about drivers."
    const user = userEvent.setup();
    HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    });
    HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    });
    renderTable([row({ id: 1, name: 'Kevin Pieper' })], { hasCarSets: false, slots: [] });
    await user.click(screen.getByRole('button', { name: /^edit/i }));
    expect(screen.queryByText('Transportation')).toBeNull();
    expect(screen.queryByRole('checkbox', { name: /drives there/i })).toBeNull();
    expect(screen.queryByText(/jobs & commitments/i)).toBeNull();
    expect(screen.queryByText(/no jobs defined/i)).toBeNull();
    // Class is still editable — that is not feature-bound.
    expect(screen.getByRole('combobox', { name: /class/i })).toBeTruthy();
  });

  it('EditDialog_JobList_ShowsWhenHowManyAndWhat_ForEachJob', async () => {
    // Patrick, 2026-08-22 (service project): "need more detail so the editor can choose correctly".
    const user = userEvent.setup();
    HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    });
    HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    });
    renderTable([row({ id: 1, name: 'Kevin Pieper' })], {
      hasCarSets: false,
      slots: [
        { id: 11, label: 'Serve dinner', slotDate: '2026-09-02', startsAt: '17:00:00', endsAt: '19:30:00', needed: 4, filled: 2, description: 'Aprons provided' },
        { id: 12, label: 'Bring dessert' }
      ]
    });
    await user.click(screen.getByRole('button', { name: /^edit/i }));
    const detail = screen.getByText(/2 of 4 claimed/).textContent ?? '';
    expect(detail).toMatch(/Wed Sep 2/);
    expect(detail).toMatch(/5:00 PM–7:30 PM/);
    expect(detail).toMatch(/Aprons provided/);
    // A bare job gets no detail line — just its checkbox.
    expect(screen.getByRole('checkbox', { name: /bring dessert/i })).toBeTruthy();
  });

  it('JobsAndAnswers_ColumnsAppear_OnlyWhenTheEventHasThem', () => {
    const { unmount } = renderTable([row({ id: 1, name: 'Kevin Pieper' })]);
    expect(headers()).not.toContain('Jobs');
    expect(headers()).not.toContain('Answers');
    unmount();
    renderTable([row({ id: 1, name: 'Kevin Pieper', answers: ['Tent size: 4-person'], claimsDisplay: ['Grubmaster'] })], {
      slots: [{ id: 11, label: 'Grubmaster', code: 'GRUB' }],
      familyQuestionCount: 1
    });
    // Jobs are one column PER job now, headed by the code (see the job-code block below).
    expect(headers()).toContain('GRUB');
    expect(headers()).not.toContain('Jobs');
    expect(headers()).toContain('Answers');
  });
});

describe('Roster grid — job-code columns (job-heavy events)', () => {
  // Patrick, 2026-08-22: "the rummage sale will have 20–30 jobs; we should come
  // up with a plan for how that's displayed on the roster" — one narrow column
  // per job headed by its code, ✓ when claimed, the note on hover.
  const JOBS = [
    { id: 11, label: 'Setup crew', slotDate: '2026-10-09', needed: 4, filled: 1 },
    { id: 12, label: 'Cashier', code: 'CASH', slotDate: '2026-10-10', startsAt: '09:00:00', endsAt: '12:00:00', needed: 2, filled: 0 },
    { id: 13, label: 'Bring a table' }
  ];

  it('Jobs_AreOneColumnPerJob_HeadedByTheCode_WithTheFullLabelOnHover', () => {
    renderTable([row({ id: 1, name: 'Kevin Pieper', claimDetails: [{ slotId: 11, comment: 'bringing gloves' }] })], { hasCarSets: false, slots: JOBS });
    const hs = headers();
    expect(hs).toContain('SC'); // derived from "Setup crew"
    expect(hs).toContain('CASH'); // leader-set
    expect(hs).toContain('BAT'); // derived from "Bring a table"
    expect(hs).not.toContain('Jobs');
    const cash = screen.getByRole('columnheader', { name: 'CASH' });
    expect(cash.getAttribute('title')).toBe('Cashier · Sat Oct 10 · 9:00 AM–12:00 PM · 0 of 2 claimed');
  });

  it('JobCell_IsATick_WhenClaimed_WithTheClaimNoteOnHover_BlankOtherwise', () => {
    renderTable([row({ id: 1, name: 'Kevin Pieper', claimDetails: [{ slotId: 11, comment: 'bringing gloves' }] })], { hasCarSets: false, slots: JOBS });
    const body = screen.getAllByRole('rowgroup')[screen.getAllByRole('rowgroup').length - 1];
    const cells = within(body).getAllByRole('cell');
    const tick = cells.find((c) => c.textContent?.trim() === '✓');
    expect(tick).toBeTruthy();
    expect(tick?.getAttribute('title')).toMatch(/Setup crew.*bringing gloves/);
    // The other two job cells are blank (the job name still on hover).
    expect(cells.filter((c) => c.getAttribute('title') === 'Cashier' || c.getAttribute('title') === 'Bring a table').map((c) => c.textContent?.trim())).toEqual(['', '']);
  });

  it('Jobs_AreBandedByDay_WhenTheySpanDays_UntimedLast', () => {
    renderTable([row({ id: 1, name: 'Kevin Pieper' })], { hasCarSets: false, slots: JOBS });
    const bands = screen.getAllByRole('columnheader').filter((h) => h.getAttribute('scope') === 'colgroup').map((h) => h.textContent?.trim());
    expect(bands).toEqual(['Fri 10/9', 'Sat 10/10', 'Anytime']);
    // Single-day events get no band row at all.
    screen.getAllByRole('table')[0].remove();
    renderTable([row({ id: 2, name: 'Amy Scout' })], { hasCarSets: false, slots: JOBS.filter((j) => j.slotDate === '2026-10-09') });
    expect(screen.queryAllByRole('columnheader').filter((h) => h.getAttribute('scope') === 'colgroup')).toHaveLength(0);
  });

  it('JobBandRow_SpansExactlyTheJobColumns_WithCarSetAndLeaderColumnsPresent', () => {
    // qa-lead, 2026-08-23: lock the band-row colspan arithmetic with every
    // other column family present (car ×4, group sets, answers, notes, fee, balance, actions).
    renderTable([row({ id: 1, name: 'Kevin Pieper' })], { hasCarSets: true, slots: JOBS, groupSets: SETS, familyQuestionCount: 1 });
    const rows = screen.getAllByRole('row');
    const bandRow = rows[0];
    const headRow = rows[1];
    const span = (tr: HTMLElement) => Array.from(tr.querySelectorAll('th')).reduce((n, th) => n + (th.colSpan || 1), 0);
    expect(span(bandRow)).toBe(span(headRow));
    const bands = Array.from(bandRow.querySelectorAll<HTMLTableCellElement>('th[scope="colgroup"]'));
    expect(bands.reduce((n, th) => n + th.colSpan, 0)).toBe(JOBS.length);
    // Left spacer = Name, Class, Guests + 4 car columns + 2 set columns.
    expect((bandRow.querySelector('th') as HTMLTableCellElement).colSpan).toBe(3 + 4 + SETS.length);
  });

  it('JobColumns_CanBeHiddenAndShownAsAGroup', async () => {
    const user = userEvent.setup();
    renderTable([row({ id: 1, name: 'Kevin Pieper' })], { hasCarSets: false, slots: JOBS });
    expect(headers()).toContain('CASH');
    await user.click(screen.getByRole('button', { name: /hide jobs/i }));
    expect(headers()).not.toContain('CASH');
    expect(headers()).not.toContain('SC');
    await user.click(screen.getByRole('button', { name: /show jobs \(3\)/i }));
    expect(headers()).toContain('CASH');
  });

  it('JobCodeHeader_SortsClaimedFirst', async () => {
    const user = userEvent.setup();
    renderTable(
      [
        row({ id: 1, name: 'Amy Adult' }),
        row({ id: 2, name: 'Zed Adult', claimDetails: [{ slotId: 12, comment: null }] })
      ],
      { hasCarSets: false, slots: JOBS }
    );
    await user.click(screen.getByRole('button', { name: 'CASH' }));
    const body = screen.getAllByRole('rowgroup')[1];
    const names = within(body).getAllByRole('row').map((r) => within(r).getAllByRole('cell')[0].textContent?.trim());
    expect(names).toEqual(['Zed Adult', 'Amy Adult']);
  });

  it('EditDialog_JobList_ShowsTheCodeBeforeEachLabel', async () => {
    const user = userEvent.setup();
    HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    });
    HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    });
    renderTable([row({ id: 1, name: 'Kevin Pieper' })], { hasCarSets: false, slots: JOBS });
    await user.click(screen.getByRole('button', { name: /^edit/i }));
    expect(screen.getByRole('checkbox', { name: /CASH.*Cashier/ })).toBeTruthy();
  });
});

describe('Roster grid — sortable columns', () => {
  it('NameClassParticipationRideAndSetColumns_AreSortable', async () => {
    const user = userEvent.setup();
    renderTable(
      [
        row({ id: 1, name: 'Zed Adult', participantClass: 'adult' }),
        row({ id: 2, name: 'Amy Scout', kind: 'scout', participantClass: 'scout', carOut: 'Patrick Bieser', groupBySet: { 31: 'Kraken' } })
      ],
      { groupSets: SETS }
    );
    const sortable = screen.getAllByRole('columnheader').filter((h) => h.hasAttribute('aria-sort')).map((h) => h.textContent?.replace(/[▲▼↕]/g, '').replace(/\s+/g, ' ').trim());
    for (const h of ['Name', 'Class', 'Fee', 'Ride To', 'Ride From', 'Patrols', 'Tents']) expect(sortable).toContain(h);
    // Clicking Ride To puts the placed rider first; blank (needs a ride) sorts last.
    await user.click(screen.getByRole('button', { name: /ride to/i }));
    const body = screen.getAllByRole('rowgroup')[1];
    const names = within(body).getAllByRole('row').map((r) => within(r).getAllByRole('cell')[0].textContent?.trim());
    expect(names).toEqual(['Amy Scout', 'Zed Adult']);
  });
});

describe('Roster grid — shorthand cells', () => {
  it('Class_IsAbbreviated_WithTheFullLabelAsTooltip', () => {
    renderTable([row({ id: 2, name: 'Hazel', kind: 'scout', participantClass: 'junior_leader' })]);
    const cell = screen.getByText('JL');
    // Full label first, then the legend of every code (Patrick: "what the codes stand for").
    expect(cell.closest('td')?.getAttribute('title')).toMatch(/^Junior Leader\. Codes: S scout/);
  });

  it('Notes_KeepTheFullTextOnHover', () => {
    renderTable([row({ id: 1, name: 'Kevin Pieper', notes: 'arriving late Friday, bringing the trailer' })]);
    const cell = screen.getByText('arriving late Friday, bringing the trailer');
    expect(cell.closest('td')?.getAttribute('title')).toBe('arriving late Friday, bringing the trailer');
  });
});
