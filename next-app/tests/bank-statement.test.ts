import { describe, it, expect } from 'vitest';
import {
  parseLandmarkCsv,
  matchStatement,
  dailyDrift,
  persistentShifts,
  buildBankMatchReport,
  BankCsvError,
  type BankRow,
  type LedgerCashRow
} from '../src/lib/bank-statement';

/**
 * Bank Match (Plans/Ledger-Audit.md). Fixtures are real rows from the
 * Landmark checking export (2025-09, the window where the $100 gap opened),
 * header line verbatim — the parser is written against the bank's actual
 * layout, not a guess at it.
 */
const HEADER =
  '"Transaction ID","Posting Date","Effective Date","Transaction Type","Posting Status","Amount","Check Number","Reference Number","Description","Transaction Category","Type","Balance","Memo","Extended Description"';

// Newest first, exactly as Landmark exports it.
const SEPT_2025 = [
  HEADER,
  '"20250922 1150383 27,195 2,934","9/22/2025","9/22/2025","Check","Posted","-271.95000","1039","447978187","Check # 1039: Completed","Checks","Check","1875.31000","COH Food","Check # 1039: Completed"',
  '"20250922 1150383 25,774 2,933","9/22/2025","9/22/2025","Check","Posted","-257.74000","1040","447978186","Check # 1040: Completed","Checks","Check","2147.26000","","Check # 1040: Completed"',
  '"20250918 1150383 53,451 2,932","9/18/2025","9/18/2025","Debit","Posted","-534.51000","","447000001","PICK N SAVE #87 250 W HOLT AVE     MILWAUKEE","Groceries","Debit Card","2405.00000","",""',
  '"20250911 1150383 20,000 2,931","9/11/2025","9/11/2025","Debit","Posted","-200.00000","","446000001","SAMOSETSCOUTI-F71E6SAMOSET.ORG    WIUS","Travel","Debit Card","2939.51000","",""',
  '"20250902 1150383 13,650 2,930","9/2/2025","9/2/2025","Debit","Posted","-136.50000","","445000001","COSTCO *ANNUAL RENE800-774-2678   WAUS","Shopping","Debit Card","3139.51000","",""',
  '"20260929 1150383 1,000 0","","","Credit","Pending","10.00000","","94882034","PBieser  - TRANSFER","","","","","PBieser  - TRANSFER"'
].join('\n');

function bank(date: string, amount: number, extra: Partial<BankRow> = {}): BankRow {
  return { date, amount, balance: null, description: 'x', checkNumber: null, memo: null, ...extra };
}
function led(id: number, occurred_on: string, amount: number, extra: Partial<LedgerCashRow> = {}): LedgerCashRow {
  return { id, occurred_on, amount, memo: null, kind: 'expense', method: 'bank', ...extra };
}

describe('parseLandmarkCsv', () => {
  it('ParseLandmarkCsv_ReturnsRowsOldestFirst_WhenExportIsNewestFirst', () => {
    const s = parseLandmarkCsv(SEPT_2025);
    expect(s.rows.map((r) => r.date)).toEqual(['2025-09-02', '2025-09-11', '2025-09-18', '2025-09-22', '2025-09-22']);
  });

  it('ParseLandmarkCsv_KeepsTheBanksOwnSign_WhenAmountIsAlreadySigned', () => {
    const s = parseLandmarkCsv(SEPT_2025);
    expect(s.rows[0].amount).toBe(-136.5);
  });

  it('ParseLandmarkCsv_SkipsPendingRows_AndCountsThem', () => {
    const s = parseLandmarkCsv(SEPT_2025);
    expect({ n: s.rows.length, pending: s.pendingCount }).toEqual({ n: 5, pending: 1 });
  });

  it('ParseLandmarkCsv_DerivesOpeningBalance_FromTheOldestRow', () => {
    expect(parseLandmarkCsv(SEPT_2025).openingBalance).toBe(3276.01);
  });

  it('ParseLandmarkCsv_ReportsAConsistentBalanceChain_WhenSumsMatchTheBalanceColumn', () => {
    expect(parseLandmarkCsv(SEPT_2025).chainConsistent).toBe(true);
  });

  it('ParseLandmarkCsv_ReadsCheckNumber_WhenPresent', () => {
    const s = parseLandmarkCsv(SEPT_2025);
    expect(s.rows.filter((r) => r.checkNumber).map((r) => r.checkNumber).sort()).toEqual(['1039', '1040']);
  });

  it('ParseLandmarkCsv_Throws_WhenRequiredColumnsAreMissing', () => {
    expect(() => parseLandmarkCsv('"Date","Amount"\n"9/1/2025","1.00"')).toThrow(BankCsvError);
  });

  it('ParseLandmarkCsv_Throws_WhenThereAreNoPostedRows', () => {
    expect(() => parseLandmarkCsv(HEADER)).toThrow(BankCsvError);
  });

  it('ParseLandmarkCsv_Throws_WhenAPostedRowHasABlankAmount', () => {
    // qa-lead: Number('') is 0 — a blank cell must not become a $0.00 row.
    const text = [HEADER, '"id","9/2/2025","9/2/2025","Debit","Posted","","","1","X","x","x","99.00000","",""'].join('\n');
    expect(() => parseLandmarkCsv(text)).toThrow(BankCsvError);
  });

  it('ParseLandmarkCsv_HandlesCommasInsideQuotedFields', () => {
    const text = [
      HEADER,
      '"id","9/2/2025","9/2/2025","Debit","Posted","-1.00000","","1","ACME, INC","x","x","99.00000","",""'
    ].join('\n');
    expect(parseLandmarkCsv(text).rows[0].description).toBe('ACME, INC');
  });
});

