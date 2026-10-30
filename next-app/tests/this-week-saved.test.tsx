import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import type { ThisWeek } from '../src/lib/this-week';
import type { SavedPlan } from '../src/lib/saved-plans-shared';

/**
 * Saved meeting plans on This week's focus card (Patrick, 2026-10-29), the screen: Save plan… posts a name and a date
 * (this meeting's by default); Load asks first and names what goes; Delete asks first; Edit is dirty-gated. The server
 * actions are the mock boundary.
 */
const m = vi.hoisted(() => ({ save: vi.fn(), load: vi.fn(), update: vi.fn(), del: vi.fn() }));
vi.mock('../src/app/(public)/planner/saved-plan-actions', () => ({ twSavePlanAction: m.save, twLoadPlanAction: m.load, twUpdatePlanAction: m.update, twDeletePlanAction: m.del }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }) }));

const { SavedPlans } = await import('../src/app/(public)/planner/this-week-saved');

const VIEW = {
  focus: [{ key: 'fg:2', setId: 2, name: 'Knots' }],
  badges: [{ mbId: 'cooking', name: 'Cooking', direct: true }],
  extras: []
} as unknown as ThisWeek;
const PLAN: SavedPlan = {
  id: 7,
  name: 'First aid night',
  planDate: '2026-11-01',
  updatedAt: '2026-10-29T00:00:00Z',
  createdBy: null,
  criteria: { focus: [{ setId: 1, title: 'First aid', items: ['tenderfoot-4a'] }], singles: [], badges: ['first-aid'] }
};
const OK = { ok: true as const, stamp: 's' };
const tab = (plans: SavedPlan[] = [PLAN]) =>
  render(<SavedPlans entryId={9} meetingDate="2026-11-08" view={VIEW} plans={plans} badges={[{ id: 'first-aid', name: 'First Aid' }, { id: 'cooking', name: 'Cooking' }]} />);

afterEach(() => {
  cleanup();
  for (const f of Object.values(m)) f.mockReset();
});

describe('SavedPlans', () => {
  it('Save_PostsTheNameAndThisMeetingsDate', async () => {
    m.save.mockResolvedValue({ ...OK, id: 3 });
    tab();
    fireEvent.click(screen.getByRole('button', { name: 'Save plan…' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Knots week' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save plan' }));
    await waitFor(() => expect(m.save).toHaveBeenCalledWith({ entryId: 9, name: 'Knots week', planDate: '2026-11-08' }));
  });

  it('Load_AsksFirst_AndNamesWhatGoes', () => {
    tab();
    fireEvent.click(screen.getByRole('button', { name: 'Load a saved plan…' }));
    fireEvent.click(screen.getByRole('button', { name: 'Load' }));
    const ask = screen.getByRole('group', { name: 'Confirm' });
    expect([ask.textContent?.includes('takes off Knots, Cooking merit badge'), m.load.mock.calls.length]).toEqual([true, 0]);
  });

  it('Load_Confirmed_LoadsThatPlan', async () => {
    m.load.mockResolvedValue(OK);
    tab();
    fireEvent.click(screen.getByRole('button', { name: 'Load a saved plan…' }));
    fireEvent.click(screen.getByRole('button', { name: 'Load' }));
    fireEvent.click(screen.getByRole('button', { name: 'Load and replace' }));
    await waitFor(() => expect(m.load).toHaveBeenCalledWith({ entryId: 9, planId: 7 }));
  });

  it('Delete_AsksFirst', async () => {
    m.del.mockResolvedValue(OK);
    tab();
    fireEvent.click(screen.getByRole('button', { name: 'Load a saved plan…' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent.click(within(screen.getByRole('group', { name: 'Confirm' })).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(m.del).toHaveBeenCalledWith({ entryId: 9, planId: 7 }));
  });

  it('Edit_IsDirtyGated', () => {
    tab();
    fireEvent.click(screen.getByRole('button', { name: 'Load a saved plan…' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const before = (screen.getByRole('button', { name: 'Saved' }) as HTMLButtonElement).disabled;
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Renamed' } });
    expect([before, (screen.getByRole('button', { name: 'Save changes' }) as HTMLButtonElement).disabled]).toEqual([true, false]);
  });

  it('BadgeFilter_NarrowsTheList', () => {
    tab([PLAN, { ...PLAN, id: 8, name: 'Cooking crew', criteria: { focus: [], singles: [], badges: ['cooking'] } }]);
    fireEvent.click(screen.getByRole('button', { name: 'Load a saved plan…' }));
    fireEvent.change(screen.getByLabelText('Merit badge'), { target: { value: 'cooking' } });
    expect(screen.queryByText('First aid night')).toBeNull();
  });
});
