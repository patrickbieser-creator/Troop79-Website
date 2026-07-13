# Meeting Attendance

**Created:** 2026-07-12 · **Status:** ACTIVE (user-approved scope, Q&A complete)

Track who was at every troop meeting — scouts and leaders — admin-only, with
history back to the troop's first meeting.

## Decisions (from Q&A with Patrick, 2026-07-12)

- Scout attendance = **ledger rows**: new `ledger_kind` value `meeting_attendance`,
  one row per scout per meeting, `code = 'MTG:<date>'` (date-based, **no FK**),
  qty 1, unit `meeting`. Present-only (absence = no row).
- Leader attendance = **separate table** `meeting_attendance_leaders`, keyed by
  `meeting_date` + `leader_code`. Carries a `status` (`'attended'` now,
  `'committed'` reserved) and a nullable `skill_id` so the future meeting-plan
  integration can record "leader X commits to attend and teach skill Y" —
  designed in now, UI later.
- Capture = a dedicated **Roll Call screen** per meeting (checkbox grids for
  scouts and leaders), NOT fast-entry integration. Ledger rows remain
  editable in the Universal Ledger like any other kind.
- Meeting summary counts are **computed at read** (a `security_invoker` counts
  view), never stored on `meetings`.
- Visibility: any admin role may view. Public site excludes the kind entirely
  (scout clipboard ignores unknown kinds; `scout_summary.last_activity_date`
  gets an explicit exclusion).
- Historical import: CSV of **name + date** only (scouts and possibly leaders
  mixed). Backfilled meetings rows = date + title, `status='draft'` (keeps
  them off the public archive), NOT archived (visible in admin list).
- Meetings admin list grows to ~200 rows → add search, year filter, date sort
  toggle, pagination, and an **attendance count column**.
- **Attendance % report per scout** ships now (range-filterable; denominator =
  meetings in range that have ≥1 scout attendance row).
- Meeting-structure cloning: handled in the other session — out of scope here.

## Test plan (no suite yet — lint + build + browser verification)

1. Roll call: check scouts/leaders → Save → rows appear in Universal Ledger
   (kind Meeting Attendance) and leader table; re-open shows checked state;
   uncheck + Save soft-deletes the scout row (visible via Show Hidden) and
   removes the leader row. **Revert all test data afterward.**
2. Counts column matches roll call. Report % matches hand-computed value.
3. Public checks: /scouts/[id] clipboard and /advancement roster show no trace;
   `last_activity_date` unchanged by an attendance row.
4. Import dry-run vs a hand-made 5-row CSV: unmatched names reported, meetings
   auto-created as drafts, re-run is idempotent.

## Implementation steps

1. Migration `20260712060000`: `alter type ledger_kind add value 'meeting_attendance'`
   (own file — enum values can't be used in the transaction that adds them).
2. Migration `20260712060100`: `meeting_attendance_leaders` (RLS on, no anon
   policies) + `meeting_attendance_counts` view (security_invoker) +
   recreate `scout_summary` with `last_act` excluding the new kind.
3. `types.ts`: extend `LedgerKind`, add `MeetingAttendanceLeader`.
4. Kind label maps: ledger-table, ledger-toolbar, row-actions, audit-tape,
   dashboard.
5. Roll Call: `/admin/advancement/meetings/[id]/attendance` (server page +
   client grid + server action, replace-on-save diff: insert new, soft-delete
   unchecked scout rows with reason, hard-delete unchecked leader rows).
6. Meetings list: counts column + Roll Call link + search/year/sort/pagination
   (client-side — ~200 rows).
7. Report: `/admin/advancement/meetings/report` — per-scout attended/held/%
   over a from/to range, active scouts, sortable.
8. `scripts/import-attendance.ts` — `--csv --apply`, name matching against
   scouts + leaders with alias map, auto-create draft meetings, idempotent.
