import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { JobCoverage } from '../src/app/admin/(workspace)/rosters/[id]/job-coverage';

/**
 * Patrick, 2026-08-25: the Job coverage list above the roster grid IS the job
 * UX now — "clicking a job title opens a line under it listing the people
 * signed up: full name, full name, …, wrapping as needed."
 */
const ITEMS = [
  { label: 'Setup crew', filled: 2, needed: 4, names: ['Kevin Pieper', 'Amy Adult'] },
  { label: 'Cashier', filled: 0, needed: 2, names: [] },
  { label: 'Bring a table', filled: 1, needed: null, names: ['Zed Adult'] }
];

describe('JobCoverage', () => {
  it('JobCoverage_ListsEveryJob_WithItsTally_AndNamesOpenByDefault', () => {
    render(<JobCoverage items={ITEMS} />);
    expect(screen.getByText('2 of 4 — 2 more needed')).toBeTruthy();
    expect(screen.getByText('1 signed up')).toBeTruthy();
    expect(screen.getByText('Kevin Pieper, Amy Adult')).toBeTruthy();
  });

  it('JobCoverage_ClickingAJob_FoldsItsNames_AndClickingAgainReopens', async () => {
    const user = userEvent.setup();
    render(<JobCoverage items={ITEMS} />);
    const btn = screen.getByRole('button', { name: /Setup crew/ });
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    await user.click(btn);
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('Kevin Pieper, Amy Adult')).toBeNull();
    await user.click(btn);
    expect(screen.getByText('Kevin Pieper, Amy Adult')).toBeTruthy();
  });

  it('JobCoverage_AnUnclaimedJob_SaysNobodyYet', () => {
    render(<JobCoverage items={ITEMS} />);
    expect(screen.getByText('Nobody yet.')).toBeTruthy();
  });
});
