# Calendar Unification — Meetings, Events and Signups on One Spine

**Status:** Built — local only, NOT deployed
**Started:** 2026-08-14
**Built:** 2026-08-14 (steps 1–8; step 9's guarded drop is deliberately deferred)
**Priority:** High — supersedes and absorbs the queued story-editor workbench (D-081)

## Build Status (2026-08-14)

Done and verified locally: both migrations applied (backfill guard passed — 0
orphans), 148 tests green (131 → 148), lint 0 errors / 3 pre-existing warnings,
`next build` clean, and the flows browser-checked against the local DB with test
data reverted.

Verified in the browser:

| Check | Result |
|---|---|
| `/events/21` (meeting entry) | Agenda template — real agenda items, prev/next by entry id, fact grid correctly suppressed |
| `/events/24` (activity entry) | Unchanged — fact grid present, no agenda |
| `details_md` through ArticleBody | Real markdown (`<h2>`, `<strong>`, `<li>`); no raw source leaked |
| `/meetings`, `/meetings/[date]` | 404 — deleted, no redirect, as decided |
| `/calendar.ics` | 81 troop meetings present; route code unchanged |
| `/admin/calendar` | Upcoming 13 / Past 92 with live counts; Open → workbench |
| `/admin/calendar/21` as LEADER | Story + Agenda + Signup panels, "Agenda template" note |
| `/admin/calendar/21` as SCOUT | **Story panel only** — zero references to the agenda/roll-call routes |
| Scout → `/admin/advancement/meetings*`, `/admin/events` | 307 at the edge — both layers of the split hold |

### qa-lead review — 2026-08-14

**SHIP-WITH-FIXES, no CRITICAL, no HIGH.** Security status clear; test quality
88/100; no anti-patterns.

The headline concern checked out: the workbench gates server-side, the layer
queries only run for leaders (a scout's payload carries `meeting: null,
signupId: null`), `createMeeting` enforces `requireRole(['leader'])` itself so
the hidden panel is not the protection, and `SCOUT_ALLOWED_PREFIXES` is a strict
1:1 path swap rather than a widening. Markdown XSS clear — no `rehype-raw`, no
`dangerouslySetInnerHTML`, react-markdown v9+'s default URL transform strips
`javascript:`.

All findings fixed the same session:

| Finding | Fix |
|---|---|
| MEDIUM — attendance survival was schema-safe but had no regression lock | `AttendanceRecords_Survive_WhenTheCalendarEntryAndItsAgendaAreDeleted` |
| MEDIUM — calendar delete-confirm didn't warn that an attached agenda goes with the entry | `hasAgenda` threaded onto the row; confirm names the loss and notes attendance is kept |
| MEDIUM — backfill's lowest-id tie-break dormant locally, unverified against prod | **Migration `20260814120000`** asserts every meeting's linked entry falls on its own date, using `meeting_date` as an independent witness before that column is dropped. Runs on prod BEFORE the code. Plus a standing test. |
| LOW — `loadMeetings`/`loadAttendanceCounts` swallowed query errors | Both `throw`; same for the calendar list loader |
| LOW — leader-only action reference in a scout's payload | `onAddAgenda={isLeader ? createMeeting : undefined}` |

Also fixed while re-running: a latent cross-file test flake — `calendar-categories`
asserted an exact category count while excluding only its own fixture, and vitest
parallelizes by file. Both files now exclude `ZZVITEST%`.

Post-fix: **150 tests green**, lint 0 errors, `tsc --noEmit` clean, build clean.

**Still owed before this ships:** production deploy in migration-before-code
order, and step 9's `meetings.meeting_date` drop after a soak (note: migration
`20260814120000` is that column's last consumer — it must run before the drop).

**Carried debt:** `MarkdownSplitPane` was created as the shared editor (D-088's
"extract, don't add a third"), and the workbench uses it — but the News article
and library post editors still carry their own panes and want their own
migration pass.

## Overview

Collapse the three admin surfaces that all describe "something happening on a
date" — **Events** (`/admin/news/calendar`), **Event Signups** (`/admin/events`)
and **Meetings** (`/admin/advancement/meetings`) — into a single **Calendar**
section. One Add button, pick a category, and the editor composes itself from
that category's template. Publicly, `/events/[id]` becomes the one permalink for
every dated thing the troop does, rendering through a template chosen by the
entry's category. The `/meetings` tree is deleted outright.

Underneath, `meetings` stops being a parallel system keyed by date and becomes a
**layer on `calendar_entries`**, joined by a real foreign key.

## Problem / Opportunity

**Double entry, joined by a string.** `meetings.meeting_date` is UNIQUE and there
is no FK to `calendar_entries`. Creating a meeting never touches the calendar
(`meetings/actions.ts:38`). To get a troop meeting onto the site a committee
member enters it twice — once as a calendar entry so it lands on the calendar and
the ICS feed, once as a meeting so it has an agenda. The two rows are correlated
**only by matching dates at read time**, in `getMeetingCalendarContext()`
(`lib/meetings.ts:106–126`). Change a date on one side and they split silently.

This is the same double-entry disease D-079 killed between events and articles.
This is the third leg of that fix.

**Committee members are confused, correctly.** The people entering content
experience "Meetings" and "Events" as two front doors to the same act. They want
one door, choose a type, fill in what that type needs.

**The ICS feed is silently incomplete.** `/calendar.ics` reads
`loadAllCalendarEntries()` filtered to `on_calendar = true`. A meeting entered
only on the Meetings screen **does not exist to Outlook, Band, or any other
subscriber**. The merge doesn't build the ICS feed — it makes the existing one
correct by construction, because a meeting without a calendar row becomes
impossible.

**Soft launch is the window.** 73 meetings, ~1,249 historical check-ins, and a
modest signup history. This migration will never be cheaper.

## Decisions Locked (2026-08-14, Patrick)

1. **Several meetings may share a date.** The one-meeting-per-date rule is
   dropped, not relaxed. (Committee meeting + troop meeting on one night is real.)
2. **`/meetings/[date]` dies. No redirect.** Families are not using the construct;
   there is no link equity to preserve.
3. **The `/meetings` index dies too** — collapsed into `/events` entirely. The
   main nav loses its Meetings tab.
4. **`/events/[id]` is the single public permalink** for every entry, including
   meetings. Decision (1) makes this mandatory, not stylistic: once a date can
   hold two meetings, no date-keyed permalink can address them.
5. **Presentation and editor composition vary by type; data shape does not.** A
   template picks layout, panel set, labels, and which layers seed on. It never
   gates which tables may attach to a row.
6. **The admin entry list keeps its Upcoming / Past tabs.** They survive the
   merge intact — meetings simply start appearing in them.
7. **Scout access splits at the panel level** — scouts reach the entry editor,
   never the agenda or roll-call panels.
8. **Roll Call stays its own route** under Planning. It is a data-entry session,
   not editing.
9. **The Meeting Plan engine loses its meeting awareness entirely.** Planning
   tools stay fluid; the engine is a planning aid, not an agenda writer.
10. **Templates are category-only** — no per-entry override.
11. **Off-calendar meetings are not a case.** No utility; handled outside the
    website. The meeting template forces `on_calendar = true`.

## Acceptance Criteria

- [ ] Every `meetings` row has a non-null `calendar_entry_id`; zero orphans.
- [ ] Two meetings can exist on one date, each independently addressable.
- [ ] Creating a meeting through the merged Calendar admin produces a
      `calendar_entries` row, and that meeting therefore appears in
      `/calendar.ics` with no additional action.
- [ ] `/events/[id]` renders a meeting in agenda format and an outing in event
      format, chosen by the entry's category template.
- [ ] `app/(public)/meetings/**` no longer exists; the Meetings nav tab and the
      footer's "This Week's Meeting" link are gone or re-pointed.
- [ ] Admin nav shows one **Calendar** section; Events, Event Signups and
      Meetings are no longer three separate destinations.
- [ ] The entry list still opens on **Upcoming** with live counts on both tabs,
      still treats a multi-day entry as upcoming until its **last** day passes,
      still reads Past newest-first, and still offers Clone on past rows —
      with meetings now included in both tabs.
- [ ] Changing an entry's category never deletes layer rows (signups, agenda
      sessions, prices) — panels hide, data survives, the change is reversible.
- [ ] All 1,249 historical check-ins remain attached to their meetings, and the
      Meeting Plan engine runs unchanged against an entry-backed meeting.
- [ ] `npm run lint` 0 errors; `next build` clean; test baseline up from 131.

## Test Plan

Vitest, integration-style against local Postgres (project convention — no DB
mocking). Names follow the existing `Subject_Behavior_WhenCondition` pattern from
`tests/calendar-categories.test.ts`.

**Backfill and the FK**
- [ ] `Backfill_LinksEveryMeetingToACalendarEntry_WhenDatesAlreadyMatch()`
- [ ] `Backfill_CreatesACalendarEntry_WhenAMeetingDateHasNone()`
- [ ] `Meeting_IsRejected_WhenCalendarEntryIdIsNull()`
- [ ] `DeletingACalendarEntry_CascadesToItsMeetingLayer()`

**Multiple meetings per date**
- [ ] `TwoMeetings_CanShareOneDate_WhenBothLinkToDistinctEntries()`
- [ ] `CalendarContext_ResolvesByEntryId_WhenTwoMeetingsShareADate()` — the
      `getMeetingCalendarContext()` date-match ambiguity

**Entry list (regression — the tabs must survive the merge)**
- [ ] `EntryList_CountsAMeetingAsUpcoming_WhenItIsToday()`
- [ ] `EntryList_CountsAMultiDayEntryAsUpcoming_UntilItsLastDayPasses()`
- [ ] `EntryList_OrdersPastNewestFirst_WhenThePastTabIsSelected()`

**Templates**
- [ ] `Category_ResolvesItsTemplate_WhenTheLookupAssignsOne()`
- [ ] `Category_FallsBackToTheDefaultTemplate_WhenNoneIsAssigned()`
- [ ] `TemplateChange_PreservesLayerRows_WhenCategoryIsReassigned()` — the
      no-destructive-conversion guarantee

**Feed and ICS**
- [ ] `IcsFeed_IncludesAMeeting_WhenItWasCreatedThroughTheCalendarAdmin()`
- [ ] `IcsFeed_OmitsAnEntry_WhenOnCalendarIsFalse()` (regression)

**Access control** — mandatory, security surface. Panel-level split (decision 7).
- [ ] `ScoutSession_ReachesTheEntryEditor_WhenItOpensTheWorkbench()`
- [ ] `ScoutSession_IsRefusedTheAgendaPanel_WhenItOpensAMeetingEntry()`
- [ ] `ScoutSession_IsRefusedTheRollCallRoute_WhenItRequestsItDirectly()` — the
      panel split must hold server-side, not just in the rendered UI

## Technical Approach

### 1. Merge by reference, not absorption

`meetings` gains `calendar_entry_id bigint not null references
calendar_entries(id) on delete cascade`. It is **not** dissolved into
`calendar_entries`.

Why: `meetings.id` survives, so `meeting_attendance`,
`meeting_attendance_leaders` (1,249 rows), `meeting_sessions` and the 645-line
Meeting Plan engine need no data surgery. It also matches the layers-on-one-spine
model already locked in D-081 — agenda becomes a layer beside signup and story.

`meeting_date` stays on the table through the transition (stop reading it, then
drop it in a later guarded migration — the two-phase pattern from D-079).

### 2. The type discriminator already exists — do not add a second one

`calendar_categories` is already a user-managed lookup, already FK'd from
`calendar_entries` with ON UPDATE CASCADE, and already carries a `behavior` flag
the code branches on (D-085). Add a **`template`** column to that table.

- Patrick creates a category and picks a template from a fixed dropdown.
  "Merit Badge Opportunity" (still open on the backlog) becomes a lookup row —
  no code.
- **No `type` column on `calendar_entries`.** Category *is* the type, and
  renaming it can't break anything because the FK cascades.
- This extends D-085's own reasoning: categories are an **open set humans reason
  about**; templates are a **closed set the code branches on**. The open set
  points at the closed one.

**Start with three templates.** `meeting` (agenda), `activity` (story + signup),
`announcement` (story only). Each template is a renderer *and* a panel preset to
maintain forever — add a fourth only when a real entry can't be served.

### 3. One workbench shell, a panel registry

The entry-keyed workbench route (this absorbs D-081's queued build) is a single
shell. The template decides panel order, visibility and labels — it does **not**
select a different editor component. Panels: Story (`details_md`), Promotion,
Agenda, Logistics, Roll Call, Signup blocks.

`/admin/events/[id]` is keyed by **signup id** today (`load(signupId)` →
`event_signups` → entry). The workbench must be **entry-keyed**, so an entry with
a story and no signup is reachable.

### 4. Documented reversal

`app/(public)/events/[id]/page.tsx` currently carries the comment *"Blocks render
from the event's own configuration — there is no per-category template."* This
plan reverses that line and must update it. The reversal is narrow and
deliberate: the template governs **presentation and panel composition**; block
rendering still follows the entry's own configuration, and no template gates
which layer tables may attach. D-081's rejection of typed events stands — what
was rejected was a stored discriminator that forces a migration when a small
event grows big, which this does not introduce.

### 5. Date-uniqueness fixes (forced by locked decision 1)

| Site | Fix |
|---|---|
| `/meetings/[date]` permalink | **Deleted** |
| `meeting_plans` upsert `onConflict: 'meeting_date'` (`meeting-plan/actions.ts:93`) | **Unchanged** — see §6; the engine stops being meeting-aware, so nothing needs re-keying |
| "first free Sunday" — `const taken = new Set(rows.map(r => r.meeting_date))` (`meetings-list.tsx:77`) | Premise removed; drop or re-scope |
| `getMeetingCalendarContext()` date match (`lib/meetings.ts:106–126`) | Key off the FK — this is the fix, not a workaround |
| `revalidateMeetingPath()` (`meetings/actions.ts:20–24`) | **Deleted** — existed only to revalidate the dead permalink |

### 6. The Meeting Plan engine drops meeting awareness (decision 9)

Convenient finding: the engine is **already decoupled at the write level.** Its
only write is `meeting_plans.upsert(..., { onConflict: 'meeting_date' })`
(`meeting-plan/actions.ts:84`). It never writes `meetings` or `meeting_sessions`
— "Plan feeds Agenda" (D-011) is a candidate-tray/copy affordance, not a foreign
key.

So this decision costs nothing and removes work: `meeting_plans` **stays
date-keyed**, no re-key migration is needed, and the multiple-meetings-per-date
ambiguity never reaches the engine. A plan is a date-scoped planning artifact a
leader draws from; it does not point at one meeting row and does not need to know
that two meetings share a night. Anything in the UI that implies the plan *is*
that meeting's agenda gets softened to "draw from this plan."

The 645-line `engine.ts`, its next-Sunday default, and `load-input.ts` are
otherwise **out of scope for this plan**. Fluidity here means leaving it alone.

### 7. The entry list keeps its tabs (decision 6)

`calendar-editor.tsx:58–110` is retained behavior, not incidental UI:
`useState<'upcoming' | 'past'>('upcoming')`, live counts on both tabs, the
`lastDay()` rule (a multi-day entry stays upcoming until its **last** day
passes), Past reversed to newest-first because the recent thing is what you're
usually cloning, and Clone on past rows. The empty-state copy cross-references
the Past tab for cloning — keep that thread intact.

The merge changes exactly one thing about this list: meetings now appear in it.
Both tab counts will jump, which is the point — one list of everything on a date.

## Implementation Steps

**Migrations land on production BEFORE the code that reads them** (D-089 —
`/events` was baked with an empty category list when this order was violated).

1. **Migration A (additive):** `calendar_categories.template` (nullable, checked
   against the closed template set); `meetings.calendar_entry_id` nullable FK.
   Seed templates onto the 14 existing categories.
2. **Migration B (backfill + constrain):** link every meeting to the calendar
   entry sharing its date; create an entry where none exists; then set
   `calendar_entry_id NOT NULL` and drop the `meeting_date` unique constraint.
   Verify 0 orphans before the NOT NULL step.
3. **Workbench route** — entry-keyed, panel registry, template-driven
   composition. Story panel ports the news editor's split pane. **First settle
   D-088's debt: extract the shared markdown editor rather than adding a third
   copy.** Panels carry their own server-side role guard (decision 7) — the
   agenda panel refuses a scout session at the action, not just in the render.
4. **Entry list merge** — meetings join the Upcoming/Past tabs. Retain the
   `lastDay()` rule, both counts, newest-first Past, and Clone (§7).
5. **Public collapse** — `/events/[id]` renders by template; `meeting-view.tsx`
   becomes the `meeting` template's renderer (re-parented, not rewritten);
   delete `app/(public)/meetings/**`; update `nav-links.tsx:9` and
   `site-footer.tsx:64`.
6. **Admin nav merge** — one Calendar section in `sub-nav.tsx`; retire the
   Events / Event Signups / Meetings triple. Roll Call keeps its own route under
   Planning (decision 8). **Sync `SCOUT_ALLOWED_PREFIXES` in `proxy.ts`** — the
   nav list and the edge allowlist must not drift (D-037).
7. **Meeting Plan softening** — strip UI language implying a plan *is* a
   meeting's agenda (§6). No schema change, no engine change.
8. **qa-lead review** — mandatory. The panel-level scout split is a new
   access-control surface; no proportionality skip applies.
9. **Migration C (guarded drop):** remove `meetings.meeting_date` after the code
   that reads it is deployed and soaked.

## Open Questions

None. All five resolved by Patrick 2026-08-14 — recorded as decisions 7–11
above. The plan is ready to activate.

Still owed at build time, but not blocking design: qa-lead's sign-off on the
panel-level access split (step 8), which is a review gate rather than an open
design question.

## Notes

**Related decisions:** D-079 (Event→News merge — the same disease, first cure),
D-080 (`on_calendar`; "Event Signups eventually folds into a per-event workbench"
was already the stated end-state), D-081 (layers on one spine; the story-editor
workbench this plan absorbs), D-082/D-085 (`calendar_categories` lookup, behavior
flags, cascade rename), D-088 (two markdown editors exist — extract, don't add a
third), D-089 (migration before code push).

**Supersedes:** `Plans/Event-News-Promotion.md` §2 (full-page story editor) —
that build is now step 4 here.

**Surfaces touched:** `lib/meetings.ts`, `lib/calendar.ts`,
`lib/calendar-categories.ts`, `app/calendar.ics/route.ts` (unchanged in code —
correctness comes free), `app/(public)/meetings/**` (deleted),
`app/(public)/events/[id]/**`, `app/admin/(workspace)/advancement/meetings/**`
(re-parented), `app/admin/(workspace)/news/calendar/**`,
`app/admin/(workspace)/events/**`, `_components/sub-nav.tsx`,
`_components/nav-links.tsx`, `_components/site-footer.tsx`, `proxy.ts`.

**Cheap follow-on once merged:** category-filtered ICS feeds (`?category=`) so
Band can subscribe to outings only. The UID scheme (`calendar-entry-${id}`) is
already entry-keyed and stable across this whole change.
