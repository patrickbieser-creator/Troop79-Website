import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import type { PlanArrangement, PlanRow } from '../src/lib/build-plan';
import type { LiveView } from '../src/lib/meeting-live-shared';

/**
 * Rotations L3 on screen (Plans/Build-A-Plan.md, "Rotations"; D-437):
 *   - Build a Plan: each offering's row says where its class sits ("Rotation — 1 2"), and an editor moves it there with
 *     Live's own action; a viewer reads it; a repeated offering lists its rotations and links to Rotations.
 *   - Rotations (was Meeting Live): no Start. A meeting with nothing planned says so and points at Build a Plan. "More
 *     actions…" holds "Suggest an arrangement" and "Reset to match picks", each confirmed first.
 * Server actions are mocked.
 */
const m = vi.hoisted(() => ({ refresh: vi.fn(), moveClass: vi.fn(), reset: vi.fn(), suggest: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: m.refresh }) }));
vi.mock('../src/app/(public)/planner/build-actions', () => ({
  plannerAddOfferingAction: vi.fn(),
  plannerRemoveOfferingAction: vi.fn(),
  plannerBuildStampAction: vi.fn(async () => ({ ok: false }))
}));
vi.mock('../src/app/(public)/planner/actions', () => ({ plannerStampAction: vi.fn(async () => ({ ok: false })) }));
vi.mock('../src/app/(public)/planner/live-actions', () => ({
  plannerLiveMoveClassAction: m.moveClass,
  plannerLiveResetAction: m.reset,
  plannerLiveSuggestAction: m.suggest
}));

const { BuildPlanView } = await import('../src/app/(public)/planner/build/build-client');
const { LiveBoard, NOTHING_PLANNED, RESET_LOST, SUGGEST_TEXT } = await import('../src/app/(public)/planner/rotations/live-board');

const row = (key: string, o: Partial<PlanRow> = {}): PlanRow => ({
  key,
  codeLabel: key,
  title: `Title ${key}`,
  origin: 'planner',
  seeded: true,
  teachers: [],
  scouts: 0,
  canTeach: 2,
  state: 'needs-teacher',
  ...o
});
const ROWS = [row('tenderfoot-4a'), row('scout-1a')];
const ARR: PlanArrangement = {
  rotations: [1, 2],
  classes: {
    'tenderfoot-4a': [{ id: 'c:7', rotation: 1, version: 3 }],
    'scout-1a': [
      { id: 'c:8', rotation: 1, version: 1 },
      { id: 'c:9', rotation: 2, version: 1 }
    ]
  }
};
const ok = { ok: true, stamp: 's' };
const EMPTY: LiveView = { started: false, rotations: [{ number: 1, location: null }, { number: 2, location: null }], cards: [], pool: [], overlaps: 0, drift: [] };
const STARTED: LiveView = { ...EMPTY, started: true };

afterEach(() => {
  cleanup();
  for (const f of Object.values(m)) f.mockReset();
});

