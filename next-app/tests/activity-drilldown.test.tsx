import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ActivityDrilldownButton } from '../src/app/admin/(workspace)/finance/report/activity-drilldown';
import type { ActivityDrilldownRow } from '../src/app/admin/(workspace)/finance/actions';

/**
 * "I need to drill in to see the details of any activities in the report"
 * (Patrick, 2026-08-19) — dedicated modal, fetched on open rather than
 * pre-loaded with the report (most activities are never drilled into).
 */
function row(over: Partial<ActivityDrilldownRow> = {}): ActivityDrilldownRow {
  return {
    id: 1,
    occurred_on: '2026-06-09',
    account: 'checking',
    amount: 593.95,
    kind: 'event_fee',
    memo: 'Camp fee payment',
    personName: 'Kevin Pieper',
    voided_at: null,
    eventHref: null,
    ...over
  };
}

describe('ActivityDrilldownButton', () => {
  it('Drilldown_FetchesOnlyAfterOpening_NotOnInitialRender', () => {
    const getActivityTransactions = vi.fn().mockResolvedValue([]);
    render(
      <ActivityDrilldownButton activityLabel="High Adventure Trip '26" getActivityTransactions={getActivityTransactions} />
    );
    expect(getActivityTransactions).not.toHaveBeenCalled();
  });

  it('Drilldown_ShowsMatchingTransactions_AfterOpening', async () => {
    const user = userEvent.setup();
    const getActivityTransactions = vi.fn().mockResolvedValue([row()]);
    render(
      <ActivityDrilldownButton activityLabel="High Adventure Trip '26" getActivityTransactions={getActivityTransactions} />
    );

    await user.click(screen.getByRole('button', { name: /view transactions/i }));

    expect(getActivityTransactions).toHaveBeenCalledWith("High Adventure Trip '26");
    await waitFor(() => expect(screen.getByText('Camp fee payment')).toBeTruthy());
  });

  it('Drilldown_LinksToTheSpecificEvent_WhenARowCarriesOne', async () => {
    const user = userEvent.setup();
    const getActivityTransactions = vi.fn().mockResolvedValue([row({ eventHref: '/admin/calendar/42' })]);
    render(<ActivityDrilldownButton activityLabel="Summer Camp '26" getActivityTransactions={getActivityTransactions} />);

    await user.click(screen.getByRole('button', { name: /view transactions/i }));

    await waitFor(() => {
      const link = screen.getByRole('link', { name: /view event/i });
      expect(link.getAttribute('href')).toBe('/admin/calendar/42');
    });
  });

  it('Drilldown_OmitsEventLink_ForRowsWithoutASignupEntry', async () => {
    // A checking-account expense (grocery run for a can drive, say) has no
    // signup_entry_id — only the label match ties it to the activity, no
    // precise event to jump to.
    const user = userEvent.setup();
    const getActivityTransactions = vi.fn().mockResolvedValue([row({ eventHref: null })]);
    render(<ActivityDrilldownButton activityLabel="Can Drive" getActivityTransactions={getActivityTransactions} />);

    await user.click(screen.getByRole('button', { name: /view transactions/i }));

    await waitFor(() => expect(screen.getByText('Kevin Pieper')).toBeTruthy());
    expect(screen.queryByRole('link', { name: /view event/i })).toBeNull();
  });

  it('Drilldown_ShowsAnErrorMessage_WhenTheFetchFails', async () => {
    const user = userEvent.setup();
    const getActivityTransactions = vi.fn().mockRejectedValue(new Error('boom'));
    render(<ActivityDrilldownButton activityLabel="Can Drive" getActivityTransactions={getActivityTransactions} />);

    await user.click(screen.getByRole('button', { name: /view transactions/i }));

    await waitFor(() => expect(screen.getByText(/could not load/i)).toBeTruthy());
  });
});
