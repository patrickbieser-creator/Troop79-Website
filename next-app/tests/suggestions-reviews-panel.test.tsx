import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import type { ReviewCandidate, Reviewer } from '../src/lib/planner-reviews';

/**
 * Suggestions' lead list (Patrick, 2026-10-29): a scout with only the conference and board left leads the page, each
 * need already filled by the rule, and Add sends exactly those people. The action is the mock boundary.
 */
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const m = vi.hoisted(() => ({ add: vi.fn() }));
vi.mock('../src/app/(public)/planner/suggestions/actions', () => ({ suggestAddReviewAction: m.add }));
const { ReviewsPanel } = await import('../src/app/(public)/planner/suggestions/reviews-panel');

const RANKS = [
  { id: 'scout', display_name: 'Scout', sort_order: 1 },
  { id: 'tenderfoot', display_name: 'Tenderfoot', sort_order: 2 },
  { id: 'second-class', display_name: 'Second Class', sort_order: 3 },
  { id: 'first-class', display_name: 'First Class', sort_order: 4 }
];
const FIONA: ReviewCandidate = {
  personId: 5,
  name: 'Fiona K',
  rankId: 'tenderfoot',
  rankName: 'Tenderfoot',
  needs: [
    { kind: 'smc', key: 'tenderfoot-10', label: 'Scoutmaster conference' },
    { kind: 'bor', key: 'tenderfoot-BoR', label: 'Board of review' }
  ]
};
const POOL: Reviewer[] = [
  { personId: 80, name: 'Mindy S', kind: 'adult', scoutmaster: true },
  { personId: 82, name: 'Patrick B', kind: 'adult' },
  { personId: 30, name: 'Henry E', kind: 'scout', rankOrder: 3 },
  { personId: 31, name: 'Quinn B', kind: 'scout', rankOrder: 3 },
  { personId: 32, name: 'Ann T', kind: 'scout', rankOrder: 2 }
];
const panel = (o: Partial<Parameters<typeof ReviewsPanel>[0]> = {}) =>
  render(<ReviewsPanel candidates={[FIONA]} pool={POOL} ranks={RANKS} meeting={{ entryId: 9, label: 'Sun, Nov 1', onPlan: [] }} canSeed {...o} />);

afterEach(() => {
  cleanup();
  m.add.mockReset();
});

describe('ReviewsPanel', () => {
  it('ReadyScout_Leads_WithWhatTheyNeed', () => {
    panel();
    expect(screen.getByText(/needs a Scoutmaster conference and a board of review/)).toBeTruthy();
  });

  it('Add_SendsTheScoutmaster_AndTwoSecondClassScouts', async () => {
    m.add.mockResolvedValue({ ok: true, stamp: 's' });
    panel();
    fireEvent.click(screen.getByRole('button', { name: 'Add to Sun, Nov 1' }));
    await waitFor(() =>
      expect(m.add).toHaveBeenCalledWith({
        entryId: 9,
        personId: 5,
        items: [
          { key: 'tenderfoot-10', reviewerIds: [80] },
          { key: 'tenderfoot-BoR', reviewerIds: [30, 31] }
        ]
      })
    );
  });

  it('ATenderfootScout_IsNeverOfferedForATenderfootBoard', () => {
    panel();
    const options = screen.getAllByRole('combobox', { name: /Board of review/ }).flatMap((sel) => [...(sel as HTMLSelectElement).options].map((o) => o.text));
    expect(options.includes('Ann T')).toBe(false);
  });

  it('Viewer_SeesNoAddButton', () => {
    panel({ canSeed: false });
    expect(screen.queryByRole('button', { name: /Add to/ })).toBeNull();
  });

  it('AlreadyOnThePlan_SaysSo', () => {
    panel({ meeting: { entryId: 9, label: 'Sun, Nov 1', onPlan: ['tenderfoot-10', 'tenderfoot-BoR'] } });
    expect(screen.getAllByText('✓ On the Sun, Nov 1 plan').length).toBe(2);
  });
});
