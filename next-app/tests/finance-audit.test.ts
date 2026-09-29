import { describe, it, expect } from 'vitest';
import {
  findPlugs,
  checkReconciliations,
  checkTransfers,
  findLikelyDuplicates,
  checkReimbursements,
  findMisbookedRows,
  compareIndependentTotals,
  balanceThrough,
  type AuditTxn,
  type AuditReconciliation,
  type SqlTotalRow
} from '../src/lib/finance-audit';

/**
 * Ledger Audit (Plans/Ledger-Audit.md) — the ledger-only checks. Fixture
 * memos and amounts are the real rows the 2026-09-22 production backup
 * turned up (#2038, #2133, #1970 …), trimmed to the fields each check reads.
 */
let nextId = 1;
function txn(p: Partial<AuditTxn>): AuditTxn {
  return {
    id: nextId++,
    occurred_on: '2026-03-01',
    account: 'checking',
    amount: -10,
    kind: 'expense',
    method: 'bank',
    person_id: null,
    memo: null,
    transfer_group: null,
    reimbursement_id: null,
    source: 'import',
    voided_at: null,
    created_at: '2026-08-20T21:03:00Z',
    updated_at: null,
    ...p
  };
}

describe('findPlugs', () => {
  it('FindPlugs_FlagsAdjustmentRowsOnCashAccounts', () => {
    const t = txn({ kind: 'adjustment', amount: 60.04, memo: "Can't find discrepancy. Acounting adjustment." });
    expect(findPlugs([t]).map((f) => f.txnIds)).toEqual([[t.id]]);
  });

  it('FindPlugs_FlagsDiscrepancyMemos_EvenWhenKindIsNotAdjustment', () => {
    const t = txn({ kind: 'fundraiser', amount: 100, memo: 'Missing $100 in Income after import' });
    expect(findPlugs([t])[0].txnIds).toEqual([t.id]);
  });

  it('FindPlugs_TreatsTheOpeningBalanceAsInfoNotAWarning', () => {
    const t = txn({ kind: 'adjustment', amount: 3505.33, occurred_on: '2022-01-01', memo: 'Starting Balance at Landmark' });
    expect(findPlugs([t]).map((f) => f.severity)).toEqual(['info']);
  });

  it('FindPlugs_IgnoresVoidedRows', () => {
    expect(findPlugs([txn({ kind: 'adjustment', voided_at: '2026-08-19T22:13:00Z' })])).toEqual([]);
  });

  it('FindPlugs_IgnoresNotionalAccounts', () => {
    expect(findPlugs([txn({ kind: 'adjustment', account: 'scout_account', person_id: 5 })])).toEqual([]);
  });
});

describe('balanceThrough + checkReconciliations', () => {
  const rows = [
    txn({ occurred_on: '2026-08-01', amount: 2288.22, kind: 'adjustment' }),
    txn({ occurred_on: '2026-08-20', amount: 100 }) // after the statement date
  ];
  const recon: AuditReconciliation = {
    id: 1,
    account: 'checking',
    as_of: '2026-08-19',
    statement_balance: 2288.22,
    computed_balance: 2288.22,
    created_at: '2026-08-19T04:51:20Z'
  };

  it('BalanceThrough_CountsOnlyRowsOnOrBeforeTheDate', () => {
    expect(balanceThrough(rows, 'checking', '2026-08-19')).toBe(2288.22);
  });

  it('CheckReconciliations_ComparesTheStatementToTheLedgerAsOfItsOwnDate', () => {
    // The all-time balance (2388.22) would read as $100 drift; as of 8/19 it's clean.
    expect(checkReconciliations(rows, [recon]).map((f) => f.severity)).toEqual(['info']);
  });

  it('CheckReconciliations_ReportsDrift_WhenTheLedgerThroughAsOfDisagrees', () => {
    const f = checkReconciliations([txn({ occurred_on: '2026-08-01', amount: 2188.22 })], [recon]);
    expect(f.map((x) => [x.severity, x.amount])).toEqual([['error', -100]]);
  });

  it('CheckReconciliations_ListsRowsChangedAfterReconciling_InsideTheReconciledPeriod', () => {
    const edited = txn({ occurred_on: '2026-08-10', amount: 0, source: 'app', created_at: '2026-08-19T04:49:00Z', voided_at: '2026-08-19T22:13:00Z' });
    const f = checkReconciliations([...rows, edited], [recon]);
    expect(f.find((x) => x.check === 'reconciliation_changed')?.txnIds).toEqual([edited.id]);
  });
});

