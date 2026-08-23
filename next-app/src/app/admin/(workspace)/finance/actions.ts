'use server';

import { feeAmount, isNotionalAccount, money, uncreditedOverpayment, type PayMethod } from '@/lib/event-money';

/**
 * Troop Finances — read + write actions (Plans/Troop-Finances.md).
 *
 * Read actions (Phase 1) are reachable by finance.manage OR finance.view.
 * Write actions (Phase 2, below the READ / WRITE split) require
 * finance.manage outright — see requireCapability calls on each.
 */

import { revalidatePath } from 'next/cache';
import { requireAnyOf } from '@/lib/require-capability';
import { requireCapability } from '@/lib/require-capability';
import { createAdminClient } from '@/lib/supabase/server';
import { fetchAllRows } from '@/lib/supabase/paginate';
import { signedReceiptMediaUrl } from '@/lib/receipt-media';
import {
  FINANCE_PAGE_SIZE,
  computeBalance,
  computeScoutAccountBalances,
  ledgerToCsv,
  editTransactionGuard,
  validateActivityRename,
  amountRangeOrFilter,
  buildRunningFunds,
  runningFundsAsOf,
  TOTAL_FUNDS_ACCOUNTS,
  type Account,
  type TransactionKind,
  type TransactionKindRow,
  type TransactionMethod,
  type FinancialTransactionRow,
  type LedgerCsvRow,
  type RunningFundsInputRow
} from '@/lib/finance';

interface Result {
  ok: boolean;
  error?: string;
}

function revalidateFinance() {
  revalidatePath('/admin/finance');
}

export type LedgerSortKey = 'date' | 'account' | 'kind' | 'amount';

const SORT_TO_COLUMN: Record<LedgerSortKey, string> = {
  date: 'occurred_on',
  account: 'account',
  kind: 'kind',
  amount: 'amount'
};

export interface LedgerFilters {
  account?: Account;
  kind?: string;
  personId?: number;
  /** Case-insensitive substring match against activity_label — "contains",
   *  not "equals", so "camp" finds every camping-related activity without
   *  needing the exact full label (which drift makes hard to type anyway). */
  activityLabel?: string;
  /** occurred_on range, both inclusive, both optional, YYYY-MM-DD. */
  dateFrom?: string;
  dateTo?: string;
  /**
   * Amount range by MAGNITUDE, not signed value — "between $50 and $200"
   * means a $75 expense or a $75 payment both match, not just one side of
   * zero. A treasurer searching for a specific dollar figure shouldn't have
   * to think about Direction to find it. Both optional, both non-negative.
   */
  amountMin?: number;
  amountMax?: number;
  sort?: LedgerSortKey;
  dir?: 'asc' | 'desc';
  page: number;
}

export interface LedgerRow {
  id: number;
  occurred_on: string;
  account: Account;
  amount: number;
  kind: string;
  method: string | null;
  person_id: number | null;
  personName: string | null;
  memo: string | null;
  activity_label: string | null;
  voided_at: string | null;
  /** Who entered this row and when (surfaced 2026-08-19). Both null for
   *  every historical import row — the import script never stamped an
   *  actor, and that's correct, not a gap: "existing entries that are
   *  blank are fine" (Patrick). */
  entered_by_person_id: number | null;
  enteredByName: string | null;
  created_at: string;
  /** Total funds (checking + savings) as they stood right after this row,
   *  chronologically — derived from the FULL history, not the display page
   *  (2026-08-21). A scout_account/scholarship row reads the funds at that
   *  moment; it doesn't move them. */
  runningFunds: number;
}

/** One page of transactions, newest first. This is a DISPLAY page (`.range()`
 *  for the current 50-row slice) — never use this to compute a balance; use
 *  the balance actions below, which pull the FULL history via fetchAllRows(). */
export async function listFinancialTransactionsAction(
  filters: LedgerFilters
): Promise<{ rows: LedgerRow[]; total: number }> {
  await requireAnyOf(['finance.manage', 'finance.view']);
  const supabase = createAdminClient();

  let q = supabase
    .from('financial_transactions')
    .select(
      'id, occurred_on, account, amount, kind, method, person_id, memo, activity_label, voided_at, entered_by_person_id, created_at',
      { count: 'exact' }
    );
  if (filters.account) q = q.eq('account', filters.account);
  if (filters.kind) q = q.eq('kind', filters.kind);
  if (filters.personId) q = q.eq('person_id', filters.personId);
  if (filters.activityLabel) q = q.ilike('activity_label', `%${filters.activityLabel}%`);
  if (filters.dateFrom) q = q.gte('occurred_on', filters.dateFrom);
  if (filters.dateTo) q = q.lte('occurred_on', filters.dateTo);
  if (filters.amountMin != null || filters.amountMax != null) {
    const min = filters.amountMin ?? 0;
    const max = filters.amountMax ?? null;
    const orFilter = amountRangeOrFilter(min, max);
    if (orFilter) q = q.or(orFilter);
    else if (max != null) q = q.gte('amount', -max).lte('amount', max);
  }

  const sortColumn = SORT_TO_COLUMN[filters.sort ?? 'date'];
  const ascending = filters.dir === 'asc';
  q = q.order(sortColumn, { ascending }).order('id', { ascending });

  const from = (filters.page - 1) * FINANCE_PAGE_SIZE;
  const { data, count, error } = await q.range(from, from + FINANCE_PAGE_SIZE - 1);
  if (error) throw new Error(`listFinancialTransactionsAction failed: ${error.message}`);

  const rawRows = (data ?? []) as Omit<LedgerRow, 'personName' | 'enteredByName' | 'runningFunds'>[];
  const personIds = [
    ...new Set(
      rawRows.flatMap((r) => [r.person_id, r.entered_by_person_id]).filter((id): id is number => id != null)
    )
  ];
  // Running Total Funds needs the FULL checking+savings history (the
  // display page alone can't know what came before it) — fetchAllRows, same
  // as the balance actions; never `.range()`-capped. Names and history are
  // independent lookups, so they run together.
  const [nameMap, fundsHistory] = await Promise.all([
    loadNames(supabase, personIds),
    fetchAllRows<RunningFundsInputRow>((from, to) =>
      supabase
        .from('financial_transactions')
        .select('id, occurred_on, account, amount, voided_at')
        .in('account', [...TOTAL_FUNDS_ACCOUNTS])
        .order('occurred_on', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to)
    )
  ]);
  const fundsSeries = buildRunningFunds(fundsHistory);

  const rows: LedgerRow[] = rawRows.map((r) => ({
    ...r,
    personName: r.person_id != null ? (nameMap.get(r.person_id) ?? `#${r.person_id}`) : null,
    enteredByName:
      r.entered_by_person_id != null ? (nameMap.get(r.entered_by_person_id) ?? `#${r.entered_by_person_id}`) : null,
    runningFunds: runningFundsAsOf(fundsSeries, r)
  }));

  return { rows, total: count ?? 0 };
}

export interface AccountBalances {
  checking: number;
  savings: number;
  scholarship: number;
  sofi: number;
}

/** Derived from the FULL transaction history — never a stored balance
 *  column, and never just the current display page. */
export async function getAccountBalancesAction(): Promise<AccountBalances> {
  await requireAnyOf(['finance.manage', 'finance.view']);
  const supabase = createAdminClient();
  const rows = await fetchAllRows<FinancialTransactionRow>((from, to) =>
    supabase
      .from('financial_transactions')
      .select('account, amount, person_id, voided_at')
      .in('account', ['checking', 'savings', 'scholarship', 'sofi'])
      .range(from, to)
  );
  return {
    checking: computeBalance(rows, { account: 'checking' }),
    savings: computeBalance(rows, { account: 'savings' }),
    scholarship: computeBalance(rows, { account: 'scholarship' }),
    sofi: computeBalance(rows, { account: 'sofi' })
  };
}

