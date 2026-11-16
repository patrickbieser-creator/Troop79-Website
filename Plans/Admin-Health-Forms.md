# Admin › Health Forms

**Status:** Approved 2026-11-15 (Brad's draft; Jenna approved with changes; Patrick answered Q1–Q4 and approved
Remove all). Building phases 1–2, then Patrick reviews before phases 3–5.
**Parked:** 2026-11-15
**Priority:** High. It follows Health Records release 3 (Plans/Health-Forms.md).

## Decisions (Patrick, 2026-11-15)

1. **Admin Health Forms is where health records are maintained.** The public `/health` becomes **view only, for
   adults on an outing**: trip lists inside the trip window, the person page, and Call / Text.
2. These move to admin:
   - the Everyone list
   - Who can open health records
   - the Access log
   - Print binder
   - Remind families
   - the Reviewed tick
3. **Who gets in:** you need existing admin access AND a place on `health_viewers`. Being on the list is not a
   capability, so it never lets anyone into admin. A health viewer who has no admin access uses `/health` only.
4. **Selecting people:** each row has a checkbox, and there is a tick-all-shown box. Filters narrow the list first.
5. **Bulk print uses the existing binder printer** for any selection.
6. **Who is listed:** active scouts and active leaders always appear. Anyone else appears once they have a document
   or a review. **Add someone** starts a record for an adult who isn't listed.
7. **The Status column stays.**

## Overview

This adds a list screen under **People & Setup → Roster · Health Forms · Access**:
- **Columns:** name, last, first, type and last upload, all sortable; four document check marks; a status.
- **View** opens one person's records in a right-side sheet over the list. A named leader can upload, replace or
  remove a document for the family, change signature dates, and mark the record complete.
- **Bulk actions** work on ticked rows: print one binder, or send update notices to families.
- **Every action commits as it is made. The screen has no Save.**

## Design rules

- **R1. Marks** come from `kindStatus` and read as words, not just symbols:

  | Status | Mark |
  |---|---|
  | On file and current | `✓` |
  | Expires soon | `✓ Soon` (amber) |
  | Expired | `Expired` (red) |
  | Missing, required kind (A & B, insurance) | `Missing` (red) |
  | Missing, optional kind (C, immunization) | `—` (muted) |

  Part C and immunizations aren't needed for routine outings, so they don't get red down two columns.
- **R2. Status** is `healthStanding`: Missing, Expired, Expires soon, Ready for review or Complete. The marks can't show
  review state, so this column carries it.
- **R3. "Updated"** in the list is the newest `uploaded_at`. The sheet header says **"Last upload"**. A removal
  doesn't change it, and a blank means nothing is on file.
- **R4. Type**
  - **Scout:** an active scout row, not Webelos.
  - **Adult:** an active adult or leader on the roster.
  - **Other:** anyone else with records: Webelos, sign-up guests, and inactive people waiting for erasure.
- **R5. Ticks stay** through search, filter and tab changes. The **Ticked (n)** tab shows exactly who a bulk action
  will touch, and every bulk confirm names the people.
- **R6. No save bar.** A file can't wait in a draft: it is encrypted and stored server-side, and holding plaintext
  scans in the browser would be worse. Mark complete is an approval-type action, which AGENTS.md already exempts.
  The dates dialog's Cancel discards.

## Routes, navigation, gate

| Route | What |
|---|---|
| `/admin/health-forms` | The list plus the sheet. `?person=`, `?tab=`, `?type=` and `?trip=` live in the URL; ticks are client state. |
| `/admin/health-forms/viewers` | **Who can open health records** (from `/health/access`). Depth 2. |
| `/admin/health-forms/log` | **Access log** (from `/health/log`). Depth 2. |

- **Navigation.** In `nav-data.ts`, Health Forms sits between Roster and Access (the existing `/admin/access`).
  The Home card reads "Forms, reviews and the binder". The item has no capability of its own.
  - It shows only when `visibleNavSections` is told `healthViewer`: the layout calls
    `isHealthViewer(actor.personId)` for an identity actor; a password session has no person, so it gets false.
  - It is never implied by full admin.
  - This one display condition is the whole nav change. Who may enter admin (`actorCanEnterAdmin`) is untouched.
