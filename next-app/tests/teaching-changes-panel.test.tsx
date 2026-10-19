import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TeachingChanges } from '../src/app/admin/(workspace)/advancement/lookups/teaching-changes';
import type { TeachingSkillChangeRow } from '../src/lib/teaching-skills';

/** Admin › Lookups › Recent teaching-skill changes (Phase 0b): Undo is the only lever, Mark reviewed clears the count. */
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

const row = (over: Partial<TeachingSkillChangeRow> = {}): TeachingSkillChangeRow => ({
  id: 1, personId: 10, personName: 'Dana Parent', personSub: null, skillName: 'Knots & Lashings', action: 'added', source: 'member',
  byLabel: 'Dana Parent', byOther: false, changedAt: '2026-10-18T20:00:00Z', reverted: false, reviewed: false, ...over
});
const noop = async () => ({ ok: true });

describe('TeachingChanges', () => {
  it('Leader_SeesSelfServiceChange_InRecentChanges', () => {
    render(<TeachingChanges toReview={[row()]} all={[row()]} onUndo={noop} onMarkReviewed={noop} />);
    expect([screen.getByText('Added Knots & Lashings'), screen.getByText('Member page')].every(Boolean)).toBe(true);
  });

  it('Undo_CallsTheActionForThatRow', async () => {
    const onUndo = vi.fn(async () => ({ ok: true, message: 'Undone.' }));
    render(<TeachingChanges toReview={[row({ id: 7 })]} all={[row({ id: 7 })]} onUndo={onUndo} onMarkReviewed={noop} />);
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect([onUndo.mock.calls[0], await screen.findByText('Undone.')]).toEqual([[7], expect.anything()]);
  });

  it('MarkReviewed_CallsTheActionForThatRow', async () => {
    const onMark = vi.fn(async () => ({ ok: true }));
    render(<TeachingChanges toReview={[row({ id: 8 })]} all={[row({ id: 8 })]} onUndo={noop} onMarkReviewed={onMark} />);
    await userEvent.click(screen.getByRole('button', { name: 'Mark reviewed' }));
    expect(onMark).toHaveBeenCalledWith(8);
  });

  it('UndoneAndUndoRows_OfferNoUndo', () => {
    render(<TeachingChanges toReview={[]} all={[row({ id: 1, reverted: true }), row({ id: 2, source: 'undo', action: 'removed' })]} onUndo={noop} onMarkReviewed={noop} />);
    expect([screen.queryByRole('button', { name: 'Undo' }), screen.getByText('Undone')]).toEqual([null, expect.anything()]);
  });

  it('NothingToReview_StartsOnAll', () => {
    render(<TeachingChanges toReview={[]} all={[row({ reviewed: true })]} onUndo={noop} onMarkReviewed={noop} />);
    expect(screen.getByText('Reviewed')).toBeTruthy();
  });
});
