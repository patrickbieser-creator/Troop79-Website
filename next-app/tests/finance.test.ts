import { describe, it, expect, afterEach } from 'vitest';
import { adminClient } from './helpers/admin-client';
import {
  ACCOUNTS,
  TRANSACTION_KINDS,
  TRANSACTION_METHODS,
  isAccount,
  computeBalance,
  computeScoutAccountBalances,
  ledgerToCsv,
  summarizeByActivity,
  editTransactionGuard,
  type FinancialTransactionRow,
  type LedgerCsvRow,
  type ActivityTransactionRow
} from '../src/lib/finance';

/**
 * Troop Finances — Phase 1 (Plans/Troop-Finances.md).
 *
 * Same approach as the rest of this suite: real local Postgres, no mocks
 * (D-049). Fixture rows are created and torn down per test. The balance-math
 * tests are pure — they exercise no Supabase client and pass with Docker
 * down; the schema/constraint tests need `npm run supabase:start` like every
 * other db-project test.
 */

describe('finance — vocabulary (pure)', () => {
  it('IsAccount_AcceptsEveryKnownAccount_RejectsUnknownStrings', () => {
    for (const account of ACCOUNTS) {
      expect(isAccount(account)).toBe(true);
    }
    expect(isAccount('checking-but-typo')).toBe(false);
  });

  it('TransactionKindsAndMethods_AreNonEmptyFlatLists', () => {
    // Guards against an accidental empty array from a bad edit — these two
    // lists are the TS-side mirror of the migration's CHECK constraints and
    // must never silently go empty.
    expect(TRANSACTION_KINDS.length).toBeGreaterThan(0);
    expect(TRANSACTION_METHODS.length).toBeGreaterThan(0);
    // No 'online' method — no payment processing in this build.
    expect(TRANSACTION_METHODS).not.toContain('online');
  });
});

describe('finance — computeBalance (pure)', () => {
  function row(partial: Partial<FinancialTransactionRow>): FinancialTransactionRow {
    return {
      account: 'checking',
      amount: 0,
      person_id: null,
      voided_at: null,
      ...partial
    };
  }

  it('ComputeBalance_SumsSignedAmounts_ForOneAccount', () => {
    const rows = [
      row({ account: 'checking', amount: 100 }),
      row({ account: 'checking', amount: -25.5 }),
      row({ account: 'savings', amount: 500 }) // different account, excluded
    ];
    expect(computeBalance(rows, { account: 'checking' })).toBe(74.5);
  });

  it('ComputeBalance_ExcludesVoidedRows_FromTheSum', () => {
    const rows = [
      row({ account: 'checking', amount: 100 }),
      row({ account: 'checking', amount: -40, voided_at: '2026-08-18T00:00:00Z' })
    ];
    expect(computeBalance(rows, { account: 'checking' })).toBe(100);
  });

  it('ComputeBalance_ScopesToOnePerson_WhenPersonIdGiven', () => {
    const rows = [
      row({ account: 'scout_account', amount: 50, person_id: 1 }),
      row({ account: 'scout_account', amount: 30, person_id: 2 })
    ];
    expect(computeBalance(rows, { account: 'scout_account', personId: 1 })).toBe(50);
    expect(computeBalance(rows, { account: 'scout_account', personId: 2 })).toBe(30);
  });

  it('ComputeBalance_AvoidsFloatDrift_OverManySmallAmounts', () => {
    // The classic 0.1 + 0.2 problem: 30 rows of $0.10 naively summed as
    // floats lands on 2.9999999999999996, not 3. A ledger cannot tolerate
    // that — this is exactly what the cents-based accumulation guards.
    const rows = Array.from({ length: 30 }, () => row({ account: 'checking', amount: 0.1 }));
    expect(computeBalance(rows, { account: 'checking' })).toBe(3);
  });

  it('ComputeScoutAccountBalances_ReturnsOneEntryPerScout_ExcludingOtherAccounts', () => {
    const rows = [
      row({ account: 'scout_account', amount: 20, person_id: 10 }),
      row({ account: 'scout_account', amount: 15, person_id: 10 }),
      row({ account: 'scout_account', amount: 40, person_id: 20 }),
      row({ account: 'checking', amount: 999, person_id: null }) // troop-level, excluded
    ];
    const balances = computeScoutAccountBalances(rows);
    expect(balances.get(10)).toBe(35);
    expect(balances.get(20)).toBe(40);
    expect(balances.size).toBe(2);
  });
});

