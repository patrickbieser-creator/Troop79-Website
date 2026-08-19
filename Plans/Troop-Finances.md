# Troop Finances

**Status:** Active — Phases 1, 2, 3, 4, 6 built and browser-verified against real data (2026-08-18).
Phase 5 (reconciliation assistant, stretch) not started. QA review in progress before first production
deploy of the schema + imported historical data.
**Priority:** High

## Overview

Replace the treasurer's standalone `Troop Accounts.xlsx` (CashFlow ledger + Scout Accounts sub-ledger + a
noisy hand-built Dashboard) with a Finances section inside `/admin`, plus a household-scoped family-facing
view. Scope is the **full ledger** — Landmark checking, Landmark savings, and the notional per-scout
sub-accounts — not just the scout-facing slice. No online payment collection in this build (see note
below); money moves the way it does today (Venmo, check, cash, or scout-account balance), and a treasurer
records it. Full historical backfill of the existing spreadsheet (2022–2026, ~647 transactions) is in
scope, including a dedicated one-time cleanup/normalization pass — the import is not a blind dump of
free-text chaos into new columns. **Annual BSA registration/dues is explicitly out of scope** — the troop
doesn't collect dues, and registration tracking is handled in a separate system entirely; this feature
never needs to model it.

## Problem / Opportunity

- Troop finances live in a single Excel file on one person's machine: no family visibility into scout
  account balances, no in-app way to request a reimbursement, no way for a scout/parent to see how a
  balance was built (can drives, wreath sales) without asking the treasurer directly.
- The spreadsheet's own Dashboard sheet is confirmed noise (per Patrick) — not a design or functional
  reference, just evidence of what the treasurer has been trying to answer by hand.
- The site already tracks *owed* for event fees (`event_prices`) and a manual *paid* checkbox
  (`signup_entries.payment_received`) — but nothing connects that to an actual transaction record, and
  nothing at all exists yet for scout-account balances or reimbursements.

## Decisions Locked In (2026-08-18, Patrick)

1. **Full replacement**, not scout-facing-only: the site becomes the books of record for Landmark
   checking, savings, and the scout/scholarship sub-ledgers.
2. **No online payment processing in this build** — not a permanent "never," just out of scope for now.
   Parents keep paying via Venmo/check/cash/scout-account-balance exactly as today; the app tracks
   owed/paid and a treasurer marks payments received. Reimbursement requests are submitted in-app,
   approved/denied by the treasurer, paid the same offline way as now, then marked paid. Revisit online
   collection as a future phase if it's ever worth the integration/compliance surface.
3. **`finance.manage` capability**, granted at launch to **Patrick, Jason, and Mindy**. `finance.view`
   (read-only) ships in the same migration for future use but nobody is granted it yet.
4. **Full historical backfill** of the spreadsheet, not just current balances — families should be able to
   see how a scout's balance was built.
5. **No dues/registration tracking of any kind belongs in this system.** The troop does not collect dues;
   annual BSA registration, due dates, and compliance tracking are handled separately, outside this
   feature entirely. Nothing here models registration — not even as an out-of-band status flag.

## Acceptance Criteria

- [ ] Treasurer can record any transaction (income, expense, transfer, fundraiser proceeds, event fee
      payment, reimbursement payout) against checking, savings, a specific scout's account, or the
      scholarship fund.
- [ ] All balances (checking, savings, each scout, scholarship) are computed from transaction history, not
      a stored/maintained running total.
- [ ] Every finance list/balance loader uses `fetchAllRows()` pagination from day one — this project has a
      documented PostgREST 1000-row silent-truncation gotcha, and the ledger starts at ~650 rows.
- [ ] A signed-in parent/scout (via `t79_identity`) sees only their own household's scout-account balances,
      history, and reimbursement requests — never another family's, never troop-level checking/savings
      activity, and no CSV/export affordance (export is treasurer-only, see below).
- [ ] A parent or scout can submit a reimbursement request with a description and receipt upload; a
      treasurer can approve, deny, or mark it paid; marking paid atomically creates the corresponding
      transaction.
- [ ] Recording an event-fee payment (from either the Finances section or the existing signup workspace's
      "payment received" checkbox) writes exactly one transaction and flips `payment_received` — never
      two independent, driftable facts. A partial unique index makes double-recording structurally
      impossible, not just policy.
- [ ] Mistakes are voided, not deleted — every app-entered transaction carries `voided_at`/`voided_by`, and
      balance queries exclude voided rows. Full audit trail survives every correction.
- [ ] Monthly reconciliation: treasurer enters a statement balance for checking/savings; app shows drift
      against computed balance.
