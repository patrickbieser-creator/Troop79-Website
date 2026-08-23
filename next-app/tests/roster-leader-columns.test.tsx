import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RosterTable } from '../src/app/admin/(workspace)/rosters/[id]/roster-table';
import type { RosterRow } from '../src/app/admin/(workspace)/rosters/[id]/page';
import type { LeaderQuestion } from '../src/lib/leader-columns';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() })
}));

const setLeaderAnswer = vi.fn(async () => ({ ok: true }));
vi.mock('../src/app/admin/(workspace)/events/actions', () => ({
  setEntryFlag: vi.fn(async () => ({ ok: true })),
  cancelEntry: vi.fn(async () => ({ ok: true })),
  restoreEntry: vi.fn(async () => ({ ok: true })),
  claimSlotFor: vi.fn(async () => ({ ok: true })),
  unclaimSlotFor: vi.fn(async () => ({ ok: true })),
  setEntryClass: vi.fn(async () => ({ ok: true })),
  addGuestEntry: vi.fn(async () => ({ ok: true })),
  setEntryTransport: vi.fn(async () => ({ ok: true })),
  setLeaderAnswer: (...a: unknown[]) => setLeaderAnswer(...(a as []))
}));
vi.mock('../src/app/admin/(workspace)/finance/actions', () => ({
  recordEventFeePaymentAction: vi.fn(async () => ({ ok: true }))
}));

/**
 * Leader-only columns on the roster (Plans/Event-Logistics.md §D): the
 * sheet's "Health Forms" / "Registered?" ticks. A single-choice leader
 * question is a checkbox; the health-form one carries a hint from the
 * roster's AHMR date (a date, never the form); families never see any of it.
 */
function row(over: Partial<RosterRow> & { id: number; name: string }): RosterRow {
  return {
    kind: 'scout',
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
    household: 'Porter',
    participantClass: 'scout',
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

const QUESTIONS: LeaderQuestion[] = [
  { id: 21, prompt: 'Health form in hand', inputType: 'choice', choices: ['Yes'], appliesTo: 'both', printAllowed: true },
  { id: 22, prompt: 'Registered with council', inputType: 'choice', choices: ['Yes'], appliesTo: 'scouts', printAllowed: true },
  { id: 23, prompt: 'Tent plan', inputType: 'text', choices: null, appliesTo: 'both', printAllowed: false }
];

function renderTable(rows: RosterRow[]) {
  return render(
    <RosterTable
      rows={rows}
      removedRows={[]}
      signupId={4}
      calendarEntryId={35}
      slots={[]}
      leaderQuestions={QUESTIONS}
      eventDate="2026-10-09"
    />
  );
}

beforeEach(() => setLeaderAnswer.mockClear());

describe('leader-only columns', () => {
  it('LeaderColumns_RenderAsHeaders_AndSingleChoiceAsACheckbox', () => {
    renderTable([row({ id: 1, name: 'Owen', leaderAnswers: { 21: 'Yes' } })]);
    // Short preset header on the grid (Plans/Roster-Status-Tab.md item 8);
    // the full prompt is the header's tooltip.
    expect(screen.getByRole('columnheader', { name: 'Health form' })).toBeTruthy();
    const box = screen.getByLabelText('Health form in hand — Owen') as HTMLInputElement;
    expect(box.type).toBe('checkbox');
    expect(box.checked).toBe(true);
    expect((screen.getByLabelText('Tent plan — Owen') as HTMLInputElement).type).toBe('text');
  });

  it('LeaderCheckbox_CallsSetLeaderAnswer_WithTheChoiceOrNull', async () => {
    const user = userEvent.setup();
    renderTable([row({ id: 1, name: 'Owen' })]);
    await user.click(screen.getByLabelText('Registered with council — Owen'));
    expect(setLeaderAnswer).toHaveBeenCalledWith(1, 22, 'Yes', 4, 35);
  });

  it('LeaderColumn_AppliesToAudience_AdultsGetADashForAScoutsOnlyColumn', () => {
    renderTable([row({ id: 2, name: 'Jason', kind: 'adult', participantClass: 'adult' })]);
    expect(screen.queryByLabelText('Registered with council — Jason')).toBeNull();
    expect(screen.getByLabelText('Health form in hand — Jason')).toBeTruthy();
  });

  it('HealthFormColumn_PreSuggestsFromHealthFormDate_Within12Months', () => {
    renderTable([
      row({ id: 1, name: 'Owen', healthFormDate: '2026-03-01' }),
      row({ id: 2, name: 'Old', healthFormDate: '2024-01-01' })
    ]);
    expect(screen.getByText('form dated 2026-03-01')).toBeTruthy();
    expect(screen.queryByText('form dated 2024-01-01')).toBeNull();
  });
});