describe('finance — ledgerToCsv (pure)', () => {
  function row(partial: Partial<LedgerCsvRow>): LedgerCsvRow {
    return {
      occurred_on: '2026-08-18',
      account: 'checking',
      amount: 10,
      kind: 'expense',
      method: null,
      personName: null,
      memo: null,
      activity_label: null,
      voided_at: null,
      ...partial
    };
  }

  it('LedgerToCsv_IncludesHeaderRow_BeforeAnyData', () => {
    const csv = ledgerToCsv([]);
    expect(csv).toBe('Date,Account,Kind,Method,Who,Memo,Activity,Amount,Voided');
  });

  it('LedgerToCsv_EscapesEmbeddedCommaAndQuote_PerRfc4180', () => {
    const csv = ledgerToCsv([row({ memo: 'Cans, "wet" batch' })]);
    expect(csv).toContain('"Cans, ""wet"" batch"');
  });

  it('LedgerToCsv_MarksVoidedRows_WithoutDroppingThem', () => {
    const csv = ledgerToCsv([row({ voided_at: '2026-08-18T00:00:00Z' })]);
    const dataLine = csv.split('\n')[1];
    expect(dataLine.endsWith(',yes')).toBe(true);
  });

  it('LedgerToCsv_FormatsAmountToTwoDecimals_EvenForWholeDollarValues', () => {
    const csv = ledgerToCsv([row({ amount: 50 })]);
    expect(csv).toContain('50.00');
  });
});

describe('finance — summarizeByActivity (pure)', () => {
  function row(partial: Partial<ActivityTransactionRow>): ActivityTransactionRow {
    return {
      activity_label: 'Can Drive',
      amount: 10,
      account: 'checking',
      voided_at: null,
      occurred_on: '2026-08-18',
      ...partial
    };
  }

  it('SummarizeByActivity_ExcludesRowsWithNoActivityLabel', () => {
    const summary = summarizeByActivity([row({ activity_label: null }), row({ activity_label: '' })]);
    expect(summary).toEqual([]);
  });

  it('SummarizeByActivity_ExcludesVoidedRows', () => {
    const summary = summarizeByActivity([row({ voided_at: '2026-08-18T00:00:00Z' })]);
    expect(summary).toEqual([]);
  });

  it('SummarizeByActivity_SplitsIncomeAndExpense_AndComputesNet', () => {
    const summary = summarizeByActivity([
      row({ amount: 100 }),
      row({ amount: -40 }),
      row({ amount: 20 })
    ]);
    expect(summary).toHaveLength(1);
    expect(summary[0].income).toBe(120);
    expect(summary[0].expense).toBe(-40);
    expect(summary[0].net).toBe(80);
    expect(summary[0].count).toBe(3);
  });

  it('SummarizeByActivity_BreaksDownByAccount_WithoutDoubleCountingAcrossActivities', () => {
    const summary = summarizeByActivity([
      row({ amount: 50, account: 'checking' }),
      row({ amount: 30, account: 'scout_account' }),
      row({ activity_label: 'Wreaths', amount: 999, account: 'checking' })
    ]);
    const canDrive = summary.find((s) => s.activityLabel === 'Can Drive')!;
    expect(canDrive.byAccount.checking).toBe(50);
    expect(canDrive.byAccount.scout_account).toBe(30);
    expect(canDrive.net).toBe(80);
    const wreaths = summary.find((s) => s.activityLabel === 'Wreaths')!;
    expect(wreaths.net).toBe(999);
  });

  it('SummarizeByActivity_SortsByMostRecentActivityFirst', () => {
    const summary = summarizeByActivity([
      row({ activity_label: 'Older Event', occurred_on: '2025-01-01' }),
      row({ activity_label: 'Newer Event', occurred_on: '2026-06-01' })
    ]);
    expect(summary[0].activityLabel).toBe('Newer Event');
    expect(summary[1].activityLabel).toBe('Older Event');
  });

  it('SummarizeByActivity_TracksFirstAndLastDate_AcrossTheActivitysRows', () => {
    const summary = summarizeByActivity([
      row({ occurred_on: '2026-03-15' }),
      row({ occurred_on: '2026-01-05' }),
      row({ occurred_on: '2026-02-20' })
    ]);
    expect(summary[0].firstDate).toBe('2026-01-05');
    expect(summary[0].lastDate).toBe('2026-03-15');
  });

  it('SummarizeByActivity_SameDateForFirstAndLast_WhenActivityIsOneDay', () => {
    const summary = summarizeByActivity([row({ occurred_on: '2026-07-18' }), row({ occurred_on: '2026-07-18' })]);
    expect(summary[0].firstDate).toBe('2026-07-18');
    expect(summary[0].lastDate).toBe('2026-07-18');
  });
});

