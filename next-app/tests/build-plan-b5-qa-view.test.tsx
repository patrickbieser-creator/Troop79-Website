import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { DATA } from './helpers/suggestions-fixture';

/**
 * Build a Plan B5 qa follow-ups (Suggestions mode): focus goes somewhere sensible on entering and leaving the mode and
 * after an Add, never to body; "Finding suggestions…" sits in a live region that is there from the start; leaders who
 * may edit Lookups get "Edit in Lookups" in the Teaching lens. Server actions are mocked.
 */
const nav = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => nav }));
const add = vi.hoisted(() => vi.fn());
vi.mock('../src/app/(public)/planner/build-actions', () => ({
  plannerAddOfferingAction: add,
  plannerRemoveOfferingAction: vi.fn(),
  plannerBuildStampAction: vi.fn(async () => ({ ok: false }))
}));
vi.mock('../src/app/(public)/planner/actions', () => ({ plannerStampAction: vi.fn(async () => ({ ok: false })) }));

const { BuildPlanView, SuggestionsFeed } = await import('../src/app/(public)/planner/build/build-client');

const PLAN = '/planner/build?meeting=1';
const mode = (o: { feed?: boolean; lookupsHref?: string } = {}) =>
  render(
    <BuildPlanView
      entryId={1}
      rows={[]}
      canSeed
      stamp="s0"
      heading={null}
      mode="suggestions"
      planHref={PLAN}
      lookupsHref={o.lookupsHref}
      feed={o.feed === false ? null : <SuggestionsFeed data={DATA} />}
    />
  );

afterEach(() => {
  cleanup();
  nav.push.mockReset();
  add.mockReset();
});

describe('B5 qa: focus in Suggestions mode', () => {
  // Since the persistent bar (2026-10-22): focus goes to the view's heading, entering and leaving.
  it('SuggestionsMode_OnEnter_FocusesItsHeading', async () => {
    mode();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { level: 2, name: 'Suggestions' })));
  });

  it('SuggestionsMode_OnLeave_FocusesThePlanHeading', async () => {
    mode();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    cleanup();
    render(<BuildPlanView entryId={1} rows={[]} canSeed stamp="s0" heading={null} suggestionsHref={`${PLAN}&view=suggestions`} />);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'The plan' })));
  });

  it('SuggestionsMode_SingleAdd_MovesFocusToTheNextAdd', async () => {
    mode();
    add.mockResolvedValueOnce({ ok: true, added: ['scout-2'], teachers: {}, prior: 's0', stamp: 's1' });
    const first = await screen.findByRole('button', { name: 'Add Scout 2 Flag' });
    first.focus();
    fireEvent.click(first);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Add Tenderfoot 4a First aid' })));
  });

  it('SuggestionsMode_AddTicked_NeverLeavesFocusOnBody', async () => {
    mode();
    add.mockResolvedValueOnce({ ok: true, added: ['scout-2', 'tenderfoot-4a'], teachers: {}, prior: 's0', stamp: 's1' });
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Select Scout 2 Flag' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Tenderfoot 4a First aid' }));
    const bar = screen.getByRole('button', { name: 'Add 2 to the plan' });
    bar.focus();
    fireEvent.click(bar);
    await waitFor(() => expect(add).toHaveBeenCalled());
    await waitFor(() => expect([document.activeElement === document.body, document.activeElement?.isConnected]).toEqual([false, true]));
  });
});

describe('B5 qa: the loading line and Lookups', () => {
  it('SuggestionsMode_Loading_IsAPersistentLiveRegion', () => {
    mode({ feed: false });
    expect(screen.getByText('Finding suggestions…').getAttribute('role')).toBe('status');
  });

  it('TeachingLens_WithLookupsRight_LinksToLookups', async () => {
    mode({ lookupsHref: '/admin/advancement/lookups' });
    fireEvent.click(await screen.findByRole('radio', { name: 'Teaching' }));
    expect(screen.getByRole('link', { name: 'Edit in Lookups' }).getAttribute('href')).toBe('/admin/advancement/lookups');
  });

  it('TeachingLens_WithoutLookupsRight_HasNoLookupsLink', async () => {
    mode();
    fireEvent.click(await screen.findByRole('radio', { name: 'Teaching' }));
    expect(screen.queryByRole('link', { name: 'Edit in Lookups' })).toBeNull();
  });
});