- **Gate.** The workspace layout already requires admin access. Every page, action and route then also requires
  `healthAccess()?.named`. Otherwise the page shows the inline gate: "Health Forms is for leaders on the health
  records list. Ask one of them to add you."

## List

```
Health Forms                                                              [Actions… ▾]
Forms, insurance cards and immunizations for outings. Each action here saves at once; opening or printing is logged.
[All 52] [Missing or expired 14] [Expires soon 5] [Ready for review 9] [Complete 24] [Ticked 3]
[Search by name…]  (•All  Scouts  Adults  Other)  Trip [Any time ▾]   14 of 52              [+ Add someone]
┌───┬──────────────┬────────┬──────────┬───────┬─────────────┬──────────┬────┬─────────┬──────┬──────────────────┬──────┐
│ ☐ │ Name ▲       │ Last   │ First    │ Type  │ Updated     │ A & B ⓘ  │ C  │ Ins.    │ Imm. │ Status           │      │
│ ☑ │ Ben Adams    │ Adams  │ Benjamin │ Scout │ Nov 2, 2026 │ ✓        │ —  │ ✓       │ —    │ Ready for review │ View │
│ ☐ │ Jack Brooks  │ Brooks │ John     │ Adult │ Sep 14, 2025│ Expired  │ —  │ ✓       │ ✓    │ Expired          │ View │
│ ☑ │ Ava Chen     │ Chen   │ Ava      │ Scout │             │ Missing  │ —  │ Missing │ —    │ Missing          │ View │
└───┴──────────────┴────────┴──────────┴───────┴─────────────┴──────────┴────┴─────────┴──────┴──────────────────┴──────┘
```

- **The tab counts are the totals.** Nothing else repeats them.
  - **Ticked** shows the ticked people whatever the other filters say.
  - At 0 it shows "Tick people on any tab to collect them here."
- **Name** (`display_name`) is the link that opens the sheet, and it is the **default sort** (A to Z).
  - **Last** and **First** are the legal names, for matching nicknames against BSA paperwork.
  - Every column except the tick and View sorts, through `useSortable` and `SortHeader`.
  - Mark columns and Status sort by severity. Blanks go last in both directions (`compareValues`).
- **Headers.** The abbreviated headers get aria-labels: "BSA form, Parts A and B", "Part C", "Insurance card",
  "Immunization record". **One** HelpBadge, on A & B, holds the legend for the marks and the five statuses.
- **Filters**
  - Type is a SegmentedControl.
  - Search is `useTableSearch` over full, first and last name.
  - **Trip** lists upcoming trips (`loadUpcomingTrips`). It stays because the binder's main job is "print this
    weekend's campout": picking a trip narrows the list to the attendees and re-rates them for it (`needsPartC`, as
    of its last day), so tick-all-shown then Print binder is two clicks.
- **Add someone.** An `AddButton` in the toolbar's Add slot opens a Dialog with an AdminCombobox: "Find an adult…",
  covering adults not on the list. **Open record** opens the sheet for that person. They join the list once
  something is uploaded or reviewed. A sheet closed with nothing added leaves no trace.
- **Actions menu.** It sits in PageTitle's children, and the bulk items are greyed (never hidden) until something is
  ticked. The divider is a disabled option, as in `more-actions.tsx`.

  | Option | What happens |
  |---|---|
  | **Print binder (n ticked)…** | A Dialog: "Print health records for n people? Each person is logged as printed by you, and families can see that. The PDF goes to your downloads; nothing is kept on the site." Buttons: [Print binder] (primary) and Cancel. The dialog then shows progress ("4 of 12: Ben Adams") and ends "Saved to your downloads." The cover sheet takes the trip's title when a trip is chosen, otherwise "Troop records". |
  | **Send update notices (n ticked)…** | Two steps. First, a preview: "This emails 7 families about 9 people, each with their own list. Emails can't be recalled." It shows the recipients, "Nothing to fix, skipped: …" and "No email on file, ask in person: …", with [Send 7 emails] (primary) and Cancel. The result reads "Sent to 7 families." or "Sent to 6 of 7. Brooks family failed; try again later." The notice uses `healthNeeds` as of today + EXPIRES_SOON_DAYS, or as of the trip's last day when a trip is chosen. Guests are skipped and named. |
  | ────────── | |
  | **Who can open health records** | Goes to `/viewers`. |
  | **Access log** | Goes to `/log`. |

