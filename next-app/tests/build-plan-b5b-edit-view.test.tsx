import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import type { PlanRow } from '../src/lib/build-plan';

/**
 * Build a Plan B5b (Plans/Build-A-Plan.md), the mix section of a row's Edit: Save changes this meeting only; "Also
 * update the focus set '<name>'…" asks first in a Dialog that names the effect, and its confirm saves the draft and the
 * set in ONE call. Server actions are mocked.
 */
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const m = vi.hoisted(() => ({ mix: vi.fn(), editMix: vi.fn() }));
vi.mock('../src/app/(public)/planner/build-actions', () => ({
  plannerAddOfferingAction: vi.fn(),
  plannerRemoveOfferingAction: vi.fn(),
  plannerAddFocusSetAction: vi.fn(),
  plannerNewMixAction: vi.fn(),
  plannerEditMixAction: m.editMix,
  plannerMixAction: m.mix,
  plannerSetTeacherAction: vi.fn(),
  plannerTeacherChoicesAction: vi.fn(async () => ({ ok: true, choices: [] })),
  plannerBuildStampAction: vi.fn(async () => ({ ok: false })),
  plannerInviteSheetAction: vi.fn(async () => ({ ok: false, error: 'x' })),
  plannerSendInvitesAction: vi.fn()
}));
vi.mock('../src/app/(public)/planner/focus-actions', () => ({
  focusSearchAction: vi.fn(async () => ({ ok: true, rows: [], hasMore: false })),
  focusSetsAction: vi.fn(async () => ({ ok: true, sets: [] }))
}));
vi.mock('../src/app/(public)/planner/actions', () => ({ plannerStampAction: vi.fn(async () => ({ ok: false })) }));

const { BuildPlanView } = await import('../src/app/(public)/planner/build/build-client');

const MIX: PlanRow = { key: 'fg:9', codeLabel: 'Focus set', title: 'Mix', origin: 'planner', seeded: true, teachers: [], scouts: 0, canTeach: 0, state: 'needs-teacher' };
const ITEM = { key: 'tenderfoot-4a', kind: 'rank' as const, sourceId: 'tenderfoot', sourceName: 'Tenderfoot', code: '4a', label: 'First aid' };
const OK = { ok: true, key: 'fg:9', title: 'Mix two', count: 1, teachers: [], prior: 's', stamp: 's2' };

afterEach(() => {
  cleanup();
  for (const f of Object.values(m)) f.mockReset();
});

const openMix = async () => {
  m.mix.mockResolvedValue({ ok: true, setId: 9, name: 'Mix', setName: 'Campout skills', items: [ITEM] });
  render(<BuildPlanView entryId={1} rows={[MIX]} canSeed stamp="s" heading={null} dayLabel="Oct 25" />);
  fireEvent.click(screen.getByRole('button', { name: 'Edit Mix' }));
  return screen.findByRole('textbox', { name: 'Name' });
};
const alsoUpdate = () => screen.getByRole('button', { name: 'Also update the focus set ‘Campout skills’…' });

describe('B5b: this meeting only, unless confirmed', () => {
  it('MixSection_Note_SaysThisMeetingOnly', async () => {
    await openMix();
    expect(screen.getByText('Changes this meeting only.')).toBeTruthy();
  });

  it('EditMix_Save_SendsNoUpdateSet', async () => {
    const name = await openMix();
    m.editMix.mockResolvedValue(OK);
    fireEvent.change(name, { target: { value: 'Mix two' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(m.editMix).toHaveBeenCalledWith({ entryId: 1, key: 'fg:9', name: 'Mix two', items: ['tenderfoot-4a'] }));
  });

  it('EditMix_UpdateSet_RequiresConfirm', async () => {
    await openMix();
    fireEvent.click(alsoUpdate());
    expect({ called: m.editMix.mock.calls.length, asks: screen.getByRole('heading', { name: 'Are you sure?' }).textContent }).toEqual({ called: 0, asks: 'Are you sure?' });
  });

  it('EditMix_UpdateSet_DialogNamesTheEffect', async () => {
    await openMix();
    fireEvent.click(alsoUpdate());
    expect(screen.getByText('Update the focus set ‘Campout skills’? Plans that add it from now on get these requirements. Meetings already using it keep theirs.')).toBeTruthy();
  });

  it('EditMix_UpdateSet_Confirm_SavesDraftAndSetInOneCall', async () => {
    const name = await openMix();
    m.editMix.mockResolvedValue(OK);
    fireEvent.change(name, { target: { value: 'Mix two' } });
    fireEvent.click(alsoUpdate());
    fireEvent.click(screen.getByRole('button', { name: 'Update the focus set' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Update the focus set' })).toBeNull());
    expect(m.editMix.mock.calls).toEqual([[{ entryId: 1, key: 'fg:9', name: 'Mix two', items: ['tenderfoot-4a'], updateSet: true }]]);
  });

  it('EditMix_UpdateSet_Cancel_SavesNothing', async () => {
    await openMix();
    fireEvent.click(alsoUpdate());
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect({ called: m.editMix.mock.calls.length, open: screen.queryByRole('button', { name: 'Update the focus set' }) }).toEqual({ called: 0, open: null });
  });
});
