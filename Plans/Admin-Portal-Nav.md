# Admin Portal: Home Dashboard, Area Menus, Search and A–Z

**Status:** Approved 2026-11-16. Patrick approved the design concepts and answered the open questions (decisions
10–14). Nothing built yet.
**Priority:** High. Admin screens have sprawled: about 70 routes, about 25 in the nav, the rest buried.
**Design reference:** Claude Design canvas "Troop 79 leader workspace: dashboard and navigation"
(https://claude.ai/artifact/WaTa1q7oamWMxNymsghAxs): boards 1 Home, 2 Money menu, 3 Find anything, 4 Everything A–Z,
and the six area menus (Meetings, Advancement, Website Content, People, Reports, Setup).
**Supersedes:** Section 1 of `Plans/Admin-Nav-And-Consistency.md`, including its rejection of a command palette (the
reasoning there, "10 people who each use the same 3–5 items", no longer holds at this size).

## Problem

- **Reports are scattered.** Site Analytics and Recent Sign-ins are links in a card header on the Advancement
  dashboard. Wreath Dashboard, Reconciliation and Rose order are tabs on Wreath Sale. Health access log and Family
  Roster print sit in Actions ▾ menus. Ledger Audit's route is under Utilities.
- **Common tasks are buried in Actions ▾.**
  - Financial Ledger: Record a transaction, Transfer, Monthly reconciliation, Manage kinds, Export CSV.
  - Roster: Assign patrols.
  - Health Forms: Who can open health records.
- **Deep tab strips.** Menu Monster has 8 tabs, Library 7, Wreath Sale 7, the event builder 5.
- **The Meeting Planner** (`/planner/*`), the most-used weekly tool, isn't in the admin nav at all.
- **Catch-alls.** "Troop admin tools" is a grab bag. Utilities holds one tool, and that tool belongs to Reports.
- **Home isn't a dashboard.** Below "Needs you today", the card grid repeats the nav.

## Decisions (Patrick, 2026-11-16)

1. **Left rail** with these groups, in order: Home, Meetings, Advancement, Website Content, Money, People, Reports.
   Then the person's **Pinned** items. Then a hairline. Then **Setup** and **Everything A–Z**, directly under the pins
   rather than at the bottom of the rail.
2. **"Calendar & News" is renamed "Website Content".**
3. **Each group opens one menu, one level deep,** with four columns: Do · Screens · Reports · Setup. The exceptions:
   - **Reports** groups every report by subject (Advancement, Meetings and people, Money, Site).
   - **Setup** has Do · Lists · Reports · Workspace.
   Items show a name and at most a short description. They carry no "was in…" history notes.
4. **Every report appears twice:** in its own group's menu and in Reports.
5. **Home**, top to bottom:
   - Needs you today, beside This week.
   - Your shortcuts: pins first, then the screens this person opens most.
   - A Reports shelf, beside At a glance.
   - Recent ledger activity, beside Likely ready for review.
   - Recent logins, full width.
6. **At a glance has four tiles:** Active scouts, Troop account, Missing BSA IDs, and Uncollected funds (unpaid wreath
   orders plus unpaid event fees, shown as a total with the two parts underneath).
7. **Retire the Advancement dashboard** (`/admin/advancement/dashboard`).
   - Its three cards (recent ledger activity, likely ready for review, recent logins) move to Home.
   - The ledger entry count and the Court of Honor candidates card are dropped.
   - Site Analytics and Recent Sign-ins become reports.
   - The old URL redirects to `/admin`.
8. **Search (Ctrl K)** finds screens, reports, tasks and setup pages by name and alias. It also finds records: scouts
   and adults, calendar entries and articles.
9. **Everything A–Z** (`/admin/everything`) lists every item the person can open, alphabetically, in columns.
   - Entries are plain names, with no type or group tags.
   - Type filter buttons (All, Screens, Reports, Actions, Setup), a filter box, and a letter jump bar.
   - The retired Advancement Dashboard is not listed.

### Answers (Patrick, 2026-11-16)

10. **Uncollected event fees include past events:** every sign-up with money still owed, whenever the event was.
11. **Missing BSA IDs counts active scouts and adult leaders only.** Parents and other adults on the roster aren't
    counted.
12. **Shortcut tracking is approved:** log each person's menu, search and A–Z opens in `admin_nav_events`.
13. **Meetings only links out to the public site.** Its menu items are convenience links to `/planner/*`. There is no
    Meetings page under `/admin`, and the planner screens are not collapsed into tabs.
14. **Website Content stays one group.** Calendar is not split out.

## The feature registry (the foundation)

`_components/nav-data.ts` grows into the single registry that every surface reads: the rail, the area menus, Home,
search, the A–Z page, and Reports. Nothing keeps a second hand-written list.

```ts
interface Feature {
  key: string;                 // stable id: 'finance.reconcile'
  label: string;               // 'Monthly reconciliation'
  description?: string;        // one line, optional
  aliases?: string[];          // search words: ['recon', 'bank statement']
  area: Area;                  // 'meetings' | 'advancement' | 'content' | 'money' | 'people' | 'reports' | 'setup'
  kind: 'action' | 'screen' | 'report' | 'setup';
  href: string;                // deep link, including ?tab= / ?do= where needed
  alsoIn?: Area[];             // reports listed under Reports too; Setup lists shown in their home area
  capability?: Capability;     // same semantics as today's NavItem.capability
  healthViewersOnly?: boolean;
  seasonal?: 'wreaths';
  tier?: 'primary' | 'secondary'; // primary items lead their column
}
```

**Unbury by deep link, not by new pages.** Each Actions ▾ item and each buried tab gets a URL that opens it directly.
The existing page reads the parameter on load and opens the same dialog or tab it opens today.
- `/admin/finance?do=reconcile` · `?do=record` · `?do=transfer` · `?do=kinds`
- `/admin/finance/wreaths?tab=dashboard` · `?tab=reconciliation` · `?tab=rose` · `?tab=sellers` · `?tab=items`
- `/admin/advancement/roster?do=patrols` · `?do=family-roster`
- `/admin/health-forms/viewers` (existing route; register it, no `?do=` needed)
- `/admin/library?tab=proof` · `?tab=topics` · `?tab=narratives`
- `/admin/library/menu-monster?tab=prices` · `?tab=gear`
- `/admin/advancement/lookups?tab=households|schools|skills|classes`

The Actions ▾ menus stay on their pages; the registry adds a second way in.

**Guard test:** every `src/app/admin/(workspace)/**/page.tsx` route is either registered or listed in an explicit
`UNLISTED` set with a reason, such as detail pages (`[id]`), print views and redirects. A new page that does neither
fails the suite. This is what stops the sprawl from coming back.

## Area menus (contents)

Show items only when the person holds their capability. A column with nothing in it shows "None yet".

| Group | Do | Screens | Reports | Setup |
|---|---|---|---|---|
| Meetings | Take roll call · Invite teachers · Publish this week's plan | This week's plan · Meeting Live · Rotations · Focus sets · Has / Needs · Meeting emails · Suggestions | Attendance Report | Teaching skills |
| Advancement | Review proof submissions · Publish the Advancement Report · Mark Scoutbook uploads submitted | Fast Entry · Advancement Ledger · Submit & Present · Approvals | Advancement Report · Court of Honor · Scoutbook Export · Audits | Requirement classes |
| Website Content | Add a calendar entry · Build a sign-up · Write an article | Calendar · News & Bugle · Pages · Media Manager · Photo Albums · Resource Library · Menu Monster · Price book | — | Topics & shelves · Narratives · Cooking gear |
| Money | Record a transaction · Approve reimbursements · Transfer between accounts · Monthly reconciliation · Move a departed scout's balance | Financial Ledger · Reimbursements · Scout Accounts · Wreath Sale orders | Bucket Report · Ledger Audit · Wreath Sale Dashboard · Wreath Reconciliation · Rose order | Buckets · Transaction kinds · Wreath items and sellers · Export ledger CSV |
| People | Confirm roster changes · Add a scout or adult · Assign patrols · Send a sign-in link | Roster · Health Forms · Access | Family Roster print · Health access log · Missing BSA IDs | Households · Schools · Who can open health records |
| Setup | Sync the EmailOctopus list · Compare with the BSA roster | Lists: Households · Schools · Teaching skills · Requirement classes · Buckets and transaction kinds | Audit Trail | Workspace: Access · Styleguides |

Reports menu: Advancement (4) · Meetings and people (Attendance, Family Roster print, Health access log,
Missing BSA IDs) · Money (5) · Site (Recent Sign-ins, Site Analytics, Audit Trail).

**The Meeting Planner stays on the public site.** `plannerAccess()` lets a scout (the SPL) edit, so the pages can't
move under `/admin`, which requires leader access. The Meetings menu links to `/planner/*`, and each link is shown
only when `plannerAccess(actor).canView`. These are convenience links only (decision 13). The menu header
links to `/planner`, and there is no Meetings home under `/admin`.

## Home (data)

| Block | Source | Notes |
|---|---|---|
| Needs you today | `loadAttentionCategories()` (exists) | Unchanged. Add "Tonight's stations without a teacher" if the planner exposes it cheaply; otherwise defer. |
| This week | next meeting from the calendar + saved plan status; next 3 calendar entries | Buttons: Open Meeting Live, Roll call. |
| Your shortcuts | `admin_pins` + `admin_nav_events` (new) | Pins first, then the top screens opened in the past 30 days. Up to 6. |
| Reports shelf | registry, `kind: 'report'`, visible to the person | Up to 8. "All N reports" links to `/admin/reports`. |
| Active scouts | roster, active scouts | |
| Troop account | finance ledger balance | finance.manage / finance.view only. |
| Missing BSA IDs | active scouts + active adult leaders with null `bsa_member_id` (decision 11) | Split into scouts and leaders. Opens the Missing BSA IDs report. |
| Uncollected funds | unpaid wreath orders (the attention item already counts these) + every sign-up with `payment_status` unpaid and `amount_due` > 0, past events included (decision 10) | finance.manage only. Total, with the two parts underneath. |
| Recent ledger activity | moved from `advancement-overview.tsx` | Date, scout, entry, by. "View all" opens the Ledger. |
| Likely ready for review | moved from `advancement-overview.tsx` | Keep the "never auto-awarded" note and the Schedule BoR rule. |
| Recent logins | `loadRecentLogins`, `loadHouseholdsSignedInStats` | Full width. "View all" opens the Recent Sign-ins report. |

**Performance.** The overview's ledger reads were moved off Home in October because they are heavy and uncached.
- The bottom three cards each render inside their own `<Suspense>` with a PageSkeleton.
- The top of Home (attention, This week, shortcuts, tiles) must not wait on them.
- Each card hides when the person lacks `advancement.write` (for logins: `roster.manage`).

## New tables (one migration)

- `admin_pins (person_id, feature_key, position, created_at)`: pins follow the person across devices.
- `admin_nav_events (person_id, feature_key, at)`: one row per open, written by a tiny server action when the rail, a
  menu, search or A–Z is used. Shortcuts read 30 days of it.
- **Access.** Both tables follow the service-role-only posture: RLS enabled with no policies, no anon or
  authenticated grants. The app doesn't use Supabase Auth, so "owner only" is enforced in the server actions: every
  read and write is scoped to the signed-in actor's `person_id`, never a `person_id` from the client.
- **Date floor.** `created_at` and `at` each get their `<col>_from_1900` CHECK, like every other date column.
- **Pruning.** The logging server action also deletes that person's rows older than 90 days in the same call. No
  cron job needed; at ~10 leaders the table stays small.
- **What counts as an open.** Only opens from the rail, a menu, search or A–Z are logged. A screen reached through an
  in-page link, a bookmark or a typed URL doesn't count toward "most opened". This is deliberate: it keeps logging
  in one place instead of on every admin page.

## Search (Ctrl K, also `/`)

- **Opens from:** the top-bar field, Ctrl K / Cmd K, or `/` when focus isn't in a field. It is a Dialog: Escape
  closes it and focus returns to where it was.
- **Features:** the registry is filtered on the client by label, aliases, area and description, grouped Do · Screens
  · Reports · Setup, up to 6 per group, capability-filtered.
- **Records:** a debounced server action (after 2+ characters) searches people, calendar entries and articles, up to
  5 each. It returns only what the actor's capabilities would let them open.
- **Keyboard:** ↑ ↓ move, Enter opens. The first result is preselected. Recent searches show when the box is empty.
- Tries "Did you mean" through aliases only, no fuzzy library. Revisit if misses come up.

## Rail and menu behavior

- **Desktop:** the rail is always visible. Clicking a group (not hovering) opens its menu as a panel beside the rail,
  over a scrim. Escape or a click outside closes it. Clicking an item navigates and closes.
- **Group home:** each group's name in its menu header links to that group's first primary screen. No new hub pages.
- **Phone (≤800px):** a "Menu" button in the top bar opens the rail as a full-height sheet. A group opens its menu as
  a full-screen sheet with a Back link. Do not use `<details>` (see the D-070 incident in Admin-Nav-And-Consistency).
- **Counts on groups:** the sum of that area's attention items, from the same source as Needs you today.
- **Pin:** each menu item has a quiet "+ Pin" on hover or focus (a real button with an aria-label). Pinned items show
  "Unpin". Pins reorder by drag on a small "Edit pins" page.
- **Active state:** the group the current page belongs to is highlighted, by explicit registry membership
  (`activeSectionTitleFor` semantics), never by URL prefix.
- **The tab strips stay.** Inside a screen, tabs are still how you move between views. The menus add direct links
  into them.

## Retirements

- **`/admin/advancement/dashboard`** redirects to `/admin`.
  - `/dashboard/logins` moves to `/admin/reports/sign-ins`.
  - `/dashboard/analytics` moves to `/admin/reports/analytics`.
  - Redirects go in `next.config.ts`.
- **`/admin/utilities`** redirects to `/admin/reports`. Ledger Audit keeps its route (registry membership puts it in
  Reports).
- **The section bar and tab strip** (`section-nav.tsx` and the bar half of `sectionNav()`) are replaced by the rail.
- **The Home card grid** (`admin-hub.tsx`, `hubGroups()`) is replaced by the new Home. Delete it once Home ships.
- **The "Troop admin tools" group** becomes Setup.

## Acceptance criteria

- [ ] Every admin page is registered or listed in `UNLISTED` with a reason. The guard test fails otherwise.
- [ ] Each group's menu shows exactly the person's visible items, in the four columns. A reports-only leader sees
      Reports and nothing empty.
- [ ] Every former Actions ▾ item and buried tab opens directly from its deep link.
- [ ] Home matches decisions 5–6. The three advancement cards stream in without delaying the top of the page.
- [ ] The money tiles show only to finance holders. Uncollected funds equals wreath unpaid plus event fees unpaid.
- [ ] Search finds every registered item by label or alias, respects capabilities for features and records, and is
      fully keyboard-operable.
- [ ] A–Z lists every visible item. The type filter, text filter and letter jump work. Entries have no tags.
- [ ] The old dashboard, logins, analytics and utilities URLs redirect.
- [ ] Works at 375px: Menu sheet, group sheet, search full-screen.
- [ ] Planner links appear only to people `plannerAccess` lets view.

## Implementation steps (each phase ships on its own)

1. **Registry, with no visible change.**
   - Add `Feature[]` with every item, alias and deep link. Derive today's `SECTIONS` / `sectionNav()` / `hubGroups()`
     from it, so the current UI renders the same.
   - Add the `UNLISTED` guard test.
   - Tests: `EveryAdminRoute_IsRegisteredOrUnlisted()`, `Registry_KeysAreUnique()`, `Registry_EveryReport_IsAlsoInReports()`,
     `Registry_CapabilityFilter_MatchesVisibleNavSections()`, `DerivedSections_RenderTodaysNav()`.
2. **Deep links.**
   - Add the `?do=` / `?tab=` handling listed above to the existing pages, opening the existing dialogs and tabs.
   - Tests: `FinanceDoReconcile_OpensReconcileDialog()`, `WreathsTabRose_SelectsRoseTab()`,
     `RosterDoPatrols_OpensAssignPatrols()`, `UnknownDoParam_IsIgnored()`.
3. **Rail and area menus.**
   - Replace the section bar with the rail and the click-open group menus. Add pins (migration: `admin_pins`), the
     group counts, and the phone sheets. Rename the group to Website Content.
   - Tests: `Rail_ShowsSetupAndAZ_DirectlyUnderPins()`, `AreaMenu_ShowsFourColumns_OnlyVisibleItems()`,
     `AreaMenu_EmptyColumn_SaysNoneYet()`, `ReportsMenu_GroupsBySubject()`, `Pin_AddsToRail_FollowsPerson()`, `Pins_ScopedToActor_IgnoresClientPersonId()`,
     `ActiveGroup_ByMembership_NotUrlPrefix()`, `PlannerLinks_HiddenWithoutPlannerView()`, `Menu_EscapeCloses_ReturnsFocus()`.
4. **New Home.**
   - This week, shortcuts (migration: `admin_nav_events` + logging), the reports shelf, the four tiles, and the three
     moved cards in Suspense. Retire the Advancement dashboard and add the redirects.
   - The Missing BSA IDs report ships here, not in phase 6, because the At a glance tile opens it.
   - Tests: `AtAGlance_MoneyTiles_HiddenWithoutFinance()`, `UncollectedFunds_SumsWreathAndEventFees_IncludingPastEvents()`,
     `MissingBsaIds_CountsActiveScoutsAndAdultLeadersOnly()`, `Shortcuts_PinsFirst_ThenMostOpened()`,
     `AdvancementCards_HiddenWithoutAdvancementWrite()`, `OldDashboardUrl_RedirectsToHome()`,
     `MissingBsaIdsTile_OpensMissingBsaIdsReport()`, `NavEvents_ScopedToActor_IgnoresClientPersonId()`,
     `NavEvents_LogPrunesRowsOlderThan90Days()`.
5. **Search.**
   - The top-bar field, Ctrl K / `/`, client feature search, and the server record search.
   - Tests: `Search_FindsByAlias()`, `Search_HidesFeaturesWithoutCapability()`, `RecordSearch_HidesHealthAndFinanceRecordsWithoutAccess()`,
     `Search_KeyboardMovesAndOpens()`, `Search_EscapeRestoresFocus()`.
6. **Everything A–Z, cleanup and new reports.**
   - `/admin/everything`. Retire Utilities. Delete `admin-hub` and the old section bar.
     Add styleguide specimens for the rail, the area menu and the search dialog.
   - Tests: `AZ_ListsAllVisible_Alphabetical_NoTags()`, `AZ_TypeFilter_And_TextFilter()`, `AZ_OmitsRetiredDashboard()`.

**As built (2026-11-16).**
- Phase 3 also shipped `/admin/everything` (A–Z), since the rail links to it, and `/admin/pins` (Edit pins). Phase 6
  keeps the cleanup and the styleguide.
- **Styleguide waiver:** the specimens for the rail, the area menu and search land in phase 6 (this plan), not with
  each phase as AGENTS.md normally asks. Phase 6 is not done until they exist.
- **App shell:** the workspace root is the viewport's height and `main` is the page's scroller, so the rail always
  fits under the top bar. Page-level `sticky` elements stick to the top of `main`. Print turns this back into one long
  page.
- **Counts and pins** refresh on a full page load or after a pin change; the layout persists across client navigation.
- The menu panel is a labelled region, not a modal dialog: Tab can leave it, Escape and a click outside close it.

**Gates and reviews.** Every phase passes the full gate (lint, typecheck, full test run, build): each touches logic,
capability gating or a migration. qa-lead reviews phases 3–5 (capability filtering on menus, tiles and record
search). jenna reviews the built rail and Home after phase 4, against the canvas (Troop 79 UI reviews route to
jenna, not ux-lead).

## Open questions

- [x] Uncollected event fees include past events (decision 10).
- [x] Missing BSA IDs counts only adult leaders among adults (decision 11).
- [x] Shortcut tracking approved (decision 12).
- [x] Meetings is convenience links to the public planner only (decision 13).
- [x] Website Content stays one group (decision 14).

## Notes

- **Sample data.** Counts, names and dates on the canvas are sample data.
- **Route counts** come from a code read on 2026-11-16: about 70 `page.tsx` routes under `app/admin/(workspace)`
  and about 25 nav items.
- **Things not to break.**
  - `NEVER_IMPLIED_BY_FULL_ADMIN` (finance).
  - `healthViewersOnly`.
  - Longest-match active state.
  - The Wreath Sale seasonal ordering.
  - All of these carry over into the registry unchanged.
