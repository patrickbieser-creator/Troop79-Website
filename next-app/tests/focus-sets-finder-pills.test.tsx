import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { FocusSource } from '../src/lib/meeting-focus';

/**
 * /planner/focus-sets, Find requirements (Patrick, 2026-10-29): the pills are All · Scout · Tenderfoot · Second Class ·
 * First Class · Merit badge. A rank pill shows that rank's requirements. Merit badge lists the badges; picking one adds
 * a "First Aid ✕" pill, and picking another badge from the list replaces it. No rank tiles, no Star / Life / Eagle.
 */
const search = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('../src/app/(public)/planner/focus-actions', () => ({
  focusCountsAction: vi.fn(async () => ({ ok: true, sources: [] })),
  focusDeleteSetAction: vi.fn(),
  focusSaveSetAction: vi.fn(),
  focusSearchAction: search
}));
vi.mock('../src/app/(public)/planner/this-week-actions', () => ({ twAddFocusSetAction: vi.fn() }));
const { FocusSetsClient } = await import('../src/app/(public)/planner/focus-sets/focus-sets-client');

const SOURCES: FocusSource[] = [
  ...['scout', 'tenderfoot', 'second-class', 'first-class', 'star', 'life', 'eagle'].map((id) => ({ kind: 'rank' as const, id, name: id === 'second-class' ? 'Second Class' : id === 'first-class' ? 'First Class' : id[0].toUpperCase() + id.slice(1), n: 10 })),
  { kind: 'mb', id: 'first-aid', name: 'First Aid', n: 12 },
  { kind: 'mb', id: 'camping', name: 'Camping', n: 9 }
];
const view = () => render(<FocusSetsClient canSeed sets={[]} sources={SOURCES} meetings={[]} />);
const finder = () => within(screen.getByRole('region', { name: 'Find requirements' }));
const pills = () => within(finder().getByRole('group', { name: 'Show' }));

beforeEach(() => {
  search.mockReset();
  search.mockResolvedValue({ ok: true, rows: [], hasMore: false });
});

describe('Find requirements pills', () => {
  it('Pills_AreAllTheFourGroupRanksAndMeritBadge', () => {
    view();
    expect(pills().getAllByRole('button').map((b) => b.textContent)).toEqual(['All', 'Scout', 'Tenderfoot', 'Second Class', 'First Class', 'Merit badge']);
  });

  it('Finder_ShowsNoRankTiles', () => {
    view();
    expect(finder().queryByRole('button', { name: /^Star/ })).toBeNull();
  });

  it('RankPill_ShowsThatRanksRequirements', async () => {
    view();
    await userEvent.setup().click(pills().getByRole('button', { name: 'Tenderfoot' }));
    await waitFor(() => expect(search).toHaveBeenCalledWith(expect.objectContaining({ kind: 'rank', source: 'tenderfoot' })));
  });

  it('MeritBadgePill_ListsTheBadges', async () => {
    view();
    await userEvent.setup().click(pills().getByRole('button', { name: 'Merit badge' }));
    expect(finder().getByRole('button', { name: /^First Aid/ })).toBeTruthy();
  });

  it('PickingABadge_AddsARemovablePill', async () => {
    view();
    const u = userEvent.setup();
    await u.click(pills().getByRole('button', { name: 'Merit badge' }));
    await u.click(finder().getByRole('button', { name: /^First Aid/ }));
    expect(pills().getByRole('button', { name: /not just First Aid/ }).textContent).toBe('First Aid ✕');
  });

  it('PickingAnotherBadge_ReplacesThePill', async () => {
    view();
    const u = userEvent.setup();
    await u.click(pills().getByRole('button', { name: 'Merit badge' }));
    await u.click(finder().getByRole('button', { name: /^First Aid/ }));
    await u.click(finder().getByRole('button', { name: /^Camping/ }));
    expect(pills().getAllByRole('button').map((b) => b.textContent)).toEqual(['All', 'Scout', 'Tenderfoot', 'Second Class', 'First Class', 'Merit badge', 'Camping ✕']);
  });

  it('BadgePillX_GoesBackToTheBadgeList', async () => {
    view();
    const u = userEvent.setup();
    await u.click(pills().getByRole('button', { name: 'Merit badge' }));
    await u.click(finder().getByRole('button', { name: /^First Aid/ }));
    await u.click(pills().getByRole('button', { name: /not just First Aid/ }));
    expect([pills().queryByRole('button', { name: /✕/ }), finder().getByRole('button', { name: /^First Aid/ })]).toEqual([null, expect.anything()]);
  });
});
