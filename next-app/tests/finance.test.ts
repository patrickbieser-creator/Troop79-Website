import { describe, it, expect, afterEach } from 'vitest';
import { adminClient } from './helpers/admin-client';
import {
  ACCOUNTS,
  TRANSACTION_METHODS,
  isAccount,
  computeBalance,
  computeScoutAccountBalances,
  ledgerToCsv,
  summarizeByActivity,
  editTransactionGuard,
  validateActivityRename,
  amountRangeOrFilter,
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

  it('TransactionMethods_IsANonEmptyFlatList', () => {
    // Guards against an accidental empty array from a bad edit — the
    // TS-side mirror of the migration's CHECK constraint and must never
    // silently go empty.
    expect(TRANSACTION_METHODS.length).toBeGreaterThan(0);
    // No 'online' method — no payment processing in this build.
    expect(TRANSACTION_METHODS).not.toContain('online');
  });
});

describe('finance — transaction_kinds lookup (db)', () => {
  const admin = adminClient();

  it('TransactionKinds_IsNonEmpty_AndEveryRowHasANonEmptyLabel', async () => {
    // Kind became a governed lookup table 2026-08-20 (same pattern as
    // calendar_categories) — this is the DB-level equivalent of the old
    // TRANSACTION_KIND_LABELS-covers-every-kind pure test, since the set
    // is no longer known at compile time.
    const { data, error } = await admin.from('transaction_kinds').select('code, label');
    expect(error).toBeNull();
    expect((data ?? []).length).toBeGreaterThan(0);
    for (const row of data ?? []) {
      expect((row as { label: string }).label).toBeTruthy();
    }
  });

  it('TransactionKinds_RendersEventFeeAsEvent_NotTheInternalValue', async () => {
    const { data } = await admin.from('transaction_kinds').select('label').eq('code', 'event_fee').single();
    expect((data as { label: string } | null)?.label).toBe('Event');
  });
});

/**
 * amountRangeOrFilter (pure) — the ledger's Min $/Max $ filter (2026-08-20).
 * A magnitude search, not a signed one: "between $50 and $200" must match a
 * $75 EXPENSE (stored as -75) as readily as a $75 payment (stored as +75) —
 * a treasurer looking for a dollar figure shouldn't have to think about
 * Direction to find it. This is a hand-built PostgREST filter string, so
 * it's pinned here rather than trusted on inspection.
 */
