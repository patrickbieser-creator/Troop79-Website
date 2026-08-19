'use server';

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
  type Account,
  type TransactionKind,
  type TransactionMethod,
  type FinancialTransactionRow,
  type LedgerCsvRow
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
      'id, occurred_on, account, amount, kind, method, person_id, memo, activity_label, voided_at',
      { count: 'exact' }
    );
  if (filters.account) q = q.eq('account', filters.account);
  if (filters.kind) q = q.eq('kind', filters.kind);
  if (filters.personId) q = q.eq('person_id', filters.personId);

  const sortColumn = SORT_TO_COLUMN[filters.sort ?? 'date'];
  const ascending = filters.dir === 'asc';
  q = q.order(sortColumn, { ascending }).order('id', { ascending });

  const from = (filters.page - 1) * FINANCE_PAGE_SIZE;
  const { data, count, error } = await q.range(from, from + FINANCE_PAGE_SIZE - 1);
  if (error) throw new Error(`listFinancialTransactionsAction failed: ${error.message}`);

  const rawRows = (data ?? []) as Omit<LedgerRow, 'personName'>[];
  const personIds = [...new Set(rawRows.map((r) => r.person_id).filter((id): id is number => id != null))];
  const nameMap = await loadNames(supabase, personIds);

  const rows: LedgerRow[] = rawRows.map((r) => ({
    ...r,
    personName: r.person_id != null ? (nameMap.get(r.person_id) ?? `#${r.person_id}`) : null
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
  method: TransactionMethod;
  /** For revalidating the roster page this payment was recorded from. */
  signupId?: number;
}

/** The event-fee integration point (Plans/Troop-Finances.md): writes ONE
 *  transaction linked to the signup entry and flips payment_received in
 *  the same call, so the two facts can never independently drift — this is
 *  the only writer either the Finances section or the existing signup
 *  roster's "payment received" checkbox should ever call. `owed` stays
 *  fully derived from event_prices; this never copies that amount into a
 *  stored "charge" row. */
export async function recordEventFeePaymentAction(input: RecordEventFeePaymentInput): Promise<Result> {
  // calendar.write OR finance.manage — "whoever can already mark payment_received
  // today keeps that power" (Plans/Troop-Finances.md's original design intent
  // for this integration point). Restored 2026-08-18 after qa-lead flagged that
  // an earlier pass had narrowed this to finance.manage-only, which would have
  // locked ordinary event leaders out of a checkbox they already used.
  const actor = await requireAnyOf(['calendar.write', 'finance.manage']);
  if (input.amount <= 0) return { ok: false, error: 'Amount must be positive.' };

  const supabase = createAdminClient();
  const { data: entry, error: entryError } = await supabase
    .from('signup_entries')
    .select('id, person_id, payment_received')
    .eq('id', input.signupEntryId)
    .maybeSingle();
  if (entryError) return { ok: false, error: entryError.message };
  if (!entry) return { ok: false, error: 'Signup entry not found.' };
  if (entry.payment_received) return { ok: false, error: 'Payment is already recorded for this entry.' };

  const account: Account = input.method === 'scout_account' ? 'scout_account' : 'checking';
  const { error: insertError } = await supabase.from('financial_transactions').insert({
    occurred_on: new Date().toISOString().slice(0, 10),
    account,
    amount: input.amount,
    kind: 'event_fee',
    method: input.method,
    person_id: entry.person_id,
    signup_entry_id: entry.id,
    source: 'app',
    entered_by_person_id: actor.personId
  });
  if (insertError) return { ok: false, error: insertError.message };

  const { error: flagError } = await supabase
    .from('signup_entries')
    .update({ payment_received: true })
    .eq('id', entry.id);
  if (flagError) {
    // The transaction is already written and correct; only the denormalized
    // flag failed to flip. Surface it plainly rather than pretending this
    // succeeded — the drift report (getPaymentDriftReportAction) is the
    // backstop for exactly this partial-failure shape.
    return {
      ok: false,
      error: `Payment recorded, but the roster checkbox failed to update (${flagError.message}). It will show as drift.`
    };
  }

  revalidateFinance();
  if (input.signupId) revalidatePath(`/admin/rosters/${input.signupId}`);
  return { ok: true };
}

/** Reverses recordEventFeePaymentAction: voids the linked transaction and
 *  flips payment_received back to false. Used when a leader un-ticks the
 *  roster checkbox — a real correction, not a delete. */
export async function voidEventFeePaymentAction(signupEntryId: number, signupId?: number): Promise<Result> {
  // Same calendar.write-OR-finance.manage gate as recordEventFeePaymentAction —
  // whoever can tick the box must be able to un-tick it too.
  const actor = await requireAnyOf(['calendar.write', 'finance.manage']);
  const supabase = createAdminClient();

  const { data: txn, error: findError } = await supabase
    .from('financial_transactions')
    .select('id')
    .eq('signup_entry_id', signupEntryId)
    .is('voided_at', null)
    .maybeSingle();
  if (findError) return { ok: false, error: findError.message };

  if (txn) {
    const { error: voidError } = await supabase
      .from('financial_transactions')
      .update({ voided_at: new Date().toISOString(), voided_by_person_id: actor.personId })
      .eq('id', txn.id);
    if (voidError) return { ok: false, error: voidError.message };
  }
  // No linked transaction found is not fatal — a pre-cutover row ticked
  // before Finances existed has no transaction to void; still flip the flag.

  const { error: flagError } = await supabase
    .from('signup_entries')
    .update({ payment_received: false })
    .eq('id', signupEntryId);
  if (flagError) return { ok: false, error: flagError.message };

  revalidateFinance();
  if (signupId) revalidatePath(`/admin/rosters/${signupId}`);
  return { ok: true };
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
  }>((from, to) =>
    supabase
      .from('financial_transactions')
      .select('occurred_on, account, amount, kind, method, person_id, memo, activity_label, voided_at')
      .order('occurred_on', { ascending: true })
      .range(from, to)
  );

  const personIds = [...new Set(rows.map((r) => r.person_id).filter((id): id is number => id != null))];
  const nameMap = await loadNames(supabase, personIds);

  return rows.map((r) => ({
    ...r,
    personName: r.person_id != null ? (nameMap.get(r.person_id) ?? `#${r.person_id}`) : null
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
