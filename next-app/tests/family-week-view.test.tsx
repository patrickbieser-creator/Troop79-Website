import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import type { FamilyScout, FamilyWeek } from '../src/lib/family-week';
import { familyLede } from '../src/lib/family-week-shared';

/** The family page (Plans/Meeting-Planner-III-Family.md; prototypes/meeting-plan-III/Family.dc.html): three answers
 *  on every card, the plan with minutes, requests on the checklist, the 4-thing / 60-minute limit, the household tap,
 *  and the email's button arriving as ?a=. The write is injected; nothing is saved. */
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
    { key: 'second-class-6a', code: 'Second Class 6a', label: 'First aid for Second Class', on: true, min: 10 },
    { key: 'second-class-6c', code: 'Second Class 6c', label: 'Reduce injuries on campouts', on: true, min: 10 }
  ],
  helping: false,
  helpGroup: null,
  also: [],
  suggestions: [],
  requestable: [],
  ...o
});
const week = (scouts: FamilyScout[]): FamilyWeek => ({ entryId: 9, date: '2099-11-01', focus: ['First aid'], scouts });
const writer = () => vi.fn((...args: [number, unknown]) => Promise.resolve({ ok: true as const, args }).then(() => ({ ok: true as const })));
const ahead = { key: 'fr:first-class', label: 'Work ahead: First Class', sub: 'with the First Class group', min: 30 };
const badge = { key: 'fr:mb:first-aid', label: 'First Aid merit badge', sub: 'usually First Class and up', code: 'Merit badge', min: 45 };
const changing = (o: Partial<FamilyScout> = {}) => scout({ choice: 'change', intent: 'coming', ...o });

afterEach(() => {
  cleanup();
  replace.mockClear();
});

describe('one card, three answers', () => {
  it('Family_SeesThreeAnswers_OnEveryCardKind', () => {
    render(<FamilyWeekView week={week([scout({}), scout({ personId: 2, kind: 'done', items: [] }), scout({ personId: 3, kind: 'mb', items: [] })])} write={writer()} />);
    expect(new Set(screen.getAllByRole('radio').map((r) => r.querySelector('span span')?.textContent))).toEqual(new Set(['This plan looks good', 'Change my plan', 'Can’t make it this week']));
  });

  it('Family_NeverSeesComing_AnywhereOnThePage', () => {
    const { container } = render(<FamilyWeekView week={week([scout({}), scout({ personId: 2, choice: 'ok', intent: 'coming' })])} write={writer()} />);
    expect(container.textContent).not.toMatch(/coming/i);
  });

  it('Family_CardTitle_IsFirstNameOnly', () => {
    render(<FamilyWeekView week={week([scout({})])} write={writer()} />);
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Lily’s plan');
  });

  it('Family_GroupLine_ShowsTheGroupOnly', () => {
    render(<FamilyWeekView week={week([scout({})])} write={writer()} />);
    expect(screen.getByText('Second Class group')).toBeTruthy();
  });

  it('Family_PlanItem_ShowsCodeDashMinutes', () => {
    render(<FamilyWeekView week={week([scout({})])} write={writer()} />);
    expect(screen.getByText('Second Class 6a - 10 min')).toBeTruthy();
  });

  it('Family_LooksGood_SavesTheAnswer', async () => {
    const write = writer();
    render(<FamilyWeekView week={week([scout({})])} write={write} />);
    fireEvent.click(screen.getByRole('radio', { name: /This plan looks good/ }));
    await waitFor(() => expect(write).toHaveBeenCalledWith(1, { op: 'answer', choice: 'ok' }));
  });

  it('Family_LooksGood_ReadsPlanLooksGood', async () => {
    render(<FamilyWeekView week={week([scout({})])} write={writer()} />);
    fireEvent.click(screen.getByRole('radio', { name: /This plan looks good/ }));
    expect(await screen.findByText('✓ Plan looks good')).toBeTruthy();
  });

  it('Family_ChangeMyPlan_ReadsChangesSent', async () => {
    render(<FamilyWeekView week={week([scout({})])} write={writer()} />);
    fireEvent.click(screen.getByRole('radio', { name: /Change my plan/ }));
    expect(await screen.findByText('✓ Changes sent')).toBeTruthy();
  });

  it('Family_Untick_SendsTheChange', async () => {
    const write = writer();
    render(<FamilyWeekView week={week([scout({})])} write={write} />);
    fireEvent.click(screen.getByRole('radio', { name: /Change my plan/ }));
    fireEvent.click(await screen.findByRole('checkbox', { name: /First aid for Second Class/ }));
    await waitFor(() => expect(write).toHaveBeenCalledWith(1, { op: 'item', key: 'second-class-6a', on: false }));
  });

  it('Family_NotSureYet_ClearsTheAnswer', async () => {
    const write = writer();
    render(<FamilyWeekView week={week([scout({ choice: 'ok', intent: 'coming' })])} write={write} />);
    fireEvent.click(screen.getByRole('button', { name: 'Not sure yet? Clear Lily’s answer' }));
    await waitFor(() => expect(write).toHaveBeenCalledWith(1, { op: 'unsure' }));
  });

  it('Family_NoAnswerYet_HasNothingToClear', () => {
    render(<FamilyWeekView week={week([scout({})])} write={writer()} />);
    expect(screen.queryByRole('button', { name: /Not sure yet/ })).toBeNull();
  });

  it('Family_Unanswered_ReadsNeedsAnAnswer', () => {
    render(<FamilyWeekView week={week([scout({})])} write={writer()} />);
    expect(screen.getByText('Needs an answer')).toBeTruthy();
  });

  it('Family_OlderEmailsMeritBadgeAnswer_ReadsPlanLooksGood', () => {
    render(<FamilyWeekView week={week([scout({ kind: 'mb', choice: 'mb', intent: 'coming' })])} write={writer()} />);
    expect(screen.getByText('✓ Plan looks good')).toBeTruthy();
  });
});