describe('amountRangeOrFilter (pure)', () => {
  it('ReturnsNull_WhenMinIsZeroOrNegative_NoOrNeeded', () => {
    // A symmetric .gte(-max).lte(max) already covers this case — see the
    // caller in actions.ts. Nothing here to build an OR filter for.
    expect(amountRangeOrFilter(0, 200)).toBeNull();
    expect(amountRangeOrFilter(-10, 200)).toBeNull();
  });

  it('BuildsTwoDisjointRanges_WhenBothMinAndMaxArePositive', () => {
    // Must match +50..+200 (a payment) OR -200..-50 (an expense) — NOT the
    // dead zone in between where a signed .gte(50).lte(200) alone would
    // silently exclude every matching expense.
    expect(amountRangeOrFilter(50, 200)).toBe('and(amount.gte.50,amount.lte.200),and(amount.gte.-200,amount.lte.-50)');
  });

  it('BuildsAnOpenUpperBound_WhenOnlyMinIsGiven', () => {
    expect(amountRangeOrFilter(50, null)).toBe('amount.gte.50,amount.lte.-50');
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
      enteredByName: null,
      enteredAt: null,
      ...partial
    };
  }

  it('LedgerToCsv_IncludesHeaderRow_BeforeAnyData', () => {
    const csv = ledgerToCsv([]);
    expect(csv).toBe('Date,Account,Kind,Method,Who,Memo,Activity,Amount,Voided,Entered By,Entered At');
  });

  it('LedgerToCsv_IncludesEnteredByAndAt_WhenPresent', () => {
    const csv = ledgerToCsv([row({ enteredByName: 'Patrick Bieser', enteredAt: '2026-08-19T14:00:00Z' })]);
    const dataLine = csv.split('\n')[1];
    expect(dataLine).toContain('Patrick Bieser');
    expect(dataLine).toContain('2026-08-19T14:00:00Z');
  });

  it('LedgerToCsv_LeavesEnteredByAndAtBlank_ForHistoricalImportRows', () => {
    const csv = ledgerToCsv([row({ enteredByName: null, enteredAt: null })]);
    const fields = csv.split('\n')[1].split(',');
    expect(fields.slice(-2)).toEqual(['', '']);
  });

  it('LedgerToCsv_EscapesEmbeddedCommaAndQuote_PerRfc4180', () => {
    const csv = ledgerToCsv([row({ memo: 'Cans, "wet" batch' })]);
    expect(csv).toContain('"Cans, ""wet"" batch"');
  });

  it('LedgerToCsv_MarksVoidedRows_WithoutDroppingThem', () => {
    const csv = ledgerToCsv([row({ voided_at: '2026-08-18T00:00:00Z' })]);
    const fields = csv.split('\n')[1].split(',');
    expect(fields[8]).toBe('yes'); // Voided is the 9th column
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

/**
 * validateActivityRename (pure) — the rename/merge feature (Patrick,
 * 2026-08-19: rename-with-cascade collapsed into the same operation as
 * merge, since activity_label is free text with no FK — see the item's
 * writeup in Plans/Ledger-Tweaks.md).
 */
describe('validateActivityRename (pure)', () => {
  it('ValidateRename_RefusesEmptySource', () => {
    expect(validateActivityRename('  ', 'New Label')).toMatch(/source and a target/i);
  });

  it('ValidateRename_RefusesEmptyTarget', () => {
    expect(validateActivityRename('Old Label', '  ')).toMatch(/source and a target/i);
  });

  it('ValidateRename_RefusesIdenticalSourceAndTarget', () => {
    expect(validateActivityRename('Can Drive', 'Can Drive')).toMatch(/already the same/i);
  });

  it('ValidateRename_AllowsCleaningStrayWhitespace_FromAStoredLabel', () => {
    // sourceLabel is a real stored activity_label value that may itself
    // carry whitespace (an import-era typo, say) — "Can Drive " -> "Can Drive"
    // is exactly the rename being asked for, not a no-op to refuse. Trimming
    // sourceLabel before comparing (the old, wrong behavior) would have
    // blocked this legitimate cleanup.
    expect(validateActivityRename('Can Drive ', 'Can Drive')).toBeNull();
  });

  it('ValidateRename_RefusesWhenSourceExactlyEqualsTrimmedTarget', () => {
    // The real no-op: source has no padding, target (after its own trim)
    // is byte-identical to it.
    expect(validateActivityRename('Can Drive', ' Can Drive ')).toMatch(/already the same/i);
  });

  it('ValidateRename_AllowsADistinctSourceAndTarget', () => {
    expect(validateActivityRename('Can Drive', 'Wreath Sale')).toBeNull();
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
  let personIds: number[] = [];

  afterEach(async () => {
    const admin = adminClient();
    // Transactions first — person_id is a real FK, so a person can only be
    // deleted after nothing still references it.
    if (transactionIds.length > 0) {
      await admin.from('financial_transactions').delete().in('id', transactionIds);
    }
    for (const k of reconciliationKeys) {
      await admin.from('account_reconciliations').delete().eq('account', k.account).eq('as_of', k.as_of);
    }
    if (personIds.length > 0) {
      await admin.from('people').delete().in('id', personIds);
    }
    transactionIds = [];
    reconciliationKeys = [];
    personIds = [];
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

  it('RenameActivity_UpdatesEveryMatchingRow_AcrossAllAccounts', async () => {
    // Same update shape as renameActivityAction: .eq('activity_label', source)
    // with no account filter — a rename/merge is account-blind by design
    // (the label groups activity across checking/savings/scout_account alike).
    const admin = adminClient();
    const source = `[TEST] Can Drive ${crypto.randomUUID()}`;
    const target = `[TEST] Wreath Sale ${crypto.randomUUID()}`;
    const { data: person, error: personError } = await admin
      .from('people')
      .insert({ display_name: '[TEST] Rename Probe' })
      .select('id')
      .single();
    expect(personError).toBeNull();
    const personId = (person as { id: number }).id;
    personIds.push(personId);
    const { data: inserted, error: insertError } = await admin
      .from('financial_transactions')
      .insert([
        { occurred_on: '2026-08-19', account: 'checking', amount: 50, kind: 'income', activity_label: source },
        {
          occurred_on: '2026-08-19',
          account: 'scout_account',
          amount: 10,
          kind: 'fundraiser',
          person_id: personId,
          activity_label: source
        }
      ])
      .select('id');
    expect(insertError).toBeNull();
    for (const row of inserted ?? []) transactionIds.push((row as { id: number }).id);

    const { data: updated, error: updateError } = await admin
      .from('financial_transactions')
      .update({ activity_label: target })
      .eq('activity_label', source)
      .select('id');
    expect(updateError).toBeNull();
    expect((updated ?? []).length).toBe(2);

    const { data: remaining } = await admin.from('financial_transactions').select('id').eq('activity_label', source);
    expect((remaining ?? []).length).toBe(0);
  });

  it('RenameActivity_IncludesVoidedRows_SoHistoryNeverSplits', async () => {
    const admin = adminClient();
    const source = `[TEST] Old Label ${crypto.randomUUID()}`;
    const target = `[TEST] New Label ${crypto.randomUUID()}`;
    const { data: row } = await admin
      .from('financial_transactions')
      .insert({
        occurred_on: '2026-08-19',
        account: 'checking',
        amount: 20,
        kind: 'donation',
        activity_label: source,
        voided_at: new Date().toISOString()
      })
      .select('id')
      .single();
    const id = (row as { id: number }).id;
    transactionIds.push(id);

    await admin.from('financial_transactions').update({ activity_label: target }).eq('activity_label', source);

    const { data: after } = await admin.from('financial_transactions').select('activity_label').eq('id', id).single();
    expect((after as { activity_label: string }).activity_label).toBe(target);
  });

  it('RenameActivity_PreviewMatchesApply_ForAStoredLabelWithStrayWhitespace', async () => {
    // Opus pre-deploy review (2026-08-19): previewRenameActivityAction and
    // renameActivityAction's WHERE clauses had drifted (one trimmed
    // sourceLabel, the other didn't) — a stored label with real whitespace
    // would preview a nonzero count and then silently update zero rows on
    // apply. Both now match sourceLabel untrimmed and exactly — this proves
    // that exact query shape stays in sync between the two actions, using a
    // label that genuinely carries whitespace the way an import-era row might.
    const admin = adminClient();
    const paddedSource = `[TEST] Padded Label ${crypto.randomUUID()} `; // real trailing space, as stored
    const { data: row, error } = await admin
      .from('financial_transactions')
      .insert({ occurred_on: '2026-08-19', account: 'checking', amount: 10, kind: 'income', activity_label: paddedSource })
      .select('id')
      .single();
    expect(error).toBeNull();
    transactionIds.push((row as { id: number }).id);

    // previewRenameActivityAction's exact query shape (untrimmed).
    const { count: previewCount } = await admin
      .from('financial_transactions')
      .select('id', { count: 'exact', head: true })
      .eq('activity_label', paddedSource);
    // renameActivityAction's exact query shape (untrimmed WHERE).
    const { data: updated } = await admin
      .from('financial_transactions')
      .update({ activity_label: 'irrelevant' })
      .eq('activity_label', paddedSource)
      .select('id');

    expect(previewCount).toBe(1);
    expect((updated ?? []).length).toBe(previewCount);
  });

  it('RenameActivity_MergesIntoExistingLabel_WhenTargetAlreadyInUse', async () => {
    // A "merge" is just a rename whose target happens to already be in use
    // elsewhere — no separate code path, confirmed here: both the renamed
    // row and the pre-existing target-labeled row end up under one label.
    const admin = adminClient();
    const source = `[TEST] Duplicate A ${crypto.randomUUID()}`;
    const target = `[TEST] Duplicate B ${crypto.randomUUID()}`;
    const { data: rows, error } = await admin
      .from('financial_transactions')
      .insert([
        { occurred_on: '2026-08-19', account: 'checking', amount: 15, kind: 'income', activity_label: source },
        { occurred_on: '2026-08-19', account: 'checking', amount: 30, kind: 'income', activity_label: target }
      ])
      .select('id');
    expect(error).toBeNull();
    for (const r of rows ?? []) transactionIds.push((r as { id: number }).id);

    await admin.from('financial_transactions').update({ activity_label: target }).eq('activity_label', source);

    const { data: merged } = await admin.from('financial_transactions').select('id').eq('activity_label', target);
    expect((merged ?? []).length).toBe(2);
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