/**
 * editTransactionGuard (pure) — "typos happen all the time" (Patrick,
 * 2026-08-18). Split out of editTransactionAction for the same D-049 reason
 * as decideFinanceViewer: the guard is the part that decides whether a row
 * may be corrected in place, and it belongs under test on its own, not only
 * exercised indirectly through a Server Action that needs next/headers.
 */
describe('editTransactionGuard (pure)', () => {
  it('EditGuard_RefusesEdit_WhenTransactionNotFound', () => {
    expect(editTransactionGuard(null)).toBe('Transaction not found.');
  });

  it('EditGuard_RefusesEdit_WhenRowIsVoided', () => {
    const result = editTransactionGuard({ voided_at: '2026-08-01T00:00:00Z', signup_entry_id: null, reimbursement_id: null });
    expect(result).toMatch(/voided row/i);
  });

  it('EditGuard_RefusesEdit_WhenLinkedToASignupEntry', () => {
    const result = editTransactionGuard({ voided_at: null, signup_entry_id: 42, reimbursement_id: null });
    expect(result).toMatch(/event-fee payment/i);
  });

  it('EditGuard_RefusesEdit_WhenLinkedToAReimbursement', () => {
    const result = editTransactionGuard({ voided_at: null, signup_entry_id: null, reimbursement_id: 7 });
    expect(result).toMatch(/reimbursement payout/i);
  });

  it('EditGuard_AllowsEdit_WhenRowIsPlainAndUnlinked', () => {
    expect(editTransactionGuard({ voided_at: null, signup_entry_id: null, reimbursement_id: null })).toBeNull();
  });
});

