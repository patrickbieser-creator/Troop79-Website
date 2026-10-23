import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import type { PlanRow } from '../src/lib/build-plan';
import { DATA } from './helpers/suggestions-fixture';

/**
 * Build a Plan's persistent navigation (Patrick, 2026-10-22): one bar on every sub-view, "The plan · Suggestions ·
 * + Requirement · + Focus set · + New mix", the current one highlighted; The plan always goes home; each sub-view has
 * "← Back to the plan"; the view lives in the URL (?view=…). Server actions are mocked.
 */
const nav = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => nav }));
vi.mock('../src/app/(public)/planner/build-actions', () => ({
  plannerAddOfferingAction: vi.fn(),
  plannerRemoveOfferingAction: vi.fn(),
  plannerAddFocusSetAction: vi.fn(),
  plannerNewMixAction: vi.fn(),
  plannerBuildStampAction: vi.fn(async () => ({ ok: false }))
}));
vi.mock('../src/app/(public)/planner/focus-actions', () => ({ focusSearchAction: vi.fn(), focusSetsAction: vi.fn(async () => ({ ok: true, sets: [] })) }));
vi.mock('../src/app/(public)/planner/actions', () => ({ plannerStampAction: vi.fn(async () => ({ ok: false })) }));

const { BuildPlanView, SuggestionsFeed } = await import('../src/app/(public)/planner/build/build-client');
type View = NonNullable<Parameters<typeof BuildPlanView>[0]['view']>;

const PLAN = '/planner/build?meeting=1';
const ROWS: PlanRow[] = [{ key: 'tenderfoot-4a', codeLabel: 'Tenderfoot 4a', title: 'First aid', origin: 'planner', seeded: true, teachers: [], scouts: 0, canTeach: 2, state: 'needs-teacher' }];
const ALL = ['The plan', 'Suggestions', '+ Requirement', '+ Focus set', '+ New mix'];

function renderAt(view: View, o: { canSeed?: boolean } = {}) {
  const suggesting = view === 'suggestions';
  return render(
    <BuildPlanView
      entryId={1}
      rows={ROWS}
      canSeed={o.canSeed ?? true}
      stamp="s"
      heading={null}
      dayLabel="Oct 25"
      planHref={PLAN}
      mode={suggesting ? 'suggestions' : 'plan'}
      view={suggesting ? undefined : view}
      feed={suggesting ? <SuggestionsFeed data={DATA} /> : null}
    />
  );
}
const strip = () => screen.getByRole('navigation', { name: 'Build a Plan' });
const tabs = () => within(strip()).getAllByRole('link');
const selected = () => tabs().filter((t) => t.getAttribute('aria-current') === 'page').map((t) => t.textContent);

beforeEach(() => window.history.replaceState(null, '', PLAN));
afterEach(() => {
  cleanup();
  nav.push.mockReset();
});