export interface ScoutBalanceRow {
  personId: number;
  personName: string;
  balance: number;
}

export async function getScoutAccountBalancesAction(): Promise<ScoutBalanceRow[]> {
  await requireAnyOf(['finance.manage', 'finance.view']);
  const supabase = createAdminClient();
  const rows = await fetchAllRows<FinancialTransactionRow>((from, to) =>
    supabase
      .from('financial_transactions')
      .select('account, amount, person_id, voided_at')
      .eq('account', 'scout_account')
      .range(from, to)
  );
  const balances = computeScoutAccountBalances(rows);
  const personIds = [...balances.keys()];
  if (personIds.length === 0) return [];

  const nameMap = await loadNames(supabase, personIds);

  return personIds
    .map((personId) => ({
      personId,
      personName: nameMap.get(personId) ?? `#${personId}`,
      balance: balances.get(personId) ?? 0
    }))
    .sort((a, b) => a.personName.localeCompare(b.personName));
}

async function loadNames(
  supabase: ReturnType<typeof createAdminClient>,
  personIds: number[]
): Promise<Map<number, string>> {
  const nameMap = new Map<number, string>();
  if (personIds.length === 0) return nameMap;
  const { data } = await supabase.from('people').select('id, display_name').in('id', personIds);
  for (const p of (data ?? []) as { id: number; display_name: string }[]) {
    nameMap.set(p.id, p.display_name);
  }
  return nameMap;
}

// ═══════════════════════════════════════════════════════════════════════
// WRITE actions (Phase 2) — every one below requires finance.manage
// outright, not finance.view. See lib/require-capability.ts.
// ═══════════════════════════════════════════════════════════════════════

export interface AddTransactionInput {
  occurredOn: string; // YYYY-MM-DD
  account: Account;
  amount: number; // signed
  kind: TransactionKind;
  method: TransactionMethod | null;
  personId: number | null; // required when account === 'scout_account'
  memo: string | null;
  activityLabel: string | null;
}

/** General single-leg transaction entry — the workhorse of the treasurer
 *  workspace. For a checking<->savings transfer or a scout-account deposit
 *  that also touches the real bank balance, use addTransferAction instead
 *  (it writes the paired legs atomically-in-intent via a shared
 *  transfer_group, which this function deliberately does not do). */
export async function addTransactionAction(input: AddTransactionInput): Promise<Result> {
  const actor = await requireCapability('finance.manage');
  if (input.amount === 0) return { ok: false, error: 'Amount cannot be zero.' };
  if (input.account === 'scout_account' && input.personId == null) {
    return { ok: false, error: 'A scout account transaction needs a person.' };
  }

  const supabase = createAdminClient();
  const { error } = await supabase.from('financial_transactions').insert({
    occurred_on: input.occurredOn,
    account: input.account,
    amount: input.amount,
    kind: input.kind,
    method: input.method,
    person_id: input.account === 'scout_account' ? input.personId : (input.personId ?? null),
    memo: input.memo,
    activity_label: input.activityLabel,
    source: 'app',
    entered_by_person_id: actor.personId
  });
  if (error) return { ok: false, error: error.message };

  revalidateFinance();
  return { ok: true };
}

/** Void, don't delete — the audit trail survives every treasurer
 *  correction. Balance queries already filter on voided_at is null. */
export async function voidTransactionAction(id: number): Promise<Result> {
  const actor = await requireCapability('finance.manage');
  const supabase = createAdminClient();
  const { error } = await supabase
    .from('financial_transactions')
    .update({ voided_at: new Date().toISOString(), voided_by_person_id: actor.personId })
    .eq('id', id)
    .is('voided_at', null);
  if (error) return { ok: false, error: error.message };

  revalidateFinance();
  return { ok: true };
}

export interface EditTransactionInput {
  id: number;
  occurredOn: string;
  account: Account;
  amount: number;
  kind: TransactionKind;
  method: TransactionMethod | null;
  personId: number | null;
  memo: string | null;
  activityLabel: string | null;
}

/** In-place correction — typos happen (Patrick, 2026-08-18). Deliberately
 *  distinct from void: void is for a transaction that shouldn't have
 *  existed at all; edit is for one that did happen but got keyed in wrong. */
export async function editTransactionAction(input: EditTransactionInput): Promise<Result> {
  await requireCapability('finance.manage');
  if (input.amount === 0) return { ok: false, error: 'Amount cannot be zero.' };
  if (input.account === 'scout_account' && input.personId == null) {
    return { ok: false, error: 'A scout account transaction needs a person.' };
  }

  const supabase = createAdminClient();
  const { data: existing, error: findError } = await supabase
    .from('financial_transactions')
    .select('id, voided_at, signup_entry_id, reimbursement_id')
    .eq('id', input.id)
    .maybeSingle();
  if (findError) return { ok: false, error: findError.message };
  const guardError = editTransactionGuard(existing);
  if (guardError) return { ok: false, error: guardError };

  const { error } = await supabase
    .from('financial_transactions')
    .update({
      occurred_on: input.occurredOn,
      account: input.account,
      amount: input.amount,
      kind: input.kind,
      method: input.method,
      person_id: input.account === 'scout_account' ? input.personId : (input.personId ?? null),
      memo: input.memo,
      activity_label: input.activityLabel,
      updated_at: new Date().toISOString()
    })
    .eq('id', input.id);
  if (error) return { ok: false, error: error.message };

  revalidateFinance();
  return { ok: true };
}

export interface BulkReassignResult extends Result {
  updated: number;
}

export interface BulkReassignUpdates {
  kind?: TransactionKind;
  /** Undefined = leave activity_label alone. A real string = set it —
   *  there is no bulk "clear" here; that's the one case still left to a
   *  single-row edit, since blanking a batch of activities at once has no
   *  legitimate everyday use the way reassigning one does. */
  activityLabel?: string;
}

/**
 * Reassign Kind and/or Activity on a batch of transactions at once — a pure
 * label change, unlike editTransactionAction (which also touches
 * amount/account and so carries the signup/reimbursement guard). Neither
 * field can affect the balance (Kind carries no direction, 2026-08-20;
 * Activity never did), so no guard beyond capability + valid values is
 * needed.
 *
 * Built for the 'income'/'expense' Kind retirement (Patrick, 2026-08-20):
 * filter the ledger to Kind=income or Kind=expense, select a page's worth,
 * reassign to a real category, repeat until both are empty — then those two
 * values can be deleted from transaction_kinds for good (deleteTransactionKindAction,
 * below). Activity rides along in the
 * same bar for the same workflow: fixing several mis-tagged/blank-activity
 * rows found while doing that pass, without leaving this tool and using the
 * separate global Rename/Merge Activity tool (which renames EVERY row under
 * a label, not just the ones selected here).
 */
