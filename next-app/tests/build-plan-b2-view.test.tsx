import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import type { PlanRow } from '../src/lib/build-plan';

/**
 * Build a Plan B2 (Plans/Build-A-Plan.md), the screen: one quiet add row for seed holders (+ Requirement, + Focus set,
 * + New mix), a new mix added as one class, and a quiet Edit per row for editors. Server actions are mocked; their
 * rules are in build-plan-b2-db.test.ts.
 */
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const m = vi.hoisted(() => ({ newMix: vi.fn(), search: vi.fn() }));
vi.mock('../src/app/(public)/planner/build-actions', () => ({
  plannerAddOfferingAction: vi.fn(),
  plannerRemoveOfferingAction: vi.fn(),
  plannerAddFocusSetAction: vi.fn(),
  plannerNewMixAction: m.newMix,
  plannerEditMixAction: vi.fn(),
  plannerMixAction: vi.fn(async () => ({ ok: false, error: 'x' })),
  plannerSetTeacherAction: vi.fn(),
  plannerTeacherChoicesAction: vi.fn(async () => ({ ok: true, choices: [] })),
  plannerBuildStampAction: vi.fn(async () => ({ ok: false }))
}));
vi.mock('../src/app/(public)/planner/focus-actions', () => ({
  focusSearchAction: m.search,
  focusSetsAction: vi.fn(async () => ({ ok: true, sets: [] }))
}));
vi.mock('../src/app/(public)/planner/actions', () => ({ plannerStampAction: vi.fn(async () => ({ ok: false })) }));

const { BuildPlanView } = await import('../src/app/(public)/planner/build/build-client');

const ROWS: PlanRow[] = [
  { key: 'tenderfoot-4a', codeLabel: 'Tenderfoot 4a', title: 'First aid', origin: 'planner', seeded: true, teachers: [], scouts: 0, canTeach: 2, state: 'needs-teacher' }
];
const HIT = { key: 'tenderfoot-4b', kind: 'rank', sourceId: 'tenderfoot', sourceName: 'Tenderfoot', code: '4b', label: 'Bites', parent: null, topLevel: true };

afterEach(() => {
  cleanup();
  m.newMix.mockReset();
  m.search.mockReset();
});

describe('Build a Plan B2 (screen)', () => {
  it('BuildPlan_SeedHolder_GetsOneAddRowWithThreeAdds', () => {
    render(<BuildPlanView entryId={1} rows={ROWS} canSeed stamp="s" heading={null} dayLabel="Oct 25" />);
    expect(screen.getAllByRole('button', { name: /^\+ / }).map((b) => b.textContent)).toEqual(['+ Requirement', '+ Focus set', '+ New mix']);
  });

  it('BuildPlan_Editor_GetsEditButNoAddRow', () => {
    render(<BuildPlanView entryId={1} rows={ROWS} canSeed={false} canEdit stamp="s" heading={null} />);
    expect([screen.queryByRole('button', { name: 'Edit First aid' }) != null, screen.queryAllByRole('button', { name: /^\+ / }).length]).toEqual([true, 0]);
  });

  it('NewMix_FromAddRow_AddsOneClassRow', async () => {
    m.search.mockResolvedValue({ ok: true, rows: [HIT], hasMore: false });
    m.newMix.mockResolvedValue({ ok: true, key: 'fg:9', title: 'Mix for Oct 25', count: 1, teachers: [], prior: 's', stamp: 's2' });
    render(<BuildPlanView entryId={1} rows={ROWS} canSeed stamp="s" heading={null} dayLabel="Oct 25" />);
    fireEvent.click(screen.getByRole('button', { name: '+ New mix' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Search requirements to tick' }), { target: { value: 'bites' } });
    fireEvent.click(await screen.findByRole('button', { name: /Bites/ }, { timeout: 2000 }));
    fireEvent.click(screen.getByRole('button', { name: 'Add mix of 1 requirement' }));
    await waitFor(() => expect(screen.getAllByRole('listitem').some((li) => li.textContent?.includes('Mix for Oct 25'))).toBe(true));
    expect({ sent: m.newMix.mock.calls[0][0], rows: screen.getAllByRole('button', { name: /^Edit / }).length }).toEqual({ sent: { entryId: 1, name: 'Mix for Oct 25', items: ['tenderfoot-4b'] }, rows: 1 });
  });

  it('NewMix_AddedRow_IsLabelledFocus', async () => {
    m.search.mockResolvedValue({ ok: true, rows: [HIT], hasMore: false });
    m.newMix.mockResolvedValue({ ok: true, key: 'fg:9', title: 'Mix for Oct 25', count: 1, teachers: [], prior: 's', stamp: 's2' });
    render(<BuildPlanView entryId={1} rows={ROWS} canSeed stamp="s" heading={null} dayLabel="Oct 25" />);
    fireEvent.click(screen.getByRole('button', { name: '+ New mix' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Search requirements to tick' }), { target: { value: 'bites' } });
    fireEvent.click(await screen.findByRole('button', { name: /Bites/ }, { timeout: 2000 }));
    fireEvent.click(screen.getByRole('button', { name: 'Add mix of 1 requirement' }));
    const row = await screen.findByText((_, el) => el?.tagName === 'LI' && (el.textContent ?? '').includes('Mix for Oct 25'));
    expect(row.querySelector('p span')?.textContent).toBe('Focus');
  });
});
