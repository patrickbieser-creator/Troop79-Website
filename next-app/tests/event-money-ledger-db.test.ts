import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { adminClient } from './helpers/admin-client';
import { createTestEvent, deleteTestEvent, TEST_PREFIX, type TestEvent } from './helpers/signup-fixtures';

/**
 * Event Money ledger + person panel, the data side (Plans/Event-Money-Ledger-Redesign.md,
 * 20270101140000_event_money_ledger): what one person owes (Tier / Custom with a reason / Not paying) with a history
 * row for every change, payments and refunds on a chosen date, voids with a reason, and the Money tab's per-person
 * history (who recorded it, by initials). Real local DB; request glue mocked as in the roster action tests.
 */
const actor = vi.hoisted(() => ({ value: { kind: 'identity', label: 'ZZ Vitest Treasurer', personId: null as number | null, capabilities: new Set(['finance.manage']) } }));
vi.mock('@/lib/require-capability', () => ({
  requireAnyOf: async () => actor.value,
  requireCapability: async () => actor.value
}));
vi.mock('@/lib/admin-actor', () => ({ resolveAdminActor: async () => actor.value }));
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: () => adminClient() }));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined, updateTag: () => undefined, revalidateTag: () => undefined }));

import {
  getEventMoneyAction,
  recordEventFeePaymentAction,
  refundEventFeeAction,
  setAmountOverrideAction,
  voidEventFeePaymentAction
} from '../src/app/admin/(workspace)/finance/actions';

const admin = adminClient();
let event: TestEvent;
let entryId: number;
let attendee: number;
let treasurer: number;

async function person(name: string, extra: Record<string, unknown> = {}): Promise<number> {
  const { data, error } = await admin.from('people').insert({ display_name: `${TEST_PREFIX} ${name}`, ...extra }).select('id').single();
  if (error || !data) throw new Error(`fixture person: ${error?.message}`);
  return data.id as number;
}

beforeEach(async () => {
  event = await createTestEvent(admin);
  attendee = await person('Edie Pasek');
  treasurer = await person('Kara Pitt', { first_name: 'Kara', last_name: 'Pitt' });
  actor.value = { ...actor.value, personId: treasurer };
  const { data: price } = await admin
    .from('event_prices')
    .insert({ event_signup_id: event.eventSignupId, label: 'Scout', amount: 25, per: 'event', applies_to: 'both' })
    .select('id')
    .single();
  const { data: entry, error } = await admin
    .from('signup_entries')
    .insert({ event_signup_id: event.eventSignupId, status: 'yes', person_kind: 'scout', person_id: attendee, price_id: price!.id })
    .select('id')
    .single();
  if (error || !entry) throw new Error(`fixture entry: ${error?.message}`);
  entryId = entry.id as number;
});

afterEach(async () => {
  await admin.from('financial_transactions').delete().eq('signup_entry_id', entryId);
  await deleteTestEvent(admin, event);
  await admin.from('leaders').delete().eq('code', 'ZQKP');
  await admin.from('people').delete().in('id', [attendee, treasurer]);
});

const entry = async () =>
  (await admin.from('signup_entries').select('amount_override, amount_override_reason').eq('id', entryId).single()).data;
const changes = async () =>
  (
    await admin
      .from('signup_entry_amount_changes')
      .select('old_amount, new_amount, old_mode, new_mode, reason, changed_by_person_id')
      .eq('signup_entry_id', entryId)
      .order('id')
  ).data ?? [];
const fees = async () =>
  (await admin.from('financial_transactions').select('id, occurred_on, amount, void_reason, voided_by_person_id').eq('signup_entry_id', entryId).order('id')).data ?? [];

describe('What one person owes', () => {
  it('Leader_SetsCustomAmount_WithReason', async () => {
    expect(await setAmountOverrideAction(entryId, 20, event.eventSignupId, 'Sibling discount')).toEqual({ ok: true });
    expect({ entry: await entry(), changes: await changes() }).toEqual({
      entry: { amount_override: 20, amount_override_reason: 'Sibling discount' },
      changes: [{ old_amount: 25, new_amount: 20, old_mode: 'tier', new_mode: 'custom', reason: 'Sibling discount', changed_by_person_id: treasurer }]
    });
  });

  it('Leader_ClearsOverride_WhenTierChosen_AndTheReasonGoesWithIt', async () => {
    await setAmountOverrideAction(entryId, 20, event.eventSignupId, 'Sibling discount');
    await setAmountOverrideAction(entryId, null, event.eventSignupId);
    expect({ entry: await entry(), last: (await changes()).at(-1) }).toEqual({
      entry: { amount_override: null, amount_override_reason: null },
      last: { old_amount: 20, new_amount: 25, old_mode: 'custom', new_mode: 'tier', reason: null, changed_by_person_id: treasurer }
    });
  });

  it('Leader_SetsNotPaying_OverrideZero', async () => {
    await setAmountOverrideAction(entryId, 0, event.eventSignupId);
    expect((await changes()).map((c) => [c.new_amount, c.new_mode])).toEqual([[0, 'none']]);
  });

  it('Leader_CustomAmount_ReasonIsOptional', async () => {
    expect(await setAmountOverrideAction(entryId, 20, event.eventSignupId)).toEqual({ ok: true });
    expect((await entry())?.amount_override_reason).toBeNull();
  });

  it('SavingTheSameAmountAgain_WritesNoSecondHistoryRow', async () => {
    await setAmountOverrideAction(entryId, 20, event.eventSignupId, 'x');
    await setAmountOverrideAction(entryId, 20, event.eventSignupId, 'x');
    expect((await changes()).length).toBe(1);
  });

  it('Leader_CannotSaveAmount_WhenNegative', async () => {
    expect(await setAmountOverrideAction(entryId, -5, event.eventSignupId)).toEqual({ ok: false, error: 'Amount must be zero or more.' });
  });
});