describe('a leader viewing a family', () => {
  it('Leader_ReadOnlyView_SaysOnlyTheFamilyCanAnswer', () => {
    render(<FamilyWeekView week={week([scout({})])} write={writer()} readOnly />);
    expect(screen.getByText('Leader view: you can see this family’s answers. Only the family can change them.')).toBeTruthy();
  });
});

describe('a Merit badge group scout', () => {
  it('MeritBadgeScout_CanUntickTheirBadge', async () => {
    const write = writer();
    const items = [{ key: 'fr:mb:first-aid', code: 'Merit badge', label: 'First Aid merit badge', on: true, min: 45 }];
    render(<FamilyWeekView week={week([changing({ kind: 'mb', items })])} write={write} />);
    fireEvent.click(screen.getByRole('checkbox', { name: /First Aid merit badge/ }));
    await waitFor(() => expect(write).toHaveBeenCalledWith(1, { op: 'item', key: 'fr:mb:first-aid', on: false }));
  });
});

describe('requests', () => {
  it('Family_Request_SendsIt', async () => {
    const write = writer();
    render(<FamilyWeekView week={week([changing({ also: [ahead] })])} write={write} />);
    fireEvent.click(screen.getByRole('button', { name: /Work ahead: First Class/ }));
    await waitFor(() => expect(write).toHaveBeenCalledWith(1, { op: 'suggest', key: 'fr:first-class', on: true }));
  });

  it('Family_Request_JoinsChecklistWithRequestedTag', async () => {
    render(<FamilyWeekView week={week([changing({ also: [ahead] })])} write={writer()} />);
    fireEvent.click(screen.getByRole('button', { name: /Work ahead: First Class/ }));
    expect((await screen.findByRole('checkbox', { name: /Work ahead: First Class/ })).closest('label')?.textContent).toContain('Requested');
  });

  it('Family_UntickRequest_WithdrawsIt', async () => {
    const write = writer();
    render(<FamilyWeekView week={week([changing({ also: [ahead], suggestions: [ahead] })])} write={write} />);
    fireEvent.click(screen.getByRole('checkbox', { name: /Work ahead: First Class/ }));
    await waitFor(() => expect(write).toHaveBeenCalledWith(1, { op: 'suggest', key: 'fr:first-class', on: false }));
  });

  it('Family_MeritBadgeHelpTeach_WritesTheHelperRow', async () => {
    const write = writer();
    const help = { key: 'help', label: 'Help teach', sub: 'with the Tenderfoot group', min: 15 };
    render(<FamilyWeekView week={week([changing({ kind: 'mb', items: [], also: [help] })])} write={write} />);
    fireEvent.click(screen.getByRole('button', { name: /Help teach/ }));
    await waitFor(() => expect(write).toHaveBeenCalledWith(1, { op: 'help', on: true }));
  });

  it('Family_Request_ShowsInThePlanList', () => {
    render(<FamilyWeekView week={week([scout({ choice: 'ok', intent: 'coming', suggestions: [badge] })])} write={writer()} />);
    expect(screen.getByText('Merit badge - 45 min · usually First Class and up')).toBeTruthy();
  });
});

