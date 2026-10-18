# Buckets Lookup — one managed link for every money theme

**Status:** SHIPPED v1.236.0 (2026-10-18, e3e8db2) — Release 1 v1.233.0–v1.235.0; Release 2 retired activity_label (D-400)
**Parked:** 2026-10-17
**Priority:** High

## Overview

Replace the free-text `financial_transactions.activity_label` with a managed `buckets` table. Every money row
points at one bucket by id; a calendar entry can point at one too. The Money tab, the Bucket Report, the
ledger filter, snapshots and future reports all group by that one key. This reverses the 2026-08-18 "no
buckets lookup table" decision (Plans/Troop-Finances.md §"No buckets lookup table", reaffirmed in
20260822180000_event_money_additive.sql: "the calendar entry IS the lookup").

**Naming (Patrick, 2026-10-17):**
- **The word is "Bucket", everywhere a person reads it:** the ledger column and filter, the picker, the Money
  tab, and today's Activity Report, renamed the Bucket Report.
- **Why not the others:** "Activity" is too narrow, and "tag" or "label" too generic. Bucket has a scouting feel.
- **Code:** `buckets` / `bucket_id`. Existing names (`activity_label`, `renameActivityAction`,
  `rename-activity-panel.tsx`) are renamed when their release touches them, or die with the drop.

## Problem / Opportunity

Today three mechanisms each answer "which theme does this money belong to?", and they disagree:

1. **`activity_label` text** — what the Bucket Report, ledger filter and Rename/Merge use.
2. **`financial_transactions.calendar_entry_id`** — what the event Money tab and the snapshot use. Fee rows get
   it via trigger; the ledger Record form never set it until v1.231.0. On 2026-10-17, 430 rows had a label and no
   link; 93 were linked by a one-off production update.
3. **Label heuristics shipped 2026-10-17** — `adoptableLabels` (v1.229.0, the Money tab adopts unlinked rows by
   label) and `eventForLabel` / `calendarEntryForLabel` (v1.231.0, Record/Edit/bulk/Rename set the link from the
   label). These are patches for this exact gap.

The calendar entry is the wrong key for a theme:
- **One theme spans several entries.** Summer Camp '26 = the camp, the trailer load-out, the planning meeting.
- **Many themes have no event.** Can Drive, Wreaths '26, Rummage Sale proceeds after the day.

Patrick wants events, payments, ledger, reports and snapshots all linked around one theme, and is cleaning up
the labels now. Naming discipline: annual themes carry a year suffix ("Wreaths '26"), so collisions are unlikely.

## Acceptance Criteria

- [ ] An `buckets` table exists (id, name unique on its normalised form, created_at, created_by_person_id).
- [ ] Every `financial_transactions` row that had a label — voided rows included — has `bucket_id` pointing at
      its bucket; zero labelled rows without one, checked by a gate query before the drop.
- [ ] `calendar_entries.bucket_id` (nullable, one per entry) is set on every entry that has money rows.
- [ ] One shared loader, `moneyRowsForEntry(entry)`, feeds the Money tab, the snapshot and the rosters money page.
      Each row is counted once even when several entries share the bucket. Fee rows still tie to their signup
      entry for owed/paid.
- [ ] `adoptableLabels`, `eventForLabel`, `calendarEntryForLabel` and `unlinkedEventRows` are deleted.
- [ ] Ledger Record / Edit / bulk use one Bucket picker (search + "+ New bucket…" inline); no free text.
- [ ] Bucket Report groups by bucket_id. Its existing Rename/Merge panel works on ids; merge is one
      transaction (RPC): move rows and calendar entries, then delete the source.
- [ ] Wreath RPCs, event-fee/refund/credit/expense, reimbursement payout and import writers set bucket_id.
- [ ] `activity_label` and `finance_activity_labels()` are dropped (code-first, then DB); CSV export and the
      public scout-account page still print the bucket name through the join.

## Test Plan