describe('Build a Plan navigation', () => {
  // Patrick, 2026-10-22: the tools sit right after "The plan" as buttons, left-aligned, not text links far right.
  it('BuildNav_Buttons_InOrder', () => {
    renderAt('plan');
    expect(tabs().map((t) => t.textContent)).toEqual(ALL);
  });

  // L0 qa (1): the bar's buttons sit straight in the bar, in order, with nothing (a spacer, a wrapper) pushing them right.
  it('BuildNav_Buttons_SitDirectlyInTheBar', () => {
    renderAt('plan');
    expect(Array.from(strip().children).map((c) => c.textContent)).toEqual(ALL);
  });

  // L0 qa (1): the views have their own primary (Invite, Add); the bar's current view is marked, never filled.
  it('BuildNav_Selected_IsMarkedLikeTheOthers', () => {
    renderAt('add-set');
    const cur = within(strip()).getByRole('link', { name: '+ Focus set' });
    const other = within(strip()).getByRole('link', { name: 'The plan' });
    expect([cur.getAttribute('aria-current'), cur.className === other.className]).toEqual(['page', true]);
  });

  it('BuildNav_NoButtonIsPrimary', () => {
    renderAt('plan');
    expect(tabs().filter((t) => /primary/.test(t.className)).length).toBe(0);
  });

  it('BuildNav_Viewer_SeesTwoButtons', () => {
    renderAt('plan', { canSeed: false });
    expect(tabs().length).toBe(2);
  });

  it('BuildNav_IsVisibleInEverySubView', () => {
    const seen = (['plan', 'suggestions', 'add-requirement', 'add-set', 'new-mix'] as View[]).map((v) => {
      renderAt(v);
      const labels = tabs().map((t) => t.textContent);
      cleanup();
      return labels;
    });
    expect(seen).toEqual([ALL, ALL, ALL, ALL, ALL]);
  });

  it('BuildNav_ThePlan_ReturnsToMainView', () => {
    renderAt('add-requirement');
    fireEvent.click(within(strip()).getByRole('link', { name: 'The plan' }));
    expect([screen.queryByRole('textbox', { name: 'Search requirements' }), selected()]).toEqual([null, ['The plan']]);
  });

  it('BuildNav_HighlightsCurrentView', () => {
    renderAt('add-set');
    expect(selected()).toEqual(['+ Focus set']);
  });

  it('BuildNav_Viewer_HidesAddItems', () => {
    renderAt('plan', { canSeed: false });
    expect(tabs().map((t) => t.textContent)).toEqual(['The plan', 'Suggestions']);
  });

  it('BuildNav_UrlRoundTrips', async () => {
    renderAt('plan');
    fireEvent.click(within(strip()).getByRole('link', { name: '+ New mix' }));
    const pushed = window.location.search;
    window.history.pushState(null, '', `${PLAN}&view=add-set`);
    fireEvent(window, new PopStateEvent('popstate'));
    const popped = selected();
    // qa-lead, nav batch: Back after an in-place switch lands on the view before it, URL and bar both.
    window.history.back();
    await waitFor(() => expect(window.location.search).toBe('?meeting=1&view=new-mix'));
    await waitFor(() => expect(selected()).toEqual(['+ New mix']));
    expect([pushed, popped, window.location.search, selected()]).toEqual(['?meeting=1&view=new-mix', ['+ Focus set'], '?meeting=1&view=new-mix', ['+ New mix']]);
  });

  it('BuildNav_Viewer_AddViewInUrl_ShowsThePlan', () => {
    renderAt('add-set', { canSeed: false });
    expect(selected()).toEqual(['The plan']);
  });

  it('BuildNav_FromSuggestions_NavigatesToTheView', () => {
    renderAt('suggestions');
    fireEvent.click(within(strip()).getByRole('link', { name: '+ Requirement' }));
    expect(nav.push.mock.calls).toEqual([[`${PLAN}&view=add-requirement`]]);
  });

  it('BuildNav_Switch_FocusesTheViewHeading', async () => {
    renderAt('plan');
    fireEvent.click(within(strip()).getByRole('link', { name: '+ Focus set' }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Add a focus set' })));
  });

  it('BuildNav_ThePlan_FocusesThePlanHeading', async () => {
    renderAt('new-mix');
    fireEvent.click(within(strip()).getByRole('link', { name: 'The plan' }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'The plan' })));
  });

  it('BuildNav_SubView_HasBackToThePlan', () => {
    renderAt('add-requirement');
    fireEvent.click(screen.getByRole('link', { name: 'Back to the plan' }));
    expect([selected(), window.location.search]).toEqual([['The plan'], '?meeting=1']);
  });

  it('BuildNav_AddView_EscReturnsToThePlan', () => {
    renderAt('add-set');
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(selected()).toEqual(['The plan']);
  });

  it('BuildNav_Suggestions_HasNoBarBackLink', () => {
    renderAt('suggestions');
    expect(screen.getAllByRole('link', { name: 'Back to the plan' }).length).toBe(1);
  });
});
