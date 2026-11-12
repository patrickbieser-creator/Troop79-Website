import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { EventMoneyData, EventMoneyPerson } from '../src/app/admin/(workspace)/finance/actions';

/**
 * The event Money tab as "Ledger with a person panel" (Plans/Event-Money-Ledger-Redesign.md). The mock boundary is
 * the server action: assert what the screen sent and what it showed.
 */
const nav = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), search: '' }));
vi.mock('next/navigation', () => ({
  useRouter: () => nav,
  usePathname: () => '/admin/rosters/9/money',
  useSearchParams: () => new URLSearchParams(nav.search)
}));
const actions = vi.hoisted(() => ({
  recordEventFeePaymentAction: vi.fn<(...args: unknown[]) => Promise<{ ok: boolean; error?: string }>>(async () => ({ ok: true })),
  refundEventFeeAction: vi.fn<(...args: unknown[]) => Promise<{ ok: boolean; error?: string }>>(async () => ({ ok: true })),
  creditOverpaymentAction: vi.fn<(...args: unknown[]) => Promise<{ ok: boolean; error?: string }>>(async () => ({ ok: true })),
  setAmountOverrideAction: vi.fn<(...args: unknown[]) => Promise<{ ok: boolean; error?: string }>>(async () => ({ ok: true })),
  voidEventFeePaymentAction: vi.fn<(...args: unknown[]) => Promise<{ ok: boolean; error?: string }>>(async () => ({ ok: true })),
  addEventExpenseAction: vi.fn<(...args: unknown[]) => Promise<{ ok: boolean; error?: string }>>(async () => ({ ok: true })),
  getScoutAccountBalanceForEntryAction: vi.fn(async () => ({ personId: 1, balance: 50, scholarshipBalance: 100, family: [] }))
}));
vi.mock('../src/app/admin/(workspace)/finance/actions', () => actions);
vi.mock('../src/app/admin/(workspace)/events/actions', () => ({
  addMilestone: vi.fn(async () => ({ ok: true })),
  deleteMilestone: vi.fn(async () => ({ ok: true })),
  emailPaymentReminders: vi.fn(async () => ({ ok: true, to: [] }))
}));
vi.mock('../src/app/admin/(workspace)/finance/bucket-actions', () => ({
  createBucketAction: vi.fn(async () => ({ ok: true })),
  setEventBucketAction: vi.fn(async () => ({ ok: true }))
}));

import { MoneyPanel } from '../src/app/admin/(workspace)/rosters/[id]/money/money-panel';

function person(over: Partial<EventMoneyPerson> & { entryId: number; name: string }): EventMoneyPerson {
  return {
    personId: over.entryId + 100,
    isScout: true,
    status: 'yes',
    participation: 'full',
    tierLabel: 'Scout',
    tierAmount: 25,
    amountOverride: null,
    amountOverrideReason: null,
    owed: 25,
    paid: 0,
    balance: 25,
    settled: false,
    credited: 0,
    amountChanges: [],
    transactions: [],
    ...over
  };
}
const pay = (id: number, amount: number, method = 'venmo', over: Partial<EventMoneyPerson['transactions'][number]> = {}) => ({
  id,
  occurredOn: '2026-11-12',
  amount,
  kind: 'event_fee',
  method,
  memo: null,
  voidedAt: null,
  accountOf: null,
  accountPersonId: null,
  enteredBy: 'PB',
  voidedBy: null,
  voidReason: null,
  createdAt: '2026-11-12T15:00:00Z',
  ...over
});

function data(people: EventMoneyPerson[], extra: Partial<EventMoneyData> = {}): EventMoneyData {
  return { bucketId: null, people, expenses: [], reimbursements: [], milestones: [], ...extra };
}

const ADAM = person({ entryId: 1, name: 'Adam Gabbard', paid: 25, balance: 0, settled: true, transactions: [pay(11, 25)] });
const EDIE = person({ entryId: 2, name: 'Edie Pasek' });
const LEE = person({ entryId: 3, name: 'Lee Pasek', status: 'no', amountOverride: 0, owed: 0, balance: 0 });

function renderPanel(d = data([ADAM, EDIE, LEE])) {
  return render(<MoneyPanel signupId={9} calendarEntryId={4} data={d} buckets={[]} adults={[]} today="2026-11-12" />);
}
const panel = () => screen.getByRole('region', { name: /Gabbard|Pasek/ });

