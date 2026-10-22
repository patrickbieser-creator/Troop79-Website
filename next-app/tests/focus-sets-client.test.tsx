import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FocusSetsClient } from '../src/app/(public)/planner/focus-sets/focus-sets-client';
import type { FocusSetView } from '../src/lib/meeting-focus';

/**
 * /planner/focus-sets: "+ New set" sits at the top of the active set panel (right column), not in the Sets list's
 * header. Same seed-right gating and behaviour. The mock boundary is the server actions.
 */
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('../src/app/(public)/planner/focus-actions', () => ({
  focusCountsAction: vi.fn(),
  focusDeleteSetAction: vi.fn(),
  focusSaveSetAction: vi.fn(),
  focusSearchAction: vi.fn()
}));
vi.mock('../src/app/(public)/planner/actions', () => ({ plannerSeedSetAction: vi.fn() }));

const SETS: FocusSetView[] = [
  {
    id: 7,
    name: 'Knots night',
    createdBy: null,
    labels: ['knots'],
    items: [{ key: 'tenderfoot-3a', kind: 'rank', sourceId: 'tenderfoot', sourceName: 'Tenderfoot', code: '3a', label: 'Knots' }],
    lastUsed: null,
    updatedAt: '2026-10-20T12:00:00Z'
  }
];
const view = (canSeed: boolean) => render(<FocusSetsClient canSeed={canSeed} sets={SETS} sources={[]} meetings={[]} />);

describe('focus sets: + New set', () => {
  it('Seeder_FindsNewSet_InTheActiveSetPanel', () => {
    view(true);
    expect(within(screen.getByRole('region', { name: 'The set' })).getByRole('button', { name: '+ New set' })).toBeTruthy();
  });

  it('Seeder_DoesNotFindNewSet_InTheSetsList', () => {
    view(true);
    expect(within(screen.getByRole('region', { name: /^Sets/ })).queryByRole('button', { name: '+ New set' })).toBeNull();
  });

  it('Seeder_NewSet_OpensAnEmptySetToCreate', async () => {
    view(true);
    const panel = screen.getByRole('region', { name: 'The set' });
    await userEvent.setup().click(within(panel).getByRole('button', { name: '+ New set' }));
    expect(within(panel).getByRole('button', { name: 'Create set' })).toBeTruthy();
  });

  it('NonSeeder_HasNoNewSet', () => {
    view(false);
    expect(screen.queryByRole('button', { name: '+ New set' })).toBeNull();
  });
});