describe('Payments on a chosen date', () => {
  it('Leader_RecordsPayment_WithPastDate', async () => {
    await recordEventFeePaymentAction({ signupEntryId: entryId, amount: 15, method: 'venmo', occurredOn: '2026-11-01', signupId: event.eventSignupId });
    expect((await fees()).map((f) => [f.occurred_on, f.amount])).toEqual([['2026-11-01', 15]]);
  });

  it('Leader_CannotRecordPayment_InTheFuture', async () => {
    const res = await recordEventFeePaymentAction({ signupEntryId: entryId, amount: 15, method: 'venmo', occurredOn: '2999-01-01' });
    expect({ res, rows: (await fees()).length }).toEqual({ res: { ok: false, error: 'Pick a date that isn’t in the future.' }, rows: 0 });
  });

  it('Leader_CannotRecordPayment_OnAnImpossibleDate', async () => {
    const res = await recordEventFeePaymentAction({ signupEntryId: entryId, amount: 15, method: 'venmo', occurredOn: '2026-02-31' });
    expect(res).toEqual({ ok: false, error: 'Pick the date it was paid.' });
  });

  it('Leader_RecordsRefund_WithPastDate', async () => {
    await recordEventFeePaymentAction({ signupEntryId: entryId, amount: 25, method: 'venmo', occurredOn: '2026-11-01' });
    await refundEventFeeAction({ signupEntryId: entryId, amount: 25, method: 'venmo', occurredOn: '2026-11-05' });
    expect((await fees()).map((f) => [f.occurred_on, f.amount])).toEqual([['2026-11-01', 25], ['2026-11-05', -25]]);
  });
});

describe('Void with a reason', () => {
  it('Leader_VoidsPayment_WithReason', async () => {
    await recordEventFeePaymentAction({ signupEntryId: entryId, amount: 25, method: 'venmo' });
    const [{ id }] = await fees();
    expect(await voidEventFeePaymentAction(id, event.eventSignupId, 'Entered twice')).toEqual({ ok: true });
    expect((await fees()).map((f) => [f.void_reason, f.voided_by_person_id])).toEqual([['Entered twice', treasurer]]);
  });

  it('Leader_VoidsPayment_ReasonIsOptional', async () => {
    await recordEventFeePaymentAction({ signupEntryId: entryId, amount: 25, method: 'venmo' });
    const [{ id }] = await fees();
    await voidEventFeePaymentAction(id, event.eventSignupId);
    expect((await fees())[0].void_reason).toBeNull();
  });
});

describe('The Money tab’s history for one person', () => {
  it('History_NamesWhoRecordedAndVoided_ByTheirInitials', async () => {
    await admin.from('leaders').insert({ code: 'ZQKP', name: 'Kara Pitt', is_person: true, can_login: false, person_id: treasurer });
    await recordEventFeePaymentAction({ signupEntryId: entryId, amount: 25, method: 'venmo', occurredOn: '2026-11-10' });
    const [{ id }] = await fees();
    await voidEventFeePaymentAction(id, event.eventSignupId, 'Entered twice');
    const data = await getEventMoneyAction(event.eventSignupId);
    const t = data!.people[0].transactions[0];
    expect({ by: t.enteredBy, voidedBy: t.voidedBy, reason: t.voidReason }).toEqual({ by: 'ZQKP', voidedBy: 'ZQKP', reason: 'Entered twice' });
  });

  it('History_NamesSomeoneWithoutInitials_AsFirstNameAndLastInitial', async () => {
    await recordEventFeePaymentAction({ signupEntryId: entryId, amount: 25, method: 'venmo' });
    const data = await getEventMoneyAction(event.eventSignupId);
    expect(data!.people[0].transactions[0].enteredBy).toBe('Kara P.');
  });

  it('History_ListsAmountChanges_WithReasonAndWho', async () => {
    await setAmountOverrideAction(entryId, 20, event.eventSignupId, 'Sibling discount');
    const data = await getEventMoneyAction(event.eventSignupId);
    const p = data!.people[0];
    expect({ reason: p.amountOverrideReason, changes: p.amountChanges.map((c) => ({ ...c, changedAt: undefined })) }).toEqual({
      reason: 'Sibling discount',
      changes: [{ oldAmount: 25, newAmount: 20, oldMode: 'tier', newMode: 'custom', reason: 'Sibling discount', by: 'Kara P.', changedAt: undefined }]
    });
  });
});
