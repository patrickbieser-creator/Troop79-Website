import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RollCall } from '../src/app/admin/(workspace)/calendar/[id]/roll-call/roll-call';
import type { AttendeeCandidate, AttendanceRow } from '../src/lib/attendance-shared';

/**
 * Roll Call sheet tabs (Patrick, 2026-08-24: "rebuild the roll call page with
 * the same tab pattern") — one pill tab per directory group instead of four
 * sections stacked down the page.
 */
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() })
}));

function person(personId: number, displayName: string, tab: string, signedUp = false): AttendeeCandidate {
  return { personId, displayName, scoutId: tab.endsWith('scout') ? `s${personId}` : null, tab, signedUp };
}
const candidates = [
  person(1, 'Avery Scout', 'active_scout'),
  person(2, 'Blake Scout', 'active_scout'),
  person(3, 'Casey Leader', 'leader'),
  person(4, 'Dana Parent', 'adult'),
  person(5, 'Eli Former', 'inactive_scout')
];
const attendance: AttendanceRow[] = [{ id: 1, personId: 1, qty: null, source: 'manual', note: null }];

function renderSheet(over: Partial<React.ComponentProps<typeof RollCall>> = {}) {
  return render(
    <RollCall
      entryId={109}
      entryTitle="PLC Meeting"
      creditKind={null}
      creditUnit={null}
      countsAsActivity={false}
      defaultQty={1}
      hasSignup={false}
      candidates={candidates}
      attendance={attendance}
      onMark={vi.fn()}
      onUnmark={vi.fn()}
      onSetQty={vi.fn()}
      onSeed={vi.fn()}
      {...over}
    />
  );
}

describe('Roll Call sheet — one tab per group', () => {
  it('OffersScoutsLeadersAdultsInactive_InThatOrder_WithPresentCounts', () => {
    renderSheet();
    const tabs = screen.getAllByRole('tab').map((t) => t.textContent);
    expect(tabs).toEqual(['Scouts1', 'Leaders0', 'Adults0', 'Inactive scouts0']);
  });

  it('OpensOnScouts_AndOnlyThatPanelIsVisible', () => {
    renderSheet();
    expect(screen.getByRole('tab', { name: /Scouts/ }).getAttribute('aria-selected')).toBe('true');
    const panel = screen.getByRole('tabpanel', { name: 'Scouts' });
    expect(within(panel).getByLabelText(/Avery Scout/)).toBeTruthy();
    expect(screen.queryByRole('tabpanel', { name: 'Leaders' })).toBeNull();
  });

  it('SwitchingTabs_ShowsThatGroup', async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.click(screen.getByRole('tab', { name: /Adults/ }));
    expect(within(screen.getByRole('tabpanel', { name: 'Adults' })).getByLabelText(/Dana Parent/)).toBeTruthy();
    expect(screen.queryByRole('tabpanel', { name: 'Scouts' })).toBeNull();
  });

  it('Search_FiltersTheOpenTab_AndSaysWhereElseTheNameIs', async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.type(screen.getByLabelText('Find a person'), 'Casey');
    const scouts = within(screen.getByRole('tabpanel', { name: 'Scouts' }));
    expect(scouts.getByText(/Nobody on this tab matches/)).toBeTruthy();
    await user.click(scouts.getByRole('button', { name: 'Leaders' })); // the hint jumps there
    expect(within(screen.getByRole('tabpanel', { name: 'Leaders' })).getByLabelText(/Casey Leader/)).toBeTruthy();
  });

  it('Names_AreAlphabetical_WithinAGroup_WhateverOrderTheyArrivedIn', () => {
    // Patrick, 2026-08-25: multi-column list, alphabetical DOWN each column —
    // the columns are CSS; the order must hold regardless of load order.
    renderSheet({
      candidates: [
        person(9, 'Zoe Scout', 'active_scout'),
        person(1, 'Avery Scout', 'active_scout'),
        person(5, 'Morgan Scout', 'active_scout')
      ],
      attendance: []
    });
    const panel = within(screen.getByRole('tabpanel', { name: 'Scouts' }));
    expect(panel.getAllByRole('checkbox').map((c) => c.closest('label')?.textContent)).toEqual([
      'Avery Scout',
      'Morgan Scout',
      'Zoe Scout'
    ]);
  });

  it('GroupsWithNobody_HaveNoTab', () => {
    renderSheet({ candidates: candidates.filter((c) => c.tab !== 'inactive_scout') });
    expect(screen.getAllByRole('tab')).toHaveLength(3);
  });
});
