import { describe, it, expect, vi } from 'vitest';
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
    seatsOut: null,
    seatsBack: null,
    slipReceived: false,
    paymentReceived: false,
    notes: null,
    household: 'Pieper',
    participantClass: 'adult',
    guestName: null,
    hostEntryId: null,
    claims: [],
    claimsDisplay: [],
    claimDetails: [],
    answers: [],
    ...over
  };
}

const SLOTS = [
  { id: 11, label: 'Grubmaster' },
  { id: 12, label: 'Bring a table' }
];

function renderTable(rows: RosterRow[]) {
  return render(
    <RosterTable rows={rows} removedRows={[]} signupId={1} calendarEntryId={2} showSlip={false} slots={SLOTS} />
  );
}

describe('RosterTable — one line per name', () => {
  it('NameCell_ShowsOnlyTheName_NoKindLine', () => {
    renderTable([row({ id: 1, name: 'Kevin Pieper', kind: 'adult', participation: 'driver_only', guests: 2 })]);
    const body = screen.getAllByRole('rowgroup')[1];
    const firstCell = within(body).getAllByRole('cell')[0];
    expect(firstCell.textContent?.trim()).toBe('Kevin Pieper');
  });

  it('Participation_Guests_Answers_Notes_HaveTheirOwnColumns', () => {
    renderTable([
      row({
        id: 1,
        name: 'Kevin Pieper',
        participation: 'driver_only',
        guests: 2,
        guestNote: 'cousins',
        notes: 'arriving late',
        answers: ['Tent size: 4-person']
      })
    ]);
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent?.trim());
    for (const h of ['Participation', 'Guests', 'Answers', 'Notes']) expect(headers).toContain(h);
    const body = screen.getAllByRole('rowgroup')[1];
    const cells = within(body).getAllByRole('cell').map((c) => c.textContent?.trim());
    expect(cells).toContain('driver only');
    expect(cells.some((c) => c?.startsWith('+2'))).toBe(true);
    expect(cells).toContain('Tent size: 4-person');
    expect(cells).toContain('arriving late');
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
    const grub = screen.getByRole('checkbox', { name: 'Grubmaster' }) as HTMLInputElement;
    const table = screen.getByRole('checkbox', { name: 'Bring a table' }) as HTMLInputElement;
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
      row({ id: 3, name: 'Sam Lee', kind: 'scout', participantClass: 'webelos', guestName: 'Sam Lee', hostEntryId: 1 })
    ]);
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent?.trim());
    expect(headers).toContain('Class');
    expect(screen.getByText('Junior Leader')).toBeTruthy();
    expect(screen.getByText('Webelos')).toBeTruthy();
    expect(screen.getAllByText('Adult').length).toBeGreaterThan(0);
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
