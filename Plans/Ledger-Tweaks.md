# Ledger Tweaks — Troop Finances Batch

**Status:** COMPLETE — all 9 items shipped 2026-08-19. Opus pre-deploy
review caught one real bug before push: `previewRenameActivityAction` and
`renameActivityAction` had drifted on trim behavior for `sourceLabel` —
would have previewed a nonzero count and silently updated zero rows for
any activity label carrying real whitespace. Fixed (both now match
`sourceLabel` untrimmed and exactly, since it's always a controlled
`<select>` value equal to real stored data — only the free-typed `target`
gets trimmed before being written), plus a matching correction to
`validateActivityRename`'s no-op check and a new regression test. Full
quality gate re-run clean after the fix: 631 tests (554 db + 77 dom).

**Post-push checks for Patrick** (no finance.manage credentials in this
environment — standing constraint):
1. Edit only the memo on one of the 74 backfilled checking rows → confirm
   Who survives (the bug #5 fixed).
2. Confirm those rows' Who dropdown shows a real name — `people_active`
   excludes anyone inactive/aged-out, so a backfilled person who's since
   left the roster won't appear as an option (pre-existing gap, not new).
3. Rename preview → apply on a throwaway label first. **A merge is
   irreversible** — once A folds into B there's no undo. The preview count
   is the only guard before committing.
4. Open the drill-down modal at least once — `<dialog>` is jsdom-polyfilled
   in tests, so real Esc/focus/backdrop behavior is unverified.
5. Confirm a "View event →" link actually resolves — the 2-hop FK chain
   (`signup_entries → event_signups → calendar_entries`) has never run
   against production data.
**Opened:** 2026-08-19
**Priority:** Medium — polish + one real gap (#5 edit UI), not blocking, ledger is live and correct today

## Overview

Eight tweaks to the Troop Finances ledger (`financial_transactions` and the
`/admin/finance` workspace, shipped v1.49.0), raised by Patrick in one batch.
Investigated against actual code/schema/production data before writing this
plan — several items are smaller than they first looked, one assumption
turned out to be wrong, and two items collapsed into one feature. Nothing
below has been built yet.

## Investigation Findings (resolve the open questions from the batch)

**Can existing rows' "Who" be backfilled from the historical import?**
Checked directly against production data. **Corrected from the first pass**
of this investigation, which had a shell-escaping bug in its name-matching
regex (nested backslashes through a Bash-wrapped Node one-liner silently
produced zero matches everywhere) — Patrick caught this by eyeballing real
data (High Adventure Trip '26) and was right to push back. Re-ran as a real
script instead of an inline command; corrected numbers below.

- **Scout Account rows (201 of 201): already done.** The original import
  script (`scripts/import-troop-finances.ts`) resolved `whoRaw` to a real
  `person_id` for every scout-account row at import time. Nothing to backfill.
- **Checking/Savings/other rows (445 rows, person_id null): 85 CAN be
  backfilled by exact name match, 360 genuinely cannot.** The import script
  stashed the spreadsheet's raw "Who" text into `memo` for every
  non-scout-account row without resolving it — for 85 of those rows the
  memo is *exactly* a real person's `display_name` (event-fee payments like
  "High Adventure Trip '26" and "Winter Camp '26," where the treasurer's
  sheet recorded the payer's name and nothing else). The other 360 are
  genuine vendor/bank-line text (Venmo, PayPal, "GFS STORE #1949," etc.)
  with no person to attribute — that part of the original finding holds.
- **Complication found during the corrected check: 11 people in the
  `people` table share a display_name with another person** (two "Lisa
  Pieper" rows, two "Patrick Bieser" rows, two "Mindy Stollenwerk" rows,
  etc. — 11 pairs total, unrelated pre-existing data-quality issue). 11 of
  the 85 exact-name matches are ambiguous against these duplicates and
  can't be auto-resolved by name alone.
- Also noted in passing: production currently holds 649
  `financial_transactions` rows vs. local dev's 646 — local is a few rows
  stale (real post-launch activity, unrelated to this backfill). Not
  blocking, just means don't trust local dev's finance data as current for
  anything time-sensitive.

**Does "Who" already serve both scout-account and event-registration
purposes?** Yes, already, in production code today:
- `recordEventFeePaymentAction` stamps `person_id` from the roster/signup
  entry on every event-fee transaction.
- Reimbursement payout stamps `person_id` from the requester.
- Scout Account rows stamp `person_id` at entry.
One field, one column (`financial_transactions.person_id`, a real FK to
`people`), three sources — Patrick confirmed this should stay one field
rather than being split or relabeled. No rename, no new column.

## Items

### 1. Surface the actor stamp ("who created this entry") — DONE (2026-08-19)

Shipped: `EnteredByCell` (info-cell popup on the Date column, matching
`MemoCell`'s pattern), CSV gained Entered By/Entered At columns. No
migration — the columns already existed. Quality gate green (lint 0/typecheck
clean/tests +4/build clean).


**Already built, never surfaced.** `entered_by_person_id` (FK to `people`)
and `created_at` already exist on `financial_transactions` and are already
written on every insert (`addTransactionAction`, `recordEventFeePaymentAction`,
reimbursement payout). Historical import rows are correctly blank (import
script never set it — matches "existing entries that are blank are fine").
Scope locked: **created-by only**, no "last edited by" column (Patrick:
"Who Created is enough").

**Acceptance criteria**
- [ ] Ledger table (`finance-workspace.tsx`) shows who entered each row and
      when, for rows where it's set; blank for historical/import rows.
- [ ] CSV export (`ledgerToCsv`) gains "Entered by" / "Entered at" columns.
- [ ] No new migration — this is a SELECT + render change only.

**Implementation approach:** add `entered_by_person_id`, `created_at` to the
`LedgerRow` select in `actions.ts`, resolve the name the same way `person_id`
already is, render as a column (or an info-cell popup like memo, if a full
column is too wide).

### 2/3. Rename an Activity, with cascade — which also covers "merge two into one" — DONE (2026-08-19)

Shipped as `previewRenameActivityAction`/`renameActivityAction` +
`RenameActivityPanel` on the Activity Report page (`finance.manage` only).
Two-step preview-then-apply, applies to every matching row including
voided ones. Pure validation extracted to `validateActivityRename` (same
D-049 split as `editTransactionGuard`), 5 pure tests + 3 schema-level tests
+ 5 dom tests (one falsified to confirm it's a real guard).


These are the same operation. `activity_label` is plain free text with no
FK (confirmed: no lookup table, per the 2026-08-18 decision in
`Plans/Troop-Finances.md` not to build one — "too much modeling for a
typo-fragmentation problem"). A rename is `UPDATE financial_transactions SET
activity_label = new WHERE activity_label = old`; a merge is the identical
statement where `new` happens to already be in use elsewhere. One admin
action covers both asks without reopening that decision or adding a lookup
table — it's a bulk edit on the column as it already exists.

**Acceptance criteria**
- [ ] New admin action: pick a source Activity label (from the existing
      `listDistinctActivityLabelsAction()` list), type or pick a target
      label, see an affected-row count before confirming, apply.
- [ ] Applies to every matching row regardless of voided status — active
      and voided history never end up with different label sets.
- [ ] Server action requires `finance.manage`, same as every other write
      path in this module.
- [ ] Activity Report and the ledger's own Activity filter immediately
      reflect the merged/renamed label (no caching to bust).

**Test plan**
- `RenameActivity_UpdatesEveryMatchingRow_AcrossAllAccounts`
- `RenameActivity_ReportsCorrectAffectedCount_BeforeConfirming`
- `RenameActivity_MergesIntoExistingLabel_WhenTargetAlreadyInUse`
- `RenameActivity_IncludesVoidedRows_SoHistoryNeverSplits`

### 4. Drill from Activity Report into transaction detail — DONE (2026-08-19)

Shipped as `getActivityTransactionsAction` + `ActivityDrilldownButton`, a
dedicated modal (Patrick's pick) on each Activity Report row, fetched on
open. Rows with a real `signup_entry_id` resolve the full FK chain
(`signup_entries → event_signups → calendar_entries`) to a precise
"View event →" link; everything else shows the label-matched transaction
list with no event link. 5 dom tests.


Lives in the **Activity Report**, not the ledger — the report is already
the aggregation Patrick wants to inspect, so summary → detail is the natural
direction, and the report already groups by `activity_label`
(`summarizeByActivity` in `lib/finance.ts`).

One refinement found during investigation: event-fee rows carry a real
`signup_entry_id` FK (`financial_transactions.signup_entry_id →
signup_entries → event_signups → calendar_entries`) that's written and
uniqueness-guarded today but never read in any UI. Two precision levels
are available:
- **Exact:** for rows with `signup_entry_id`, jump straight to the specific
  event via the real FK chain.
- **Label match:** for everything else, filter the ledger by
  `activity_label = X` (what a report line already represents).

**Acceptance criteria**
- [ ] Clicking an Activity Report line opens a dedicated modal/panel
      showing the matching transactions — not a navigation away to a
      filtered ledger view.
- [ ] A row with `signup_entry_id` links to the specific calendar
      event/signup, not just the label match.

### 5. "Who" edit UI for rows that can take it — DONE (2026-08-19)

Shipped, and it caught a real live bug: the freshly-backfilled 74 rows from
#5b had a data-loss trap waiting for them — the old submit handlers
unconditionally nulled `personId` for any non-scout_account row, so editing
ANY field (memo, date, amount) on one of those 74 rows would have silently
wiped the Who a treasurer had no idea was even there. Fixed in both
`RecordTransactionForm` and `EditTransactionForm`: Who now always renders,
required only for scout_account, and the submit handlers pass through
whatever's selected regardless of account. Regression test
(`Who_SurvivesEditingAnUnrelatedField_OnANonScoutAccountRow`) written and
falsified against the old behavior to confirm it actually catches this
class of bug before trusting it. 8 new dom tests total, quality gate green.


Confirmed: rows already structurally locked from editing
(`editTransactionGuard` refuses any row with `signup_entry_id` or
`reimbursement_id` set — correctly, since those are driven by the real
signup/reimbursement record and editing "Who" there would desync from it).
The actual gap is narrower than it first looked: **plain scout-account and
manual rows have no way to change who they're attributed to at all** — the
Edit dialog's scout selector only renders `if (account === 'scout_account')`,
and even then there's no path to reassign it to someone else after creation.

Keeping this as **one field, one label ("Who")** — not splitting or
relabeling for its different sources, per Patrick.

**Acceptance criteria**
- [ ] Edit Transaction dialog gets a person-picker for `person_id` on rows
      not locked by `editTransactionGuard`.
- [ ] Rows with `signup_entry_id`/`reimbursement_id` continue to show Who
      read-only (already correct, no change) — editing those still requires
      going through the real signup/reimbursement flow.
- [ ] Change is auditable via item #1's created/entered stamp context (no
      new "last edited by" column, per the scope lock above).

**Test plan**
- `EditTransaction_AllowsReassigningWho_OnAPlainScoutAccountRow`
- `EditTransaction_RefusesToChangeWho_OnAnEventFeeLinkedRow`
- `EditTransaction_RefusesToChangeWho_OnAReimbursementLinkedRow`

### 5b. One-time backfill: resolve "Who" from historical memo text — DONE (2026-08-19)

Applied directly to production via `supabase db query --linked` (dry-run
first, verified count matched, applied, re-verified zero remaining
candidates and the 11 ambiguous rows correctly untouched). 74 rows
backfilled. No code shipped — this was data-only, same category as the
original historical import.


New item, surfaced by Patrick spotting real name-in-memo data the first
investigation pass missed (see corrected finding above). One-time data
cleanup script, same shape as the original import's `resolvePersonId`
logic — not a recurring feature.

**Scope:** 74 of the 85 exact-name matches are unambiguous (memo text
matches exactly one `people.display_name`) — safe to backfill directly.
The other 11 hit a person with a duplicate display_name in the `people`
table and need a decision before touching them (see Open Question below).

**Acceptance criteria**
- [ ] One-time script (mirrors `scripts/import-troop-finances.ts`'s
      `resolvePersonId`/`NAME_ALIAS` pattern): for every non-scout-account
      import row with `person_id IS NULL` and `memo` exactly matching one
      unambiguous `people.display_name`, set `person_id` accordingly.
- [ ] Dry-run output (row id, memo, resolved person, amount, date) for
      Patrick to review before committing, same discipline as the original
      import.
- [ ] Ambiguous rows (11) are listed separately, untouched, pending the
      Open Question below.
- [ ] Run against production directly (same `supabase db query --linked`
      path used to investigate this, not a raw key) — this is existing
      historical data, not a schema change, no migration needed.

**Test plan:** none — this is a one-time data script against production,
same category as the original historical import (which also had no
automated test, just dry-run + validation per Tests/CLAUDE.md's existing
carve-out for that kind of operation).

### 6. Memo field: textarea, multi-line — DONE (2026-08-19)

Record, Transfer, and Edit forms all switched to `<textarea rows={2}>`,
resizable, matching styling added to `.formGrid textarea`.


Trivial. Column is already unbounded `text` — swap the `<input type="text">`
for a `<textarea>` in both `RecordTransactionForm` and
`EditTransactionForm`. No migration, no test-worthy behavior change beyond
"it's a textarea now."

### 7. Tone down the reconciliation warning — DONE (2026-08-19)

New `.staleWarnNote` class (left-border warning-card, same visual language
as the audits page's stale-audit cards) replaces the bold-red paragraph on
the Edit dialog specifically. The Reconciliation Panel's own small inline
drift indicator (`.driftWarn`, a different, already-compact usage) was left
untouched — only the Edit dialog's version was "too loud."


Currently one `<p className={styles.driftWarn}>` — bold, full danger-red,
no background/border/icon (`finance.module.css`: `color:
var(--admin-danger); font-weight: 700;`). It's a nudge, not a block (save
still proceeds — correct, keep that behavior). Restyle only: smaller/lighter
weight, an amber/warning tone instead of full danger-red, optionally a small
icon instead of relying on color+weight alone to carry it. No behavior
change — still fires on the same condition (row date ≤ account's last
reconciliation date), still doesn't block save.

### 8/9. Kind vs. Direction overlap + `event_fee` → "Event" label — DONE (2026-08-19)

Shipped: `KIND_IMPLIED_DIRECTION` + `kindDirectionMismatch` (pure, in
`lib/finance.ts`). Picking a Kind with an unambiguous implied direction
(income/donation/event_fee/interest → in; expense/reimbursement → out)
auto-sets Direction in both Record and Edit forms; `transfer`/`adjustment`
stay manually picked (legitimately ambiguous). A warning (same
`.staleWarnNote` style as #7, never blocking) appears if Direction is then
manually set against the Kind. 8 new tests (4 pure + 4 dom across both
forms), one falsified to confirm it's a real guard.

**Not a lookup table.** `kind` is a free-text `CHECK`-constrained column
(9 values), sharing that exact pattern with `account` and `method`.
Converting only `kind` to a real lookup table would make it inconsistent
with its two siblings for no real gain, and this project has a standing
"simplify, don't layer" convention already applied once to this exact
module (the Activity-label decision above). Recommending against a lookup
table.

**Real fix for the overlap:** `kind` and `direction` (in/out) are fully
independent today — nothing stops picking `kind=expense` with
`direction=in`. Let `kind` imply/default `direction`: `income`, `donation`,
`event_fee`, `interest` → in; `expense`, `reimbursement` → out; `transfer`,
`adjustment` stay manually picked (legitimately ambiguous). Validate they
agree rather than allowing a silent contradiction.

**`event_fee` → "Event":** a label change on the shared `TRANSACTION_KINDS`
const only (`lib/finance.ts`) — the stored value can stay `event_fee`
internally (it's hardcoded at the one write site,
`recordEventFeePaymentAction`, not user-picked, so nothing downstream
depends on the display string). Pure cosmetic, no migration.

**#9 DONE (2026-08-19).** New `TRANSACTION_KIND_LABELS` map in
`lib/finance.ts`, applied at all 4 render sites (Record form, Edit dialog,
ledger table's Kind pill, page.tsx's Kind filter). The Kind/Direction
overlap fix itself (#8's warning behavior) is NOT yet built — only the
label swap shipped so far.

**Acceptance criteria**
- [ ] Direction field defaults from the chosen Kind for the six unambiguous
      values; `transfer`/`adjustment` remain manually picked.
- [ ] Record and Edit forms warn (not reject) on a Kind/Direction
      combination that contradicts the implied mapping — save still
      proceeds, same nudge-not-block pattern as #7.
- [ ] `TRANSACTION_KINDS` display label for `event_fee` changes to "Event"
      everywhere it renders (Record form, Edit dialog, CSV, Activity
      Report if it surfaces Kind).

**Test plan**
- `RecordTransaction_DefaultsDirection_FromTheChosenKind`
- `RecordTransaction_LeavesDirectionManual_ForTransferAndAdjustment`
- `RecordTransaction_WarnsButStillSaves_WhenKindAndDirectionDisagree`

## Open Questions — RESOLVED (default taken, 2026-08-19)

- [x] **#5b:** going with the conservative default — **skip the 11
      ambiguous rows**, backfill only the 74 unambiguous ones now, leave the
      11 for manual correction once #5's edit UI ships. No agent-guessed
      identity resolution on money records.

## Open Questions — RESOLVED (Patrick, 2026-08-19)

- [x] **#2/3:** rename/merge applies to **all rows, including voided ones**
      — no split label sets between active and voided history.
- [x] **#4:** **dedicated modal/panel** on the Activity Report, not a
      filtered ledger view.
- [x] **#8/9:** Kind/Direction contradiction is a **warning, not a hard
      reject** — same nudge-not-block pattern as #7's reconciliation
      warning, consistent within the module.

## Sequencing

Not yet picked. Candidates for a first slice, roughly by size:
- **Smallest, no open questions:** #1 (surface actor stamp), #6 (memo
  textarea), #7 (tone down warning), #9 (event_fee label) — could all ship
  together in one pass.
- **One clear feature, one open question:** #2/3 (rename/merge Activity).
- **Needs the two Open Questions answered first:** #4 (drill-down), #8
  (Kind/Direction).
- **Needs a person-picker component (new, or reuse an existing one from
  Roster/Access):** #5.

## Notes

- All of this lives in `next-app/src/lib/finance.ts`,
  `next-app/src/app/admin/(workspace)/finance/actions.ts`,
  `edit-transaction-dialog.tsx`, `finance-workspace.tsx`, `report/activity-report.tsx`,
  and (for #1/#5/#8) a new migration or two.
- Every write path in this module already gates on `finance.manage` — no
  new access-control surface, just extending existing guarded actions.
- `financial_transactions` has zero RLS policies by design (service-role
  only, same pattern as `person_capabilities`) — not a complication for any
  of this.
- Related project convention: [[feedback-simplify-dont-layer]] — cited
  directly above against building a Kind lookup table or reopening the
  Activity lookup-table question with new schema.
