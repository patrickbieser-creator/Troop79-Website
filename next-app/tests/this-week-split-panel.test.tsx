import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import type { TwGroup } from '../src/lib/this-week';
import type { SplitView } from '../src/lib/group-split-proposal';

/**
 * Split or merge… (Plans/Meeting-Planner-III-Split-Groups.md, S4, D8), the panel: it opens on the auto planner's
 * proposal (or the groups as they are), ticks and levels re-preview, and the footer button splits, merges or splits
 * again as it was. The server actions are the mock boundary.
 */
const m = vi.hoisted(() => ({ preview: vi.fn(), apply: vi.fn(), merge: vi.fn(), unmerge: vi.fn() }));
vi.mock('../src/app/(public)/planner/this-week-actions', () => ({
  twPreviewSplitAction: m.preview,
  twApplySplitAction: m.apply,
  twMergeGroupAction: m.merge,
  twUnmergeGroupAction: m.unmerge
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }) }));

const { SplitPanel } = await import('../src/app/(public)/planner/this-week-split');

const TF = 'fr:tenderfoot';
const group = (o: Partial<TwGroup> = {}): TwGroup =>
  ({ key: TF, kind: 'rank', refId: 'tenderfoot', name: 'Tenderfoot', title: 'Tenderfoot group', base: TF, section: 1, sections: 1, fromDone: 0, merged: false, offer: null, stored: null, ...o }) as TwGroup;
const VIEW: SplitView = {
  base: TF,
  name: 'Tenderfoot',
  sections: [['tenderfoot-4a'], ['tenderfoot-8']],
  levels: [0, 4],
  adds: ['tenderfoot-8'],
  placed: 11,
  options: [
    { key: 'tenderfoot-4a', code: '4a', label: 'First Aid', minutes: 120 },
    { key: 'tenderfoot-8', code: '8', label: 'Teach the square knot', minutes: 15 }
  ],
  groups: [
    { label: 'Tenderfoot Group 1', fromDone: 0, minutes: 120, members: [{ personId: 1, name: 'Emory M' }] },
    { label: 'Tenderfoot Group 2', fromDone: 4, minutes: 15, members: [{ personId: 2, name: 'Adi A' }] }
  ]
};
const OK = { ok: true as const, stamp: 's' };
const open = (g = group(), onMerged = vi.fn(), onClose = vi.fn()) => {
  render(<SplitPanel entryId={9} group={g} onClose={onClose} onMerged={onMerged} />);
  return { onMerged, onClose };
};

afterEach(() => {
  cleanup();
  for (const f of Object.values(m)) f.mockReset();
});

describe('SplitPanel', () => {
  it('Planner_OpeningAnUnsplitGroup_SeesTheTwoGroupProposal', async () => {
    m.preview.mockResolvedValue({ ok: true, view: VIEW });
    open();
    await screen.findByText('Adi A');
    expect([m.preview.mock.calls[0][0], screen.getByText('11 scouts placed tonight') != null]).toEqual([{ entryId: 9, group: TF, count: 2 }, true]);
  });

  it('Planner_CanSplitTenderfoot_WithTheProposal', async () => {
    m.preview.mockResolvedValue({ ok: true, view: VIEW });
    m.apply.mockResolvedValue(OK);
    const { onClose } = open();
    await screen.findByText('Adi A');
    fireEvent.click(screen.getByRole('button', { name: 'Split into 2 groups' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(m.apply).toHaveBeenCalledWith({ entryId: 9, group: TF, sections: VIEW.sections, levels: [0, 4], adds: ['tenderfoot-8'] });
  });

  it('Ticking_ARequirement_PreviewsTheEditedGroups', async () => {
    m.preview.mockResolvedValue({ ok: true, view: VIEW });
    open();
    await screen.findByText('Adi A');
    fireEvent.click(screen.getByRole('checkbox', { name: '4a in Group 2' }));
    await waitFor(() => expect(m.preview).toHaveBeenLastCalledWith({ entryId: 9, group: TF, sections: [['tenderfoot-4a'], ['tenderfoot-8', 'tenderfoot-4a']], levels: [0, 4] }));
  });

  it('AGroupWithNothingToTeach_IsRefusedInWords', async () => {
    m.preview.mockResolvedValue({ ok: true, view: { ...VIEW, sections: [['tenderfoot-4a'], []] } });
    open();
    await screen.findByText('Adi A');
    fireEvent.click(screen.getByRole('button', { name: 'Split into 2 groups' }));
    expect([
      screen.getByRole('alert').textContent,
      screen.getByText('Group 2 has nothing to teach. Tick at least one requirement for it below.') != null,
      screen.getByRole('checkbox', { name: '4a in Group 2' }).getAttribute('aria-invalid'),
      m.apply.mock.calls.length
    ]).toEqual(['Can’t save yet: Group 2 has nothing to teach.', true, 'true', 0]);
  });

  it('Planner_CanMerge_ASplitGroup', async () => {
    m.preview.mockResolvedValue({ ok: true, view: VIEW });
    m.merge.mockResolvedValue(OK);
    const { onMerged } = open(group({ sections: 2, title: 'Tenderfoot Group 1', stored: { sections: VIEW.sections, levels: [0, 4] } }));
    fireEvent.click(screen.getByRole('radio', { name: 'One group' }));
    fireEvent.click(screen.getByRole('button', { name: 'Merge into one group' }));
    await waitFor(() => expect(onMerged).toHaveBeenCalledWith(TF));
    expect(m.merge).toHaveBeenCalledWith({ entryId: 9, group: TF });
  });

  it('ASplitGroup_OpensOnTheGroupsAsTheyAre', async () => {
    m.preview.mockResolvedValue({ ok: true, view: VIEW });
    open(group({ sections: 2, stored: { sections: VIEW.sections, levels: [0, 4] } }));
    await screen.findByText('Adi A');
    expect(m.preview.mock.calls[0][0]).toEqual({ entryId: 9, group: TF, sections: VIEW.sections, levels: [0, 4] });
  });

  it('Modes_AreOneTabStop_ArrowsChoose', async () => {
    m.preview.mockResolvedValue({ ok: true, view: VIEW });
    open();
    await screen.findByText('Adi A');
    const two = screen.getByRole('radio', { name: '2 groups' });
    fireEvent.keyDown(two, { key: 'ArrowRight' });
    const three = screen.getByRole('radio', { name: '3 groups' });
    expect([two.tabIndex, three.tabIndex, three.getAttribute('aria-checked'), m.preview.mock.calls.at(-1)?.[0]]).toEqual([-1, 0, 'true', { entryId: 9, group: TF, count: 3 }]);
  });

  it('AMergedGroup_SplitsAgainAsItWas', async () => {
    m.preview.mockResolvedValue({ ok: true, view: VIEW });
    m.unmerge.mockResolvedValue(OK);
    open(group({ merged: true, stored: { sections: VIEW.sections, levels: [0, 4] } }));
    await screen.findByText('Adi A');
    fireEvent.click(screen.getByRole('button', { name: 'Split again as it was' }));
    await waitFor(() => expect(m.unmerge).toHaveBeenCalledWith({ entryId: 9, group: TF }));
  });
});
