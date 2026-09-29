# Ledger Audit + Bank Match

**Created:** 2026-09-29 · **Status:** SHIPPED v1.132.0 (2026-09-29, commit ee9cd27) · **Owner:** Patrick

## Why

Patrick, 2026-09-29: "Recurring incidents where the ledger does not balance with the bank
accounts online. I am more suspicious of my ledger than I am of the bank."

Evidence from the 2026-09-22 production backup (read-only analysis, nothing written):

- The arithmetic is sound — an independent exact-decimal re-sum matches the app's
  cents math to the cent. The errors are in what was entered, not how it is added.
- The ledger has only ever "balanced" by plugging: #2038 +$60.04 checking and #2037
  −$2.37 savings (2026-03-31, "Can't find discrepancy"), and #2133 +$100 checking
  (2026-08-20, "missing $100 income after import"; replaced the voided #1486).
- The 2026-08-19 reconciliation matched only because of the $100 plug; #2133 is dated
  8/20, so the ledger through 8/19 now reads $2,188.22 vs the $2,288.22 statement.
- 104 imported `transfer` rows carry no `transfer_group`; at least one savings transfer
  is tagged `fundraiser` (#1970).

A ledger-only audit can list suspects. Only the bank's own transaction list can name the
missing entry — hence the bank match.

## Scope

1. **Ledger Audit** (`/admin/utilities/ledger-audit`, finance.manage OR finance.view):
   - Independent re-sum: Postgres `numeric` totals (new SQL function) vs the app's JS
     balances; row-count completeness (catches the PostgREST 1000-row cap).
   - Plugs: adjustment rows on checking/savings, and "discrepancy"-style memos.
   - Reconciliations: ledger-through-as_of vs statement; rows created/edited/voided
     after a reconciliation but dated inside its period.
   - Transfers: linked legs net to zero and share void state; unlinked checking↔savings
     transfer rows paired by amount within a few days; unpaired ones flagged;
     transfer-looking memos not tagged `transfer`.
   - Likely duplicates: same account + amount, dates close, similar memo.
   - Reimbursement tie-out: every paid request has exactly one live payout of −amount.
   - Checking rows paid "from a scout account" (notional money on the cash ledger);
     SOFI nonzero; future-dated rows.
2. **Bank Match** (same page): upload a Landmark CSV; parse server-side, never stored;
   match to ledger rows in the file's date range by exact amount + date proximity;
   report bank-only rows (missing from the ledger), ledger-only rows (not in the bank),
   and near-misses (transposed digits, off by cents).

Out of scope: auto-fixing anything. The audit reports; the treasurer corrects in the ledger.

## Test Plan

- `tests/finance-audit.test.ts` (pure): one test per check, true positive and a clean
  negative for each; voided rows ignored; cents-exact sums.
- `tests/finance-audit-db.test.ts` (db): SQL totals function matches seeded rows;
  anon/authenticated cannot execute it.
- `tests/bank-match.test.ts` (pure): CSV parsing against the real Landmark column
  layout (sample file from Patrick); exact match, date-lag match, one-to-one greedy
  (two equal amounts), bank-only, ledger-only, near-miss.
- `tests/ledger-audit-report.test.tsx` (dom): findings render grouped by severity; a
  clean audit says so; bank-match upload shows the three result lists.

## Implementation Steps

1. Pure audit checks + tests.
2. Migration: `finance_audit_totals()` (DB-first deploy; additive).
3. Server action + page + Utilities card + nav visibility for finance holders.
4. Bank CSV parser + matcher + tests (blocked on the sample export).
5. Upload UI; quality gate; qa-lead; deploy; run against production with Patrick.