describe('checkTransfers', () => {
  it('CheckTransfers_FlagsALinkedPairThatDoesNotNetToZero', () => {
    const f = checkTransfers([
      txn({ kind: 'transfer', amount: -50, transfer_group: 'g1' }),
      txn({ kind: 'transfer', account: 'savings', amount: 40, transfer_group: 'g1' })
    ]);
    expect(f.map((x) => x.check)).toEqual(['transfer_unbalanced']);
  });

  it('CheckTransfers_FlagsALinkedPairWithOnlyOneLegVoided', () => {
    const f = checkTransfers([
      txn({ kind: 'transfer', amount: -50, transfer_group: 'g1', voided_at: '2026-09-01T00:00:00Z' }),
      txn({ kind: 'transfer', account: 'savings', amount: 50, transfer_group: 'g1' })
    ]);
    expect(f.map((x) => x.check)).toEqual(['transfer_half_voided']);
  });

  it('CheckTransfers_PairsUnlinkedCheckingAndSavingsLegs_ByAmountAndDate', () => {
    const f = checkTransfers([
      txn({ kind: 'transfer', amount: -128.22, occurred_on: '2024-08-08' }),
      txn({ kind: 'transfer', account: 'savings', amount: 128.22, occurred_on: '2024-08-09' })
    ]);
    expect(f).toEqual([]);
  });

  it('CheckTransfers_FlagsAnUnlinkedLegWithNoPartner', () => {
    const lone = txn({ kind: 'transfer', amount: -500, occurred_on: '2025-01-01', memo: 'Xfer To *******7120' });
    expect(checkTransfers([lone]).map((x) => x.txnIds)).toEqual([[lone.id]]);
  });

  it('CheckTransfers_IgnoresOutsideCashOuts_TaggedAsTransfer', () => {
    // The spreadsheet tagged every Venmo/PayPal cash-out 'transfer' — money in
    // from outside, never meant to have a savings-side partner.
    expect(checkTransfers([txn({ kind: 'transfer', amount: 340.1, memo: 'VENMO - CASHOUT' })])).toEqual([]);
  });

  it('CheckTransfers_FlagsALoneSavingsTransfer_WithNoMemo', () => {
    const lone = txn({ kind: 'transfer', account: 'savings', amount: 974.78, occurred_on: '2024-06-14' });
    expect(checkTransfers([lone]).map((x) => x.txnIds)).toEqual([[lone.id]]);
  });

  it('CheckTransfers_PairsTransferFundsMemo_WithItsSavingsSide', () => {
    const f = checkTransfers([
      txn({ kind: 'fundraiser', amount: -974.78, memo: "Transfer funds: Scouts' fundraising", occurred_on: '2024-06-14' }),
      txn({ kind: 'transfer', account: 'savings', amount: 974.78, occurred_on: '2024-06-14' })
    ]);
    expect(f.map((x) => x.check)).toEqual(['transfer_mislabeled']);
  });

  it('CheckTransfers_NotesATransferTaggedAsSomethingElse', () => {
    const f = checkTransfers([
      txn({ kind: 'fundraiser', amount: -1025.99, memo: 'Xfer To *******7120 Scouts Share', occurred_on: '2026-02-05' }),
      txn({ kind: 'transfer', account: 'savings', amount: 1025.99, occurred_on: '2026-02-05' })
    ]);
    expect(f.map((x) => [x.check, x.severity])).toEqual([['transfer_mislabeled', 'info']]);
  });
});

describe('findLikelyDuplicates', () => {
  it('FindLikelyDuplicates_FlagsSameAmountSameAccountCloseDatesSimilarMemo', () => {
    const a = txn({ occurred_on: '2026-03-06', amount: -100, memo: 'Owen Radtke deposit; Samoset Council' });
    const b = txn({ occurred_on: '2026-03-06', amount: -100, memo: 'Owen Radke summer camp registration Samoset Council' });
    expect(findLikelyDuplicates([a, b]).map((f) => f.txnIds)).toEqual([[a.id, b.id]]);
  });

  it('FindLikelyDuplicates_IgnoresDifferentAmounts', () => {
    expect(findLikelyDuplicates([txn({ amount: -100 }), txn({ amount: -101 })])).toEqual([]);
  });

  it('FindLikelyDuplicates_IgnoresRowsAWeekApart', () => {
    expect(
      findLikelyDuplicates([txn({ occurred_on: '2026-03-01', memo: 'x' }), txn({ occurred_on: '2026-03-09', memo: 'x' })])
    ).toEqual([]);
  });

  it('FindLikelyDuplicates_IgnoresUnrelatedMemos', () => {
    expect(
      findLikelyDuplicates([txn({ amount: 30, memo: 'Anjali Walters' }), txn({ amount: 30, memo: 'Henry Ellermann' })])
    ).toEqual([]);
  });
});

