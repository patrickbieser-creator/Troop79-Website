import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { adminClient } from './helpers/admin-client';
import {
  createTestEvent,
  deleteTestEvent,
  createTestScout,
  deleteTestScout,
  type TestEvent,
  type TestScout
} from './helpers/signup-fixtures';

/**
 * Event Logistics Phase 0, money — ADDITIVE only (Plans/Event-Logistics.md §C).
 * The one-payment unique index is NOT dropped here; that happens in the same
 * deploy as the rewritten record/void actions (Phase 3, qa-lead critical #1).
 * What lands now: amount_override, financial_transactions.calendar_entry_id
 * (auto-filled from the entry), the signup_entry_balances view, and
 * event_milestones.
 */
const admin = adminClient();

let event: TestEvent;
let scout: TestScout;
let flatPriceId: number;
let perDayPriceId: number;

async function addEntry(row: Record<string, unknown>): Promise<number> {
  const { data, error } = await admin
    .from('signup_entries')
    .insert({ event_signup_id: event.eventSignupId, status: 'yes', person_kind: 'scout', person_id: scout.personId, ...row })
    .select('id')
    .single();
  if (error || !data) throw new Error(`entry insert failed: ${error?.message}`);
  return data.id as number;
}

async function balance(entryId: number) {
  const { data, error } = await admin
    .from('signup_entry_balances')
    .select('owed, paid, balance, settled, event_signup_id')
    .eq('entry_id', entryId)
    .single();
  if (error) throw new Error(error.message);
  return data as { owed: number; paid: number; balance: number; settled: boolean; event_signup_id: number };
}

beforeAll(async () => {
  event = await createTestEvent(admin);
  scout = await createTestScout(admin, 'Money');
  const { data: flat } = await admin
    .from('event_prices')
    .insert({ event_signup_id: event.eventSignupId, label: 'Scout', amount: 30, per: 'event', applies_to: 'both' })
    .select('id')
    .single();
  const { data: day } = await admin
    .from('event_prices')
    .insert({ event_signup_id: event.eventSignupId, label: 'Adult per day', amount: 40, per: 'day', applies_to: 'both' })
    .select('id')
    .single();
  flatPriceId = flat!.id;
  perDayPriceId = day!.id;
});

afterEach(async () => {
  await admin.from('financial_transactions').delete().eq('calendar_entry_id', event.calendarEntryId);
  await admin.from('financial_transactions').delete().eq('person_id', scout.personId);
  await admin.from('signup_entries').delete().eq('event_signup_id', event.eventSignupId);
  await admin.from('event_milestones').delete().eq('event_signup_id', event.eventSignupId);
});

afterAll(async () => {
  await deleteTestEvent(admin, event);
  await deleteTestScout(admin, scout);
});