beforeEach(() => {
  vi.clearAllMocks();
  nav.search = '';
});

describe('Summary band', () => {
  it('Leader_SeesSummaryBand_WithIncomeOfExpected', () => {
    renderPanel();
    expect(within(screen.getByRole('region', { name: 'Money summary' })).getByText(/income, of/).textContent).toBe('$25 income, of $50 expected');
  });

  it('Leader_SeesFourPrimaryMethods_WhenOnlyVenmoUsed', () => {
    renderPanel();
    expect(screen.getByText(/By method/).textContent).toBe('By method: Venmo $25 · PayPal $0 · Cash $0 · Check $0');
  });

  it('Leader_SeesCostToTroop_WhenNetNegative', () => {
    renderPanel(
      data([EDIE], { expenses: [{ id: 5, occurredOn: '2026-11-01', amount: -40, kind: 'expense', method: 'bank', memo: 'Gym', personName: 'PB', voidedAt: null }] })
    );
    expect(screen.getByText('Cost to the troop').nextSibling?.textContent).toBe('$40');
  });
});

describe('Ledger', () => {
  it('Leader_SeesShortPaidOn_WhenPaid_AndBlankWhenNot', () => {
    renderPanel();
    const rows = screen.getAllByRole('row');
    expect([within(rows[1]).getByText('Nov 12, ’26').textContent, within(rows[2]).queryByText(/’26/)]).toEqual(['Nov 12, ’26', null]);
  });

  it('NotGoing_AndNotPaying_ShowAsSeparateFacts', () => {
    renderPanel();
    const lee = screen.getByRole('button', { name: 'Lee Pasek' }).closest('tr')!;
    expect([within(lee).getByText('Not going').textContent, within(lee).getByText('Not paying').textContent]).toEqual(['Not going', 'Not paying']);
  });

  it('Ledger_HasNoActionButtonsInRows', () => {
    renderPanel();
    const edie = screen.getByRole('button', { name: 'Edie Pasek' }).closest('tr')!;
    expect(within(edie).getAllByRole('button').map((b) => b.textContent)).toEqual(['Edie Pasek']);
  });
});

describe('Selecting a person', () => {
  it('ThePanel_OpensOnTheFirstPerson_ByDefault', () => {
    renderPanel();
    expect(screen.getByRole('heading', { level: 2, name: 'Adam Gabbard' })).toBeTruthy();
  });

  it('ThePanel_OpensOnThePersonInTheUrl', () => {
    nav.search = 'person=2';
    renderPanel();
    expect(screen.getByRole('heading', { level: 2, name: 'Edie Pasek' })).toBeTruthy();
  });

  it('Leader_OpensPersonPanel_WhenRowClicked', async () => {
    renderPanel();
    await userEvent.click(screen.getByRole('button', { name: 'Edie Pasek' }));
    expect(screen.getByRole('heading', { level: 2, name: 'Edie Pasek' })).toBeTruthy();
  });

  it('Leader_MovesSelection_WithArrowKeys', async () => {
    renderPanel();
    screen.getByRole('button', { name: 'Adam Gabbard' }).focus();
    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getByRole('heading', { level: 2, name: 'Edie Pasek' })).toBeTruthy();
  });

  it('Leader_ClosesThePanel_WithEsc', async () => {
    renderPanel();
    screen.getByRole('button', { name: 'Adam Gabbard' }).focus();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('heading', { level: 2, name: 'Adam Gabbard' })).toBeNull();
  });
});