- [ ] `Treasurer_CanRecordATransaction_UnderAnExistingBucket`
- [ ] `Treasurer_CanCreateABucket_InlineFromTheRecordForm_OnlyAfterTheSecondConfirm`
- [ ] `Treasurer_SeesNearMatches_BeforeCreatingANewBucket`
- [ ] `Treasurer_CancellingEitherConfirm_CreatesNothing`
- [ ] `Treasurer_CanRecordUnderANonEventBucket` (e.g. Registration Fees — no calendar entry)
- [ ] `BucketReport_ShowsTheSameRowsAndTotals_BeforeAndAfterTheMigration` (regression snapshot from production)
- [ ] `Treasurer_CannotCreate_ADuplicateBucketName_IgnoringCaseAndSpaces` (db constraint)
- [ ] `Treasurer_CanMergeBuckets_AndEveryRowAndCalendarEntryMoves_InOneTransaction`
- [ ] `Treasurer_CanRenameABucket_AndHistoryShowsTheNewName`
- [ ] `Leader_SeesEveryRowOfTheEventsBucket_OnTheMoneyTab` (incl. rows with no signup entry)
- [ ] `MoneyTab_CountsABucketRowOnce_WhenTwoCalendarEntriesShareTheBucket`
- [ ] `Snapshot_ReadsTheSameRowsAsTheMoneyTab` (shared loader)
- [ ] `EventFeePayment_CarriesTheEventsBucket` (writer + fill trigger)
- [ ] `LabelOnlyInsert_GetsItsBucketId_FromTheSyncTrigger` (a missed writer can't leave a gap)
- [ ] `WreathOrderBooking_CarriesTheSalesBucket` (wreath RPC accepts id, still accepts label)
- [ ] `BucketReport_GroupsByBucketId_NotText`
- [ ] `Backfill_LeavesNoLabelledRowWithoutABucket` (migration assertion, also a db test)
- [ ] `Backfill_FoldsCaseAndSpaceVariants_IntoOneBucket`
- [ ] `LedgerCsv_PrintsTheBucketName`

## Technical Approach

- **Schema.**
  - **Table:** `buckets(id bigint identity, name text not null, created_at, created_by_person_id)`.
  - **Uniqueness:** unique index on `lower(btrim(regexp_replace(name, '\s+', ' ', 'g')))`.
  - **Access:** RLS on, service-role only (supabase-security-posture).
- **Links.** `financial_transactions.bucket_id`, `calendar_entries.bucket_id`, and
  `reimbursement_requests.bucket_id` (filled from the entry) are FKs to `buckets(id) on delete restrict`.
  Merge moves the rows before deleting the source, so restrict guards against orphans.
- **Two keys, two jobs (open question 1, tech-lead's firm answer).**
  - `bucket_id` is the only answer to "which theme".
  - `financial_transactions.calendar_entry_id` stays, but only to mean "tied to this specific outing or signup"
    (the fill trigger, owed/paid, roll-call). Nothing groups by theme through it.
  - The Money tab's fallback to `calendar_entry_id` (for an entry with no bucket yet) is temporary. Backfill
    every entry with money so the fallback can be deleted, and the heuristics never come back.
- **Triggers.**
  - **Fill trigger:** extend `financial_transactions_fill_event`. When `signup_entry_id` is set and
    `bucket_id` is null, fill it from the calendar entry's bucket.
  - **Sync trigger (until the drop):** when a row is inserted or updated with a label and no `bucket_id`,
    resolve the label to an id by the normalised name. Any writer that was missed — an import script, a stale
    deploy — then can't leave a gap. It is dropped with the column.
- **Backfill (SQL, set-based).**
  - **How it runs:** `insert … select distinct … on conflict do nothing`, then `update … from`. It runs in SQL,
    not through PostgREST, so the 1000-row cap doesn't apply. Any scripted check uses `fetchAllRows`.
  - **Normalisation:** same expression as the unique index. Each bucket's display name is the most frequent
    spelling under it. '' becomes null.
  - **Voided rows are included**, matching `finance_activity_labels()`.
  - **Idempotent**, and it logs the distinct-label count before and after.
- **Wreath RPCs** (20261105100000, lines 131–168 and 224–226) read `activity_label` from the JSON payload.
  `create or replace` them to accept `bucket_id` while still accepting the label. Switch the code to send ids
  after the RPCs are live.
- **Non-event buckets stay (Patrick, 2026-10-17 — overrides tech-lead on open question 2).**
  - A bucket is any bucket the treasurer reports by: an event (High Cliff Fall '26), a fundraiser (Can Drive),
    or a standing non-event bucket (Registration Fees, Dividends, Interest). All are rows in `buckets`.
  - No type column. A bucket is an "event bucket" because a calendar entry points at it, nothing more.
    The picker and the report can show that, derived from the link.
  - Kind stays what it is (the category of the money movement). Bucket is the bucket. The cleanup folds
    near-duplicates into a few buckets: e.g. Annual Registration, Annual Registration Fee '23, Registration
    Renewal, BSA Registrations '26 → one "Registration Fees" bucket.
- **Adding a bucket on the fly is deliberate, with two confirmations.**
  - **Step 1:** "+ New bucket…" in the picker opens a name box. The existing buckets closest to the typed
    name are listed first ("Did you mean Summer Camp '26?"), and picking one ends the flow there.
  - **Step 2:** "Create a new bucket" opens a confirm dialog. It names the new bucket, says it becomes a
    choice for everyone, and lists the near matches once more. The bucket is created only on that second
    confirm.
  - The unique normalised-name index still blocks an exact duplicate.
- **This year first.**
  - **The goal is accurate 2026 event data.** 2026 rows get the careful pass: every 2026 event's money is under
    its bucket, and every 2026 calendar entry with money points at its bucket.
  - **Older years are backfilled as they are:** label → bucket, no hand review. Their Bucket Report rows
    stay as accurate as they are today.
- **The Bucket Report keeps its shape.** Same rows, totals and drill-down, now grouped by `bucket_id` instead
  of text. This is a regression requirement, not a redesign.
- **Releases** (DB-first for additive, code-first for the drop — the deploy-order rule in DECISIONS). The sync
  trigger makes a separate dual-write release unnecessary (tech-lead), so there are two:
  - **Release 1 (additive, DB-first):**
    - **Migration:** the table, the FK columns, the index, RLS, the backfill, both triggers, and the wreath RPC
      update.
    - **Code:** the writers set `bucket_id`. The one picker replaces free text. Rename/Merge works on ids.
      `moneyRowsForEntry` replaces the Money tab, snapshot and rosters reads. The heuristics are deleted.
  - **Release 2 (tightening, code-first):**
    - **Gate first:** the zero-gap query runs again, since writes kept arriving after Release 1.
    - **Code:** remove every `activity_label` read and write — grep the source and the tests, and watch for
      `select('*')` hiding a dropped column.
    - **Migration:** drop the column, `finance_activity_labels()` and the sync trigger.

## Implementation Steps

1. Patrick finishes the label cleanup (in progress):
   - 2026 events each under one label;
   - non-event labels folded into their buckets;
   - older years left as they are.
2. Freeze: list the distinct normalised labels and row counts from production, with 2026 labels flagged.
   Patrick approves the bucket list.
3. 2026 accuracy pass: every 2026 calendar entry with money gets its bucket. Every 2026 ledger row under an
   event label is checked against that event (counts per bucket, shown to Patrick).
4. Rehearse the Release 1 migration against a restored backup (the local DB is a read-only mirror by policy),
   then push it to production DB-first and verify with the gate query.
5. Release 1 code:
   - **Writers:** set `bucket_id` in addTransactionAction, editTransactionAction, bulkReassignAction, the
     event-fee/refund/credit/expense actions, the reimbursement payout, the wreath payload
     (`lib/wreaths/rules.ts`), and the import scripts.
   - **Picker:** one admin Bucket picker on `--admin-*` tokens, with one styleguide specimen.
   - **Report panel:** the existing Rename/Merge panel works on ids; merge goes through an RPC.
   - **Reads:** `moneyRowsForEntry` serves the Money tab, the snapshot (`snapshot-document.tsx:87-93`) and the
     rosters money page.
   - **Calendar editor:** an Bucket picker on the calendar entry editor.
   - **Delete:** the heuristics and their tests.
6. Backfill `calendar_entries.bucket_id` from linked rows: one bucket → set it; several → list them for
   Patrick. Then delete the temporary `calendar_entry_id` fallback.
7. Release 2: the gate query, removing the label from code and tests, then the drop migration.
8. Record a new DECISIONS entry naming what it reverses (2026-08-18 no-lookup, the 2026-08-22 reaffirmation).

## Open Questions

All decided 2026-10-17. Patrick accepted tech-lead's answers on 1 and 3–6 and overruled 2.

- [x] **1. Does `financial_transactions.calendar_entry_id` stay?**
  - **Tech-lead:** yes, with the narrow role above ("which outing", never "which theme"), and the Money tab
    fallback is temporary.
- [x] **2. Category-like labels** (Dividends, Interest, Registration fees, Transfers, Best Guess):
  - **Decided (Patrick, 2026-10-17):** they stay as non-event buckets, organised into a few buckets.
    Tech-lead had suggested turning them into Kinds; overruled, because the report by bucket is useful.
- [x] **3. How many buckets per calendar entry?**
  - **Tech-lead:** one, nullable. Agreed.
- [x] **4. Should next year's bucket for an annual event be created automatically?**
  - **Tech-lead:** always by hand. Auto-create is speculative, and the inline "+ New bucket…" is cheap.
- [x] **5. Who may create buckets?**
  - **Tech-lead:** `finance.manage` and `calendar.write` can create. Rename, merge and (later) archive are
    `finance.manage` only.
- [x] **6. Does the public scout-account page show the bucket name?**
  - **Tech-lead:** yes, through the join.

## Release 1 as built (2026-10-17) — where it differs from the approach above

- **Sync trigger does more.** For a writer that still sends text, it resolves in this order:
  1. the event's bucket, if the row is linked to an event that has one;
  2. else the bucket the label names, created when new;
  3. and when the event had no bucket, it links the event to that one.

  The label is always rewritten to the bucket's own name. So the wreath RPCs, the event-fee/refund/credit
  actions and the import scripts needed no change in Release 1, and switching the wreath RPCs to bucket ids
  moves to Release 2 with the drop.
- **Rename relabels rows; merge is an RPC.** A bucket rename relabels its rows (`buckets_relabel_rows`), and
  merge is `merge_buckets()`. The picker list comes from `bucket_list()`, which returns last-used and is-event
  without reading rows through PostgREST (no 1000-row cap).
- **Money scope = the bucket OR the event's own rows** (`lib/buckets` `moneyScopeFor`, a PostgREST `or`
  filter). A sign-up's fee rows always show, even when they sit in another bucket. The Money tab, the snapshot
  and the event nav all read through it. `adoptableLabels`, `eventForLabel`, `calendarEntryForLabel` and the old
  `renameActivityAction` are deleted.
- **An event's bucket is set on its Money tab, not in the calendar details form.** It's a one-click control
  that takes effect immediately, and the event's own linked rows move into the bucket with it.
  (`setEventBucketAction`.) Since v1.234.0 (2026-10-18) the same `EventBucketControl` also sits on the calendar
  workbench's Entry tab, below the entry form, so an event with no sign-up can have a bucket too.
- **Reimbursements stay entry-scoped on purpose.** A payout writes a ledger row linked to the event, and the
  trigger buckets it, so no `reimbursement_requests.bucket_id`.
- **The Bucket Report still groups by label in Release 1.** The trigger keeps each label equal to its bucket's
  name, so this is identical to grouping by bucket. The read switches to the bucket join in Release 2, when
  the label column goes.
- **Test hygiene.** A test that writes a label creates a bucket, so `tests/helpers/bucket-cleanup.ts` deletes
  only the buckets the test made that are now empty. It is used in the wreath fixture, finance.test.ts and
  finance-aggregates.
- **Rehearsal (2026-10-17).** The migration ran on production inside BEGIN … ROLLBACK:
  - 39 labels → 39 buckets, 0 labelled rows left without one, 459 rows bucketed;
  - 5 calendar entries linked themselves: 17, 22, 23, 35, 120;
  - production was confirmed unchanged afterward.

## Deferred (tech-lead cuts)

- **Archive:** an archived flag so old buckets drop out of pickers. It can come later, once the picker is long
  enough to need it.
- **A separate buckets manager screen:** the Bucket Report's Rename/Merge panel already does the job.
- **More than one styleguide specimen:** only the picker gets one.

## Notes

- Supersedes the Bucket half of Plans/Troop-Finances.md §"No buckets lookup table" (2026-08-18) and the
  DECISIONS entries that reaffirmed it.
- Today's heuristics (v1.229.0, v1.231.0) are the bridge until Release 1 and are deleted there.
- 2026-10-17 inventory: 51 distinct unlinked labels / 430 rows before the 93-row link.
- Files touching `activity_label` today:
  - `finance/actions.ts` (45 refs)
  - `lib/finance.ts`, `lib/event-money.ts`, `lib/wreaths/rules.ts`
  - `finance/wreaths/actions.ts`
  - `finance-workspace.tsx`, `edit-transaction-dialog.tsx`
  - `report/page.tsx`, `report/rename-activity-panel.tsx`
  - `(public)/member/scout-account/page.tsx`
  - `scripts/import-troop-finances.ts`, `scripts/import-event-sheet.ts`
  - migrations 20260818200000, 20260822180000, 20261102120000 (`finance_activity_labels()`), 20261105100000
    (wreath RPCs)
- The snapshot reads money by `calendar_entry_id` directly (`snapshot-document.tsx:87-93`), and
  `reimbursement_requests` is entry-scoped — both covered by the shared loader and the new column.
- Simplify, don't layer: the test of this plan is that after Release 2 exactly one mechanism answers "which
  theme" — if two remain, the plan failed.