describe('matchStatement', () => {
  it('MatchStatement_PairsExactAmounts_WhenBankPostsDaysAfterTheLedgerDate', () => {
    const r = matchStatement([bank('2025-09-19', -534.51)], [led(1, '2025-09-18', -534.51)]);
    expect(r.matched.map((m) => [m.bank.date, m.ledger.id])).toEqual([['2025-09-19', 1]]);
  });

  it('MatchStatement_ReportsBankOnlyRow_WhenLedgerNeverRecordedIt', () => {
    const r = matchStatement([bank('2025-09-02', -136.5)], []);
    expect(r.bankOnly.map((b) => b.amount)).toEqual([-136.5]);
  });

  it('MatchStatement_ReportsLedgerOnlyRow_WhenTheBankNeverSawIt', () => {
    // The real 2025-09 case: one $200 Samoset charge at the bank, a $200 AND a
    // $100 Samoset row in the ledger.
    const r = matchStatement(
      [bank('2025-09-11', -200)],
      [led(1877, '2025-09-12', -200), led(1878, '2025-09-12', -100)]
    );
    expect(r.ledgerOnly.map((l) => l.id)).toEqual([1878]);
  });

  it('MatchStatement_MatchesOneToOne_WhenTwoRowsShareAnAmount', () => {
    const r = matchStatement(
      [bank('2026-03-15', -100)],
      [led(1, '2026-03-15', -100), led(2, '2026-03-15', -100)]
    );
    expect({ matched: r.matched.length, ledgerOnly: r.ledgerOnly.length }).toEqual({ matched: 1, ledgerOnly: 1 });
  });

  it('MatchStatement_PrefersTheNearestDate_WhenSeveralCandidatesFit', () => {
    const r = matchStatement(
      [bank('2026-05-12', 30)],
      [led(1, '2026-05-06', 30), led(2, '2026-05-11', 30)]
    );
    expect(r.matched[0].ledger.id).toBe(2);
  });

  it('MatchStatement_DoesNotPair_WhenDatesAreFurtherApartThanTheWindow', () => {
    const r = matchStatement([bank('2025-11-01', -50)], [led(1, '2025-09-01', -50)]);
    expect(r.matched).toHaveLength(0);
  });

  it('MatchStatement_AllowsAWiderWindow_ForChecks', () => {
    // A check is written (ledger date) and clears weeks later (bank date).
    const r = matchStatement([bank('2025-10-20', -271.95, { checkNumber: '1039' })], [led(1, '2025-09-22', -271.95)]);
    expect(r.matched).toHaveLength(1);
  });

  it('MatchStatement_FlagsNearMiss_WhenDigitsAreTransposed', () => {
    const r = matchStatement([bank('2025-09-02', -136.5)], [led(1, '2025-09-02', -163.5)]);
    expect(r.nearMisses.map((n) => n.reason)).toEqual(['transposed']);
  });

  it('MatchStatement_FlagsNearMiss_WhenTheSignIsFlipped', () => {
    const r = matchStatement([bank('2025-09-02', -45)], [led(1, '2025-09-02', 45)]);
    expect(r.nearMisses.map((n) => n.reason)).toEqual(['sign']);
  });

  it('MatchStatement_FlagsNearMiss_WhenOffByCents', () => {
    const r = matchStatement([bank('2024-09-16', 391.99)], [led(1, '2024-09-16', 392)]);
    expect(r.nearMisses.map((n) => n.reason)).toEqual(['cents']);
  });
});