describe('finance — schema constraints (requires local Supabase)', () => {
  let transactionIds: number[] = [];
  let personIds: number[] = [];

  afterEach(async () => {
    const admin = adminClient();
    if (transactionIds.length > 0) {
      await admin.from('financial_transactions').delete().in('id', transactionIds);
    }
    if (personIds.length > 0) {
      await admin.from('people').delete().in('id', personIds);
    }
    transactionIds = [];
    personIds = [];
  });

  async function makePerson(admin: ReturnType<typeof adminClient>, name = 'Finance Probe'): Promise<number> {
    const { data, error } = await admin
      .from('people')
      .insert({ display_name: `[TEST] ${name}` })
      .select('id')
      .single();
    if (error || !data) throw new Error(`fixture: people insert failed: ${error?.message}`);
    const id = data.id as number;
    personIds.push(id);
    return id;
  }

  it('FinancialTransactions_RejectsScoutAccountRow_WhenPersonIdMissing', async () => {
    const admin = adminClient();
    const { error } = await admin.from('financial_transactions').insert({
      occurred_on: '2026-08-18',
      account: 'scout_account',
      amount: 10,
      kind: 'fundraiser',
      person_id: null
    });
    expect(error).not.toBeNull();
  });

  it('FinancialTransactions_AllowsScoutAccountRow_WhenPersonIdPresent', async () => {
    const admin = adminClient();
    const personId = await makePerson(admin);
    const { data, error } = await admin
      .from('financial_transactions')
      .insert({
        occurred_on: '2026-08-18',
        account: 'scout_account',
        amount: 10,
        kind: 'fundraiser',
        person_id: personId
      })
      .select('id')
      .single();
    expect(error).toBeNull();
    if (data) transactionIds.push(data.id as number);
  });

  it('FinancialTransactions_RejectsZeroAmount_WhenAmountEqualsZero', async () => {
    const admin = adminClient();
    const { error } = await admin.from('financial_transactions').insert({
      occurred_on: '2026-08-18',
      account: 'checking',
      amount: 0,
      kind: 'expense'
    });
    expect(error).not.toBeNull();
  });

  it('FinancialTransactions_RejectsUnknownAccount_WhenAccountNotInVocabulary', async () => {
    const admin = adminClient();
    const { error } = await admin.from('financial_transactions').insert({
      occurred_on: '2026-08-18',
      account: 'crypto_wallet',
      amount: 10,
      kind: 'income'
    });
    expect(error).not.toBeNull();
  });

  it('PersonCapabilities_AcceptsFinanceManageAndFinanceView_AsValidCapabilities', async () => {
    const admin = adminClient();
    const personId = await makePerson(admin, 'Finance Cap Probe');
    const { error: manageError } = await admin
      .from('person_capabilities')
      .insert({ person_id: personId, capability: 'finance.manage' });
    expect(manageError).toBeNull();
    const { error: viewError } = await admin
      .from('person_capabilities')
      .insert({ person_id: personId, capability: 'finance.view' });
    expect(viewError).toBeNull();
    await admin.from('person_capabilities').delete().eq('person_id', personId);
  });

  it('AtLeastOnePerson_HoldsFinanceManage_SoTheFinanceAdminScreenIsNotBricked', async () => {
    const admin = adminClient();
    const { data } = await admin.from('person_capabilities').select('person_id').eq('capability', 'finance.manage');
    expect((data ?? []).length).toBeGreaterThan(0);
  });
});