## Record sheet (View)

```
┌ Ben Adams  [Ready for review]                     ‹ Prev  Next ›   ⋯   ✕ ┐
│ Scout · Last upload Nov 2, 2026 · Viewing is logged. Each action saves.  │
│ What the family told us   Peanut allergy; carries an EpiPen.             │
│                           Typed by the family, not read from the form.   │
│ Who to call               Mary Adams · (414) 555-0142                    │
│ ──────────────────────────────────────────────────────────────────────── │
│ BSA health form, Parts A and B  ✓ Good until Mar 4, 2027                 │
│    Page 1  View ⋯    Page 2  View ⋯             Change signature dates…  │
│    + Add page                                                            │
│ BSA health form, Part C         — Not needed     + Upload                │
│ Insurance card                  ✓  Front View ⋯   Back View ⋯            │
│ Immunization record             —                + Upload                │
│ ──────────────────────────────────────────────────────────────────────── │
│ [Mark complete]       (after: Reviewed by Mindy Kerr · Nov 15, 2026  Undo)│
│ ▸ Recent activity (6)                                                    │
└──────────────────────────────────────────────────────────────────────────┘
```

- **The sheet** is a modal `<dialog>` from the right, 480px wide. It goes full width below 768px.
  - The list stays mounted underneath, so ticks and scroll position survive.
  - `?person=` makes it linkable. Esc, ✕, a backdrop click or browser Back closes it, and focus returns to what
    opened it.
  - **‹ Prev · Next ›** walks the current filtered order.
- **Logged before shown. This is new behaviour; Scout Accounts doesn't do it.** Opening the sheet calls a server
  action that writes the `view`/`record` line through `logHealthRecordOpen` first. If that write fails, it returns
  nothing: "Couldn't open Ben's records. Nothing was shown. Try again."
- **Documents**
  - **View** opens `/api/health-files/[id]` in a new tab, which logs its own line.
  - **Each page has View and a ⋯ menu** (Replace…, Remove…), following AGENTS rule 5.
  - **+ Add page** and **+ Upload** are quiet actions under their document.
- **Upload / Replace dialog.** The title names the slot ("Replace insurance card, back").
  - It offers Take photo / Choose photo or PDF, through `shrinkPhoto`.
  - For a dated kind's first page it asks for both signature dates, then shows "Good until …".
  - [Upload] is primary. Saving goes through `saveHealthPage` with `via: 'named'`, so the family's list reads
    "Mindy Kerr (named leader) added …".
  - On a replace, the old page stays until the new one saves.
  - Problems are marked in place: a red box names the problem and the field is outlined.
- **Remove…** opens a danger Dialog: "Remove Ben's insurance card, back? The file is deleted from storage and can't be
  recovered. Ben's review is cleared, and his family will see the card as missing." Buttons: [Remove page]
  (dangerSolid) and Cancel.
- **Mark complete** is the sheet's one primary button, shown at Ready for review.
  - It writes `setHealthReviewed` on, then the button becomes the text "Reviewed by <name> · <date>" with a quiet
    **Undo**, which writes it off. No confirm is needed, because it is reversible.
  - While a required file is missing or expired, the button is disabled with **visible** text: "Can be marked
    complete once the health form and insurance card are on file and current."
  - A button rather than a checkbox, so a Prev/Next sweep can't flip a review by a stray click.
- **⋯ (sheet-level) holds actions for this person only.** It doesn't repeat the bulk items.
  - Open in Roster.
  - ──────────
  - **Remove all health records…** (recommended, see Create / delete below).
- **Recent activity** is a disclosure (D-070) over `healthOpensFor([id], 10)`.
- **Out of scope:** editing "things we should know". It is still unbuilt on the family side.

## Create / delete

The create-implies-delete gate is met at page level: upload, replace and remove. **I recommend also adding "Remove
all health records…"**, rather than leaving it to the 90-day erasure:
- The retention job is **not built yet** (Health-Forms.md, "Still to build").
- Real cases need it now: a departed adult's records, or a whole set uploaded to the wrong person.

The danger Dialog reads: "Delete all 7 pages of Ben Adams's health records? Every file is deleted from storage and
can't be recovered. His review is cleared, and his family will see every document as missing. The access log keeps
a line for each removal." The confirm button is [Delete all records] (dangerSolid). It is named leaders only and
runs through `removeHealthPage` per page, so each removal is logged.