export async function bulkReassignAction(ids: number[], updates: BulkReassignUpdates): Promise<BulkReassignResult> {
  try {
    await requireCapability('finance.manage');
  } catch {
    return { ok: false, error: 'Not authenticated', updated: 0 };
  }
  if (!Array.isArray(ids) || ids.length === 0) return { ok: false, error: 'Nothing selected.', updated: 0 };
  if (updates.kind == null && updates.activityLabel == null) {
    return { ok: false, error: 'Pick a Kind and/or an Activity to apply.', updated: 0 };
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (updates.kind != null) patch.kind = updates.kind;
  if (updates.activityLabel != null) {
    const trimmed = updates.activityLabel.trim();
    if (!trimmed) return { ok: false, error: 'Activity cannot be blank.', updated: 0 };
    patch.activity_label = trimmed;
  }

  const supabase = createAdminClient();
  const { error, count } = await supabase
    .from('financial_transactions')
    .update(patch, { count: 'exact' })
    .in('id', ids);
  if (error) {
    // 23503 = FK violation — transaction_kinds no longer has the code
    // typed in, which happens if it was deleted from another tab mid-edit.
    return {
      ok: false,
      error: error.code === '23503' ? 'Not a real Kind — it may have just been removed.' : error.message,
      updated: 0
    };
  }

  revalidateFinance();
  return { ok: true, updated: count ?? ids.length };
}

export interface AddTransferInput {
  occurredOn: string;
  fromAccount: 'checking' | 'savings';
  toAccount: 'checking' | 'savings';
  amount: number; // positive; the two legs get +amount / -amount
  memo: string | null;
}

/** Both legs of a real transfer, sharing one transfer_group so they always
 *  read as a pair rather than two unrelated rows. */
export async function addTransferAction(input: AddTransferInput): Promise<Result> {
  const actor = await requireCapability('finance.manage');
  if (input.amount <= 0) return { ok: false, error: 'Transfer amount must be positive.' };
  if (input.fromAccount === input.toAccount) return { ok: false, error: 'Pick two different accounts.' };

  const supabase = createAdminClient();
  const transferGroup = crypto.randomUUID();
  const base = {
    occurred_on: input.occurredOn,
    kind: 'transfer' as const,
    method: 'bank' as const,
    memo: input.memo,
    source: 'app' as const,
    entered_by_person_id: actor.personId,
    transfer_group: transferGroup
  };
  const { error } = await supabase.from('financial_transactions').insert([
    { ...base, account: input.fromAccount, amount: -Math.abs(input.amount) },
    { ...base, account: input.toAccount, amount: Math.abs(input.amount) }
  ]);
  if (error) return { ok: false, error: error.message };

  revalidateFinance();
  return { ok: true };
}

export interface RecordEventFeePaymentInput {
  signupEntryId: number;
  amount: number;
  /** Ledger methods plus 'scholarship' (the scholarship fund pays: account
   *  'scholarship', method 'other'). */
  method: PayMethod;
  /** For revalidating the roster/Money pages this payment was recorded from. */
  signupId?: number;
  /** Defaults to today. */
  occurredOn?: string;
  memo?: string | null;
  /** Client-minted; a retried click with the same key is a no-op. */
  idempotencyKey?: string;
}

/** Resolve the event (calendar entry id + title) behind a signup entry, so a
 *  money row can carry calendar_entry_id AND the activity label the Activity
 *  Report groups by. Plans/Event-Logistics.md §C: activity_label stays free
 *  text — for linked rows it is simply the event title. */
async function eventForSignupEntry(
  supabase: ReturnType<typeof createAdminClient>,
  signupEntryId: number
): Promise<{ entry: { id: number; person_id: number | null; event_signup_id: number }; calendarEntryId: number | null; title: string | null } | null> {
  const { data: entry } = await supabase
    .from('signup_entries')
    .select('id, person_id, event_signup_id')
    .eq('id', signupEntryId)
    .maybeSingle();
  if (!entry) return null;
  const e = entry as { id: number; person_id: number | null; event_signup_id: number };
  const { data: sig } = await supabase
    .from('event_signups')
    .select('calendar_entry_id, calendar_entries!inner(title)')
    .eq('id', e.event_signup_id)
    .maybeSingle();
  const s = sig as unknown as { calendar_entry_id: number; calendar_entries: { title: string } } | null;
  return { entry: e, calendarEntryId: s?.calendar_entry_id ?? null, title: s?.calendar_entries?.title ?? null };
}

function revalidateEventMoney(signupId?: number) {
  revalidateFinance();
  if (signupId) {
    revalidatePath(`/admin/rosters/${signupId}`);
    revalidatePath(`/admin/rosters/${signupId}/money`);
  }
}

/** The event-fee integration point (Plans/Troop-Finances.md, revised by
 *  Plans/Event-Logistics.md §C, 2026-08-22): writes ONE transaction linked to
 *  the signup entry. Many per entry are allowed — installments, split methods —
 *  and the entry's paid/balance is DERIVED from them (signup_entry_balances),
 *  never flagged. `owed` stays derived from event_prices (or the per-entry
 *  override); this never copies that amount into a stored "charge" row.
 *  A retried click carries the same idempotency key and is a no-op. */
export async function recordEventFeePaymentAction(input: RecordEventFeePaymentInput): Promise<Result> {
  // calendar.write OR finance.manage — "whoever can already mark payment_received
  // today keeps that power" (Plans/Troop-Finances.md's original design intent
  // for this integration point). Restored 2026-08-18 after qa-lead flagged that
  // an earlier pass had narrowed this to finance.manage-only, which would have
  // locked ordinary event leaders out of a checkbox they already used.
  const actor = await requireAnyOf(['calendar.write', 'finance.manage']);
  if (!(input.amount > 0)) return { ok: false, error: 'Amount must be positive.' };

  const supabase = createAdminClient();
  const ctx = await eventForSignupEntry(supabase, input.signupEntryId);
  if (!ctx) return { ok: false, error: 'Signup entry not found.' };

  // Paid from a notional account (scout account, scholarship fund) = a NEGATIVE
  // row on that account — its balance goes down; the event reads it as +paid
  // (the balances view flips notional fee rows). Cash methods land in checking.
  const account: Account = input.method === 'scout_account' ? 'scout_account' : input.method === 'scholarship' ? 'scholarship' : 'checking';
  const storedMethod: TransactionMethod = input.method === 'scholarship' ? 'other' : input.method;
  const { error: insertError } = await supabase.from('financial_transactions').insert({
    occurred_on: input.occurredOn ?? new Date().toISOString().slice(0, 10),
    account,
    amount: isNotionalAccount(account) ? -Math.abs(input.amount) : input.amount,
    kind: 'event_fee',
    method: storedMethod,
    person_id: ctx.entry.person_id,
    signup_entry_id: ctx.entry.id,
    calendar_entry_id: ctx.calendarEntryId,
    activity_label: ctx.title,
    memo: input.method === 'scholarship' ? `Scholarship fund${input.memo?.trim() ? ` — ${input.memo.trim()}` : ''}` : input.memo?.trim() || null,
    source: 'app',
    entered_by_person_id: actor.personId,
    idempotency_key: input.idempotencyKey ?? null
  });
  if (insertError) {
    if (insertError.code === '23505' && input.idempotencyKey) {
      revalidateEventMoney(input.signupId);
      return { ok: true }; // the retry of a write that already landed
    }
    return { ok: false, error: insertError.message };
  }

  revalidateEventMoney(input.signupId);
  return { ok: true };
}

/** Void ONE event-fee transaction by id — a real correction, not a delete.
 *  With many payments per entry, "un-tick the box" is gone; the Money tab
 *  voids the specific row. */
export async function voidEventFeePaymentAction(transactionId: number, signupId?: number): Promise<Result> {
  // Same calendar.write-OR-finance.manage gate as recordEventFeePaymentAction —
  // whoever can record a payment must be able to correct it too.
  const actor = await requireAnyOf(['calendar.write', 'finance.manage']);
  const supabase = createAdminClient();

  const { data: txn, error: findError } = await supabase
    .from('financial_transactions')
    .select('id, signup_entry_id, kind, voided_at')
    .eq('id', transactionId)
    .maybeSingle();
  if (findError) return { ok: false, error: findError.message };
  const t = txn as { id: number; signup_entry_id: number | null; kind: string; voided_at: string | null } | null;
  if (!t) return { ok: false, error: 'Transaction not found.' };
  if (t.signup_entry_id == null || t.kind !== 'event_fee') {
    return { ok: false, error: 'Only event-fee payments can be voided here — use the Financial Ledger for other rows.' };
  }
  if (t.voided_at) return { ok: true };

  const { error: voidError } = await supabase
    .from('financial_transactions')
    .update({ voided_at: new Date().toISOString(), voided_by_person_id: actor.personId })
    .eq('id', t.id);
  if (voidError) return { ok: false, error: voidError.message };

  revalidateEventMoney(signupId);
  return { ok: true };
}

/** A refund is a NEGATIVE event_fee row linked to the entry — the balance view
 *  nets it, the Activity Report nets it, and Kind stays a tag (finance.ts: the
 *  signed amount is the only thing that decides money in vs. out). */
export async function refundEventFeeAction(input: {
  signupEntryId: number;
  amount: number;
  method: PayMethod;
  memo?: string | null;
  signupId?: number;
  idempotencyKey?: string;
}): Promise<Result> {
  const actor = await requireAnyOf(['calendar.write', 'finance.manage']);
  if (!(input.amount > 0)) return { ok: false, error: 'Refund amount must be positive.' };
  const supabase = createAdminClient();
  const ctx = await eventForSignupEntry(supabase, input.signupEntryId);
  if (!ctx) return { ok: false, error: 'Signup entry not found.' };
  const account: Account = input.method === 'scout_account' ? 'scout_account' : input.method === 'scholarship' ? 'scholarship' : 'checking';
  const { error } = await supabase.from('financial_transactions').insert({
    occurred_on: new Date().toISOString().slice(0, 10),
    account,
    // A refund INTO a notional account is a positive row there (balance back up);
    // the event reads it as −paid. Cash refunds are negative on checking.
    amount: isNotionalAccount(account) ? Math.abs(input.amount) : -Math.abs(input.amount),
    kind: 'event_fee',
    method: input.method === 'scholarship' ? 'other' : input.method,
    person_id: ctx.entry.person_id,
    signup_entry_id: ctx.entry.id,
    calendar_entry_id: ctx.calendarEntryId,
    activity_label: ctx.title,
    memo: input.memo?.trim() || 'Refund',
    source: 'app',
    entered_by_person_id: actor.personId,
    idempotency_key: input.idempotencyKey ?? null
  });
  if (error) {
    if (error.code === '23505' && input.idempotencyKey) return { ok: true };
    return { ok: false, error: error.message };
  }
  revalidateEventMoney(input.signupId);
  return { ok: true };
}

/** Overpayment → scout-account credit (Patrick: "a perfect place to put it").
 *  The fee money already sits in checking; the credit is the NOTIONAL
 *  scout_account +X (kind adjustment, linked to the entry and the event),
 *  the finance plan's two-row pattern. The entry keeps showing the
 *  overpayment with a "credited" note — nothing is hidden or re-stated. */
export async function creditOverpaymentAction(input: {
  signupEntryId: number;
  amount: number;
  signupId?: number;
  idempotencyKey?: string;
}): Promise<Result> {
  const actor = await requireAnyOf(['calendar.write', 'finance.manage']);
  if (!(input.amount > 0)) return { ok: false, error: 'Credit amount must be positive.' };
  const supabase = createAdminClient();
  const ctx = await eventForSignupEntry(supabase, input.signupEntryId);
  if (!ctx) return { ok: false, error: 'Signup entry not found.' };
  if (ctx.entry.person_id == null) return { ok: false, error: 'A guest has no scout account to credit.' };
  // Never credit more than the overpayment that is still uncredited — a second
  // click, a retry, or a stale tab must not mint a second credit (Patrick,
  // 2026-08-22: three clicks, three credits). Both figures are derived live.
  const [{ data: bal }, { data: prior }] = await Promise.all([
    supabase.from('signup_entry_balances').select('balance').eq('entry_id', ctx.entry.id).maybeSingle(),
    supabase
      .from('financial_transactions')
      .select('amount')
      .eq('signup_entry_id', ctx.entry.id)
      .eq('account', 'scout_account')
      .eq('kind', 'adjustment')
      .gt('amount', 0)
      .is('voided_at', null)
  ]);
  const credited = ((prior ?? []) as { amount: number }[]).reduce((n, r) => n + Number(r.amount), 0);
  const room = uncreditedOverpayment(Number((bal as { balance: number } | null)?.balance ?? 0));
  if (room <= 0) return { ok: false, error: credited > 0 ? `Already credited ${money(credited)} — nothing left to credit.` : 'Nothing is overpaid on this entry.' };
  if (Math.abs(input.amount) > room + 0.005) return { ok: false, error: `Only ${money(room)} is still uncredited.` };
  const { error } = await supabase.from('financial_transactions').insert({
    occurred_on: new Date().toISOString().slice(0, 10),
    account: 'scout_account',
    amount: Math.abs(input.amount),
    kind: 'adjustment',
    method: 'other',
    person_id: ctx.entry.person_id,
    signup_entry_id: ctx.entry.id,
    calendar_entry_id: ctx.calendarEntryId,
    activity_label: ctx.title,
    memo: `Overpayment credit${ctx.title ? ` — ${ctx.title}` : ''}`,
    source: 'app',
    entered_by_person_id: actor.personId,
    idempotency_key: input.idempotencyKey ?? null
  });
  if (error) {
    if (error.code === '23505' && input.idempotencyKey) return { ok: true };
    return { ok: false, error: error.message };
  }
  revalidateEventMoney(input.signupId);
  return { ok: true };
}

/** Per-person owed override (Tesomas tiers, BWCA 840 vs 850, Lapham
 *  "Expected"). null = back to the tier. */
export async function setAmountOverrideAction(
  signupEntryId: number,
  amount: number | null,
  signupId?: number
): Promise<Result> {
  await requireAnyOf(['calendar.write', 'finance.manage']);
  if (amount != null && !(amount >= 0)) return { ok: false, error: 'Amount must be zero or more.' };
  const supabase = createAdminClient();
  const { error } = await supabase
    .from('signup_entries')
    .update({ amount_override: amount == null ? null : Math.round(amount * 100) / 100 })
    .eq('id', signupEntryId);
  if (error) return { ok: false, error: error.message };
  revalidateEventMoney(signupId);
  return { ok: true };
}

export interface AddEventExpenseInput {
  signupId: number;
  calendarEntryId: number;
  occurredOn: string;
  /** Entered positive; stored negative. */
  amount: number;
  memo: string;
  /** 'troop' = the troop paid (check / card / bank) — a real expense row now.
   *  A person id = that person fronted it — a reimbursement request is
   *  created; the expense row is written when it is paid out
   *  (markReimbursementPaidAction), the one writer for that money. */
  paidBy: 'troop' | number;
  /** WHO paid — always an adult leader (Patrick, 2026-08-22: "we need to know
   *  who paid for something"). For a troop-funds expense this is the leader who
   *  used the card / wrote the check and lands in person_id on the expense
   *  row; for a fronted expense the requester IS the payer. Required. */
  payerPersonId: number;
  method: TransactionMethod;
  idempotencyKey?: string;
}

/** Expenses from the event's Money tab (the sheet's expense list). Patrick:
 *  "Expenses could be entered by any leader with access" — calendar.write or
 *  finance.manage; everything stays visible to leaders, which is the control. */
export async function addEventExpenseAction(input: AddEventExpenseInput): Promise<Result> {
  const actor = await requireAnyOf(['calendar.write', 'finance.manage']);
  if (!(input.amount > 0)) return { ok: false, error: 'Amount must be positive.' };
  const memo = input.memo.trim();
  if (!memo) return { ok: false, error: 'Say what the expense was for.' };
  if (!Number.isInteger(input.payerPersonId) || input.payerPersonId <= 0) return { ok: false, error: 'Say who paid.' };
  const supabase = createAdminClient();
  const { data: cal } = await supabase.from('calendar_entries').select('id, title').eq('id', input.calendarEntryId).maybeSingle();
  if (!cal) return { ok: false, error: 'Event not found.' };
  const title = (cal as { title: string }).title;

  if (input.paidBy === 'troop') {
    const { error } = await supabase.from('financial_transactions').insert({
      occurred_on: input.occurredOn,
      account: 'checking',
      amount: -Math.abs(input.amount),
      kind: 'expense',
      method: input.method,
      person_id: input.payerPersonId,
      memo,
      calendar_entry_id: input.calendarEntryId,
      activity_label: title,
      source: 'app',
      entered_by_person_id: actor.personId,
      idempotency_key: input.idempotencyKey ?? null
    });
    if (error) {
      if (error.code === '23505' && input.idempotencyKey) return { ok: true };
      return { ok: false, error: error.message };
    }
  } else {
    const { error } = await supabase.from('reimbursement_requests').insert({
      requester_person_id: input.paidBy,
      amount: Math.abs(input.amount),
      description: `${title}: ${memo}`,
      receipt_path: null,
      status: 'submitted',
      calendar_entry_id: input.calendarEntryId,
      entered_by_person_id: actor.personId
    });
    if (error) return { ok: false, error: error.message };
    revalidatePath('/admin/finance/reimbursements');
  }
  revalidateEventMoney(input.signupId);
  return { ok: true };
}

export interface EventMoneyPerson {
  entryId: number;
  personId: number | null;
  name: string;
  isScout: boolean;
  status: string;
  participation: string;
  tierLabel: string | null;
  tierAmount: number;
  amountOverride: number | null;
  owed: number;
  paid: number;
  balance: number;
  settled: boolean;
  credited: number;
  transactions: {
    id: number;
    occurredOn: string;
    amount: number;
    kind: string;
    method: string | null;
    memo: string | null;
    voidedAt: string | null;
  }[];
}

export interface EventMoneyData {
  people: EventMoneyPerson[];
  expenses: {
    id: number;
    occurredOn: string;
    amount: number;
    kind: string;
    method: string | null;
    memo: string | null;
    personName: string | null;
    voidedAt: string | null;
  }[];
  reimbursements: {
    id: number;
    requesterName: string;
    amount: number;
    description: string;
    status: string;
    createdAt: string;
  }[];
  milestones: {
    id: number;
    kind: 'payment' | 'registration' | 'form' | 'other';
    label: string;
    dueOn: string;
    amount: number | null;
    appliesTo: 'scouts' | 'adults' | 'both';
  }[];
}

/** Everything the event's Money tab shows — the sheet's money block for one
 *  event. Pure math over it lives in lib/event-money.ts. */
export async function getEventMoneyAction(signupId: number): Promise<EventMoneyData | null> {
  await requireAnyOf(['calendar.write', 'finance.manage']);
  const supabase = createAdminClient();
  const { data: sig } = await supabase.from('event_signups').select('id, calendar_entry_id').eq('id', signupId).maybeSingle();
  if (!sig) return null;
  const calendarEntryId = (sig as { calendar_entry_id: number }).calendar_entry_id;

  const [{ data: entries }, { data: balances }, { data: prices }, { data: people }, { data: tx }, { data: reqs }, { data: ms }] =
    await Promise.all([
      supabase
        .from('signup_entries')
        .select('id, person_id, guest_name, person_kind, status, participation, price_id, amount_override')
        .eq('event_signup_id', signupId)
        .neq('status', 'cancelled'),
      supabase.from('signup_entry_balances').select('entry_id, owed, paid, balance, settled').eq('event_signup_id', signupId),
      supabase.from('event_prices').select('id, label, amount, per').eq('event_signup_id', signupId),
      supabase.from('people').select('id, display_name'),
      supabase
        .from('financial_transactions')
        .select('id, occurred_on, amount, kind, method, memo, person_id, signup_entry_id, voided_at, account')
        .eq('calendar_entry_id', calendarEntryId)
        .order('occurred_on')
        .order('id'),
      supabase
        .from('reimbursement_requests')
        .select('id, requester_person_id, amount, description, status, created_at')
        .eq('calendar_entry_id', calendarEntryId)
        .order('created_at'),
      supabase.from('event_milestones').select('id, kind, label, due_on, amount, applies_to, sort').eq('event_signup_id', signupId)
    ]);

  const nameOf = new Map(((people ?? []) as { id: number; display_name: string }[]).map((p) => [p.id, p.display_name]));
  const priceById = new Map(((prices ?? []) as { id: number; label: string; amount: number; per: string }[]).map((p) => [p.id, p]));
  const balById = new Map(
    ((balances ?? []) as { entry_id: number; owed: number; paid: number; balance: number; settled: boolean }[]).map((b) => [b.entry_id, b])
  );
  type Tx = { id: number; occurred_on: string; amount: number; kind: string; method: string | null; memo: string | null; person_id: number | null; signup_entry_id: number | null; voided_at: string | null; account: string };
  const txRows = (tx ?? []) as Tx[];
  const txByEntry = new Map<number, Tx[]>();
  for (const t of txRows) if (t.signup_entry_id != null) txByEntry.set(t.signup_entry_id, [...(txByEntry.get(t.signup_entry_id) ?? []), t]);

  const peopleRows: EventMoneyPerson[] = ((entries ?? []) as Record<string, unknown>[]).map((e) => {
    const id = Number(e.id);
    const b = balById.get(id);
    const tier = e.price_id ? priceById.get(Number(e.price_id)) : undefined;
    const mine = txByEntry.get(id) ?? [];
    const credited = mine
      .filter((t) => !t.voided_at && t.kind === 'adjustment' && t.amount > 0)
      .reduce((n, t) => n + Number(t.amount), 0);
    return {
      entryId: id,
      personId: e.person_id != null ? Number(e.person_id) : null,
      name: (e.person_id != null ? nameOf.get(Number(e.person_id)) : null) ?? (e.guest_name ? String(e.guest_name) : 'Unknown'),
      isScout: e.person_kind === 'scout',
      status: String(e.status),
      participation: String(e.participation),
      tierLabel: tier?.label ?? null,
      tierAmount: tier ? Number(tier.amount) : 0,
      amountOverride: e.amount_override != null ? Number(e.amount_override) : null,
      owed: Number(b?.owed ?? 0),
      paid: Number(b?.paid ?? 0),
      balance: Number(b?.balance ?? 0),
      settled: b?.settled === true,
      credited: Math.round(credited * 100) / 100,
      transactions: mine.map((t) => ({
        id: t.id,
        occurredOn: t.occurred_on,
        // The event's sign: a −30 scout-account fee row shows as a $30 payment here.
        amount: feeAmount({ amount: Number(t.amount), kind: t.kind, account: t.account }),
        kind: t.kind,
        method: t.account === 'scholarship' ? 'scholarship' : t.method,
        memo: t.memo,
        voidedAt: t.voided_at
      }))
    };
  });
  peopleRows.sort((a, b) => a.name.localeCompare(b.name));

  return {
    people: peopleRows,
    expenses: txRows
      .filter((t) => t.signup_entry_id == null)
      .map((t) => ({
        id: t.id,
        occurredOn: t.occurred_on,
        amount: Number(t.amount),
        kind: t.kind,
        method: t.method,
        memo: t.memo,
        personName: t.person_id != null ? (nameOf.get(t.person_id) ?? null) : null,
        voidedAt: t.voided_at
      })),
    reimbursements: ((reqs ?? []) as { id: number; requester_person_id: number; amount: number; description: string; status: string; created_at: string }[]).map(
      (r) => ({
        id: r.id,
        requesterName: nameOf.get(r.requester_person_id) ?? `#${r.requester_person_id}`,
        amount: Number(r.amount),
        description: r.description,
        status: r.status,
        createdAt: r.created_at
      })
    ),
    milestones: ((ms ?? []) as { id: number; kind: string; label: string; due_on: string; amount: number | null; applies_to: string; sort: number }[])
      .map((m) => ({
        id: m.id,
        kind: m.kind as 'payment' | 'registration' | 'form' | 'other',
        label: m.label,
        dueOn: m.due_on,
        amount: m.amount != null ? Number(m.amount) : null,
        appliesTo: m.applies_to as 'scouts' | 'adults' | 'both'
      }))
      .sort((a, b) => (a.dueOn < b.dueOn ? -1 : a.dueOn > b.dueOn ? 1 : a.id - b.id))
  };
}

export interface ReconciliationSummaryRow {
  account: 'checking' | 'savings';
  computedBalance: number;
  lastReconciledAt: string | null;
  lastStatementBalance: number | null;
  drift: number | null; // computed - lastStatementBalance, null if never reconciled
}

/** Per-account computed balance vs. the most recent reconciliation snapshot.
 *  The proportionate substitute for double-entry (Plans/Troop-Finances.md):
 *  this is what surfaces drift for a treasurer to investigate, not a
 *  constraint that blocks anything. */
export async function getReconciliationSummaryAction(): Promise<ReconciliationSummaryRow[]> {
  await requireAnyOf(['finance.manage', 'finance.view']);
  const supabase = createAdminClient();

  const rows = await fetchAllRows<FinancialTransactionRow>((from, to) =>
    supabase
      .from('financial_transactions')
      .select('account, amount, person_id, voided_at')
      .in('account', ['checking', 'savings'])
      .range(from, to)
  );

  const out: ReconciliationSummaryRow[] = [];
  for (const account of ['checking', 'savings'] as const) {
    const computedBalance = computeBalance(rows, { account });
    const { data: last } = await supabase
      .from('account_reconciliations')
      .select('as_of, statement_balance')
      .eq('account', account)
      .order('as_of', { ascending: false })
      .limit(1)
      .maybeSingle();
    const lastStatementBalance = last ? Number(last.statement_balance) : null;
    out.push({
      account,
      computedBalance,
      lastReconciledAt: last?.as_of ?? null,
      lastStatementBalance,
      drift: lastStatementBalance == null ? null : Math.round((computedBalance - lastStatementBalance) * 100) / 100
    });
  }
  return out;
}

export interface AddReconciliationInput {
  account: 'checking' | 'savings';
  asOf: string; // YYYY-MM-DD
  statementBalance: number;
  note: string | null;
}

export async function addReconciliationAction(input: AddReconciliationInput): Promise<Result> {
  const actor = await requireCapability('finance.manage');
  const supabase = createAdminClient();

  const rows = await fetchAllRows<FinancialTransactionRow>((from, to) =>
    supabase
      .from('financial_transactions')
      .select('account, amount, person_id, voided_at')
      .eq('account', input.account)
      .range(from, to)
  );
  const computedBalance = computeBalance(rows, { account: input.account });

  const { error } = await supabase.from('account_reconciliations').upsert(
    {
      account: input.account,
      as_of: input.asOf,
      statement_balance: input.statementBalance,
      computed_balance: computedBalance,
      note: input.note,
      reconciled_by_person_id: actor.personId
    },
    { onConflict: 'account,as_of' }
  );
  if (error) return { ok: false, error: error.message };

  revalidateFinance();
  return { ok: true };
}

/** Full ledger, unpaginated, for the treasurer's CSV backup export
 *  (finance/export/route.ts). Includes voided rows, clearly marked — this
 *  is the disaster-recovery copy, it needs to be complete, not curated. */
export async function exportLedgerAction(): Promise<LedgerCsvRow[]> {
  await requireCapability('finance.manage');
  const supabase = createAdminClient();

  const rows = await fetchAllRows<{
    occurred_on: string;
    account: Account;
    amount: number;
    kind: TransactionKind;
    method: TransactionMethod | null;
    person_id: number | null;
    memo: string | null;
    activity_label: string | null;
    voided_at: string | null;
    entered_by_person_id: number | null;
    created_at: string | null;
  }>((from, to) =>
    supabase
      .from('financial_transactions')
      .select(
        'occurred_on, account, amount, kind, method, person_id, memo, activity_label, voided_at, entered_by_person_id, created_at'
      )
      .order('occurred_on', { ascending: true })
      .range(from, to)
  );

  const personIds = [
    ...new Set(rows.flatMap((r) => [r.person_id, r.entered_by_person_id]).filter((id): id is number => id != null))
  ];
  const nameMap = await loadNames(supabase, personIds);

  return rows.map((r) => ({
    ...r,
    personName: r.person_id != null ? (nameMap.get(r.person_id) ?? `#${r.person_id}`) : null,
    enteredByName:
      r.entered_by_person_id != null ? (nameMap.get(r.entered_by_person_id) ?? `#${r.entered_by_person_id}`) : null,
    enteredAt: r.created_at
  }));
}

/** CSV text, ready for the export route to stream as a download. Kept as a
 *  thin wrapper over ledgerToCsv (pure, tested separately) so the route
 *  handler doesn't need its own formatting logic. */
export async function exportLedgerCsvTextAction(): Promise<string> {
  const rows = await exportLedgerAction();
  return ledgerToCsv(rows);
}

// ═══════════════════════════════════════════════════════════════════════
// Reimbursements (Phase 4) — treasurer side. Family submission/withdrawal
// lives in app/(public)/member/reimbursements/actions.ts; these are the
// approve/deny/pay transitions, all finance.manage-only.
// ═══════════════════════════════════════════════════════════════════════

export interface ReimbursementQueueRow {
  id: number;
  requester_person_id: number;
  requesterName: string;
  amount: number;
  description: string;
  status: string;
  receipt_path: string;
  receiptUrl: string | null;
  denial_reason: string | null;
  created_at: string;
  decided_at: string | null;
  paid_at: string | null;
}

/** Every reimbursement request, newest first — the treasurer's queue is
 *  small enough (this is a 30-family troop) that no pagination is needed
 *  yet; add it if that stops being true. */
export async function listReimbursementsAction(): Promise<ReimbursementQueueRow[]> {
  await requireCapability('finance.manage');
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from('reimbursement_requests')
    .select('id, requester_person_id, amount, description, status, receipt_path, denial_reason, created_at, decided_at, paid_at')
    .order('created_at', { ascending: false });
  if (error) throw new Error(`listReimbursementsAction failed: ${error.message}`);

  const rows = (data ?? []) as Omit<ReimbursementQueueRow, 'requesterName' | 'receiptUrl'>[];
  const personIds = [...new Set(rows.map((r) => r.requester_person_id))];
  const nameMap = await loadNames(supabase, personIds);

  return Promise.all(
    rows.map(async (r) => ({
      ...r,
      requesterName: nameMap.get(r.requester_person_id) ?? `#${r.requester_person_id}`,
      receiptUrl: await signedReceiptMediaUrl(supabase, r.receipt_path)
    }))
  );
}

export async function approveReimbursementAction(id: number): Promise<Result> {
  const actor = await requireCapability('finance.manage');
  const supabase = createAdminClient();
  const { error } = await supabase
    .from('reimbursement_requests')
    .update({ status: 'approved', decided_by_person_id: actor.personId, decided_at: new Date().toISOString() })
    .eq('id', id)
    .eq('status', 'submitted');
  if (error) return { ok: false, error: error.message };
  revalidatePath('/admin/finance/reimbursements');
  return { ok: true };
}

export async function denyReimbursementAction(id: number, reason: string): Promise<Result> {
  if (!reason.trim()) return { ok: false, error: 'A denial needs a reason — the family will see it.' };
  const actor = await requireCapability('finance.manage');
  const supabase = createAdminClient();
  const { error } = await supabase
    .from('reimbursement_requests')
    .update({
      status: 'denied',
      denial_reason: reason.trim(),
      decided_by_person_id: actor.personId,
      decided_at: new Date().toISOString()
    })
    .eq('id', id)
    .eq('status', 'submitted');
  if (error) return { ok: false, error: error.message };
  revalidatePath('/admin/finance/reimbursements');
  return { ok: true };
}

/** approved -> paid: atomically creates the linked checking transaction —
 *  the only place reimbursement money actually moves (Plans/Troop-Finances.md
 *  Phase 4), same one-writer principle as recordEventFeePaymentAction. */
export async function markReimbursementPaidAction(id: number, method: TransactionMethod): Promise<Result> {
  const actor = await requireCapability('finance.manage');
  const supabase = createAdminClient();

  const { data: req, error: findError } = await supabase
    .from('reimbursement_requests')
    .select('id, requester_person_id, amount, status')
    .eq('id', id)
    .maybeSingle();
  if (findError) return { ok: false, error: findError.message };
  if (!req) return { ok: false, error: 'Request not found.' };
  if (req.status !== 'approved') return { ok: false, error: 'Only an approved request can be marked paid.' };

  const { data: txn, error: txnError } = await supabase
    .from('financial_transactions')
    .insert({
      occurred_on: new Date().toISOString().slice(0, 10),
      account: 'checking',
      amount: -Math.abs(Number(req.amount)),
      kind: 'reimbursement',
      method,
      person_id: req.requester_person_id,
      reimbursement_id: req.id,
      source: 'app',
      entered_by_person_id: actor.personId
    })
    .select('id')
    .single();
  if (txnError || !txn) return { ok: false, error: txnError?.message ?? 'Could not record the payout transaction.' };

  const { error: updateError } = await supabase
    .from('reimbursement_requests')
    .update({ status: 'paid', paid_at: new Date().toISOString() })
    .eq('id', id);
  if (updateError) {
    return {
      ok: false,
      error: `Payout transaction recorded, but the request status failed to update (${updateError.message}).`
    };
  }

  revalidatePath('/admin/finance/reimbursements');
  revalidateFinance();
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════════
// Per-event/activity report (Phase 6) — read-only, finance.manage OR
// finance.view, same gate as the ledger itself.
// ═══════════════════════════════════════════════════════════════════════

/** Every non-voided transaction that carries an activity_label, unpaginated
 *  (fetchAllRows — same 1000-row-cap discipline as every other finance
 *  loader) — the report groups these client-side via summarizeByActivity(),
 *  a pure function so the grouping logic is unit-tested without a DB. */
/** Distinct activity_label values already in use — powers the Record a
 *  transaction form's autocomplete (Patrick, 2026-08-18: a typo-resistance
 *  safeguard instead of a full normalized activities table, see
 *  Plans/Troop-Finances.md). Deliberately not a separate lookup table:
 *  reusing an existing label is a suggestion here, not an enforced FK. */
export async function listDistinctActivityLabelsAction(): Promise<string[]> {
  await requireAnyOf(['finance.manage', 'finance.view']);
  const supabase = createAdminClient();
  const rows = await fetchAllRows<{ activity_label: string | null }>((from, to) =>
    supabase.from('financial_transactions').select('activity_label').not('activity_label', 'is', null).range(from, to)
  );
  return [...new Set(rows.map((r) => r.activity_label).filter((v): v is string => !!v))].sort();
}

/** The governed Kind vocabulary (transaction_kinds, 2026-08-20) — powers
 *  every Kind picker (Record, Edit, bulk reassign). Unlike Activity, this
 *  IS an enforced FK (financial_transactions_kind_fkey), so a value not in
 *  this list is rejected by the database, not just unsuggested. */
export async function listTransactionKindsAction(): Promise<TransactionKindRow[]> {
  await requireAnyOf(['finance.manage', 'finance.view']);
  const supabase = createAdminClient();
  const { data, error } = await supabase.from('transaction_kinds').select('code, label, sort_order').order('sort_order');
  if (error) throw new Error(`transaction_kinds lookup failed: ${error.message}`);
  return (data ?? []) as TransactionKindRow[];
}

export interface KindActionResult extends Result {
  code?: string;
}

/** Add a new Kind — "governed, extensible without a deploy" (Patrick,
 *  2026-08-20). Same everyday need as calendar_categories: a treasurer
 *  reassigning the retired 'income'/'expense' rows may find no existing
 *  category fits and needs a new one on the spot, not a deploy. */
export async function createTransactionKindAction(formData: FormData): Promise<KindActionResult> {
  try {
    await requireCapability('finance.manage');
  } catch {
    return { ok: false, error: 'Not authenticated' };
  }
  const code = String(formData.get('code') ?? '').trim();
  const label = String(formData.get('label') ?? '').trim() || code;
  if (!code) return { ok: false, error: 'Give the new Kind a name.' };
  // Matches the seeded values' shape (lowercase, underscore) so a
  // hand-typed code reads consistently with the original 9 — not enforced
  // by the DB, just a light nudge before it round-trips through a <select>.
  const normalized = code.toLowerCase().replace(/\s+/g, '_');

  const supabase = createAdminClient();
  const { count } = await supabase.from('transaction_kinds').select('code', { count: 'exact', head: true });
  const { error } = await supabase
    .from('transaction_kinds')
    .insert({ code: normalized, label, sort_order: ((count ?? 0) + 1) * 10 });
  if (error) {
    return {
      ok: false,
      error: error.code === '23505' ? `"${normalized}" already exists.` : error.message
    };
  }

  revalidateFinance();
  return { ok: true, code: normalized };
}

/** Rename a Kind's code — cascades to every transaction that uses it via
 *  ON UPDATE CASCADE, the same free rename calendar_categories gets. */
export async function renameTransactionKindAction(formData: FormData): Promise<Result> {
  try {
    await requireCapability('finance.manage');
  } catch {
    return { ok: false, error: 'Not authenticated' };
  }
  const originalCode = String(formData.get('original_code') ?? '').trim();
  const code = String(formData.get('code') ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
  const label = String(formData.get('label') ?? '').trim();
  if (!originalCode || !code || !label) return { ok: false, error: 'Malformed request.' };

  const supabase = createAdminClient();
  const { error } = await supabase
    .from('transaction_kinds')
    .update({ code, label })
    .eq('code', originalCode);
  if (error) {
    return {
      ok: false,
      error: error.code === '23505' ? `"${code}" already exists.` : error.message
    };
  }

  revalidateFinance();
  return { ok: true };
}

/** Delete a Kind — refused by the database (ON DELETE RESTRICT) if any
 *  transaction still uses it, same protection calendar_categories has for
 *  a category still in use on a calendar entry. */
export async function deleteTransactionKindAction(formData: FormData): Promise<Result> {
  try {
    await requireCapability('finance.manage');
  } catch {
    return { ok: false, error: 'Not authenticated' };
  }
  const code = String(formData.get('code') ?? '').trim();
  if (!code) return { ok: false, error: 'Malformed request.' };

  const supabase = createAdminClient();
  const { error } = await supabase.from('transaction_kinds').delete().eq('code', code);
  if (error) {
    return {
      ok: false,
      error:
        error.code === '23503'
          ? 'Still in use on at least one transaction — reassign those first (the bulk Kind tool on the ledger).'
          : error.message
    };
  }

  revalidateFinance();
  return { ok: true };
}

export interface RenameActivityPreview {
  affectedCount: number;
}

/** Preview-only: how many rows a rename/merge from `sourceLabel` to
 *  `targetLabel` would touch, before committing. Counts EVERY matching row,
 *  including voided ones (Patrick, 2026-08-19: no split label sets between
 *  active and voided history). */
export async function previewRenameActivityAction(sourceLabel: string): Promise<RenameActivityPreview> {
  await requireCapability('finance.manage');
  const supabase = createAdminClient();
  // Untrimmed, deliberately — must match renameActivityAction's WHERE clause
  // exactly (Opus pre-deploy review, 2026-08-19: these two drifting apart
  // would preview a nonzero count and then silently match zero rows on
  // apply). sourceLabel always comes from RenameActivityPanel's <select>
  // of real, already-stored activity_label values — never free-typed — so
  // an exact untrimmed match is correct: it's comparing against data that
  // may itself carry stray whitespace, and trimming here would make a
  // padded stored label permanently unmatchable by either the preview or
  // the apply.
  const { count, error } = await supabase
    .from('financial_transactions')
    .select('id', { count: 'exact', head: true })
    .eq('activity_label', sourceLabel);
  if (error) throw new Error(`previewRenameActivityAction failed: ${error.message}`);
  return { affectedCount: count ?? 0 };
}

/** Bulk rename (or merge, when targetLabel already names another activity)
 *  — a rename is `UPDATE ... SET activity_label = target WHERE activity_label
 *  = source`; a merge is the identical statement when target happens to
 *  already be in use. Deliberately a plain bulk edit on the free-text
 *  activity_label column, NOT a lookup table — Plans/Troop-Finances.md's
 *  2026-08-18 decision against a normalized activities table still holds;
 *  this doesn't reopen it, it operates on the column as it already exists.
 *  Applies to every matching row regardless of voided status (2026-08-19). */
export async function renameActivityAction(sourceLabel: string, targetLabel: string): Promise<Result & { affectedCount?: number }> {
  await requireCapability('finance.manage');
  const guardError = validateActivityRename(sourceLabel, targetLabel);
  if (guardError) return { ok: false, error: guardError };

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('financial_transactions')
    // WHERE clause on the untrimmed sourceLabel (see previewRenameActivityAction's
    // comment) — source is a controlled <select> value, matched exactly.
    // Only the free-typed target gets trimmed before being written, so a
    // stray-whitespace typo doesn't mint a new near-duplicate label.
    .update({ activity_label: targetLabel.trim() })
    .eq('activity_label', sourceLabel)
    .select('id');
  if (error) return { ok: false, error: error.message };

  revalidateFinance();
  revalidatePath('/admin/finance/report');
  return { ok: true, affectedCount: data?.length ?? 0 };
}

export interface ActivityDrilldownRow {
  id: number;
  occurred_on: string;
  account: Account;
  amount: number;
  kind: string;
  memo: string | null;
  personName: string | null;
  voided_at: string | null;
  /** Link to the specific calendar event this row came from, when it
   *  carries a real signup_entry_id — precise per-event drill-down (via
   *  signup_entries -> event_signups -> calendar_entries), not just a
   *  same-activity_label text match. Null for every row without one
   *  (checking-account expenses, fundraiser income, etc.) — those only
   *  ever had the label match to begin with. */
  eventHref: string | null;
}

/** Every transaction carrying a given activity_label — the Activity
 *  Report's drill-down (Patrick, 2026-08-19: "I need to drill in to see the
 *  details of any activities in the report"). Read-only, same
 *  finance.manage-OR-finance.view gate as the report itself. */
export async function getActivityTransactionsAction(activityLabel: string): Promise<ActivityDrilldownRow[]> {
  await requireAnyOf(['finance.manage', 'finance.view']);
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from('financial_transactions')
    .select('id, occurred_on, account, amount, kind, memo, person_id, voided_at, signup_entry_id')
    .eq('activity_label', activityLabel)
    .order('occurred_on', { ascending: true });
  if (error) throw new Error(`getActivityTransactionsAction failed: ${error.message}`);

  type Row = {
    id: number;
    occurred_on: string;
    account: Account;
    amount: number;
    kind: string;
    memo: string | null;
    person_id: number | null;
    voided_at: string | null;
    signup_entry_id: number | null;
  };
  const rows = (data ?? []) as Row[];

  const personIds = [...new Set(rows.map((r) => r.person_id).filter((id): id is number => id != null))];
  const nameMap = await loadNames(supabase, personIds);

  const signupEntryIds = [...new Set(rows.map((r) => r.signup_entry_id).filter((id): id is number => id != null))];
  const eventHrefBySignupEntry = new Map<number, string>();
  if (signupEntryIds.length > 0) {
    const { data: entries } = await supabase
      .from('signup_entries')
      .select('id, event_signup_id')
      .in('id', signupEntryIds);
    const signupIds = [
      ...new Set((entries ?? []).map((e) => (e as { event_signup_id: number }).event_signup_id))
    ];
    if (signupIds.length > 0) {
      const { data: signups } = await supabase
        .from('event_signups')
        .select('id, calendar_entry_id')
        .in('id', signupIds);
      const calendarBySignup = new Map(
        (signups ?? []).map((s) => [
          (s as { id: number }).id,
          (s as { calendar_entry_id: number }).calendar_entry_id
        ])
      );
      for (const e of entries ?? []) {
        const entry = e as { id: number; event_signup_id: number };
        const calendarEntryId = calendarBySignup.get(entry.event_signup_id);
        if (calendarEntryId != null) {
          eventHrefBySignupEntry.set(entry.id, `/admin/calendar/${calendarEntryId}`);
        }
      }
    }
  }

  return rows.map((r) => ({
    id: r.id,
    occurred_on: r.occurred_on,
    account: r.account,
    amount: r.amount,
    kind: r.kind,
    memo: r.memo,
    personName: r.person_id != null ? (nameMap.get(r.person_id) ?? `#${r.person_id}`) : null,
    voided_at: r.voided_at,
    eventHref: r.signup_entry_id != null ? (eventHrefBySignupEntry.get(r.signup_entry_id) ?? null) : null
  }));
}

export async function getActivityReportAction(): Promise<
  { account: Account; amount: number; activity_label: string | null; voided_at: string | null; occurred_on: string }[]
> {
  await requireAnyOf(['finance.manage', 'finance.view']);
  const supabase = createAdminClient();
  return fetchAllRows((from, to) =>
    supabase
      .from('financial_transactions')
      .select('account, amount, activity_label, voided_at, occurred_on')
      .not('activity_label', 'is', null)
      .range(from, to)
  );
}

/** The scout-account balance behind a signup entry — shown in the Record
 *  payment dialog when the method is "Scout account balance" (Patrick,
 *  2026-08-22: "we need to see how much that Scout has available"). Derived
 *  from the FULL scout_account history for that person (never a stored
 *  figure); null balance = no person on the entry (a guest row). */
export async function getScoutAccountBalanceForEntryAction(
  signupEntryId: number
): Promise<{ personId: number | null; balance: number | null; scholarshipBalance: number }> {
  await requireAnyOf(['calendar.write', 'finance.manage']);
  const supabase = createAdminClient();
  const { data: entry } = await supabase.from('signup_entries').select('person_id').eq('id', signupEntryId).maybeSingle();
  const personId = (entry as { person_id: number | null } | null)?.person_id ?? null;
  const scholarshipRows = await fetchAllRows<FinancialTransactionRow>((from, to) =>
    supabase.from('financial_transactions').select('account, amount, person_id, voided_at').eq('account', 'scholarship').range(from, to)
  );
  const scholarshipBalance = computeBalance(scholarshipRows, { account: 'scholarship' });
  if (personId == null) return { personId: null, balance: null, scholarshipBalance };
  const rows = await fetchAllRows<FinancialTransactionRow>((from, to) =>
    supabase
      .from('financial_transactions')
      .select('account, amount, person_id, voided_at')
      .eq('account', 'scout_account')
      .eq('person_id', personId)
      .range(from, to)
  );
  return { personId, balance: computeScoutAccountBalances(rows).get(personId) ?? 0, scholarshipBalance };
}