describe('matchStatement — grouped deposits', () => {
  it('MatchStatement_GroupsLedgerRows_WhenOneBankDepositIsTheirSum', () => {
    // Real 2026-06-09: "$1333.95 Mobile Depo … ACH to Landmark" = 593.95 + 740.
    const r = matchStatement(
      [bank('2026-06-09', 1333.95)],
      [led(2100, '2026-06-09', 593.95), led(2101, '2026-06-09', 740)]
    );
    expect(r.grouped.map((g) => [g.bank.map((b) => b.amount), g.ledger.map((l) => l.id)])).toEqual([[[1333.95], [2100, 2101]]]);
  });

  it('MatchStatement_LeavesGroupedRowsOutOfTheOnlyLists', () => {
    const r = matchStatement(
      [bank('2026-05-12', 60)],
      [led(1, '2026-05-11', 30), led(2, '2026-05-11', 30)]
    );
    expect({ bankOnly: r.bankOnly.length, ledgerOnly: r.ledgerOnly.length }).toEqual({ bankOnly: 0, ledgerOnly: 0 });
  });

  it('MatchStatement_GroupsBankRows_WhenOneLedgerRowIsTheirSum', () => {
    const r = matchStatement(
      [bank('2026-03-09', -100), bank('2026-03-10', -100)],
      [led(1994, '2026-03-04', -200)]
    );
    expect(r.grouped.map((g) => [g.bank.length, g.ledger.map((l) => l.id)])).toEqual([[2, [1994]]]);
  });

  it('MatchStatement_DoesNotGroup_WhenNoSubsetSumsExactly', () => {
    const r = matchStatement(
      [bank('2026-05-12', 61)],
      [led(1, '2026-05-11', 30), led(2, '2026-05-11', 30)]
    );
    expect(r.grouped).toEqual([]);
  });

  it('MatchStatement_PrefersOneToOne_OverAGroup', () => {
    const r = matchStatement(
      [bank('2026-05-12', 60)],
      [led(1, '2026-05-11', 30), led(2, '2026-05-11', 30), led(3, '2026-05-12', 60)]
    );
    expect({ one: r.matched.map((m) => m.ledger.id), grouped: r.grouped.length }).toEqual({ one: [3], grouped: 0 });
  });

  it('MatchStatement_PairsALedgerRowEnteredAWeekAfterTheBankPosted', () => {
    // Real: Square concession deposit posted 5/5, ledger dated 5/11.
    const r = matchStatement([bank('2026-05-05', 285.25)], [led(2051, '2026-05-11', 285.25)]);
    expect(r.matched).toHaveLength(1);
  });
});