describe('Rotations L3: Build a Plan rows', () => {
  it('Row_Editor_ShowsItsRotationPressed', () => {
    render(<BuildPlanView entryId={1} rows={ROWS} arrangement={ARR} canSeed canEdit stamp="s" heading={null} />);
    const group = screen.getByRole('group', { name: 'Rotation for Title tenderfoot-4a' });
    expect(within(group).getByRole('button', { name: 'Rotation 1' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('Row_Editor_MovesTheClass', async () => {
    m.moveClass.mockResolvedValue(ok);
    render(<BuildPlanView entryId={1} rows={ROWS} arrangement={ARR} canSeed canEdit stamp="s" heading={null} />);
    const group = screen.getByRole('group', { name: 'Rotation for Title tenderfoot-4a' });
    fireEvent.click(within(group).getByRole('button', { name: 'Rotation 2' }));
    await waitFor(() => expect(m.moveClass).toHaveBeenCalledWith({ entryId: 1, classId: 'c:7', version: 3, rotation: 2 }));
  });

  it('Row_MoveRefused_SaysWhy', async () => {
    m.moveClass.mockResolvedValue({ ok: false, error: 'Someone else changed this. Here’s the latest.', stale: true });
    render(<BuildPlanView entryId={1} rows={ROWS} arrangement={ARR} canSeed canEdit stamp="s" heading={null} />);
    const group = screen.getByRole('group', { name: 'Rotation for Title tenderfoot-4a' });
    fireEvent.click(within(group).getByRole('button', { name: 'Not scheduled' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Someone else changed this. Here’s the latest.');
  });

  it('Row_Viewer_ReadsItsRotation', () => {
    render(<BuildPlanView entryId={1} rows={ROWS} arrangement={ARR} canSeed={false} stamp="s" heading={null} />);
    expect([screen.queryByRole('group', { name: 'Rotation for Title tenderfoot-4a' }), screen.getByText('Rotation 1') != null]).toEqual([null, true]);
  });

  it('Row_Repeated_ListsItsRotations_AndLinksToRotations', () => {
    render(<BuildPlanView entryId={1} rows={ROWS} arrangement={ARR} canSeed canEdit stamp="s" heading={null} />);
    const link = screen.getByRole('link', { name: 'Arrange in Rotations' });
    expect([link.closest('p')?.textContent?.startsWith('Repeats: R1, R2'), link.getAttribute('href')]).toEqual([true, '/planner/rotations']);
  });

  it('Row_NothingArranged_HasNoChips', () => {
    render(<BuildPlanView entryId={1} rows={ROWS} canSeed canEdit stamp="s" heading={null} />);
    expect(screen.queryByRole('group', { name: /^Rotation for/ })).toBeNull();
  });
});

describe('Rotations L3: the Rotations screen', () => {
  it('NothingPlanned_SaysSo_AndPointsAtBuild', () => {
    render(<LiveBoard view={EMPTY} canEdit entryId={133} />);
    expect([screen.getByText(NOTHING_PLANNED, { exact: false }) != null, screen.getByRole('link', { name: 'Build a Plan' }).getAttribute('href')]).toEqual([true, '/planner/build?meeting=133']);
  });

  it('NoStartButton', () => {
    render(<LiveBoard view={EMPTY} canEdit entryId={133} />);
    expect(screen.queryByRole('button', { name: /Start/ })).toBeNull();
  });

  it('MoreActions_Reset_ConfirmsThenResets', async () => {
    m.reset.mockResolvedValue(ok);
    render(<LiveBoard view={STARTED} canEdit entryId={133} />);
    fireEvent.click(screen.getByRole('button', { name: 'More actions…' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reset to match picks' }));
    const dlg = screen.getByRole('dialog');
    expect(within(dlg).getByText(RESET_LOST)).toBeTruthy();
    fireEvent.click(within(dlg).getByRole('button', { name: 'Reset to match picks' }));
    await waitFor(() => expect(m.reset).toHaveBeenCalledWith({ entryId: 133 }));
  });

  it('MoreActions_Suggest_ConfirmsThenSuggests', async () => {
    m.suggest.mockResolvedValue(ok);
    render(<LiveBoard view={STARTED} canEdit entryId={133} />);
    fireEvent.click(screen.getByRole('button', { name: 'More actions…' }));
    fireEvent.click(screen.getByRole('button', { name: 'Suggest an arrangement' }));
    const dlg = screen.getByRole('dialog');
    expect(within(dlg).getByText(SUGGEST_TEXT)).toBeTruthy();
    fireEvent.click(within(dlg).getByRole('button', { name: 'Suggest an arrangement' }));
    await waitFor(() => expect(m.suggest).toHaveBeenCalledWith({ entryId: 133 }));
  });

  it('MoreActions_Viewer_HasNone', () => {
    render(<LiveBoard view={STARTED} canEdit={false} entryId={133} />);
    expect(screen.queryByRole('button', { name: 'More actions…' })).toBeNull();
  });
});

describe('Rotations L3: the old address', () => {
  it('PlannerLive_RedirectsToRotations_KeepingTheQuery', async () => {
    vi.resetModules();
    const redirect = vi.fn((to: string) => {
      throw new Error(`REDIRECT ${to}`);
    });
    vi.doMock('next/navigation', () => ({ redirect }));
    const { default: Page } = await import('../src/app/(public)/planner/live/page');
    const got = await Page({ searchParams: Promise.resolve({ meeting: '133' }) }).then(
      () => 'no redirect',
      (e: Error) => e.message
    );
    vi.doUnmock('next/navigation');
    expect(got).toBe('REDIRECT /planner/rotations?meeting=133');
  });
});
