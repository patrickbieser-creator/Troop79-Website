import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SkillAssignEditor, type AssignPerson, type AssignCandidate } from '../src/app/admin/(workspace)/advancement/lookups/skill-assign-editor';

/**
 * Lookups & Admin -> Adult Skills / Scout Instructors (2026-10-26). Rows are people who teach; Add picks someone from
 * the pool and ticks skills, Delete removes every skill (the row goes). The mock boundary is onSave: assert on what the
 * editor sent.
 */
const onSave = vi.fn(async (...[]: [FormData]): Promise<{ ok: boolean; error?: string }> => ({ ok: true }));

const PEOPLE: AssignPerson[] = [{ key: '82', name: 'Patrick Bieser', sub: 'Scoutmaster', skillIds: ['knots', 'map'] }];
const CANDIDATES: AssignCandidate[] = [
  { key: '119', name: 'Julie Radtke', sub: 'Parent' },
  { key: '136', name: 'Rachel Ellerman', sub: 'Parent' }
];
const SKILLS = [
  { id: 'knots', name: 'Knots' },
  { id: 'map', name: 'Map and compass' },
  { id: 'cooking', name: 'Cooking' }
];

function mount(people: AssignPerson[] = PEOPLE) {
  return render(<SkillAssignEditor people={people} candidates={CANDIDATES} skills={SKILLS} keyField="person_id" noun="Adult" onSave={onSave} />);
}

const sent = () => Object.fromEntries(onSave.mock.calls[0]![0].entries());
const row = (name: string) => screen.getByRole('row', { name: new RegExp(`^${name}`) });

async function pickCandidate(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(screen.getByRole('combobox', { name: 'Adult to add' }));
  await user.click(screen.getByRole('option', { name: new RegExp(name) }));
}

beforeEach(() => {
  onSave.mockClear();
  vi.spyOn(window, 'confirm').mockClear().mockReturnValue(true);
});

describe('Skill assignment editor — Add', () => {
  it('Leader_CanAddAnAdult_ByPickingThemAndTickingSkills', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByRole('button', { name: '+ Add Adult' }));
    await pickCandidate(user, 'Julie Radtke');
    const panel = screen.getByRole('group', { name: 'Add Adult' });
    await user.click(within(panel).getByRole('checkbox', { name: 'Cooking' }));
    await user.click(within(panel).getByRole('button', { name: 'Add Adult' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(sent()).toEqual({ person_id: '119', skill_ids: JSON.stringify(['cooking']) });
  });

  it('Leader_CannotAddAnAdult_WithNoSkillTicked_AndIsToldWhy', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByRole('button', { name: '+ Add Adult' }));
    await pickCandidate(user, 'Julie Radtke');
    await user.click(within(screen.getByRole('group', { name: 'Add Adult' })).getByRole('button', { name: 'Add Adult' }));
    expect(screen.getByRole('alert').textContent).toMatch(/Tick at least one skill/);
    expect(onSave).not.toHaveBeenCalled();
  });

  it('Leader_CannotAddWithoutPickingSomeone_AndIsToldWhy', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByRole('button', { name: '+ Add Adult' }));
    const panel = screen.getByRole('group', { name: 'Add Adult' });
    await user.click(within(panel).getByRole('checkbox', { name: 'Knots' }));
    await user.click(within(panel).getByRole('button', { name: 'Add Adult' }));
    expect(screen.getByRole('alert').textContent).toMatch(/Pick an adult/);
    expect(onSave).not.toHaveBeenCalled();
  });

  it('AddPanel_ClosesAfterASuccessfulAdd', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByRole('button', { name: '+ Add Adult' }));
    await pickCandidate(user, 'Rachel Ellerman');
    const panel = screen.getByRole('group', { name: 'Add Adult' });
    await user.click(within(panel).getByRole('checkbox', { name: 'Knots' }));
    await user.click(within(panel).getByRole('button', { name: 'Add Adult' }));
    await waitFor(() => expect(screen.queryByRole('group', { name: 'Add Adult' })).toBeNull());
  });
});

