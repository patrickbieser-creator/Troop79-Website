import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import type { PlanRow } from '../src/lib/build-plan';

/**
 * Build a Plan B2 (Plans/Build-A-Plan.md), the screen: one quiet add row for seed holders (+ Requirement, + Focus set,
 * + New mix), a new mix added as one class, and a quiet Edit per row for editors. Server actions are mocked; their
 * rules are in build-plan-b2-db.test.ts.
 */
const nav = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => nav }));
const m = vi.hoisted(() => ({ newMix: vi.fn(), search: vi.fn(), addOffering: vi.fn(), addSet: vi.fn(), sets: vi.fn(async () => ({ ok: true, sets: [] as unknown[] })) }));
vi.mock('../src/app/(public)/planner/build-actions', () => ({
  plannerAddOfferingAction: m.addOffering,
  plannerRemoveOfferingAction: vi.fn(),
  plannerAddFocusSetAction: m.addSet,
  plannerNewMixAction: m.newMix,
  plannerEditMixAction: vi.fn(),
  plannerMixAction: vi.fn(async () => ({ ok: false, error: 'x' })),
  plannerSetTeacherAction: vi.fn(),
  plannerTeacherChoicesAction: vi.fn(async () => ({ ok: true, choices: [] })),
  plannerBuildStampAction: vi.fn(async () => ({ ok: false }))
}));
vi.mock('../src/app/(public)/planner/focus-actions', () => ({
  focusSearchAction: m.search,
  focusSetsAction: m.sets
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
  m.addOffering.mockReset();
  m.addSet.mockReset();
  nav.refresh.mockReset();
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

  // B9 qa: an add from the heading's row can cover a scout outside the orphan universe, so it refreshes the streamed
  // count (once), even when the write's stamp kept.
  it('AddRequirement_RefreshesTheOrphanCount', async () => {
    m.search.mockResolvedValue({ ok: true, rows: [HIT], hasMore: false });
    m.addOffering.mockResolvedValue({ ok: true, added: ['tenderfoot-4b'], teachers: {}, prior: 's', stamp: 's2' });
    render(<BuildPlanView entryId={1} rows={ROWS} canSeed stamp="s" heading={null} dayLabel="Oct 25" />);
    fireEvent.click(screen.getByRole('button', { name: '+ Requirement' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Search requirements' }), { target: { value: 'bites' } });
    fireEvent.click(await screen.findByRole('button', { name: /^Add / }, { timeout: 2000 }));
    await waitFor(() => expect(m.addOffering).toHaveBeenCalled());
    await waitFor(() => expect(nav.refresh).toHaveBeenCalledTimes(1));
  });

  it('AddSet_RefreshesTheOrphanCount', async () => {
    m.sets.mockResolvedValueOnce({ ok: true, sets: [{ id: 5, name: 'Knots set', labels: [], items: [{ key: 'tenderfoot-4b' }] }] });
    m.addSet.mockResolvedValue({ ok: true, key: 'fg:5', title: 'Knots set', count: 1, teachers: [], prior: 's', stamp: 's2' });
    render(<BuildPlanView entryId={1} rows={ROWS} canSeed stamp="s" heading={null} dayLabel="Oct 25" />);
    fireEvent.click(screen.getByRole('button', { name: '+ Focus set' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Add Knots set' }));
    await waitFor(() => expect(m.addSet).toHaveBeenCalled());
    await waitFor(() => expect(nav.refresh).toHaveBeenCalledTimes(1));
  });

  it('NewMix_RefreshesTheOrphanCount', async () => {
    m.search.mockResolvedValue({ ok: true, rows: [HIT], hasMore: false });
    m.newMix.mockResolvedValue({ ok: true, key: 'fg:9', title: 'Mix for Oct 25', count: 1, teachers: [], prior: 's', stamp: 's2' });
    render(<BuildPlanView entryId={1} rows={ROWS} canSeed stamp="s" heading={null} dayLabel="Oct 25" />);
    fireEvent.click(screen.getByRole('button', { name: '+ New mix' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Search requirements to tick' }), { target: { value: 'bites' } });
    fireEvent.click(await screen.findByRole('button', { name: /Bites/ }, { timeout: 2000 }));
    fireEvent.click(screen.getByRole('button', { name: 'Add mix of 1 requirement' }));
    await waitFor(() => expect(m.newMix).toHaveBeenCalled());
    await waitFor(() => expect(nav.refresh).toHaveBeenCalledTimes(1));
  });
});