describe('What one person owes', () => {
  it('Leader_SeesOwesTheTier_WithChangeAmount', () => {
    renderPanel();
    expect(within(panel()).getByText(/Owes the tier/).textContent).toBe('Owes the tier, $25');
  });

  it('Leader_SetsCustomAmount_WithReason', async () => {
    renderPanel();
    await userEvent.click(within(panel()).getByRole('button', { name: 'Change amount' }));
    await userEvent.click(within(panel()).getByRole('radio', { name: 'Custom' }));
    await userEvent.type(within(panel()).getByLabelText('Amount'), '20');
    await userEvent.type(within(panel()).getByLabelText('Reason (optional)'), 'Sibling discount');
    await userEvent.click(within(panel()).getByRole('button', { name: 'Save amount' }));
    expect(actions.setAmountOverrideAction).toHaveBeenCalledWith(1, 20, 9, 'Sibling discount');
  });

  it('Leader_ClearsOverride_WhenTierChosen', async () => {
    nav.search = 'person=2';
    renderPanel(data([person({ entryId: 2, name: 'Edie Pasek', amountOverride: 20, owed: 20, balance: 20, amountOverrideReason: 'x' })]));
    await userEvent.click(within(panel()).getByRole('radio', { name: 'Tier $25' }));
    await userEvent.click(within(panel()).getByRole('button', { name: 'Save amount' }));
    expect(actions.setAmountOverrideAction).toHaveBeenCalledWith(2, null, 9, null);
  });

  it('Leader_SetsNotPaying_OverrideZero', async () => {
    renderPanel();
    await userEvent.click(within(panel()).getByRole('button', { name: 'Change amount' }));
    await userEvent.click(within(panel()).getByRole('radio', { name: 'Not paying' }));
    await userEvent.click(within(panel()).getByRole('button', { name: 'Save amount' }));
    expect(actions.setAmountOverrideAction).toHaveBeenCalledWith(1, 0, 9, '');
  });

  it('Leader_CannotSaveAmount_WhenNegative', async () => {
    renderPanel();
    await userEvent.click(within(panel()).getByRole('button', { name: 'Change amount' }));
    await userEvent.click(within(panel()).getByRole('radio', { name: 'Custom' }));
    fireEvent.change(within(panel()).getByLabelText('Amount'), { target: { value: '-5' } });
    await userEvent.click(within(panel()).getByRole('button', { name: 'Save amount' }));
    expect({
      invalid: within(panel()).getByLabelText('Amount').getAttribute('aria-invalid'),
      said: within(panel()).getByRole('alert').textContent,
      sent: actions.setAmountOverrideAction.mock.calls.length
    }).toEqual({ invalid: 'true', said: 'Can’t save yet: Amount must be zero or more', sent: 0 });
  });

  it('ACustomZero_IsSavedAsNotPaying_AndReadsSaved', () => {
    // A saved override of 0 reloads as Not paying; the draft must not stay dirty.
    renderPanel(data([person({ entryId: 1, name: 'Adam Gabbard', amountOverride: 0, owed: 0, balance: 0 })]));
    expect(within(panel()).getByRole('button', { name: 'Saved' }).hasAttribute('disabled')).toBe(true);
  });

  it('Leader_SeesSavedDisabled_WhenAmountUnchanged', async () => {
    renderPanel();
    await userEvent.click(within(panel()).getByRole('button', { name: 'Change amount' }));
    expect(within(panel()).getByRole('button', { name: 'Saved' }).hasAttribute('disabled')).toBe(true);
  });
});

