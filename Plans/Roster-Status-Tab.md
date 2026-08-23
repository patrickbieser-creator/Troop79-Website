# Roster — Status Column Off the Main Grid

**Status:** Built 2026-08-22 (items 1–4, 6–10 shipped together on Patrick's "build these");
**job-code columns BUILT 2026-08-23** (see "Job-heavy events" below — `signup_slots.code` +
`lib/job-codes.ts`, one column per job headed by its code, day bands, Jobs show/hide, claimed-first
sort, Builder code field, snapshot Jobs section); item 5 (guests as people + per-event guest mode)
now has its own plan — `Plans/Guests-As-People.md` (designed 2026-08-23, tech-lead + qa-lead
reviewed, NOT built)
**Parked:** 2026-08-22
**Priority:** Medium
**Bundle:** Pinewoods practice-run findings (this file collects them; add the next ones below)

**What shipped (roster-table.tsx / page.tsx / snapshot / libs; tests in
`tests/roster-grid-bundle.test.tsx`, `tests/roster-grid-shorthand.test.ts`):** Attending /
Other responses tabs (TabStrip, counts; Put back + Remove on the other tab; the old "Removed"
block and the page's Waitlist panel are gone — both folded into the tab); Status, Household,
Slip and the joined Groups column removed from the grid; Driving To/From + Ride To/From as four
stacked-header columns (`.thStack`) with bare seat numbers and `PBieser` / blank-when-unplaced / `self` /
`meeting` / `—` shorthand (`rideShort`, `driverShortName`, `RIDE_STATUS_SHORT`); one column per
non-car set headed by its label (`RosterRow.groupBySet`, `groupSets` prop); Jobs / Answers only
when the event has slots / family questions (`familyQuestionCount`); Class as S / A / JL / Cub /
W / G (`PARTICIPANT_CLASS_SHORT`, full label in title) on grid and snapshot; leader headers
"Health form" / "Registered" (`leaderColumnHeader`, preset `short`) on grid and snapshot; Notes
one-line `.noteCell` with full text in title (snapshot still prints it whole). CSV unchanged in
wording — still carries Household, Status, verbose Ride/Driving, full class, plus the per-set
columns and every row incl. other responses; Slip dropped from the CSV too. Styleguide (admin →
Data Tables) got the stacked-header specimen. DB untouched (`permission_slip_received` and
`needs_permission_slip` remain — retiring them is a migration + builder decision, deferred).

**Same-day tweaks from Patrick's live review (all shipped):** driver shorthand is `PBieser`
(one word); "Owed" header → **Fee** (CSV header unchanged); "Health form" leader header stacks
("Health" over "form"); class pill is a colored categorical pill — youth light / adults dark
(`.classPill`, `.classS` red / `.classJL/.classCub/.classW/.classG` light, `.classA/.classAG` dark, so
youth-guest vs adult-guest G differ by shade); unplaced "needs a ride" cells are **blank**
(hover still says "Needs a ride"); Driving/Ride To/From headers + values centered
(`.thCenter` + `.cellTight`), only those; Name, Class, Participation, Ride To, Ride From and
every group-set column are sortable (`RosterColKey` incl. `set:<id>`); idle ↕ sort glyphs off on
this grid (`SortHeader idleArrow={false}` — Patrick read them as stray quote marks; the
active column keeps ▲/▼, aria-sort intact); Participation values read **Attend / Drv only /
Contributor**; Class and Participation headers + cells carry hover legends explaining the codes
and the available values (`CLASS_LEGEND` / `PARTICIPATION_LEGEND`; `SortHeader` gained a `title` prop); a driver's own Ride To/From cells name their own car
(`PBieser` — "by default, a driver should be assigned to their own car"; the DB already had the
driver as a member of their car, the grid now shows it).
**Event page navigation** (Patrick: "those links are really important — buttons or tabs
consistent with the other admin screens"): new `rosters/[id]/event-nav.tsx` — the shared
link-mode TabStrip (Builder · Roster · Rides & assignments · Money · Snapshot, active tab
selected) rendered identically on Builder, Roster, Rides & assignments and Money; "All signups"
and "Public page" stay as the muted sub-links; test `tests/event-nav.test.tsx`. **Then (Patrick):
"expose the entire navigation at the top at all times … Ride Assignments can go away; move
Patrols, Tents, Cars There, Cars Back in its place, so Money and Snapshot are last"** — EventNav
now renders one tab per assignment set (builder order: Patrols · Tents · Cars there · Cars back),
each opening the board on that set (`?set=<id>`); the board's own inner set tabs are gone (active
set comes from the URL); an event with no sets keeps a single "Rides & assignments" tab. **Snapshot is a workspace page now** (Patrick: "one more step … consistent with
the rest of the tabs"): `/admin/rosters/[id]/snapshot` renders the same document inside the
workspace (sidebar + event tabs + the By patrol / A–Z switch) and its **Print** button opens the
bare print view `/admin/snapshot/[id]` in a new tab; the document itself moved to
`admin/snapshot/[id]/snapshot-document.tsx` (`loadSnapshot` + `SnapshotDocument`) shared by both routes. Car cards on the snapshot no longer repeat the driver's phone (Contacts has it). Snapshot roster
(Patrick, same evening): third order **Adults · JLs · Scouts** (`RosterOrder 'class'`, `classRank`,
then A–Z by last name within); header "Class" → **A/J/S**; one fixed column layout across every
section (`.rosterTable` + `<colgroup>` — Name 1.9in, A/J/S and Grade 0.5in, set columns 1.1in,
Notes takes the rest, all flush left) so sections no longer "weave"; **Patrol / Tent columns**
(`rosterSetColumns` — every non-car set except the one the roster is sectioned by, label
singularized) on the A–Z and class orders, Tent on the by-patrol order. Snapshot "templates": not
separate templates — sections and columns appear only when the event uses the feature (car sets →
Cars, non-car sets → columns / Assignments, prices → Money, family questions → columns), mirroring
the Builder's block checklist; the missing piece is a Jobs section (see the job-heavy plan above).
**Later the same evening:** Participation column dropped from the Attending grid — that tab is
now status yes AND participation full; driver-only and contributor rows sit on Other responses
with their Participation shown (legend tooltip on the header); Fee moved to just left of Balance.
Snapshot roster table: Household, Balance, and the leader columns (Health form / Registered) are
off it (the SPL's copy — family questions stay; leader free text still obeys print_allowed);
Grade is the bare number (K / Grad at the ends); a **print-order switch** on the toolbar — "By
patrol" (default, the sheet) or "A–Z by last name" (`?order=alpha`, `buildRosterSections(input,
order)`, `lastNameKey`).
**Events without rides** (Patrick's question about service projects): when the event has no car
sets (Drivers block off) the four Driving/Ride columns are not rendered at all (`hasCarSets`
prop, item 7's rule) and Notes drops its one-line clamp — Jobs + Notes get the width; the Job
coverage panel above the grid already carries the filled/needed tally.
**Job-heavy events — BUILT 2026-08-23 as proposed below** (Patrick, 2026-08-22: "the rummage sale
will have 20–30 jobs; we should come up with a plan for how that's displayed on the roster").
Decisions at build time: codes are leader-entered in the Builder with the derived code as the
placeholder (initials for multi-word labels, consonant skeleton for one word, digit suffix on
collision — `lib/job-codes.ts`; unique per event by a partial index on `upper(code)`); families
never see codes; CSV keeps its one verbose Jobs column; the Builder's Jobs panel also gained "Add a
job" hidden until clicked (button on the right) and the whole Builder moved its data-entry sections
under a TabStrip (Settings default) — both Patrick, 2026-08-23. Before this, Jobs was ONE
column listing each claim ("Grill — Sat lunch, Setup — Fri") — unreadable at 20–30 jobs. Proposal:
  1. **One narrow column per job**, header = a short **job code** (e.g. `SET`, `CASH`, `TRK`) with
     the full label + when/how many needed in the header tooltip; cell = ✓ (or the claim's note on
     hover); columns only for jobs that exist (item 7's rule). Codes: a new optional
     `signup_slots.code` (3–5 chars, leader-set in the Builder, defaulted from the label's initials,
     unique per event) — a small migration + Builder field.
  2. **Grouping when there are many**: the Builder already orders slots by `slot_date`/`sort`; the
     roster can band the job columns by day (a thin "Fri / Sat / Sun" super-header) so 30 columns
     read as three blocks. A "Jobs" column-group toggle (show / hide) keeps the campout-style
     roster clean when jobs are few or irrelevant.
  3. **The snapshot carries the full detail**: a "Jobs" section listing every job with who claimed
     it and their notes (by day/time), so the printed sheet — not the grid — is the readable
     assignment list; the roster grid is for scanning and editing.
  4. Sorting/filtering: clicking a job-code header sorts claimed-first; the existing per-row Edit
     drawer stays the way to change claims.
  Needs a Builder pass (code field, ordering) + the migration → its own plan/phase; not in this
  bundle. Decide: codes leader-entered vs auto-derived only; whether the family form shows codes
  (probably not — families see full labels).
**Money tab (Patrick, late 2026-08-22):** Balance cell blank at $0; "Credit to account" explained
(overpayment → scout-account +X adjustment row, cash stays in checking, row keeps a "credited" note);
**expenses always name WHO paid** — the add-expense form is now "Who paid" (adult) + "Paid with"
(troop funds → expense row with `person_id` = that leader; their own money → reimbursement request);
`addEventExpenseAction.payerPersonId` is required; the expenses table gained a header row with a
"Who paid" column. Record payment (roster + Money tab): choosing **Scout account balance** shows that
person's current scout-account balance (`getScoutAccountBalanceForEntryAction`, derived from the full
history) and warns when the amount exceeds it. Negative balances (overpaid on the Money tab, overdrawn scout
account in the hint) print red, in parentheses, with the minus sign (`.negMoney`).
**Bug fixed (Patrick, dev, Pinewoods):** Credit to account could be clicked repeatedly — crediting never
changes the event balance, so the row kept reading "overpaid" and the button stayed; three clicks =
three $30 credits. Now `uncreditedOverpayment(balance, credited)` (lib/event-money, tested) drives
it: the button shows only while something is uncredited, the dialog defaults to that amount, the
server refuses anything beyond it ("Already credited $30 — nothing left to credit."), and the Balance
cell says "credited to scout account" once it is. The two duplicate dev rows (#2310, #2311) were voided. **Then the real fix (Patrick: "shouldn't the
balance be zero?" — yes):** migration `20260823100000_entry_balances_credit` — the balances view
nets credits (`balance = owed − paid + credited`, `settled = paid − credited ≥ owed`, new trailing
`credited` column), so a credited overpayment reads settled while Paid still says $60 and the row
notes "$30 credited to account"; `uncreditedOverpayment(balance)` is now just max(0, −balance);
`summarizeEventMoney` uses the view balance for due/overpaid. Deploy: code first (it does not select
the new column), then `supabase db push`. Cars there / Cars back board cards no longer show the driver's phone (Patrick); board chips show the same short colored class
pill as the roster (shared `events/class-pill.tsx`) on patrol / tent / crew sets and no pill on cars.
**Record payment guard (Patrick, late 2026-08-22, same dialog):** choosing Scout account balance or the new
**Scholarship fund** method shows that account's balance; if the amount exceeds it, a warning block
("Not enough … would take the account to (−$X)") with a required acknowledgement checkbox blocks Record
until ticked, and offers "Use the scholarship fund instead" (shows the fund's balance). Shared pure
guard: `events/pay-guard.tsx` (`availableFor`, `wouldGoNegative`, `PayGuard`), used by the roster row
dialog and the Money tab dialog. **Sign bug found and fixed:** the app had been writing scout-account
fee payments as +amount on `scout_account` (raising the scout's balance); now notional accounts
(scout_account, scholarship) get −amount for a fee and +amount for a refund, the balances view flips
notional fee rows to the event's sign (`20260823110000`, which also repairs existing app-written rows),
and the Money tab shows the event's sign via `feeAmount`. Expenses table: "Who paid" now right after Amount.
**Tabs follow the features (Patrick, the Unity Church service project):** no assignment sets → no set tabs
and no "Rides & assignments" placeholder; **Money** only when the event has prices or any money activity
(payments, expenses, reimbursement requests, milestones) — or when you are on the Money page. One shared
loader (`rosters/[id]/event-nav-data.ts` → `loadEventNav`) feeds all five pages. The roster row Edit dialog is data-driven too: Transportation only with car sets, Jobs only with slots (no placeholder text); each job in that list shows its day, time range, "N of M claimed" and description (`slotDetail`) so the editor can choose the right one.
**Open question raised (not built):** a distinct "dropped off by someone else" ride status —
today a parent driving all the way is `self` ("Driving separately") and a drop-off at the
departure point is just `needs_ride`; decide whether to add a value / relabel `self` → "Own ride".

## Overview

The admin roster grid (`/admin/rosters/[id]`) shows every `signup_entries` row with a Status
column (yes / no / waitlist / cancelled). 99% of rows are `yes`; the column and the non-attending
rows waste width on the common case. Move the non-`yes` rows to their own tab and drop the column
from the main grid.

## Problem / Opportunity

The main grid is the working surface for the leader running the event — cars, patrols, money,
leader columns. Declines, waitlist and cancellations are a different question ("who else asked?"),
looked at rarely, and today they sit in the same table, costing a column and rows.

## Acceptance Criteria

- [ ] Main roster tab shows ONLY `status = 'yes'` entries; the Status column is gone from it
      (and from its sort keys / CSV? — see Open Questions).
- [ ] New tab (name TBD — "Not attending" / "Other responses") lists `no`, `waitlist`, and
      `cancelled` entries together, with the status shown per row and a count in the tab label.
- [ ] Waitlist promotion, cancel, and re-activate actions still reachable from the new tab
      (a cancelled or waitlisted person must be able to come back to `yes`).
- [ ] Headcount / owed / balance summaries are unchanged (they were already `yes`-only).
- [ ] Snapshot page and CSV: decide whether they keep the other statuses (Open Questions).

## Test Plan

- [ ] `Roster_MainTab_ListsOnlyYesEntries()` — dom test on the roster table with a mixed fixture
- [ ] `Roster_OtherTab_ListsNoWaitlistCancelledWithStatusBadge()`
- [ ] `Roster_OtherTab_CountInTabLabel()`
- [ ] `Roster_Cancelled_CanBeReactivatedFromOtherTab()`

## Technical Approach

`roster-table.tsx` already splits by `r.status` in places (waitRow class, cancelled muting);
the page shell has a tab strip (Roster / Assignments / Money / …). Partition the rows once in the
page (`yes` vs rest), pass each to the table; the "other" tab reuses the table with a reduced
column set plus a Status badge. Keep `status` on the CSV row (downstream spreadsheets rely on it)
unless Patrick says otherwise.

## Implementation Steps

1. Partition rows in `rosters/[id]/page.tsx`; add the tab + count.
2. Remove the Status column/sort from the main grid; add the badge variant for the other tab.
3. Make sure promote / cancel / reactivate actions are wired on the other tab.
4. dom tests above; styleguide specimen if a new badge variant appears.

## Open Questions

- Tab name? ("Not attending" reads wrong for waitlist.)
- Does the snapshot print the other statuses at all? (Today: cancelled rows muted.)
- Keep Status in the CSV export? (Recommend yes.)

## Bundle — other findings from the Pinewoods practice run

(add items here as they come up; implement together when Patrick says go)

1. Status column → own tab (this plan).
2. **Ride column → two columns, "Ride To" / "Ride From"** (Patrick, 2026-08-22). Today one "Ride"
   cell inlines both legs as `there: … · back: …` (roster-table.tsx ~L519, `rideCell` per leg).
   Split into two narrow columns, one value each; **stack the column labels** (two-line header,
   e.g. "Ride" over "To" / "Ride" over "From") to keep them narrow. Theme: **more grid space** —
   prefer stacked/abbreviated headers and narrow cells throughout the roster. CSV already has
   separate "Ride there"/"Ride back" columns — align wording ("To"/"From") with the grid.
   **Refinement (Patrick, same day): four narrow columns, stacked labels, shorthand values.**
   Driving → two columns "Driving / To" and "Driving / From": value is **just the seat number**
   (e.g. `4`) — no "seats incl. driver" text, it is self-evident; blank when not driving.
   Ride → two columns "Ride / To" and "Ride / From": value is the **driver as first initial +
   last name** (`PBieser`, one word — Patrick) when placed in a car; otherwise the status in shorthand
   (`needs` / `self` / `meeting there` / `—` for not traveling — pick the shortest unambiguous
   set at build time); no "riding with" / "there:" prefixes. Full wording stays in the cell
   tooltip, the edit drawer, and the CSV (which keeps its verbose columns).
3. **Drop the Household column from the grid** (Patrick, 2026-08-22 — "not helpful in this
   context"). Remove the column + its sort key (`RosterColKey 'household'`); keep household in
   the CSV and in the row's edit/detail view (still useful for "who do I email"), just off the grid.
4. **Abbreviate the Class column** (Patrick, 2026-08-22): `scout` → **S**, `adult` → **A**,
   `junior_leader` → **JL**, `cub_scout` → **Cub**, `webelos` → **W**, guests → **G**
   (`youth_guest` and `adult_guest` both "G" — full label in the cell's `title`/tooltip; if the
   youth/adult distinction matters on the grid, "G" / "AG" — confirm with Patrick at build time).
   Add a `PARTICIPANT_CLASS_SHORT` map beside `PARTICIPANT_CLASS_LABEL`; grid + snapshot use the
   short form, CSV keeps the full label. Header can shrink to "Cl." or stay "Class" (stacked theme).
5. **Guests are people: one line = one person, with a person ID** (Patrick, 2026-08-22 — "the
   concept of guests is misplaced … we need to know who they are, their ride, etc."). Today:
   (a) leader-added named guests ARE one `signup_entries` row each (`guest_name` + `host_entry_id`
   + guest class; ride/drive/money columns work) but have **no `person_id`** — so no contact info,
   no remembered seats, no household, no scout-account credit, and the family form can't add
   them; (b) the family form still has the legacy **"+N guests" count** (`guest_count` /
   `guest_note`, `event_signups.allow_guests` / `guest_prompt`) — rows without identity.
   Direction: retire the count; every guest becomes a `people` row (short-lived — flag such as
   `people.guest_of_household_id` / `inactive_reason='guest'`, archived after the event, promotable
   to a real scout/adult when they join — Webelos do), linked to the host household for the
   event so the family form can add them and they appear on the roster like anyone else.
   Needs its own design pass (people model + family form + archival) — tech-lead + the
   People-Identity-Model plan; qa-lead on PII of non-member people. Likely its own phase
   rather than a bundle item; queued here so the bundle's grid work assumes one-line-per-person
   and does not build around `guest_count`.
   **Refinement (Patrick, same day): mature guest support — BOTH modes are real.** For a Court of
   Honor or a service project only the **count** matters (no names, no attendance record); for a
   campout, anything with payment, or any overnight, the **names** matter (one line per person,
   ride, money, health form). So guests are a per-event builder setting, not a retirement of the
   count: a "Guests" block with mode **none / count only / named** (default by category — the
   Event Logistics presets pattern: Court of Honor & Service Project → count, Campout / Overnight,
   Summer Camp, High Adventure and any event with a price → named; a leader can flip it). Count
   mode keeps `guest_count`/`guest_note` on the host's entry and the headcount; named mode uses
   the per-person rows above (with person IDs per item 5) and hides the count. Snapshot / CSV /
   headcount follow the mode. Money: named only (a guest who pays is a line).
6. **One column per group set, headed by the set's label** (Patrick, 2026-08-22 — "lumping them
   all together is not a good solution"). Today a single "Groups" column joins every set
   (`r.groups.join`). Instead: the grid gets one column per non-car `signup_group_sets` row of the
   event, in set `sort` order, header = the set's label ("Patrols", "Tents", "Crews", …), cell =
   that person's group name (blank if unplaced). Column count is **dynamic per event** (0..N);
   car sets are already the Driving/Ride columns (item 2) and are NOT repeated here. CSV: same
   per-set columns (replace the joined "Groups" column).
7. **Drop empty feature columns entirely**: if the event has no jobs/slots → no Jobs column; no
   family questions → no Answers column; (same rule for any future optional block — a column
   exists only when the event uses the feature). Leader-only columns already appear only when
   defined.
8. **Shorter leader-column headers**: preset prompts render as **"Health form"** (not "Health
   form in hand") and **"Registered"** (not "Registered with council") on the grid and snapshot
   — keep the full prompt in `signup_questions.prompt` (the family never sees it; the leader
   tooltip can show it). Cheapest: add a `short` to `LEADER_PRESETS` and match on prompt.
9. **Notes get a hover**: the cell shows a truncated note (or an icon) with the full text in
   `title`/a tooltip, on the grid AND on the snapshot ("certainly on the delivery" — the printed
   snapshot prints the full note, since hover does not exist on paper).
10. **Remove the permission-slip checkbox** from the grid (`permission_slip_received`) — handled
    outside the system. Leave the column in the DB for now (a drop is a migration + a
    `needs_permission_slip` builder decision — decide at build time whether the builder flag
    goes too; Patrick says slips are out of scope for the site).