describe('Skill assignment editor — Delete', () => {
  it('Leader_CanDeleteAnAdult_WhichClearsEverySkill', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(within(row('Patrick Bieser')).getByRole('button', { name: 'Delete Patrick Bieser' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(sent()).toEqual({ person_id: '82', skill_ids: '[]' });
  });

  it('DeleteConfirm_NamesThePersonAndTheirSkills', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(within(row('Patrick Bieser')).getByRole('button', { name: 'Delete Patrick Bieser' }));
    const msg = vi.mocked(window.confirm).mock.calls[0]![0] as string;
    expect(msg).toMatch(/Patrick Bieser/);
    expect(msg).toMatch(/Knots, Map and compass/);
  });

  it('Leader_WhoCancelsTheConfirm_ChangesNothing', async () => {
    vi.mocked(window.confirm).mockReturnValue(false);
    const user = userEvent.setup();
    mount();
    await user.click(within(row('Patrick Bieser')).getByRole('button', { name: 'Delete Patrick Bieser' }));
    expect(onSave).not.toHaveBeenCalled();
  });
});

describe('Skill assignment editor — empty', () => {
  it('EmptyTable_PointsAtAdd', () => {
    mount([]);
    expect(screen.getByText(/No one yet/)).toBeTruthy();
  });
});

describe('Skill assignment editor — guards', () => {
  it('Leader_WhoUnticksEverySkillInEdit_IsAskedFirst_LikeDelete', async () => {
    vi.mocked(window.confirm).mockReturnValue(false);
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByRole('button', { name: 'Edit Patrick Bieser' }));
    await user.click(screen.getByRole('checkbox', { name: 'Knots' }));
    await user.click(screen.getByRole('checkbox', { name: 'Map and compass' }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(window.confirm).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
  });

  it('FailedAdd_KeepsThePanelOpen_AndSaysWhy', async () => {
    onSave.mockResolvedValueOnce({ ok: false, error: 'That person was merged into another record.' });
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByRole('button', { name: '+ Add Adult' }));
    await pickCandidate(user, 'Julie Radtke');
    const panel = screen.getByRole('group', { name: 'Add Adult' });
    await user.click(within(panel).getByRole('checkbox', { name: 'Knots' }));
    await user.click(within(panel).getByRole('button', { name: 'Add Adult' }));
    await waitFor(() => expect(screen.getByText(/merged into another record/)).toBeTruthy());
    expect(screen.getByRole('group', { name: 'Add Adult' })).toBeTruthy();
  });

  it('BlockedAdd_MovesFocusToThePersonPicker', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByRole('button', { name: '+ Add Adult' }));
    const panel = screen.getByRole('group', { name: 'Add Adult' });
    await user.click(within(panel).getByRole('checkbox', { name: 'Knots' }));
    await user.click(within(panel).getByRole('button', { name: 'Add Adult' }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('combobox', { name: 'Adult to add' })));
  });

  it('ScoutNoun_ReadsAScout', async () => {
    const user = userEvent.setup();
    render(<SkillAssignEditor people={[]} candidates={CANDIDATES} skills={SKILLS} keyField="person_id" noun="Scout" onSave={onSave} />);
    await user.click(screen.getByRole('button', { name: '+ Add Scout' }));
    await user.click(within(screen.getByRole('group', { name: 'Add Scout' })).getByRole('checkbox', { name: 'Knots' }));
    await user.click(within(screen.getByRole('group', { name: 'Add Scout' })).getByRole('button', { name: 'Add Scout' }));
    expect(screen.getByRole('alert').textContent).toMatch(/Pick a scout/);
  });

  it('OpeningAdd_WithAnUnsavedEdit_AsksBeforeDiscardingIt', async () => {
    vi.mocked(window.confirm).mockReturnValue(false);
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByRole('button', { name: 'Edit Patrick Bieser' }));
    await user.click(screen.getByRole('checkbox', { name: 'Cooking' }));
    await user.click(screen.getByRole('button', { name: '+ Add Adult' }));
    expect(window.confirm).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('group', { name: 'Add Adult' })).toBeNull();
  });
});