## Who can open health records / Access log

- **`/viewers`** has PageTitle back "Health Forms".
  - A compact table: Name · Added by · Added on, with a ⋯ menu holding Remove….
  - One quiet add row: an AdminCombobox of adults (no current scouts or Webelos) and Add. Adding is a one-click grant.
  - Remove… opens a danger Dialog: "Jason Miller will no longer open anyone's health records except his own family's
    and his trips', and Health Forms leaves his admin menu." The last name can't be removed: the item is greyed and
    says why.
- **`/log`** is DataTable·Compact: When · Who · How in (family / named leader / adult on the trip) · Did · Whose ·
  Which document.
  - SearchField on Who and Whose.
  - Read-only, showing the last 500.
  - The lede says "Nothing here can be edited."

## `/health` after this

- **Removed:**
  - the Everyone list
  - the Who can open and Access log links
  - Print binder and Remind families
  - the Reviewed tick (the person page shows "Reviewed by …" as text)
- **Redirects:** `/health/access` and `/health/log` permanently redirect to the admin pages. A non-admin who
  follows one hits the admin gate, which is correct.
- **Named leaders who are also admins** see a "Manage health forms" link.
- **Unchanged:** trip lists inside the window, the person page, Call / Text, and "Viewing is logged."

## Reuse

| Existing piece | Where it's used |
|---|---|
| `PageTitle` · `ActionsMenu` (Actions precedent: `roster-actions.tsx`; divider and More actions: `more-actions.tsx`) | All pages; Actions menu; the sheet's and each page's ⋯ |
| `TabStrip` (button mode) · `SegmentedControl` · `SearchField` + `useTableSearch` · `AddButton` | Tabs, Type, search, Add someone |
| `useSortable` + `SortHeader` + `compareValues` · `data-table.module.css` (`.card`, `.compact`, `.actionsCell`, `.rowLink`, `.empty`) | The tables |
| `Badge` · `HelpBadge` · `Dialog` family · `Button` · `Notice` · `DatePickerField` · `AdminCombobox` · `loading.tsx` skeleton | Status, legend, every confirm, upload, dates, pickers, loading |
| `lib/health-records` (kinds, `kindStatus`, `healthStanding`, labels and tones, `nextPage`, `effectiveOn`/`expiresOn`, `signedDateProblem`, `healthNeeds`) | All status logic. Nothing is re-derived. |
| `lib/health-store` (pages, reviews, `saveHealthPage`, `saveHealthDates`, `removeHealthPage`, `setHealthReviewed`, `logHealthRecordOpen`, `healthOpensFor`, `healthLogRecent`, viewer list functions, `loadUpcomingTrips`, `isHealthViewer`) | Every read and write |
| `lib/health-access` · `/api/health-files/[id]` · `/api/health-binder/[personId]` · `buildPersonBinder` · `remindFamilies` · `format-date` · `fetchAllRows` | Gate, View, binder, notices, dates, reads |

**Moved, not copied**
- `member/health-forms/shrink-photo.ts` → `lib/health-shrink-photo.ts`.
- The join and cover-sheet code in `(public)/health/print-binder.tsx` → `lib/health-binder-assemble.ts` (pure,
  client-safe).
- The named-only server actions (review, grant, revoke, remind) move from `(public)/health/actions.ts` into the
  admin actions file.
- Deleted from public: `print-binder.tsx`, `remind-families.tsx`, `ReviewTick` and `ViewerList`.

**Extended, not forked**
- The binder route also works without `event`: a named leader can print anyone, logged with a null `event_id`.
- `buildHealthReminders` takes `{ personIds, needsPartC, asOf, title|null }` instead of a `HealthTrip`.
- `healthReminderEmail` gets a version with no trip in it.

**New**