describe('finance — Phase 2 write-pattern constraints (requires local Supabase)', () => {
  // These test the SCHEMA guarantees addTransferAction / voidTransactionAction
  // / addReconciliationAction / recordEventFeePaymentAction rely on — the
  // actions themselves import next/headers (via requireCapability /
  // createAdminClient) and can't be called directly from this suite, same
  // reasoning as tests/helpers/admin-client.ts. Each test here performs the
  // exact insert/update shape the action performs, using the service-role
  // client directly, so a constraint regression is still caught even though
  // the 'use server' wrapper itself isn't exercised.
  let transactionIds: number[] = [];
  let reconciliationKeys: { account: string; as_of: string }[] = [];

  afterEach(async () => {
    const admin = adminClient();
    if (transactionIds.length > 0) {
      await admin.from('financial_transactions').delete().in('id', transactionIds);
    }
    for (const k of reconciliationKeys) {
      await admin.from('account_reconciliations').delete().eq('account', k.account).eq('as_of', k.as_of);
    }
    transactionIds = [];
    reconciliationKeys = [];
  });

  it('TransferPair_NetsToZero_AcrossCheckingAndSavings', async () => {
    const admin = adminClient();
    const transferGroup = crypto.randomUUID();
    const { data, error } = await admin
      .from('financial_transactions')
      .insert([
        { occurred_on: '2026-08-18', account: 'checking', amount: -50, kind: 'transfer', transfer_group: transferGroup },
        { occurred_on: '2026-08-18', account: 'savings', amount: 50, kind: 'transfer', transfer_group: transferGroup }
      ])
      .select('id, amount');
    expect(error).toBeNull();
    for (const row of data ?? []) transactionIds.push((row as { id: number }).id);
    const sum = (data ?? []).reduce((s, r) => s + Number((r as { amount: number }).amount), 0);
    expect(sum).toBe(0);
  });

  it('VoidTransaction_ExcludesFromBalance_ButPreservesRow', async () => {
    const admin = adminClient();
    const { data } = await admin
      .from('financial_transactions')
      .insert({ occurred_on: '2026-08-18', account: 'checking', amount: 25, kind: 'income' })
      .select('id')
      .single();
    const id = (data as { id: number }).id;
    transactionIds.push(id);

    const { error: voidError } = await admin
      .from('financial_transactions')
      .update({ voided_at: new Date().toISOString() })
      .eq('id', id);
    expect(voidError).toBeNull();

    const { data: after } = await admin
      .from('financial_transactions')
      .select('id, voided_at')
      .eq('id', id)
      .single();
    expect((after as { voided_at: string | null }).voided_at).not.toBeNull();
    // Row still exists — void is an update, never a delete.
    expect(after).not.toBeNull();
  });

  it('RecordEventFeePayment_RejectsSecondRecording_WhenSignupEntryAlreadyLinked', async () => {
    const admin = adminClient();
    // financial_transactions_signup_entry_uq is a partial unique index —
    // signup_entry_id also carries a real FK to signup_entries, so this
    // needs an actual row to reference (read-only use of real data; this
    // test never writes to signup_entries itself). Skips gracefully on a
    // completely empty signups table rather than failing on missing fixture
    // data that isn't this test's job to create.
    const { data: anyEntry } = await admin.from('signup_entries').select('id').limit(1).maybeSingle();
    if (!anyEntry) return;
    const signupEntryId = (anyEntry as { id: number }).id;

    const { data: first, error: firstError } = await admin
      .from('financial_transactions')
      .insert({ occurred_on: '2026-08-18', account: 'checking', amount: 30, kind: 'event_fee', signup_entry_id: signupEntryId })
      .select('id')
      .single();
    expect(firstError).toBeNull();
    if (first) transactionIds.push((first as { id: number }).id);

    const { error: secondError } = await admin
      .from('financial_transactions')
      .insert({ occurred_on: '2026-08-18', account: 'checking', amount: 30, kind: 'event_fee', signup_entry_id: signupEntryId });
    expect(secondError).not.toBeNull();
  });

  it('AccountReconciliations_UpsertsOnAccountAndAsOf_RatherThanDuplicating', async () => {
    const admin = adminClient();
    const key = { account: 'checking', as_of: '2026-01-15' };
    reconciliationKeys.push(key);

    const { error: firstError } = await admin
      .from('account_reconciliations')
      .upsert({ ...key, statement_balance: 100, computed_balance: 100 }, { onConflict: 'account,as_of' });
    expect(firstError).toBeNull();

    const { error: secondError } = await admin
      .from('account_reconciliations')
      .upsert({ ...key, statement_balance: 110, computed_balance: 100 }, { onConflict: 'account,as_of' });
    expect(secondError).toBeNull();

    const { data } = await admin
      .from('account_reconciliations')
      .select('statement_balance')
      .eq('account', key.account)
      .eq('as_of', key.as_of);
    expect((data ?? []).length).toBe(1);
    expect(Number((data as { statement_balance: number }[])[0].statement_balance)).toBe(110);
  });
});

