import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import type { PlanRow } from '../src/lib/build-plan';

/**
 * Build a Plan B2 (Plans/Build-A-Plan.md), a row's Edit drawer (qa-lead B2 follow-ups): the teacher toggle keeps focus
 * while it saves and says so when unticking the last teacher took the row off the plan; the mix section is dirty-gated
 * with Discard changes and marks a missing name or an empty mix in place. Server actions are mocked.
 */
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const m = vi.hoisted(() => ({ setTeacher: vi.fn(), choices: vi.fn(), mix: vi.fn(), editMix: vi.fn(), addOffering: vi.fn(), search: vi.fn() }));
vi.mock('../src/app/(public)/planner/build-actions', () => ({
  plannerAddOfferingAction: m.addOffering,
  plannerRemoveOfferingAction: vi.fn(),
  plannerAddFocusSetAction: vi.fn(),
  plannerNewMixAction: vi.fn(),
  plannerEditMixAction: m.editMix,
  plannerMixAction: m.mix,
  plannerSetTeacherAction: m.setTeacher,
  plannerTeacherChoicesAction: m.choices,
  plannerBuildStampAction: vi.fn(async () => ({ ok: false })),
  plannerInviteSheetAction: vi.fn(async () => ({ ok: false, error: 'x' })),
  plannerSendInvitesAction: vi.fn()
}));
vi.mock('../src/app/(public)/planner/focus-actions', () => ({
  focusSearchAction: m.search,
  focusSetsAction: vi.fn(async () => ({ ok: true, sets: [] }))
}));
vi.mock('../src/app/(public)/planner/actions', () => ({ plannerStampAction: vi.fn(async () => ({ ok: false })) }));

const { BuildPlanView } = await import('../src/app/(public)/planner/build/build-client');

const REQ: PlanRow = { key: 'tenderfoot-4a', codeLabel: 'Tenderfoot 4a', title: 'First aid', origin: 'teacher', seeded: false, teachers: ['Beth B'], scouts: 0, canTeach: 0, state: 'needs-scouts' };
const MIX: PlanRow = { key: 'fg:9', codeLabel: 'Focus set', title: 'Mix', origin: 'planner', seeded: true, teachers: [], scouts: 0, canTeach: 0, state: 'needs-teacher' };
const ITEM = { key: 'tenderfoot-4a', kind: 'rank' as const, sourceId: 'tenderfoot', sourceName: 'Tenderfoot', code: '4a', label: 'First aid' };
const BETH = { personId: 2, name: 'Beth B', reason: 'Teaches First aid', counselor: false, qualified: true, teaching: true };

afterEach(() => {
  cleanup();
  for (const f of Object.values(m)) f.mockReset();
});

const openTeacher = async () => {
  m.choices.mockResolvedValue({ ok: true, choices: [BETH] });
  render(<BuildPlanView entryId={1} rows={[REQ]} canSeed={false} canEdit stamp="s" heading={null} />);
  fireEvent.click(screen.getByRole('button', { name: 'Edit First aid' }));
  return screen.findByRole('button', { name: /Beth B/ });
};

const openMix = async () => {
  m.mix.mockResolvedValue({ ok: true, setId: 9, name: 'Mix', items: [ITEM] });
  m.choices.mockResolvedValue({ ok: true, choices: [] });
  render(<BuildPlanView entryId={1} rows={[MIX]} canSeed stamp="s" heading={null} dayLabel="Oct 25" />);
  fireEvent.click(screen.getByRole('button', { name: 'Edit Mix' }));
  return screen.findByRole('textbox', { name: 'Name' });
};

describe('the teacher toggle', () => {
  it('TeacherToggle_WhileSaving_KeepsFocus', async () => {
    const beth = await openTeacher();
    m.setTeacher.mockReturnValue(new Promise(() => undefined));
    beth.focus();
    fireEvent.click(beth);
    expect([beth.getAttribute('aria-disabled'), document.activeElement === beth]).toEqual(['true', true]);
  });

  it('TeacherToggle_LastTeacherOff_SaysRemovedFromThePlan', async () => {
    const beth = await openTeacher();
    m.setTeacher.mockResolvedValue({ ok: true, teachers: [], onBoard: false, prior: 's', stamp: 's2' });
    fireEvent.click(beth);
    expect(await within(screen.getByRole('dialog')).findByText('Removed from the plan.')).toBeTruthy();
  });
});

describe('the edit drawer status line (qa-lead B3 #2)', () => {
  it('EditDrawer_StatusLine_IsALiveRegionFromTheStart', async () => {
    const beth = await openTeacher();
    const status = within(screen.getByRole('dialog')).getByRole('status');
    m.setTeacher.mockResolvedValue({ ok: true, teachers: [], onBoard: false, prior: 's', stamp: 's2' });
    fireEvent.click(beth);
    await waitFor(() => expect(status.textContent).toBe('Removed from the plan.'));
  });

  it('TeacherToggle_LastTeacherOff_MovesFocusToTheStatusLine', async () => {
    const beth = await openTeacher();
    beth.focus();
    m.setTeacher.mockResolvedValue({ ok: true, teachers: [], onBoard: false, prior: 's', stamp: 's2' });
    fireEvent.click(beth);
    await waitFor(() => expect(document.activeElement?.textContent).toBe('Removed from the plan.'));
  });
});

describe('the mix section', () => {
  it('MixSection_Clean_SaysSaved', async () => {
    await openMix();
    expect((screen.getByRole('button', { name: 'Saved' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('MixSection_RequirementSearch_IsLabelledAddARequirement', async () => {
    await openMix();
    expect((screen.getByRole('textbox', { name: 'Add a requirement' }) as HTMLInputElement).placeholder).toBe('Tenderfoot 4a, first aid…');
  });

  it('MixSection_Dirty_OffersSaveChanges', async () => {
    const name = await openMix();
    fireEvent.change(name, { target: { value: 'Mix two' } });
    expect((screen.getByRole('button', { name: 'Save changes' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('MixSection_Discard_ReturnsToSaved', async () => {
    const name = await openMix();
    fireEvent.change(name, { target: { value: 'Mix two' } });
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect((name as HTMLInputElement).value).toBe('Mix');
  });

  it('MixSection_EmptyName_MarksTheName', async () => {
    const name = await openMix();
    fireEvent.change(name, { target: { value: '  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(name.getAttribute('aria-invalid')).toBe('true');
  });

  it('MixSection_NoRequirements_SaysTickOne', async () => {
    await openMix();
    fireEvent.click(screen.getByRole('button', { name: 'Take Tenderfoot 4a out' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(screen.getByRole('alert').textContent).toBe('Tick at least one requirement.');
  });
});

describe('the add row', () => {
  it('AddRequirement_WhileAdding_KeepsFocus', async () => {
    m.search.mockResolvedValue({ ok: true, rows: [{ ...ITEM, key: 'tenderfoot-4b', code: '4b', label: 'Bites', parent: null, topLevel: true }], hasMore: false });
    m.addOffering.mockReturnValue(new Promise(() => undefined));
    render(<BuildPlanView entryId={1} rows={[]} canSeed stamp="s" heading={null} dayLabel="Oct 25" />);
    fireEvent.click(screen.getByRole('link', { name: 'Requirements' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Search requirements' }), { target: { value: 'bites' } });
    const add = await screen.findByRole('button', { name: 'Add Tenderfoot 4b' }, { timeout: 2000 });
    add.focus();
    fireEvent.click(add);
    await waitFor(() => expect(add.textContent).toBe('Adding…'));
    expect([add.getAttribute('aria-disabled'), document.activeElement === add]).toEqual(['true', true]);
  });
});