| New piece | Why |
|---|---|
| `lib/use-drawer-dialog.ts` + `AdminDrawer` (`_components/admin-drawer.tsx`) | The shared `src/app/_components/drawer.tsx` is the **public** kit: it reads public tokens (`--navy`, `--sp-*`, `--fs-*`) and is documented on `/admin/styleguide/public`, and admin may not import it outside the three sanctioned crossings. Smallest twin: move Drawer's behaviour (showModal, focus return, scroll lock, backdrop close) into the hook, used by **both** Drawers. `AdminDrawer` is then only markup and an `--admin-*` stylesheet. It gets a styleguide specimen. |
| `useRowSelection(ids)` + a header tick cell in `_components` | Ledger (`.bulkBar`), Finance and Patrols each hand-roll ticks, and none is shared. This builds one, with a specimen. Converting those three is parked: `Plans/Shared-Row-Selection.md`. |
| `HealthMark` cell (local to this screen) | R1's mark, word and screen-reader text |
| Admin document block, Mark-complete control, viewer list | The firewall forbids the public JSX in admin. Only the markup is twinned, and the public copies of the last two are deleted, so the count is net zero. |
| `loadHealthRoster()` and `removeAllHealthPages()` in `lib/health-store` | Testable rules for who is listed, type and Updated; remove-all as a loop that logs each page |
| `healthViewer` input to `visibleNavSections` | A display condition, not a capability |

## States

- **Loading:** the workspace skeleton. The sheet shows "Opening…" under its header, and the binder shows progress in
  its dialog.
- **Not configured:** a Notice, "Health records aren't switched on yet." No table.
- **Empty:** "Nobody has health records yet. Families add them under Members › Health forms." When filters hide
  everyone: "Nobody matches" plus **Clear filters**.
- **Errors:**
  - An open that fails shows nothing (above).
  - Upload and remove errors appear in place.
  - Binder failures are listed on the cover sheet and in the status line.
  - Notice failures are named by family; mail not configured counts as a failure.

## Accessibility

- **Ticks:** each reads "Tick Ben Adams". The header box reads "Tick all 14 shown" and is `aria-checked="mixed"` when
  partial. The Ticked tab count also lives in a `role="status"` region.
- **Marks:** each has visually-hidden full text ("Parts A and B: expired Sep 14, 2025"), so colour is never the only
  signal. Abbreviated headers get aria-labels, and sort headers get `aria-sort`.
- **Sheet:** a modal dialog labelled by its heading, with focus inside. Prev/Next keep focus on the heading.
  Dialogs opened from the sheet stack above it, and Esc closes only the top one.
- **Targets** are at least 24 × 24 (WCAG 2.2 SC 2.5.8). The whole tick cell is the label.
- **Below 1024px**, Last and First hide. **Below 768px**:
  - Updated also hides, and the four marks fold into one "Files" cell ("2 of 2 · 1 expired").
  - The Actions menu wraps under the title and stays reachable, as does the header tick box.
  - The sheet is full width, with no page-level horizontal scroll.

## Acceptance Criteria

- [ ] Only admins on `health_viewers` see and open Health Forms. Full admins who aren't on the list are refused.
      Admin entry is unchanged.
- [ ] The list follows decision 6, R1–R4, the sorts, the tabs including Ticked, and the Trip filter. Ticks survive
      every filter change.
- [ ] Print binder and Send update notices act on exactly the ticked people and log or email as specified.
- [ ] The sheet logs before it shows. Upload, replace, remove, remove all, dates, Mark complete and Undo all work
      with `via: named`.
- [ ] `/health` is view only; `/health/access` and `/health/log` redirect; the public bulk and review code is gone.
- [ ] Styleguide specimens exist for AdminDrawer and useRowSelection.

## Implementation Steps (each phase ships on its own)

> **As built (2026-11-15):** phase 1 shipped only the groundwork phase 2 needs: `use-drawer-dialog` + AdminDrawer
> (with specimen), `loadHealthRoster`, `openHealthRecord` (logs first), `lib/health-marks`. The shrink-photo move,
> binder assembly, the binder route's no-event mode and the generalized reminders move to phases 3–4, where they are
> first used, so nothing ships unused. Phase 2 shipped the list, sheet (view only), `/viewers` (add / remove) and
> `/log`; the Actions menu holds the two links until phase 4 adds the bulk items. "Added by" on `/viewers` is left
> out (the store keeps no granter name).

