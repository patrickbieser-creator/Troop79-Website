import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { FocusSetView } from '../src/lib/meeting-focus';
import { draftKey, draftProblem } from '../src/lib/meeting-focus';

/** Station rotations step 1 (Plans/Planner-Station-Rotations.md): a focus set's time goal on the Focus sets screen. */
const m = vi.hoisted(() => ({ save: vi.fn(async () => ({ ok: true as const, id: 7 })) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('../src/app/(public)/planner/focus-actions', () => ({
  focusCountsAction: vi.fn(),
  focusDeleteSetAction: vi.fn(),
  focusSaveSetAction: m.save,
  focusSearchAction: vi.fn()
}));
vi.mock('../src/app/(public)/planner/build-actions', () => ({ plannerAddFocusSetAction: vi.fn() }));
const { FocusSetsClient } = await import('../src/app/(public)/planner/focus-sets/focus-sets-client');

const set = (goalMinutes: number | null): FocusSetView[] => [
  {
    id: 7,
    name: 'Climbing MB - Safety',
    createdBy: null,
    labels: [],
    items: [{ key: 'climbing-1', kind: 'mb', sourceId: 'climbing', sourceName: 'Climbing', code: '1', label: 'Safety' }],
    lastUsed: null,
    updatedAt: '2026-11-08T12:00:00Z',
    goalMinutes
  }
];
const view = (goal: number | null) => render(<FocusSetsClient canSeed sets={set(goal)} sources={[]} meetings={[]} />);
const goalBox = () => screen.getByRole('spinbutton', { name: /Time goal/ }) as HTMLInputElement;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('the draft rules', () => {
  const d = { name: 'Safety', labels: [], items: [] };

  it('DraftKey_ChangesWithTheGoal', () => {
    expect(draftKey({ ...d, goal: '25' })).not.toBe(draftKey({ ...d, goal: '' }));
  });

  it('DraftProblem_RefusesAGoalOutOfRange', () => {
    expect(draftProblem({ ...d, goal: '3' })).toEqual({ at: 'goal', text: 'A time goal is 5 to 240 minutes.' });
  });

  it('DraftProblem_RefusesAFraction', () => {
    expect(draftProblem({ ...d, goal: '12.5' })?.at).toBe('goal');
  });

  it('DraftProblem_AcceptsNoGoal', () => {
    expect(draftProblem({ ...d, goal: '' })).toBeNull();
  });
});

describe('the Time goal field', () => {
  it('Field_ShowsTheSavedGoal', () => {
    view(25);
    expect(goalBox().value).toBe('25');
  });

  it('Planner_SetsAGoal_AndSaveSendsIt', async () => {
    view(null);
    const u = userEvent.setup();
    await u.type(goalBox(), '25');
    await u.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(m.save).toHaveBeenCalledWith(expect.objectContaining({ id: 7, goalMinutes: 25 }));
  });

  it('Planner_ClearsTheGoal_AndSaveSendsNull', async () => {
    view(25);
    const u = userEvent.setup();
    await u.clear(goalBox());
    await u.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(m.save).toHaveBeenCalledWith(expect.objectContaining({ goalMinutes: null }));
  });

  it('BadGoal_IsMarkedInPlace_AndNothingSaves', async () => {
    view(null);
    const u = userEvent.setup();
    await u.type(goalBox(), '3');
    await u.click(screen.getByRole('button', { name: 'Save changes' }));
    expect([m.save.mock.calls.length, goalBox().getAttribute('aria-invalid'), screen.getAllByText('A time goal is 5 to 240 minutes.').length > 0]).toEqual([0, 'true', true]);
  });
});
