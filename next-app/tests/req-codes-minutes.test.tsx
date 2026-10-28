import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/**
 * Admin › Lookups › Req codes: the expected teaching time on every requirement (Plans/Matcher-Tune-Up.md T-3).
 * A requirement with sub-requirements shows the sum of its parts and is set on them, never on itself.
 */
const update = vi.hoisted(() => vi.fn());
vi.mock('../src/app/admin/(workspace)/advancement/lookups/actions', () => ({ updateReqCode: update }));

const { ReqCodesTable, ReqCodeForm } = await import('../src/app/admin/(workspace)/advancement/lookups/req-codes-table');
const { parseTeachMinutes } = await import('../src/lib/meeting-board-picklist');

const row = (o: Partial<Parameters<typeof ReqCodeForm>[0]['row']> = {}) => ({
  id: 1,
  source: 'rank' as const,
  parentId: 'tenderfoot',
  parentLabel: 'Tenderfoot',
  code: '3a',
  label: 'Knots',
  nestedUnder: null,
  officialText: '',
  minutes: 15,
  partsMinutes: null,
  classCodes: [] as string[],
  effectiveClasses: ['M'],
  ...o
});
const CLASSES = [
  { code: 'M', name: 'Troop meeting', description: '', sortOrder: 10, retired: false },
  { code: 'A', name: 'Aquatics', description: '', sortOrder: 40, retired: false },
  { code: 'Q', name: 'Old one', description: '', sortOrder: 90, retired: true }
];

beforeEach(() => update.mockReset());

describe('teaching minutes on requirements', () => {
  it('Leader_SeesEachRequirementsMinutes_AndAPartedOnesSum', () => {
    render(<ReqCodesTable classes={CLASSES} rows={[row(), row({ id: 2, code: '4a', label: 'First aid', partsMinutes: 40 })]} />);
    const cells = ['Knots', 'First aid'].map((l) => screen.getByText(l).closest('tr')!.querySelector('[data-col="minutes"]')!.textContent);
    expect(cells).toEqual(['15', '40 (its parts)']);
  });

  it('Leader_SetsARequirementsMinutes_AndSaves', async () => {
    update.mockResolvedValue({ ok: true });
    render(<ReqCodeForm row={row()} classes={CLASSES} onClose={vi.fn()} />);
    const box = screen.getByRole('spinbutton', { name: 'Minutes to teach' });
    await userEvent.clear(box);
    await userEvent.type(box, '10');
    await userEvent.click(screen.getByRole('button', { name: /Save/ }));
    expect((update.mock.calls[0][0] as FormData).get('teach_minutes')).toBe('10');
  });

  it('RequirementWithParts_HasNoMinutesBox_AndSaysWhere', () => {
    render(<ReqCodeForm row={row({ code: '4a', partsMinutes: 40 })} classes={CLASSES} onClose={vi.fn()} />);
    expect([screen.queryByRole('spinbutton', { name: 'Minutes to teach' }), screen.getByText(/set on its parts/i) != null]).toEqual([null, true]);
  });

  it('TeachMinutes_AcceptsOneToTwoFortyWholeMinutes', () => {
    expect(['15', '0', '241', '7.5', '', 'x'].map(parseTeachMinutes)).toEqual([15, null, null, null, null, null]);
  });
});

// Requirement classes (Plans/Requirement-Classification.md): tags say where a requirement can be done.
describe('class tags on requirements', () => {
  it('Leader_TicksClasses_AndSavesThem', async () => {
    update.mockResolvedValue({ ok: true });
    render(<ReqCodeForm row={row()} classes={CLASSES} onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole('checkbox', { name: 'A Aquatics' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'M Troop meeting' }));
    await userEvent.click(screen.getByRole('button', { name: /Save/ }));
    expect((update.mock.calls[0][0] as FormData).get('class_codes')).toBe('["M","A"]');
  });

  it('ClassCheckboxes_AreInAlphabeticalOrderByName', () => {
    render(<ReqCodeForm row={row()} classes={CLASSES} onClose={vi.fn()} />);
    expect(screen.getAllByRole('checkbox').map((c) => c.closest('label')!.textContent)).toEqual(['A Aquatics', 'M Troop meeting']);
  });

  it('RetiredClass_IsNotOffered_UnlessAlreadyTicked', () => {
    const { unmount } = render(<ReqCodeForm row={row()} classes={CLASSES} onClose={vi.fn()} />);
    const offered = screen.queryByRole('checkbox', { name: /Old one/ }) != null;
    unmount();
    render(<ReqCodeForm row={row({ classCodes: ['Q'] })} classes={CLASSES} onClose={vi.fn()} />);
    expect([offered, screen.getByRole('checkbox', { name: /Old one/ }) != null]).toEqual([false, true]);
  });

  it('ClassFilter_ShowsOnlyRequirementsWithThatTag', async () => {
    render(<ReqCodesTable classes={CLASSES} rows={[row(), row({ id: 2, code: '6a', label: 'Swim test', classCodes: ['A'], effectiveClasses: ['A'] })]} />);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Filter by class' }), 'A');
    expect([screen.queryByText('Knots'), screen.getByText('Swim test') != null]).toEqual([null, true]);
  });

  it('ClassFilter_Untagged_ShowsOnlyRequirementsWithNoTags', async () => {
    render(<ReqCodesTable classes={CLASSES} rows={[row(), row({ id: 2, code: '6a', label: 'Swim test', classCodes: ['A'], effectiveClasses: ['A'] })]} />);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Filter by class' }), 'Untagged (1)');
    expect([screen.getByText('Knots') != null, screen.queryByText('Swim test')]).toEqual([true, null]);
  });
});
