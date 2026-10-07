import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/** Admin › Menu Monster › Tools & utilities (Patrick, 2026-10-06): the first tool resyncs the patrol list from the roster. */

const router = { refresh: vi.fn() };
vi.mock('next/navigation', () => ({ useRouter: () => router }));
const resyncPatrolsFromRoster = vi.fn();
const movePatrolMenus = vi.fn();
vi.mock('../src/app/admin/(workspace)/library/menu-monster/actions', () => ({
  resyncPatrolsFromRoster: () => resyncPatrolsFromRoster(),
  movePatrolMenus: (...a: unknown[]) => movePatrolMenus(...a)
}));

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
    await userEvent.setup().click(screen.getAllByRole('button', { name: 'Run' })[0]);
    await waitFor(() => expect(resyncPatrolsFromRoster).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/3 patrols: Buff Burritos/)).toBeTruthy();
    expect(router.refresh).toHaveBeenCalled();
  });

  it('AFailure_IsSaid', async () => {
    resyncPatrolsFromRoster.mockResolvedValueOnce({ ok: false, error: 'Not authenticated' });
    render(<ToolsAdmin />);
    await userEvent.setup().click(screen.getAllByRole('button', { name: 'Run' })[0]);
    expect(await screen.findByText('Not authenticated')).toBeTruthy();
  });
});

describe('ToolsAdmin: move menus to a renamed patrol', () => {
  const missing = [{ name: 'Flaming Arrows', count: 3 }];
  const patrols = ['Screaming Eagles', 'Whole troop'];
  const row = () => screen.getByText('Move menus to a renamed patrol').closest('li') as HTMLElement;

  it('NothingToMove_SaysSo_WithRunGreyed', () => {
    render(<ToolsAdmin />);
    expect(within(row()).getByText('Nothing to move.')).toBeTruthy();
    expect((within(row()).getByRole('button', { name: 'Run' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('RunStaysGreyed_UntilBothAreChosen_ThenMovesAndReports', async () => {
    movePatrolMenus.mockResolvedValue({ ok: true, note: 'Moved 3 menus from Flaming Arrows to Screaming Eagles.' });
    const user = userEvent.setup();
    render(<ToolsAdmin missing={missing} patrols={patrols} />);
    const run = within(row()).getByRole('button', { name: 'Run' }) as HTMLButtonElement;
    expect(within(within(row()).getByRole('combobox', { name: 'From patrol' })).getAllByRole('option').map((o) => o.textContent)).toEqual(['From…', 'Flaming Arrows (3 menus)']);
    await user.selectOptions(within(row()).getByRole('combobox', { name: 'From patrol' }), 'Flaming Arrows');
    expect(run.disabled).toBe(true);
    await user.selectOptions(within(row()).getByRole('combobox', { name: 'To patrol' }), 'Screaming Eagles');
    expect(run.disabled).toBe(false);
    await user.click(run);
    await waitFor(() => expect(movePatrolMenus).toHaveBeenCalledWith('Flaming Arrows', 'Screaming Eagles'));
    expect(await screen.findByText('Moved 3 menus from Flaming Arrows to Screaming Eagles.')).toBeTruthy();
  });
});