describe('checkReimbursements', () => {
  it('CheckReimbursements_FlagsAPaidRequestWithNoLivePayout', () => {
    const f = checkReimbursements([txn({ reimbursement_id: 7, voided_at: '2026-09-01T00:00:00Z' })], [{ id: 7, amount: 40, status: 'paid' }]);
    expect(f.map((x) => x.check)).toEqual(['reimbursement_missing_payout']);
  });

  it('CheckReimbursements_FlagsAPayoutWhoseAmountDiffersFromTheRequest', () => {
    const f = checkReimbursements([txn({ reimbursement_id: 7, amount: -45, kind: 'reimbursement' })], [{ id: 7, amount: 40, status: 'paid' }]);
    expect(f.map((x) => x.check)).toEqual(['reimbursement_amount']);
  });

  it('CheckReimbursements_IsQuiet_WhenEveryPaidRequestHasItsPayout', () => {
    expect(checkReimbursements([txn({ reimbursement_id: 7, amount: -40 })], [{ id: 7, amount: 40, status: 'paid' }])).toEqual([]);
  });
});

describe('findMisbookedRows', () => {
  it('FindMisbookedRows_FlagsCashRowsPaidFromAScoutAccount', () => {
    const t = txn({ method: 'scout_account', kind: 'event_fee', amount: 25 });
    expect(findMisbookedRows([t], '2026-09-29').map((f) => f.check)).toEqual(['notional_on_cash']);
  });

  it('FindMisbookedRows_FlagsExpensesRecordedAsMoneyIn', () => {
    const t = txn({ kind: 'expense', amount: 569.64 });
    expect(findMisbookedRows([t], '2026-09-29').map((f) => f.check)).toEqual(['sign']);
  });

  it('FindMisbookedRows_FlagsFutureDatedRows', () => {
    const t = txn({ occurred_on: '2026-10-15' });
    expect(findMisbookedRows([t], '2026-09-29').map((f) => f.check)).toEqual(['future_dated']);
  });

  it('FindMisbookedRows_FlagsANonZeroSofiBalance', () => {
    const t = txn({ account: 'sofi', amount: 5, kind: 'transfer' });
    expect(findMisbookedRows([t], '2026-09-29').map((f) => f.check)).toEqual(['sofi_nonzero']);
  });
});

describe('compareIndependentTotals', () => {
  const rows = [
    txn({ account: 'checking', amount: 0.1 }),
    txn({ account: 'checking', amount: 0.2 }),
    txn({ account: 'scout_account', person_id: 9, amount: 12.5 }),
    txn({ account: 'checking', amount: 999, voided_at: '2026-01-01T00:00:00Z' })
  ];
  const sql: SqlTotalRow[] = [
    { account: 'checking', person_id: null, live_total: 0.3, live_rows: 2, voided_rows: 1 },
    { account: 'scout_account', person_id: 9, live_total: 12.5, live_rows: 1, voided_rows: 0 }
  ];

  it('CompareIndependentTotals_Passes_WhenPostgresAndTheAppAgreeToTheCent', () => {
    expect(compareIndependentTotals(rows, sql).map((f) => f.severity)).toEqual(['info']);
  });

  it('CompareIndependentTotals_Fails_WhenTheAppReadFewerRowsThanExist', () => {
    const f = compareIndependentTotals(rows.slice(1), sql);
    expect(f.some((x) => x.check === 'row_count' && x.severity === 'error')).toBe(true);
  });

  it('CompareIndependentTotals_Fails_WhenAnAccountTotalDiffers', () => {
    const off = [{ ...sql[0], live_total: 0.31 }, sql[1]];
    const f = compareIndependentTotals(rows, off);
    expect(f.some((x) => x.check === 'independent_total' && x.severity === 'error')).toBe(true);
  });
});
