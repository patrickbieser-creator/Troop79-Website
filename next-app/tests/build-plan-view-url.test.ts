import { describe, it, expect } from 'vitest';
import { parseBuildView, viewHref } from '../src/lib/build-plan-view';

/** Build a Plan's ?view= (lib/build-plan-view): what a URL opens, and the URL of each view. qa-lead, nav batch. */
const PLAN = '/planner/build?meeting=1';

describe('parseBuildView', () => {
  it('ParseBuildView_Missing_IsThePlan', () => {
    expect(parseBuildView(undefined, true)).toBe('plan');
  });

  it('ParseBuildView_Unknown_IsThePlan', () => {
    expect(parseBuildView('nonsense', true)).toBe('plan');
  });

  it('ParseBuildView_Suggestions_ForAViewer', () => {
    expect(parseBuildView('suggestions', false)).toBe('suggestions');
  });

  it.each(['add-requirement', 'add-set', 'new-mix'])('ParseBuildView_Seeder_OpensAddView %s', (v) => {
    expect(parseBuildView(v, true)).toBe(v);
  });

  it.each(['add-requirement', 'add-set', 'new-mix'])('ParseBuildView_Viewer_AddView_FallsBackToThePlan %s', (v) => {
    expect(parseBuildView(v, false)).toBe('plan');
  });

  it('ParseBuildView_RepeatedParam_TakesTheFirst', () => {
    expect(parseBuildView(['add-set', 'new-mix'], true)).toBe('add-set');
  });
});

describe('viewHref', () => {
  it('ViewHref_ThePlan_IsThePlanUrl', () => {
    expect(viewHref(PLAN, 'plan')).toBe(PLAN);
  });

  it('ViewHref_AppendsToExistingQuery', () => {
    expect(viewHref(PLAN, 'add-set')).toBe('/planner/build?meeting=1&view=add-set');
  });

  it('ViewHref_StartsAQueryWhenThereIsNone', () => {
    expect(viewHref('/planner/build', 'suggestions')).toBe('/planner/build?view=suggestions');
  });

  it.each(['suggestions', 'add-requirement', 'add-set', 'new-mix'] as const)('ViewHref_RoundTripsThroughParse %s', (v) => {
    expect(parseBuildView(new URL(viewHref(PLAN, v), 'http://x').searchParams.get('view'), true)).toBe(v);
  });
});
