import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import type { FamilyScout, FamilyWeek } from '../src/lib/family-week';

/** Emails E2 (prototypes/meeting-plan-III/Family.dc.html): one tap per scout, the household tap, and the email's
 *  button arriving as ?a=. The write is injected; nothing is saved. */
const replace = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace, refresh: vi.fn() }), usePathname: () => '/i/plan/x' }));
const { FamilyWeekView } = await import('../src/app/(public)/member/meeting/family-week');

const scout = (o: Partial<FamilyScout>): FamilyScout => ({
  personId: 1,
  firstName: 'Lily',
  name: 'Lily Bloom',
  rankName: 'Tenderfoot',
  kind: 'rank',
  intent: null,
  choice: null,
  group: { key: 'fr:second-class', name: 'Second Class', teachers: ['Mr. V'] },
  items: [
    { key: 'second-class-6a', code: '6a', label: 'First aid for Second Class', on: true },
    { key: 'second-class-6c', code: '6c', label: 'Reduce injuries on campouts', on: true }
  ],
  helpGroup: null,
  also: [],
  suggestions: [],
  requestable: [],
  ...o
});
const week = (scouts: FamilyScout[]): FamilyWeek => ({ entryId: 9, date: '2099-11-01', focus: ['First aid'], scouts });
const writer = () => vi.fn((...args: [number, unknown]) => Promise.resolve({ ok: true as const, args }).then(() => ({ ok: true as const })));

afterEach(() => {
  cleanup();
  replace.mockClear();
});

describe('one tap per scout', () => {
  it('Family_LooksGood_SavesComingWithTheChoice', async () => {
    const write = writer();
    render(<FamilyWeekView week={week([scout({})])} write={write} />);
    fireEvent.click(screen.getByRole('radio', { name: /this plan looks good/ }));
    await waitFor(() => expect(write).toHaveBeenCalledWith(1, { op: 'answer', choice: 'ok' }));
  });

  it('Family_ChangeWithNoEdits_ReadsComing', async () => {
    render(<FamilyWeekView week={week([scout({})])} write={writer()} />);
    fireEvent.click(screen.getByRole('radio', { name: /but change the plan/ }));
    expect(await screen.findByText('✓ Coming')).toBeTruthy();
  });

  it('Family_Untick_SendsTheChange', async () => {
    const write = writer();
    render(<FamilyWeekView week={week([scout({})])} write={write} />);
    fireEvent.click(screen.getByRole('radio', { name: /but change the plan/ }));
    fireEvent.click(await screen.findByRole('checkbox', { name: /First aid for Second Class/ }));
    await waitFor(() => expect(write).toHaveBeenCalledWith(1, { op: 'item', key: 'second-class-6a', on: false }));
  });

  it('Family_ChangeSaved_ReadsChangesSent', async () => {
    render(<FamilyWeekView week={week([scout({})])} write={writer()} />);
    fireEvent.click(screen.getByRole('radio', { name: /but change the plan/ }));
    fireEvent.click(await screen.findByRole('checkbox', { name: /First aid for Second Class/ }));
    expect(await screen.findByText('Coming · changes sent')).toBeTruthy();
  });

  it('Family_NotSureYet_ClearsTheAnswer', async () => {
    const write = writer();
    render(<FamilyWeekView week={week([scout({ choice: 'ok', intent: 'coming' })])} write={write} />);
    fireEvent.click(screen.getByRole('button', { name: /Not sure yet/ }));
    await waitFor(() => expect(write).toHaveBeenCalledWith(1, { op: 'unsure' }));
    expect([screen.getByText('Not sure yet', { selector: 'span' }) != null, screen.getAllByRole('radio').some((r) => r.getAttribute('aria-checked') === 'true')]).toEqual([true, false]);
  });

  it('Family_NoAnswerYet_HasNothingToClear', () => {
    render(<FamilyWeekView week={week([scout({})])} write={writer()} />);
    expect(screen.queryByRole('button', { name: /Not sure yet/ })).toBeNull();
  });

  it('Family_Unanswered_ReadsNeedsAnAnswer', () => {
    render(<FamilyWeekView week={week([scout({})])} write={writer()} />);
    expect(screen.getByText('Needs an answer')).toBeTruthy();
  });

  it('Family_CannotAddASixthSuggestion_OnThePage', async () => {
    const write = writer();
    const five = ['a', 'b', 'c', 'd', 'e'].map((k) => ({ key: k, label: k, sub: '' }));
    render(<FamilyWeekView week={week([scout({ choice: 'change', intent: 'coming', suggestions: five, also: [{ key: 'fr:first-class', label: 'Work ahead: First Class', sub: '' }] })])} write={write} />);
    fireEvent.click(screen.getByRole('button', { name: /Work ahead: First Class/ }));
    expect(await screen.findByText('Suggest up to 5 things. Remove one first.')).toBeTruthy();
  });
});

describe('household', () => {
  it('Household_EveryoneComing_AnswersEveryCard', async () => {
    const write = writer();
    render(<FamilyWeekView week={week([scout({}), scout({ personId: 2, firstName: 'Simon' })])} write={write} />);
    fireEvent.click(screen.getByRole('button', { name: /Everyone’s coming/ }));
    await waitFor(() => expect(write.mock.calls.map((c) => c[0])).toEqual([1, 2]));
  });

  it('Household_AllAnswered_SaysAllSet', () => {
    render(<FamilyWeekView week={week([scout({ choice: 'ok', intent: 'coming' }), scout({ personId: 2, firstName: 'Simon', choice: 'out', intent: 'not_coming' })])} write={writer()} />);
    expect(screen.getByRole('status').textContent).toContain('all set');
  });
});

describe('the email button', () => {
  it('AnswerParam_Ok_AnswersUnansweredCards', async () => {
    const write = writer();
    render(<FamilyWeekView week={week([scout({}), scout({ personId: 2, firstName: 'Simon', choice: 'out', intent: 'not_coming' })])} write={write} initialAnswer="ok" />);
    await waitFor(() => expect(write.mock.calls).toEqual([[1, { op: 'answer', choice: 'ok' }]]));
  });

  it('AnswerParam_Out_NeedsAConfirmingTap', async () => {
    const write = writer();
    render(<FamilyWeekView week={week([scout({})])} write={write} initialAnswer="out" />);
    expect([await screen.findByText('Tap to confirm'), write.mock.calls.length]).toEqual([expect.anything(), 0]);
  });

  it('AnswerParam_Reload_DoesNotReapply', async () => {
    render(<FamilyWeekView week={week([scout({})])} write={writer()} initialAnswer="ok" />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/i/plan/x', { scroll: false }));
  });
});