describe('the plan limit', () => {
  const four = [10, 10, 10, 10].map((min, i) => ({ key: `k${i}`, code: `Second Class ${i}`, label: `Item ${i}`, on: true, min }));

  it('Family_Counter_ShowsThingsAndMinutes', () => {
    render(<FamilyWeekView week={week([changing({})])} write={writer()} />);
    expect(screen.getByText('2 of 4 things · 20 of 60 min')).toBeTruthy();
  });

  it('Family_CannotRequest_WhenFourThings', () => {
    render(<FamilyWeekView week={week([changing({ items: four, also: [ahead] })])} write={writer()} />);
    expect((screen.getByRole('button', { name: /Work ahead: First Class/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('Family_FullPlan_SaysLimitReached', () => {
    render(<FamilyWeekView week={week([changing({ items: four, also: [ahead] })])} write={writer()} />);
    expect(screen.getByRole('button', { name: /Work ahead: First Class/ }).textContent).toContain('Limit reached');
  });

  it('Family_CannotRequest_WhenMinutesWouldPass60', () => {
    render(<FamilyWeekView week={week([changing({ also: [badge] })])} write={writer()} />);
    expect(screen.getByRole('button', { name: /First Aid merit badge/ }).textContent).toContain('Needs 45 min · 40 left');
  });

  it('Family_CannotReTick_PlannedItem_WhenFull', () => {
    const items = [...four, { key: 'k9', code: 'Second Class 9', label: 'Item 9', on: false, min: 10 }];
    render(<FamilyWeekView week={week([changing({ items })])} write={writer()} />);
    expect((screen.getByRole('checkbox', { name: /Item 9/ }) as HTMLInputElement).disabled).toBe(true);
  });

  it('Family_FullPlan_TurnsTheCounterYellow', () => {
    render(<FamilyWeekView week={week([changing({ items: four })])} write={writer()} />);
    expect(screen.getByText(/plan is full: 4 things is the most for one meeting/)).toBeTruthy();
  });
});

describe('household', () => {
  it('Household_AllLookGood_AnswersEveryCard', async () => {
    const write = writer();
    render(<FamilyWeekView week={week([scout({}), scout({ personId: 2, firstName: 'Simon' })])} write={write} />);
    fireEvent.click(screen.getByRole('button', { name: /All of these plans look good/ }));
    await waitFor(() => expect(write.mock.calls.map((c) => c[0])).toEqual([1, 2]));
  });

  it('Household_AllAnswered_SaysAllSet', () => {
    render(<FamilyWeekView week={week([scout({ choice: 'ok', intent: 'coming' }), scout({ personId: 2, firstName: 'Simon', choice: 'out', intent: 'not_coming' })])} write={writer()} />);
    expect(screen.getByRole('status').textContent).toContain('all set');
  });

  it('Lede_Family_NamesTheScouts', () => {
    expect(familyLede(['Lily', 'Simon'], false)).toBe('Here’s what’s planned for Lily and Simon Sunday. One tap per card tells us whether the plan works.');
  });

  it('Lede_ScoutForThemself_SaysYou', () => {
    expect(familyLede(['Finn'], true)).toBe('Here’s what’s planned for you Sunday. One tap tells us whether the plan works.');
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
