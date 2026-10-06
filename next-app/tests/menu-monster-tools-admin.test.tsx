import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/** Admin › Menu Monster › Tools & utilities (Patrick, 2026-10-06): the first tool resyncs the patrol list from the roster. */

const router = { refresh: vi.fn() };
vi.mock('next/navigation', () => ({ useRouter: () => router }));
const resyncPatrolsFromRoster = vi.fn();
vi.mock('../src/app/admin/(workspace)/library/menu-monster/actions', () => ({ resyncPatrolsFromRoster: () => resyncPatrolsFromRoster() }));

import { ToolsAdmin } from '../src/app/admin/(workspace)/library/menu-monster/tools-admin';

beforeEach(() => {
  vi.clearAllMocks();
  resyncPatrolsFromRoster.mockResolvedValue({ ok: true, note: '3 patrols: Buff Burritos, Screaming Eagles, Whole troop. Nothing had changed.' });
});

describe('ToolsAdmin', () => {
  it('ListsTheResyncTool_WithWhatItDoes', () => {
    render(<ToolsAdmin />);
    expect(screen.getByText('Resync patrol list from roster')).toBeTruthy();
    expect(screen.getByText(/Patrol pull-down becomes the roster/)).toBeTruthy();
  });

  it('Run_CallsTheTool_AndShowsItsReport', async () => {
    render(<ToolsAdmin />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Run' }));
    await waitFor(() => expect(resyncPatrolsFromRoster).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/3 patrols: Buff Burritos/)).toBeTruthy();
    expect(router.refresh).toHaveBeenCalled();
  });

  it('AFailure_IsSaid', async () => {
    resyncPatrolsFromRoster.mockResolvedValueOnce({ ok: false, error: 'Not authenticated' });
    render(<ToolsAdmin />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Run' }));
    expect(await screen.findByText('Not authenticated')).toBeTruthy();
  });
});
