import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/** Admin › Lookups › Requirement classes (Plans/Requirement-Classification.md step 2). */
const acts = vi.hoisted(() => ({
  createRequirementClass: vi.fn(),
  updateRequirementClass: vi.fn(),
  setRequirementClassRetired: vi.fn(),
  deleteRequirementClass: vi.fn()
}));
vi.mock('../src/app/admin/(workspace)/advancement/lookups/requirement-class-actions', () => acts);

const { RequirementClassesEditor } = await import('../src/app/admin/(workspace)/advancement/lookups/requirement-classes-editor');

const ROWS = [
  { code: 'M', name: 'Troop meeting', description: 'A 90-minute meeting', sortOrder: 10, retired: false, usedBy: 0 },
  { code: 'A', name: 'Aquatics', description: 'Water', sortOrder: 40, retired: false, usedBy: 7 }
];
const menuFor = (code: string) => screen.getByRole('combobox', { name: `Actions for class ${code}` });
const option = (code: string, label: RegExp) =>
  [...menuFor(code).querySelectorAll('option')].find((o) => label.test(o.textContent ?? '')) as HTMLOptionElement;

beforeEach(() => Object.values(acts).forEach((f) => f.mockReset().mockResolvedValue({ ok: true })));

describe('Requirement classes card', () => {
  it('Leader_SeesEachClass_WithHowManyRequirementsUseIt', () => {
    render(<RequirementClassesEditor rows={ROWS} />);
    expect(screen.getByText('Aquatics').closest('tr')!.textContent).toContain('7');
  });

  it('UsedClass_CannotBeDeleted_AndTheMenuSaysRetireInstead', () => {
    render(<RequirementClassesEditor rows={ROWS} />);
    expect([option('A', /Delete/).disabled, option('A', /Delete/).textContent]).toEqual([true, 'Delete (in use: retire instead)']);
  });

  it('Leader_RetiresAClass_FromItsMenu', async () => {
    render(<RequirementClassesEditor rows={ROWS} />);
    await userEvent.selectOptions(menuFor('A'), 'retire');
    expect((acts.setRequirementClassRetired.mock.calls[0][0] as FormData).get('retired')).toBe('true');
  });

  it('Leader_AddsAClass_WithItsLetterNameAndDescription', async () => {
    render(<RequirementClassesEditor rows={ROWS} />);
    await userEvent.click(screen.getByRole('button', { name: '+ Add Class' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Code (one letter)' }), 'k');
    await userEvent.type(screen.getByRole('textbox', { name: 'Name' }), 'Kitchen');
    await userEvent.click(screen.getByRole('button', { name: 'Add Class' }));
    const sent = acts.createRequirementClass.mock.calls[0][0] as FormData;
    expect([sent.get('code'), sent.get('name')]).toEqual(['K', 'Kitchen']);
  });
});
