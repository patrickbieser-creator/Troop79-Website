import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CatalogPayload, ReqTreeNode } from '../src/app/admin/(workspace)/advancement/fast-entry/picker-types';

/**
 * Requirement-First bulk entry (Patrick, 2026-11-09): typing "cli" to find Climbing and opening it kept "cli" as the
 * requirement filter, so 1c and 2 (no "cli" in them) vanished, as if the badge had no requirement 2. Opening a badge
 * starts with an empty filter; going back to the list restores the badge search.
 */
vi.mock('../src/app/admin/(workspace)/advancement/fast-entry/actions', () => ({ addLedgerEntries: vi.fn(), undoCompletion: vi.fn() }));
vi.mock('../src/app/admin/(workspace)/advancement/lookups/actions', () => ({
  createEvent: vi.fn(),
  updateEvent: vi.fn(),
  createLeadershipPosition: vi.fn(),
  createServiceProject: vi.fn()
}));
const { RequirementPicker } = await import('../src/app/admin/(workspace)/advancement/fast-entry/picker');

const leaf = (code: string, label: string): ReqTreeNode => ({ code, label, complete_rule: 'all', complete_n: null, children: [] });
const catalog: CatalogPayload = {
  ranks: [],
  mbs: [
    {
      id: 'climbing',
      name: 'Climbing',
      eagle: false,
      requirements: [leaf('1', 'Explain climbing hazards'), leaf('2', 'Explain the Leave No Trace Seven Principles')]
    },
    { id: 'chess', name: 'Chess', eagle: false, requirements: [leaf('1', 'Discuss the history of the game')] }
  ],
  events: [],
  serviceProjects: [],
  leadershipPositions: []
};

afterEach(cleanup);

async function openClimbingAfterSearching() {
  const user = userEvent.setup();
  render(<RequirementPicker catalog={catalog} selections={[]} onSelectionsChange={() => {}} completion={new Map()} showFreeTabs={false} />);
  await user.click(screen.getByRole('button', { name: 'MBs' }));
  await user.type(screen.getByRole('searchbox'), 'cli');
  await user.click(screen.getByRole('button', { name: 'Climbing' }));
  return user;
}

describe('Fast Entry picker, opening a merit badge from a search', () => {
  it('OpenBadge_ShowsEveryRequirement_WhenTheBadgeSearchMatchesOnlySome', async () => {
    await openClimbingAfterSearching();
    expect(screen.getByText('Explain the Leave No Trace Seven Principles')).toBeTruthy();
  });

  it('OpenBadge_StartsWithAnEmptyRequirementFilter', async () => {
    await openClimbingAfterSearching();
    expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('');
  });

  it('BackToAllBadges_RestoresTheBadgeSearch', async () => {
    const user = await openClimbingAfterSearching();
    await user.click(screen.getByRole('button', { name: '← All Merit Badges' }));
    expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('cli');
  });
});