describe('dailyDrift + persistentShifts', () => {
  const statement = parseLandmarkCsv(SEPT_2025);

  it('DailyDrift_IsZero_WhenLedgerMatchesTheBankEveryDay', () => {
    const ledger = statement.rows.map((r, i) => led(i + 1, r.date, r.amount));
    const points = dailyDrift(statement, ledger, 3276.01);
    expect(points.every((p) => p.diff === 0)).toBe(true);
  });

  it('DailyDrift_ShowsTheGap_FromTheDayAPhantomLedgerRowLands', () => {
    const ledger = [...statement.rows.map((r, i) => led(i + 1, r.date, r.amount)), led(99, '2025-09-12', -100)];
    const points = dailyDrift(statement, ledger, 3276.01);
    expect(points.map((p) => [p.date, p.diff])).toEqual([
      ['2025-09-02', 0],
      ['2025-09-11', 0],
      ['2025-09-18', -100],
      ['2025-09-22', -100]
    ]);
  });

  it('PersistentShifts_IgnoresTimingGaps_ThatCloseWithinTheSettleWindow', () => {
    const points = [
      { date: '2025-01-01', bankBalance: 0, ledgerBalance: 0, diff: 0 },
      { date: '2025-01-10', bankBalance: 0, ledgerBalance: 0, diff: 588.43 },
      { date: '2025-01-11', bankBalance: 0, ledgerBalance: 0, diff: 0 },
      { date: '2025-03-01', bankBalance: 0, ledgerBalance: 0, diff: 0 }
    ];
    expect(persistentShifts(points)).toEqual([]);
  });

  it('PersistentShifts_ReportsTheWindowWhereALastingGapOpened', () => {
    const points = [
      { date: '2025-07-31', bankBalance: 0, ledgerBalance: 0, diff: 0 },
      { date: '2025-09-11', bankBalance: 0, ledgerBalance: 0, diff: 200 },
      { date: '2025-09-22', bankBalance: 0, ledgerBalance: 0, diff: -100 },
      { date: '2026-02-04', bankBalance: 0, ledgerBalance: 0, diff: 711.41 },
      { date: '2026-02-09', bankBalance: 0, ledgerBalance: 0, diff: -100 },
      { date: '2026-08-31', bankBalance: 0, ledgerBalance: 0, diff: 0 },
      { date: '2026-09-21', bankBalance: 0, ledgerBalance: 0, diff: 0 }
    ];
    expect(persistentShifts(points)).toEqual([
      { from: 0, to: -100, lastSeenAtFrom: '2025-07-31', firstSeenAtTo: '2025-09-22' },
      { from: -100, to: 0, lastSeenAtFrom: '2026-02-09', firstSeenAtTo: '2026-08-31' }
    ]);
  });

  it('PersistentShifts_ReportsAnOngoingGap_WhenTheLastLevelIsNonZero', () => {
    const points = [
      { date: '2025-01-01', bankBalance: 0, ledgerBalance: 0, diff: 0 },
      { date: '2025-02-01', bankBalance: 0, ledgerBalance: 0, diff: -60.04 },
      { date: '2025-02-02', bankBalance: 0, ledgerBalance: 0, diff: -60.04 }
    ];
    expect(persistentShifts(points)).toEqual([
      { from: 0, to: -60.04, lastSeenAtFrom: '2025-01-01', firstSeenAtTo: '2025-02-01' }
    ]);
  });
});

describe('buildBankMatchReport', () => {
  const statement = parseLandmarkCsv(SEPT_2025);
  const exact = statement.rows.map((r, i) => led(i + 1, r.date, r.amount));
  const history = [led(900, '2025-08-01', 3276.01, { kind: 'adjustment' })];

  it('BuildBankMatchReport_UsesTheLedgerBalanceBeforeTheStatement_AsItsOpening', () => {
    const r = buildBankMatchReport(statement, [...history, ...exact]);
    expect(r.openingDiff).toBe(0);
  });

  it('BuildBankMatchReport_IgnoresLedgerRowsOutsideTheStatementDates', () => {
    const r = buildBankMatchReport(statement, [...history, ...exact, led(901, '2025-10-15', -9)]);
    expect(r.match.ledgerOnly).toEqual([]);
  });

  it('BuildBankMatchReport_NamesTheCandidateRows_ForALastingShift', () => {
    const r = buildBankMatchReport(statement, [...history, ...exact, led(1878, '2025-09-12', -100)]);
    expect(r.shifts.map((s) => s.candidates.ledger.map((l) => l.id))).toEqual([[1878]]);
  });

  it('BuildBankMatchReport_Throws_WhenAlmostNothingMatches', () => {
    // Savings rows uploaded against checking: nothing lines up.
    const wrong = [...history, led(1, '2025-09-05', 0.13), led(2, '2025-09-20', 0.12)];
    expect(() => buildBankMatchReport(statement, wrong)).toThrow(BankCsvError);
  });

  it('BuildBankMatchReport_SumsTheUnexplainedRows_OnEachSide', () => {
    const r = buildBankMatchReport(statement, [...history, ...exact, led(1878, '2025-09-12', -100)]);
    expect({ bank: r.bankOnlyTotal, ledger: r.ledgerOnlyTotal }).toEqual({ bank: 0, ledger: -100 });
  });
});