- [ ] CSV export exists for the full ledger, for treasurer backup purposes — `finance.manage`/`finance.view`
      only, not exposed on the family-facing statement page.
- [ ] All 647 historical CashFlow rows and all 38 Scout Accounts rows are imported, normalized (see Import
      below), and validated row-by-row against the spreadsheet's own running-balance columns with zero
      unexplained mismatches. SoFi-coded historical rows import as a closed, historical-only account
      (confirmed fully retired — no current balance, no future activity expected).

## Test Plan

Stubs per phase — name tests for what they verify, fill in during implementation. `db` project unless noted.

**Phase 1 — schema, import, read-only ledger**
- [ ] `ImportScript_ImportsAllRows_WhenGivenFullSpreadsheet()` — 647 CashFlow + 38 Scout Accounts rows land, none dropped, none duplicated.
- [ ] `ImportScript_ResolvesDuplicatePerson_WhenNameIsAnjaliTypo()` — "Anjlai Sankpal-Tatera" resolves to the same `person_id` as "Anjali Sankpal-Tatera".
- [ ] `ImportScript_DecodesExcelSerialDate_WhenRowIsWinnieBlack()` — serial `46011` imports as `2025-12-20`.
- [ ] `ImportScript_InfersAccountFromMovedColumn_WhenCodeIsAmbiguous()` — bare "BL"/casing-variant codes resolve from which of the three running-balance columns actually changed on that row.
- [ ] `ImportValidation_MatchesSpreadsheetRunningBalance_ForEveryAccountAndRow()` — replayed `sum(amount)` per account equals the sheet's BLC/BLS/SA columns at every row, and final per-scout balances match the Scout Accounts sheet exactly (total $2,942.85).
- [ ] `ImportValidation_SofiAccountDerivesToZero_ConfirmingClosedAccount()` — retired account, no current or future balance expected.
- [ ] `ImportScript_InsertsOpeningBalanceAdjustment_WhenPreHistoryGapExists()` — a scout whose CashFlow history can't fully reconstruct their Scout Accounts balance gets one `kind='adjustment'` row at the history boundary, not a silently wrong derived balance.
- [ ] `FinancialTransactions_RejectsScoutAccountRow_WhenPersonIdMissing()` — CHECK constraint enforced.
- [ ] `Balance_ComputesFromTransactionHistory_NotFromStoredColumn()` — no running-balance column exists to go stale.
- [ ] `FinanceLoader_ReturnsAllRows_WhenLedgerExceedsOneThousand()` — pagination guard against the PostgREST cap, tested against a seeded >1000-row fixture.
- [ ] `FinanceCapability_GrantedToLaunchTreasurers_ForPatrickJasonAndMindy()` — seed/migration check, not a runtime code path.

**Phase 2 — treasurer write UI + event-fee integration**
- [ ] `RecordEventFeePayment_WritesOneTransactionAndFlipsPaymentReceived_WhenCalledOnce()` — single writer, no drift.
- [ ] `RecordEventFeePayment_DebitsScoutAccount_WhenMethodIsScoutBalance()`
- [ ] `RecordEventFeePayment_RejectsSecondRecording_WhenSignupEntryAlreadyLinked()` — partial unique index enforced.
- [ ] `TransferPair_NetsToZero_AcrossCheckingAndSavings()`
- [ ] `VoidTransaction_ExcludesFromBalance_ButPreservesRow()`
- [ ] `Reconciliation_FlagsDrift_WhenComputedBalanceMismatchesStatement()`
- [ ] `LedgerExport_IncludesAllTransactions_ForGivenAccountAndDateRange()`
- [ ] `LedgerExport_RequiresFinanceCapability_RejectsFamilySession()` — export is treasurer-only, not a family affordance.
- [ ] `PaymentReceivedDriftReport_FindsOrphans_WhenFlagTrueButNoLinkedTransaction()` — covers legacy pre-cutover rows explicitly (expected, not a bug).

**Phase 3 — family statement page**
- [ ] `FamilyStatement_ShowsOwnHouseholdOnly_WhenParentSignedIn()`
- [ ] `FamilyStatement_ExcludesOtherHouseholds_WhenQueried()` — the actual security-relevant negative test.
- [ ] `FamilyStatement_RequiresIdentitySession_RejectsLegacyFamilyPasswordOnly()`
- [ ] `FamilyStatement_ShowsTransactionHistory_NotJustCurrentBalance()`
- [ ] `FamilyStatement_OffersNoExportAffordance_ByDesign()` — confirms the deliberate scope cut, not an oversight.