describe('signup_entry_balances view', () => {
  it('SignupEntryBalance_UsesTierPrice_WhenNoOverride', async () => {
    const e = await addEntry({ price_id: flatPriceId });
    const b = await balance(e);
    expect(Number(b.owed)).toBe(30);
    expect(Number(b.paid)).toBe(0);
    expect(Number(b.balance)).toBe(30);
    expect(b.settled).toBe(false);
    expect(b.event_signup_id).toBe(event.eventSignupId);
  });

  it('SignupEntryBalance_UsesTierTimesDays_WhenPerDay', async () => {
    const e = await addEntry({ price_id: perDayPriceId, days: 3 });
    expect(Number((await balance(e)).owed)).toBe(120);
  });

  it('SignupEntryBalance_UsesOverride_WhenPresent', async () => {
    const e = await addEntry({ price_id: flatPriceId, amount_override: 22.5 });
    expect(Number((await balance(e)).owed)).toBe(22.5);
  });

  it('SignupEntryBalance_IsZero_ForAnEntryWithNoTier', async () => {
    const e = await addEntry({});
    const b = await balance(e);
    expect(Number(b.owed)).toBe(0);
    expect(b.settled).toBe(false); // nothing owed is not "paid"
  });

  it('SignupEntryBalance_CountsAPayment_AndExcludesVoidedRows', async () => {
    const e = await addEntry({ price_id: flatPriceId });
    const { data: tx, error } = await admin
      .from('financial_transactions')
      .insert({
        occurred_on: '2026-09-01',
        account: 'checking',
        amount: 30,
        kind: 'event_fee',
        method: 'venmo',
        person_id: scout.personId,
        signup_entry_id: e
      })
      .select('id')
      .single();
    expect(error).toBeNull();
    let b = await balance(e);
    expect(Number(b.paid)).toBe(30);
    expect(b.settled).toBe(true);
    await admin.from('financial_transactions').update({ voided_at: new Date().toISOString() }).eq('id', tx!.id);
    b = await balance(e);
    expect(Number(b.paid)).toBe(0);
    expect(b.settled).toBe(false);
  });

  it('AmountOverride_RejectsNegative', async () => {
    const { error } = await admin.from('signup_entries').insert({
      event_signup_id: event.eventSignupId,
      status: 'yes',
      person_kind: 'scout',
      person_id: scout.personId,
      amount_override: -1
    });
    expect(error).not.toBeNull();
  });
});

describe('financial_transactions.calendar_entry_id', () => {
  it('Transaction_GetsCalendarEntryId_FromItsSignupEntry', async () => {
    const e = await addEntry({ price_id: flatPriceId });
    const { data, error } = await admin
      .from('financial_transactions')
      .insert({
        occurred_on: '2026-09-01',
        account: 'checking',
        amount: 30,
        kind: 'event_fee',
        person_id: scout.personId,
        signup_entry_id: e
      })
      .select('calendar_entry_id')
      .single();
    expect(error).toBeNull();
    expect(data?.calendar_entry_id).toBe(event.calendarEntryId);
  });

  it('Transaction_KeepsExplicitCalendarEntryId_WithoutASignupEntry', async () => {
    const { data, error } = await admin
      .from('financial_transactions')
      .insert({
        occurred_on: '2026-09-02',
        account: 'checking',
        amount: -187,
        kind: 'expense',
        memo: 'Group site C',
        calendar_entry_id: event.calendarEntryId
      })
      .select('calendar_entry_id')
      .single();
    expect(error).toBeNull();
    expect(data?.calendar_entry_id).toBe(event.calendarEntryId);
  });
});

describe('event_milestones', () => {
  it('Milestone_RequiresAmount_WhenKindIsPayment', async () => {
    const { error } = await admin
      .from('event_milestones')
      .insert({ event_signup_id: event.eventSignupId, kind: 'payment', label: 'Deposit', due_on: '2026-01-25' });
    expect(error).not.toBeNull();
    const { error: ok } = await admin.from('event_milestones').insert({
      event_signup_id: event.eventSignupId,
      kind: 'payment',
      label: 'Deposit',
      due_on: '2026-01-25',
      amount: 300
    });
    expect(ok).toBeNull();
  });

  it('Milestone_AllowsNoAmount_ForRegistrationAndForms', async () => {
    const { error } = await admin.from('event_milestones').insert({
      event_signup_id: event.eventSignupId,
      kind: 'registration',
      label: 'Council registration',
      due_on: '2026-03-01'
    });
    expect(error).toBeNull();
  });

  it('AnonKey_CannotReadEventMilestones', async () => {
    await admin.from('event_milestones').insert({
      event_signup_id: event.eventSignupId,
      kind: 'other',
      label: 'Pack the trailer',
      due_on: '2026-09-10'
    });
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anonKey) throw new Error('anon key env missing — is .env.local present?');
    const anon = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data } = await anon.from('event_milestones').select('*');
    expect(data ?? []).toHaveLength(0);
    const { data: view } = await anon.from('signup_entry_balances').select('*');
    expect(view ?? []).toHaveLength(0);
  });
});