describe('Recording money from the panel', () => {
  it('Leader_RecordsPartPayment_AndSeesWhatWillStillBeDue', async () => {
    nav.search = 'person=2';
    renderPanel();
    const amount = within(panel()).getByLabelText('Amount');
    await userEvent.clear(amount);
    await userEvent.type(amount, '15');
    const notice = within(panel()).getByText('$10 will still be due').textContent;
    await userEvent.click(within(panel()).getByRole('button', { name: 'Record $15 Venmo payment' }));
    expect({ notice, call: actions.recordEventFeePaymentAction.mock.calls[0][0] }).toMatchObject({
      notice: '$10 will still be due',
      call: { signupEntryId: 2, amount: 15, method: 'venmo', occurredOn: '2026-11-12' }
    });
  });

  it('Leader_CannotRecordPayment_WithoutADate_AndTheFieldSaysWhy', async () => {
    nav.search = 'person=2';
    renderPanel();
    const date = within(panel()).getByLabelText('Paid on');
    await userEvent.clear(date);
    await userEvent.tab();
    await userEvent.click(within(panel()).getByRole('button', { name: 'Record $25 Venmo payment' }));
    expect({ said: within(panel()).getByRole('alert').textContent, sent: actions.recordEventFeePaymentAction.mock.calls.length }).toEqual({
      said: 'Can’t record yet: Pick the date it was paid',
      sent: 0
    });
  });

  it('Leader_RecordsPayPalPayment', async () => {
    nav.search = 'person=2';
    renderPanel();
    await userEvent.click(within(panel()).getByRole('radio', { name: 'PayPal' }));
    await userEvent.click(within(panel()).getByRole('button', { name: 'Record $25 PayPal payment' }));
    expect(actions.recordEventFeePaymentAction.mock.calls[0][0]).toMatchObject({ method: 'paypal', amount: 25 });
  });

  it('Leader_PaysFromScoutAccount_UnderOther', async () => {
    nav.search = 'person=2';
    renderPanel();
    await userEvent.click(within(panel()).getByRole('radio', { name: 'Other ▾' }));
    await userEvent.selectOptions(within(panel()).getByLabelText('Other method'), 'scout_account');
    expect(await within(panel()).findByText(/balance:/)).toBeTruthy();
  });

  it('Leader_Refunds_FromPanel', async () => {
    renderPanel();
    await userEvent.click(within(panel()).getByRole('button', { name: 'Refund' }));
    await userEvent.click(within(panel()).getByRole('button', { name: 'Record $25 refund' }));
    expect(actions.refundEventFeeAction.mock.calls[0][0]).toMatchObject({ signupEntryId: 1, amount: 25, method: 'venmo' });
  });

  it('Leader_CreditsOverpayment_FromPanel', async () => {
    renderPanel(data([person({ entryId: 1, name: 'Adam Gabbard', paid: 30, balance: -5, transactions: [pay(11, 30)] })]));
    await userEvent.click(within(panel()).getByRole('button', { name: 'Credit to account' }));
    await userEvent.click(within(panel()).getByRole('button', { name: 'Credit $5 to scout account' }));
    expect(actions.creditOverpaymentAction.mock.calls[0][0]).toMatchObject({ signupEntryId: 1, amount: 5 });
  });
});

describe('History', () => {
  it('History_SaysWhoRecordedEachPayment', () => {
    renderPanel();
    expect(within(panel()).getByText('Recorded by PB')).toBeTruthy();
  });

  it('Leader_VoidsPayment_WithReason', async () => {
    renderPanel();
    await userEvent.click(within(panel()).getByRole('button', { name: 'Void' }));
    const dialog = screen.getByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Reason (optional)'), 'Entered twice');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Void payment' }));
    expect(actions.voidEventFeePaymentAction).toHaveBeenCalledWith(11, 9, 'Entered twice');
  });

  it('VoidedEntry_ShowsWhoAndWhy', () => {
    renderPanel(
      data([person({ entryId: 1, name: 'Adam Gabbard', transactions: [pay(11, 25, 'venmo', { voidedAt: '2026-11-12T16:00:00Z', voidedBy: 'KPD', voidReason: 'Entered twice' })] })])
    );
    expect(within(panel()).getByText(/Voided by/).textContent).toBe('Voided by KPD: “Entered twice”');
  });

  it('AmountChange_ReadsOldToNew_WithReasonAndWho', () => {
    renderPanel(
      data([
        person({
          entryId: 1,
          name: 'Adam Gabbard',
          amountOverride: 20,
          owed: 20,
          balance: 20,
          amountChanges: [{ oldAmount: 25, newAmount: 20, oldMode: 'tier', newMode: 'custom', reason: 'Sibling discount', by: 'PB', changedAt: '2026-11-10T15:00:00Z' }]
        })
      ])
    );
    expect([within(panel()).getByText(/Amount changed/).textContent, within(panel()).getByText(/Tier → Custom/).textContent]).toEqual([
      'Amount changed $25 → $20',
      'Tier → Custom · “Sibling discount” · by PB'
    ]);
  });

  it('AReasonOnlyChange_ReadsAsAReasonChange', () => {
    renderPanel(
      data([
        person({
          entryId: 1,
          name: 'Adam Gabbard',
          amountOverride: 20,
          owed: 20,
          balance: 20,
          amountChanges: [{ oldAmount: 20, newAmount: 20, oldMode: 'custom', newMode: 'custom', reason: 'Scholarship', by: 'PB', changedAt: '2026-11-10T15:00:00Z' }]
        })
      ])
    );
    expect(within(panel()).getByText(/Reason changed/).textContent).toBe('Reason changed ($20)');
  });

  it('History_EmptyState', () => {
    nav.search = 'person=2';
    renderPanel();
    expect(within(panel()).getByText('No payments yet.')).toBeTruthy();
  });
});
