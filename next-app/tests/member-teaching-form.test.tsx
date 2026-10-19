import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { TeachingSkillOption } from '../src/lib/teaching-skills';

/** Members › What I can teach (Phase 0b): the house edit-form rules on a checklist, and the Junior Leader notes. */
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
const save = vi.fn(async (ids: string[]) => ({ ok: true as const, added: ids.filter((i) => i !== 'knots'), removed: [] as string[] }));
vi.mock('../src/app/(public)/member/teaching/actions', () => ({ saveMyTeachingSkillsAction: (ids: string[]) => save(ids) }));

const { TeachingForm } = await import('../src/app/(public)/member/teaching/teaching-form');
const opt = (id: string, name: string, over: Partial<TeachingSkillOption> = {}): TeachingSkillOption => ({
  id, name, youthTeachable: true, adultOnlyNote: null, held: false, finished: null, ...over
});

beforeEach(() => {
  save.mockClear();
});

describe('TeachingForm', () => {
  it('Save_IsGreyedSaved_UntilSomethingChanges', () => {
    render(<TeachingForm skills={[opt('knots', 'Knots & Lashings', { held: true })]} junior={false} readOnly={false} />);
    expect((screen.getByRole('button', { name: 'Saved' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('Adult_ChecksASkillAndSaves_SendsTheWholeSet', async () => {
    render(<TeachingForm skills={[opt('knots', 'Knots & Lashings', { held: true }), opt('cooking', 'Cooking')]} junior={false} readOnly={false} />);
    await userEvent.click(screen.getByRole('checkbox', { name: /Cooking/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(save).toHaveBeenCalledWith(['knots', 'cooking']);
  });

  it('Save_SaysWhatChanged', async () => {
    render(<TeachingForm skills={[opt('cooking', 'Cooking')]} junior={false} readOnly={false} />);
    await userEvent.click(screen.getByRole('checkbox', { name: /Cooking/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Saved: added Cooking.')).toBeTruthy();
  });

  it('Discard_ReturnsToTheSavedSet', async () => {
    render(<TeachingForm skills={[opt('cooking', 'Cooking')]} junior={false} readOnly={false} />);
    const box = screen.getByRole('checkbox', { name: /Cooking/ }) as HTMLInputElement;
    await userEvent.click(box);
    await userEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(box.checked).toBe(false);
  });

  it('Adult_AdultOnlySkill_ShowsItsReason', () => {
    render(<TeachingForm skills={[opt('first-aid', 'First Aid', { youthTeachable: false, adultOnlyNote: 'Adults only (troop rule)' })]} junior={false} readOnly={false} />);
    expect(screen.getByText('Adults only (troop rule)')).toBeTruthy();
  });

  it('JuniorLeader_SeesRequirementsFinished_PerSkill', () => {
    render(<TeachingForm skills={[opt('knots', 'Knots & Lashings', { finished: { done: 0, total: 6 } })]} junior readOnly={false} />);
    expect(screen.getByText('0 of 6 requirements finished. Finish one first to teach it in a meeting.')).toBeTruthy();
  });

  it('ProxyViewer_SeesTheListReadOnly', () => {
    render(<TeachingForm skills={[opt('knots', 'Knots & Lashings')]} junior={false} readOnly />);
    expect([(screen.getByRole('checkbox') as HTMLInputElement).disabled, screen.queryByRole('button', { name: /Save/ })]).toEqual([true, null]);
  });
});