**Phase 4 — reimbursements**
- [ ] `ReimbursementRequest_TransitionsSubmittedToApproved_WhenTreasurerActs()`
- [ ] `ReimbursementRequest_CreatesLinkedTransactionAtomically_WhenMarkedPaid()`
- [ ] `ReimbursementRequest_RejectsTransition_WhenActorLacksFinanceManage()`
- [ ] `ReimbursementRequest_AllowsWithdrawal_WhenRequesterActsOnOwnSubmittedRequest()`

**Phase 5 (stretch) — reconciliation assistant**
- [ ] `ReconciliationAssistant_FlagsSingleEntryMatch_WhenOneTransactionEqualsDrift()`
- [ ] `ReconciliationAssistant_FlagsDuplicatePair_WhenTwoTransactionsShareAmountDateAndMemo()`
- [ ] `ReconciliationAssistant_FlagsDecimalShift_WhenAmountScaledByTenOrHundredEqualsDrift()`
- [ ] `ReconciliationAssistant_FlagsMissingTransferLeg_WhenTransferGroupHasOnlyOneRow()`
- [ ] `ReconciliationAssistant_BoundsSearchWindow_ToSincePreviousReconciliation()` — never scans the full history.
- [ ] `ReconciliationAssistant_NeverAutoCorrects_OnlySuggestsForTreasurerReview()`

## Technical Approach

### Schema

One `financial_transactions` table for every money movement, plus one satellite table
(`reimbursement_requests`) for something that is **not** itself a transaction — a request can be denied
with zero money moved. Facts and workflow state live in the satellite; when money actually moves, it's
always a linked `financial_transactions` row.

The single-ledger table matches this project's existing `ledger_entries.kind`-discriminator precedent (and
the spreadsheet's own shape — one CashFlow sheet, one Code column for account, one Category column for
kind). A troop-level bank row and a scout-account credit are the same shape — date, account, signed
amount, kind, method — differing only in whether a person is attached; two transaction tables would force
every balance query and export to UNION them, which is exactly the layering this project's "simplify,
don't layer" convention rejects.

```sql
-- 20260BXXXXXXXX_finance_core.sql
create table public.financial_transactions (
  id             bigserial primary key,
  occurred_on    date not null,
  account        text not null check (account in
                   ('checking','savings','scout_account','scholarship','sofi')),
                   -- checking/savings = real Landmark accounts (BLC/BLS)
                   -- scout_account = NOTIONAL per-scout sub-ledger, commingled in the real bank balance
                   -- scholarship   = notional troop fund (the spreadsheet's 37th "scout account")
                   -- sofi          = retired, fully closed account — historical rows only, derives to $0
  amount         numeric(10,2) not null check (amount <> 0),   -- signed: + in, - out
  kind           text not null check (kind in
                   ('event_fee','fundraiser','donation','expense','reimbursement',
                    'transfer','interest','adjustment','income')),
  method         text check (method in
                   ('venmo','check','cash','scout_account','bank','other')),
  person_id      bigint references public.people(id),   -- required when account='scout_account'
  memo           text,             -- payee/payer free text when not a person, or a note
  activity_label text,             -- normalized version of the spreadsheet's free-text Event field
  transfer_group uuid,             -- links both legs of one real-world movement: a checking↔savings
                                    -- transfer, or a cash deposit that credits both checking AND a
                                    -- scout's notional balance
  signup_entry_id  bigint references public.signup_entries(id),
  reimbursement_id bigint references public.reimbursement_requests(id),
  source         text not null default 'app' check (source in ('import','app')),
  import_row     int,              -- original CashFlow sheet row, audit trail for the backfill
  entered_by_person_id bigint references public.people(id),   -- real FK, not free text
                    -- (this project's person_capabilities.granted_by precedent is explicit that
                    -- ledger_entries.entered_by being free text, not an FK, was a mistake to repeat)
  voided_at      timestamptz,
  voided_by_person_id bigint references public.people(id),
  created_at     timestamptz not null default now(),
  check (account <> 'scout_account' or person_id is not null)
);
create unique index fin_tx_signup_entry_uq
  on public.financial_transactions (signup_entry_id) where signup_entry_id is not null;
-- RLS enabled, zero policies — matches every other table in this project. All reads via
-- createAdminClient(); authorization is 100% app-layer (capability + household scoping).
-- Every loader over this table MUST use fetchAllRows() — ~650 rows at launch, crosses the
-- PostgREST 1000-row cap within ~2 years of normal troop activity.
```

Key decisions inside that shape:

- **Each row moves exactly one account.** A checking→savings transfer is two rows sharing a
  `transfer_group`. A cash deposit into a scout's account is *also* two rows (`checking +50`,
  `scout_account +50` for that scout, same group) because both the real and notional balances move; a
  scout later *spending* that balance on a camp fee is a single `scout_account −50` row (the real cash
  already sat in checking; the troop's payment to camp is its own separate `expense` row when it happens).
  This is quasi-double-entry exactly where it matters, without a full debit/credit framework.
- **Balances are always DERIVED** (`sum(amount) where voided_at is null`, grouped by account and — for
  `scout_account` — by person). Never a maintained running-balance column: that's precisely the
  reconciliation failure mode the spreadsheet already has (three hand-updated running-balance columns).
  Computing on read is free at this scale forever.
- **Void, don't delete.** Every app-entered row can be voided (`voided_at`/`voided_by_person_id`); balance
  queries filter `voided_at is null`. Full audit trail survives every treasurer correction. Import rows may
  be hard-deleted by batch, but only during the import sign-off loop before go-live.
- **No `activities` lookup table.** The 66 historical free-text Event values don't earn a controlled
  vocabulary (this project has an explicit pattern of avoiding redundant tag/lookup layers). Normalize
  spelling once at import time into `activity_label`; new app-entered rows either link a real
  `signup_entry_id`/calendar event or just type a label.
- **No registration/dues table.** Explicitly out of scope — the troop doesn't collect dues, and annual BSA
  registration is tracked in a separate system entirely. Nothing in this schema needs to know about it.

### Satellite: `account_reconciliations`

```sql
create table public.account_reconciliations (
  id bigserial primary key,
  account text not null check (account in ('checking','savings')),
  as_of date not null,
  statement_balance numeric(10,2) not null,   -- typed from the real Landmark statement
  computed_balance  numeric(10,2) not null,   -- sum(amount) snapshot at that moment
  note text,
  reconciled_by_person_id bigint references public.people(id),
  created_at timestamptz not null default now(),
  unique (account, as_of)
);
```

This is the proportionate substitute for full double-entry bookkeeping, which would be the wrong
complexity budget for a volunteer parent treasurer. Monthly, the treasurer types the statement balance;
the app snapshots the computed balance and shows drift. This table is also what the reconciliation
assistant (below) anchors to.

#### Nice-to-have (not required for MVP): reconciliation assistant

Patrick flagged wanting help hunting down mis-entered ledger rows when a statement doesn't match computed
balance, rather than the treasurer manually scanning 650+ rows. Scoped as a **stretch feature layered on
top of Phase 2's basic drift flag**, not a blocker to shipping it:

- Given a drift amount (`statement_balance − computed_balance`) on a reconciliation attempt, run a small
  set of cheap heuristics over transactions in that account since the *previous* reconciliation's `as_of`
  date (the search window is always bounded — never the full 650-row history) and surface ranked
  candidates, not a guaranteed answer:
  - **Single-entry match**: a transaction whose amount exactly equals the drift (classic sign-flip: an
    expense entered as positive instead of negative, or vice versa).
  - **Duplicate-pair match**: two transactions with the same amount, date, and memo/counterparty within a
    few days of each other (an entry accidentally recorded twice).
  - **Decimal-shift match**: a transaction whose amount, scaled by 10x or 100x, equals the drift (a
    transposed-decimal typo — $50.00 entered as $5.00 is the single most common manual-ledger error).
  - **Missing-transfer-leg match**: a `transfer_group` with only one leg present when it should have two
    (the deposit-into-scout-account case above, entered on one side but not the other).
- Present as a "Possible causes" list on the reconciliation screen — treasurer reviews and either
  corrects/voids the flagged row or dismisses the suggestion; the assistant never auto-corrects anything.
- Ships as **Phase 5 (stretch, post-launch)** once real reconciliation data exists to validate the
  heuristics against — building it against synthetic data before any real drift has occurred risks tuning
  it to the wrong error patterns.

### Satellite: `reimbursement_requests`

```sql
create table public.reimbursement_requests (
  id bigserial primary key,
  requester_person_id bigint not null references public.people(id),
  amount numeric(10,2) not null check (amount > 0),
  description text not null,
  receipt_path text not null,       -- private Supabase storage bucket, same pattern as proof_media
  status text not null default 'submitted' check (status in
    ('submitted','withdrawn','approved','denied','paid')),
  denial_reason text,
  decided_by_person_id bigint references public.people(id),
  decided_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now()
);
```

Transitions: `submitted → withdrawn` (requester only, own request); `submitted → approved | denied`
(`finance.manage`); `approved → paid` (`finance.manage` — and marking paid **atomically** creates the
linked `financial_transactions` row: `kind='reimbursement'`, `account='checking'`, negative amount, method
chosen at payment time). `denied` is terminal — no "more info requested" state; treasurer and requester are
expected to just talk. Submitting requires only a verified `t79_identity` — no capability needed for a
household to act on its own behalf.

### Event-fee integration (no duplicate "owed" concept)

- **Owed stays fully derived** from `event_prices` × `signup_entries` (tier × days) exactly as today —
  Finances never copies an owed amount into its own table.
- **Paid becomes a transaction.** The existing action that flips `signup_entries.payment_received` gains a
  required step (method + amount, defaulting to derived-owed but editable for real-world partial/rounded
  payments) and writes the linked `financial_transactions` row in the same call — one writer, not two
  independent facts. Flipping the checkbox back voids the linked row rather than deleting it.
- **`payment_received` stays** as the denormalized boolean the signup UI already reads; the linked
  transaction is the source of truth for the actual money. The partial unique index on `signup_entry_id`
  makes double-recording structurally impossible, not just a policy.
- **Capability split for this one path**: whoever can already mark `payment_received` today keeps that
  power (a leader at check-in shouldn't need the treasurer present) — they're recorded as
  `entered_by_person_id`. All *other* transaction writes require `finance.manage`.
- A drift report (rows `payment_received=true` with no linked transaction, and vice versa) covers legacy
  pre-cutover rows and any future bug — reviewed at reconciliation time, not enforced by a constraint.
  Pre-cutover rows are *expected* to show as drift; exclude them from any alerting.

### Capability & access design

- `finance.manage` (write: transactions, reimbursement decisions/payouts, import tooling, export) and
  `finance.view` (read-only over every treasurer screen) both land in the same migration — extend the
  `person_capabilities` CHECK constraint
  (`next-app/supabase/migrations/20260816120000_person_capabilities.sql`). **Grant `finance.manage` to
  Patrick, Jason, and Mindy in that same migration** — no one gets `finance.view` at launch, it exists for
  future use.
- **Parent/scout self-scope is a new pattern for this codebase** — it is not a capability, it's an
  identity-derived row scope, consistent with the project's zero-policy RLS posture (every table has RLS
  enabled but zero policies; authorization is 100% app-layer). Resolve via household membership: a single
  `resolveFinanceScope(session)` helper returns self plus children (`t79_identity` → `person_id` →
  `household_members` → household → co-members, plus `relationships` rows of type `parent_of`/
  `guardian_of`); every family-facing loader filters `person_id = any(scope)`. Troop-level rows (null
  `person_id`: checking/savings/scholarship) are structurally unreachable from family scope — and the
  family-facing loader offers no export affordance at all (export is treasurer-only).
- **Finance requires `t79_identity` — no legacy `FAMILY_PASSWORD` fallback.** The family password is one
  shared secret across every household; it cannot scope data, so a finance surface behind it would leak
  every family's balances to every other family. This is the first feature in the codebase to hard-require
  real identity rather than degrade to the household gate — deliberate, and justified by being the first
  household-scoped-PII read surface.
- Routes: treasurer UI at `admin/(workspace)/finance/...` (standard `requireCapability('finance.manage')`
  or `'finance.view'` first line, `actions.ts`, `*-workspace.tsx`); family statement lives outside `/admin`,
  gated by identity resolution rather than a capability — see below for exactly where.

### Import / backfill + one-time cleanup pass

One-shot Node/TS script using the service-role client (same pattern as the prior advancement-spreadsheet
import), tagged with a batch marker so it's re-runnable idempotently while the mapping is tuned. **Import
and normalization are explicitly two passes, not one blind dump**: raw extraction, then mapping, then
row-by-row validation.

1. **Extract** raw rows from both sheets as-is (openpyxl), no interpretation yet.
2. **Normalize**:
   - *Category → `kind`*: explicit mapping dictionary (`Event Fee`→`event_fee`, `Can Drive`→`fundraiser`,
     `Donation`→`donation`, `Transfer`→`transfer`, `Expense`/`Reservation Fee`→`expense`; `Income` (46
     rows) needs manual per-row classification by Event text into `fundraiser`/`interest`/`income` —
     budget an hour of treasurer/Patrick time, this is a data question, not a code problem).
   - *Method* (30 near-duplicate free-text values, typos like "Scout Accout") → mapping dictionary
     collapsing to the canonical `method` enum; null is acceptable where genuinely ambiguous.
   - *Event → `activity_label`*: kept as free text, normalized spelling only — not force-mapped to a
     controlled vocabulary or to `events`/calendar rows; most predate this site's events table.
   - *Code → `account`*: `BLC`→`checking`, `BLS`→`savings`, `SA`→`scout_account`, `SoFi`/`Sofi`→`sofi`
     (confirmed retired, fully closed — no current balance, import as historical-only). For ambiguous
     codes (bare `BL`, casing variants), **infer the account from which of the sheet's three
     running-balance columns actually moved on that row** — this doubles as the row's own verification.
   - *Who* → for `scout_account` rows, must resolve to a real `person_id` (name-match against
     people/scouts, including the known "Anjlai"→"Anjali Sankpal-Tatera" merge; script fails loudly, not
     silently, on a non-match). For bank-level rows, goes to `memo` as free text.
   - **Known fixes**: "Winnie Black" row's corrupted Excel serial `46011` decodes to `2025-12-20`;
     "Scholarship Fund" rows → `account='scholarship'`, no `person_id`.
3. **Validate**: replay `sum(amount)` in row order per account and diff against the spreadsheet's own
   three running-balance columns row-by-row — any mismatch is a mapping bug caught at the exact row it
   happens, fixed before go-live. Then diff derived per-scout ending balances against the Scout Accounts
   sheet (total $2,942.85). Where CashFlow history can't fully reconstruct a scout's balance (pre-2022
   activity), insert a single `kind='adjustment'` opening-balance row dated at the history boundary,
   memo'd "opening balance from Scout Accounts sheet" — never leave a silently-wrong derived balance.
   `sofi` account must derive to $0 — a nonzero result flags a mapping error. Script emits a
   reconciliation report; treasurer signs off before the batch is final.

### Phasing (each phase independently shippable)

1. **Schema + capabilities + import, ship dark.** Migrations (including `finance.manage` grants to
   Patrick/Jason/Mindy, and `finance.view` for future use), import + normalization script,
   validation/reconciliation report, one read-only admin ledger view (`finance.view`+) — treasurer(s) and
   Patrick eyeball 4 years of real history before any write UI exists. *Exit: sign-off that derived
   balances match the spreadsheet.*
2. **Treasurer write UI + event-fee cutover.** Add/void transaction, transfer pairs,
   `recordEventFeePayment` (rewires the signup checkbox), reconciliation entry, CSV export for backup
   (treasurer-only — ships in this phase, not later, since it's the backup plan). Entry form should be
   keyboard-fast, matching this codebase's existing Fast Entry ledger precedent — if entering a transaction
   is slower than the spreadsheet, the treasurer will quietly stop using it and the books will fork.
   Treasurer(s) run the app **parallel to the spreadsheet** for 4–6 weeks; cutover after one clean
   reconciliation.
3. **Family statement page.** This is the intended landing spot, already stubbed: `/member`
   (`next-app/src/app/(public)/member/page.tsx`) has a `CARDS` array with a "Scout account" entry
   (currently `href`-less, rendering as a greyed-out "Soon" card alongside Registration/Health
   forms/Wreath sale/Pay for a campout — all deliberately-stubbed future cards on the site's real sign-in
   front door). Phase 3 gives that card a real `href` (a new sub-route, e.g. `/member/scout-account`) and
   builds the page behind it: read-only scout-account history, identity-gated, household-scoped, **no
   export affordance**. `getIdentitySessionIfValid()` already distinguishes adult vs. scout sessions
   (`session.subjectKind`) — a scout signed in directly sees their own account via the "self" half of
   `resolveFinanceScope`, no different code path needed from a parent viewing their kid's.
4. **Reimbursements.** Request submission with receipt upload, treasurer approve/deny/pay workflow,
   atomic linked transaction on payout.
5. **(Stretch, post-launch) Reconciliation assistant.** Drift-diagnosis heuristics (single-entry,
   duplicate-pair, decimal-shift, missing-transfer-leg matches) layered onto the Phase 2 reconciliation
   screen — deferred until real reconciliation drift data exists to validate against.

## Shipped (2026-08-18)

All browser-verified against real production-mirrored local data, not just typechecked. Full detail is in
git history / session record; summary for anyone picking this plan back up:

- **Phase 1** — schema (`financial_transactions`, `account_reconciliations`, `reimbursement_requests`),
  `finance.manage`/`finance.view` capabilities, full 646-row historical import (see the import script's
  own header for the normalization/typo/date-corruption fixes applied), read-only ledger.
- **Phase 2** — treasurer write UI: record transaction, void, transfer, monthly reconciliation, CSV
  export, event-fee integration (roster "payment received" checkbox now opens a method/amount dialog and
  writes a real linked transaction instead of just flipping a flag). Ledger gained column sort (click
  headers) and account/kind/person filters after initial ship.
- **Phase 3** — family statement page (`/member/scout-account`), household-scoped via
  `resolveFamilyScope`. Extended mid-build per Patrick: a `finance.manage` holder (superuser) defaults to
  their OWN family view (not the proxy picker) with a switcher offered to view another scout — picking one
  turns proxy mode on until the next fresh visit from `/member`. See `lib/finance-viewer.ts`.
- **Phase 4** — reimbursement requests: family submission at `/member/reimbursements` (receipt upload via
  a new `receipt-media` Storage bucket, mirroring `proof-media`'s pattern) and treasurer approve/deny/pay
  queue at `/admin/finance/reimbursements`. Approved→paid atomically creates the linked checking
  transaction (`reimbursement_id` FK).
- **Phase 6** — per-activity income/expense report (`/admin/finance/report`), grouped by
  `activity_label`, with a date range and a per-account breakdown per activity (added after the first cut
  didn't show dates and had a header/data alignment bug from mixing a `<table>` with a CSS-grid
  `<details>` body — rebuilt as one shared grid class for both). The Record Transaction form now collects
  Activity (with an autocomplete sourced from existing labels — see the "activities table?" decision
  below) so new entries feed this report too, not just imported history.
- **Dashboard**: added Total Funds (checking + savings) and Available Funds (total funds minus
  scout + scholarship accounts) cards; merged the Scout Accounts and Scholarship Fund cards into one —
  Scholarship is earmarked money, not troop-discretionary cash, same as an individual scout's balance.
- **Ledger display**: Memo and Activity split into separate columns (they were always separate DB
  columns; the display had conflated them); long memos now truncate with a click-to-expand popup
  (mirrors `advancement/ledger/info-cell.tsx`'s exact pattern).
- **Decision: no normalized activities table.** Asked and answered 2026-08-18: a full lookup table
  would need a two-level model anyway (an activity *type* like "Can Drive" vs. a specific *instance* like
  "Can Drive - July '26" aren't the same thing), which is a bigger modeling exercise than the actual
  problem (typo-driven report fragmentation) warrants — and conflicts with this project's standing
  "simplify, don't layer" convention, already applied to this exact field in Phase 1. Shipped a lighter
  safeguard instead: `listDistinctActivityLabelsAction()` powers an HTML `<datalist>` autocomplete on the
  Activity field — a suggestion, not an enforced FK; typing a genuinely new label is always fine.
- **Local dev incident, 2026-08-18**: an unplanned `supabase db reset` mid-session wiped the local DB
  (this repo's `20260817160000` backfill migration can never survive a from-scratch reset — see
  [[feedback-never-reset-local-supabase]]). Recovered via a full production→local data sync (documented in
  [[deployment]]), not by reconstructing from import scripts. No production data was ever at risk.
- **Edit transaction** (Patrick, 2026-08-18: "typos happen all the time"): in-place correction, distinct
  from void. Void is for a transaction that shouldn't have existed; Edit is for one that did happen but
  got keyed in wrong. Refuses voided rows, and rows linked to a signup entry or a reimbursement (those stay
  owned by their one-writer actions). Pure guard (`editTransactionGuard`) lives in `lib/finance.ts`, not the
  `'use server'` actions file — a plain exported function there fails the Next.js build outright (every
  export from a `'use server'` file must itself be an async Server Action), which is a stricter constraint
  than the usual D-049 testability reason for splitting out pure logic.
- **qa-lead review, 2026-08-18** (pre-production, verdict BLOCK) — all findings fixed same session,
  re-verified clean (typecheck/lint/527 db tests/45 dom tests/build all green):
  - CRITICAL: legacy `LEADER_PASSWORD` sessions were granted `finance.manage`/`finance.view` for free via
    `legacyCapabilities()`, contradicting the Patrick/Jason/Mindy-only grant decision. Fixed with a
    `LEGACY_EXCLUDED` set in `lib/admin-actor.ts`; follow-on fix in `sub-nav.tsx`'s `fullAdmin` bypass
    (`NEVER_IMPLIED_BY_FULL_ADMIN`) so the nav doesn't dangle a Finance link that would then throw.
  - CRITICAL: no unique index on `financial_transactions.reimbursement_id`, unlike the already-protected
    `signup_entry_id` — a retried "mark paid" after a partial failure could double-pay a reimbursement.
    Fixed with `financial_transactions_reimbursement_uq`.
  - CRITICAL: `resolveFinanceViewer`'s branching (proxy-available vs. family-default vs. explicit-pick vs.
    none) had zero test coverage. Fixed by extracting a pure `decideFinanceViewer` into
    `lib/finance-viewer.ts` (D-049 pattern) with full branch coverage in `tests/finance-viewer.test.ts`.
  - WARNING: `recordEventFeePaymentAction`/`voidEventFeePaymentAction` required `finance.manage` outright,
    narrower than the plan's stated intent ("whoever can already mark payment_received today keeps that
    power"). Restored to `requireAnyOf(['calendar.write', 'finance.manage'])`.
  - WARNING: a capability failure inside `roster-table.tsx`'s payment dialog threw unhandled instead of
    showing the same friendly error banner as every other failure. Wrapped in try/catch.

## Future Ideas (not yet scoped into a phase)

(Phase 6 above absorbed the original per-event report idea — nothing outstanding here right now.)

## Open Questions

- [ ] Exact CSV export shape (one combined file vs. per-account files) — still just a nice-to-have; the
      current single-file export is fine to ship as-is.
- [ ] Whether a second/backup treasurer beyond Patrick/Jason/Mindy should be granted `finance.manage` —
      revisit if any of the three steps back from the role.
- [ ] Whether the activities autocomplete needs to grow into something more (e.g. seeding it from
      `calendar_entries` titles too) once there's real app-entered post-launch data to see the pattern
      against — not worth guessing at now.

## Notes

- Architecture drafted via an escalated design pass (Fable), corrected once after clarifying there is no
  recurring "dues," then simplified further after Patrick confirmed registration/dues tracking doesn't
  belong in this system at all — the `scout_registrations` table from the intermediate design was removed
  entirely rather than kept as an unused stub. Track only what this feature actually needs.
- Grounded in real current schema: `next-app/supabase/migrations/20260816120000_person_capabilities.sql`
  (capability CHECK to extend — its own commit history is explicit that `ledger_entries.entered_by` being
  free text rather than an FK was a mistake, hence `entered_by_person_id` being a real FK here),
  `20260718100000_event_signup_phase1.sql` (`event_prices` / `signup_entries.payment_received` — the
  integration point), `20260720100000_people_identity_spine.sql` (`people`, `household_members`,
  `relationships` — the household-scoping mechanism), `next-app/src/lib/identity-session.ts` (identity
  resolution), and `next-app/src/app/(public)/member/page.tsx` (the "Scout account" card Phase 3 activates
  — confirmed by Patrick as the intended family-facing home for this feature, not a new top-level route).
- **Known project gotcha this feature must respect**: PostgREST caps unpaginated reads at 1000 rows and
  truncates silently past that — this project has been bitten by it before on other large tables. The
  ledger starts at ~650 imported rows and will cross 1000 within about two years of normal activity; every
  finance loader must use `fetchAllRows()` from day one, not added later when balances start looking wrong.
- **Online payment collection**: explicitly deferred, not rejected. Patrick's framing — "never say never"
  — this build stays offline-tracking-only; a future phase could add real payment processing if it's ever
  worth the integration and compliance surface for a volunteer-run troop site. No design decision here
  should make that harder to add later (e.g., `method` already has room for a future `'online'` value).
- **Risk callouts for Patrick, not yet resolved into acceptance criteria:** this makes the site the real
  books of record — a Vercel/Supabase outage or a write bug now touches actual troop money, not just
  content. Mitigated by CSV export from Phase 2 day one, monthly reconciliation (drift surfaces within
  ~30 days), and a parallel-run period before cutting the spreadsheet loose. The chosen model is
  quasi-double-entry (paired transfer rows) rather than full double-entry — a deliberate complexity
  tradeoff for a one-part-time-developer, volunteer-treasurer project; the residual risk is a mistyped
  amount inside a period staying invisible until the next reconciliation. The commingling invariant
  (`scout_account + scholarship totals ≤ checking + savings`) is surfaced as a dashboard warning, never
  enforced — nothing currently stops troop expenses from spending scouts' notional money, true in the
  spreadsheet today too.
- No existing precedent in this codebase for household-scoped data access (every current capability is
  troop-wide) or for hard-requiring `t79_identity` with no legacy-gate fallback — both are new patterns
  this feature introduces, not reuses. Worth a tech-lead pass on the household-scoping helper specifically
  before Phase 3 ships, since it's the first genuinely security-relevant new access-control shape in the
  project.
- Source data analyzed: `Troop Accounts (2).xlsx` (Patrick's Downloads folder, not in the repo) —
  CashFlow (647 rows, 2022-08–2026-08), Scout Accounts (38 sub-accounts, $2,942.85 total), Dashboard
  (confirmed noise, not a design reference).