1. **Groundwork, with no visible change.**
   - Move shrink-photo and the binder assembly.
   - Extract `use-drawer-dialog` (the public Drawer is unchanged on screen).
   - Add the binder route's no-event mode, the generalized reminders, and `loadHealthRoster`.
   - Tests: `AssembleBinder_JoinsSectionsInOrder_CoverListsFailures()`,
     `BinderRoute_NamedLeaderWithoutEvent_PrintsAnyone_LogsNullEvent()`, `BinderRoute_TripAdult_IsRefused()`,
     `Notices_ForPeople_EmailOnePerFamily_SkipNothingToFixAndGuests()`, `Notices_Preview_SendsNothing()`,
     `HealthRoster_ListsActiveScoutsLeadersAndAnyoneWithRecords_NotBareParents()`,
     `HealthRoster_TypesWebelosGuestsAndInactiveAsOther()`, `HealthRoster_UpdatedIsLatestUploadedAt_BlankWhenNothingOnFile()`,
     `PublicDrawer_StillReturnsFocusAndLocksScroll()`.
2. **Read-only admin screen.**
   - Nav item, gate, list (tabs, Type, search, sort, marks), sheet viewing with Prev/Next, the `/viewers` and `/log`
     pages, and the AdminDrawer specimen.
   - `/health` is untouched, so the two overlap harmlessly.
   - Tests: `AdminNonViewer_CannotOpenHealthForms_EvenAsFullAdmin()`, `HealthViewerWithoutAdmin_IsNotLetIntoAdmin()`,
     `HealthViewerAdmin_SeesNavItem_BetweenRosterAndAccess()`, `HealthMark_OptionalMissingReadsDash_RequiredMissingReadsMissing()`,
     `HealthList_DefaultSort_IsNameAscending()`, `SheetOpen_WritesLogFirst_ShowsNothingWhenLogFails()`,
     `ViewersPage_LastViewerCannotBeRemoved()`.
3. **Writes in the sheet.**
   - Upload, replace, remove, change dates, Mark complete / Undo, Remove all, and Add someone.
   - Tests: `AdminUpload_AsNamed_LogsViaNamed_ClearsReview()`, `AdminRemove_DeletesCiphertext_ClearsReview()`,
     `RemoveAll_DeletesEveryPage_LogsEachRemoval()`, `MarkComplete_DisabledWithVisibleReason_WhenRequiredFileMissing()`,
     `MarkComplete_Undo_ClearsReview()`, `AddSomeone_OpensSheet_PersonListedOnlyAfterUpload()`.
4. **Bulk work.**
   - `useRowSelection` and its specimen, the Ticked tab, the Trip filter, Print binder and Send update notices.
   - Tests: `RowSelection_HeaderTicksAllShown_IndeterminateWhenPartial()`, `RowSelection_SurvivesSearchAndFilter()`,
     `TickedTab_ShowsTickedRegardlessOfFilters()`, `TripFilter_NarrowsToAttendees_AndRatesForTrip()`,
     `BulkPrint_LogsOnePrintPerTickedPerson()`.
5. **Trim `/health` to view only.** This ships last, once admin already has every tool it loses.
   - Remove Everyone, the bulk tools and the tick. Add the redirects. Delete the public copies.
   - Tests: `HealthAccessPage_RedirectsToAdmin()`, `HealthLogPage_RedirectsToAdmin()`, `HealthEveryone_IsGone()`,
     `HealthPersonPage_ShowsReviewAsText_NoControls()`.

Every phase passes the full gate (lint, typecheck, full test run, build), because each touches logic or access.
qa-lead reviews phases 2, 3 and 5 (access control). Jenna reviews the built screen after phase 4.

## Open Questions

- [x] **Remove all health records…** in the sheet's ⋯: **approved** (Patrick, 2026-11-15). Builds in phase 3.

## Notes

- Prototype reference: `prototypes/health-records/admin-roster.html` and `admin-medical.html` (2026-11-12). This
  screen replaces both the Roster health tab and the Medical tab ideas.
- qa-lead (2026-11-15, phase 2, pass with fixes): applied: the menu flag fails closed; pages and actions use one
  guard, `healthAdminAccess()` (admin entry AND the list, pure `healthAdminAllowed` tested). Open: (1) the list
  view itself is deliberately not logged; only opening a record is (decision). (2) grant / revoke leave no audit
  line; needs a migration (health_access_log's action CHECK, or an audit_log area), and the public side has the same
  gap. (3) Before phases 3–4 ship write actions, their gates need the extracted guard (done) plus a test per action.
- Parked: record "last notice sent" per family, so a second press doesn't re-email yesterday's families. The two-step
  preview is the guard for now.
