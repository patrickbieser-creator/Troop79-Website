import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import type { PlanRow } from '../src/lib/build-plan';

/**
 * Build a Plan B1 (Plans/Build-A-Plan.md), the screen: a viewer sees the plan with no controls; a seed holder's ⋯ on
 * a row scouts picked offers Remove greyed, with the reason. The server actions are mocked; their rules are tested
 * in build-plan-db.test.ts.
 */
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('../src/app/(public)/planner/build-actions', () => ({
  plannerAddOfferingAction: vi.fn(),
  plannerRemoveOfferingAction: vi.fn(),
  plannerBuildStampAction: vi.fn(async () => ({ ok: false }))
}));
vi.mock('../src/app/(public)/planner/actions', () => ({ plannerStampAction: vi.fn(async () => ({ ok: false })) }));

const { BuildPlanView, SuggestionsFeed } = await import('../src/app/(public)/planner/build/build-client');

const row = (key: string, o: Partial<PlanRow> = {}): PlanRow => ({
  key,
  codeLabel: key,
  title: `Title ${key}`,
  origin: 'planner',
  seeded: true,
  teachers: [],
  scouts: 0,
  likely: 0,
  canTeach: 2,
  state: 'needs-teacher',
  ...o
});
const ROWS = [row('tenderfoot-4a'), row('scout-1a', { origin: 'scouts', seeded: false, scouts: 3, teachers: ['Dan K'], state: 'ready' })];
const SUGGESTIONS = [{ key: 'scout-2', codeLabel: 'Scout 2', title: 'Flag', need: 4, bestTeacher: 'Dan K' }];

afterEach(cleanup);

describe('BuildPlanView', () => {
  it('BuildPlan_Viewer_SeesNoControls', () => {
    render(<BuildPlanView entryId={1} rows={ROWS} canSeed={false} stamp="s" heading={null} feed={<SuggestionsFeed list={SUGGESTIONS} />} />);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('BuildPlan_ScoutPickedRow_CannotBeRemoved', () => {
    render(<BuildPlanView entryId={1} rows={ROWS} canSeed stamp="s" heading={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'More for Title scout-1a' }));
    const remove = screen.getByRole('button', { name: 'Remove' }) as HTMLButtonElement;
    expect([remove.disabled, screen.getByText('Scouts picked this, so it stays on the plan.') != null]).toEqual([true, true]);
  });
});