describe('finance — Phase 4 reimbursement_requests (requires local Supabase)', () => {
  // Same D-049 boundary as the Phase 2 suite above: the approve/deny/pay
  // Server Actions import next/headers and can't be called directly here —
  // these prove the schema-level guarantees markReimbursementPaidAction()
  // relies on.
  let requestIds: number[] = [];
  let transactionIds: number[] = [];
  let personIds: number[] = [];

  afterEach(async () => {
    const admin = adminClient();
    if (transactionIds.length > 0) {
      await admin.from('financial_transactions').delete().in('id', transactionIds);
    }
    if (requestIds.length > 0) {
      await admin.from('reimbursement_requests').delete().in('id', requestIds);
    }
    if (personIds.length > 0) {
      await admin.from('people').delete().in('id', personIds);
    }
    requestIds = [];
    transactionIds = [];
    personIds = [];
  });

  async function makePerson(name: string): Promise<number> {
    const admin = adminClient();
    const { data, error } = await admin
      .from('people')
      .insert({ display_name: `[TEST] ${name}` })
      .select('id')
      .single();
    if (error || !data) throw new Error(`fixture: people insert failed: ${error?.message}`);
    const id = data.id as number;
    personIds.push(id);
    return id;
  }

  it('ReimbursementRequests_RejectsZeroOrNegativeAmount_WhenAmountNotPositive', async () => {
    const admin = adminClient();
    const requesterId = await makePerson('Reimbursement Probe');
    const { error } = await admin.from('reimbursement_requests').insert({
      requester_person_id: requesterId,
      amount: 0,
      description: 'Test',
      receipt_path: 'fake/path.pdf'
    });
    expect(error).not.toBeNull();
  });

  it('ReimbursementRequests_RejectsUnknownStatus_WhenStatusNotInVocabulary', async () => {
    const admin = adminClient();
    const requesterId = await makePerson('Reimbursement Probe');
    const { error } = await admin.from('reimbursement_requests').insert({
      requester_person_id: requesterId,
      amount: 10,
      description: 'Test',
      receipt_path: 'fake/path.pdf',
      status: 'pending' // not a real status — 'submitted' is the default/initial one
    });
    expect(error).not.toBeNull();
  });

  it('ReimbursementRequests_DefaultsToSubmitted_WhenStatusOmitted', async () => {
    const admin = adminClient();
    const requesterId = await makePerson('Reimbursement Probe');
    const { data, error } = await admin
      .from('reimbursement_requests')
      .insert({ requester_person_id: requesterId, amount: 10, description: 'Test', receipt_path: 'fake/path.pdf' })
      .select('id, status')
      .single();
    expect(error).toBeNull();
    expect((data as { status: string }).status).toBe('submitted');
    if (data) requestIds.push((data as { id: number }).id);
  });

  it('MarkPaid_LinksTransactionBackToRequest_ViaReimbursementId', async () => {
    // Simulates exactly what markReimbursementPaidAction() does: insert the
    // negative checking transaction with reimbursement_id set, then flip the
    // request to 'paid'. Proves the FK linkage and status transition are
    // both mechanically sound at the schema level.
    const admin = adminClient();
    const requesterId = await makePerson('Reimbursement Probe');
    const { data: reqRow } = await admin
      .from('reimbursement_requests')
      .insert({
        requester_person_id: requesterId,
        amount: 42.5,
        description: 'Test',
        receipt_path: 'fake/path.pdf',
        status: 'approved'
      })
      .select('id')
      .single();
    const requestId = (reqRow as { id: number }).id;
    requestIds.push(requestId);

    const { data: txn, error: txnError } = await admin
      .from('financial_transactions')
      .insert({
        occurred_on: '2026-08-18',
        account: 'checking',
        amount: -42.5,
        kind: 'reimbursement',
        person_id: requesterId,
        reimbursement_id: requestId
      })
      .select('id')
      .single();
    expect(txnError).toBeNull();
    transactionIds.push((txn as { id: number }).id);

    const { error: updateError } = await admin
      .from('reimbursement_requests')
      .update({ status: 'paid' })
      .eq('id', requestId);
    expect(updateError).toBeNull();

    const { data: linked } = await admin
      .from('financial_transactions')
      .select('id')
      .eq('reimbursement_id', requestId)
      .single();
    expect((linked as { id: number }).id).toBe((txn as { id: number }).id);
  });

  it('MarkPaid_RejectsSecondPayoutTransaction_WhenReimbursementAlreadyLinked', async () => {
    // The regression this guards (qa-lead, 2026-08-18, pre-production BLOCK
    // finding): retrying "mark paid" after a partial-failure error (payout
    // transaction written, status update failed) must not be able to create
    // a second real payout for the same request.
    const admin = adminClient();
    const requesterId = await makePerson('Reimbursement Probe');
    const { data: reqRow } = await admin
      .from('reimbursement_requests')
      .insert({
        requester_person_id: requesterId,
        amount: 20,
        description: 'Test',
        receipt_path: 'fake/path.pdf',
        status: 'approved'
      })
      .select('id')
      .single();
    const requestId = (reqRow as { id: number }).id;
    requestIds.push(requestId);

    const { data: first, error: firstError } = await admin
      .from('financial_transactions')
      .insert({ occurred_on: '2026-08-18', account: 'checking', amount: -20, kind: 'reimbursement', reimbursement_id: requestId })
      .select('id')
      .single();
    expect(firstError).toBeNull();
    if (first) transactionIds.push((first as { id: number }).id);

    const { error: secondError } = await admin
      .from('financial_transactions')
      .insert({ occurred_on: '2026-08-18', account: 'checking', amount: -20, kind: 'reimbursement', reimbursement_id: requestId });
    expect(secondError).not.toBeNull();
  });
});
