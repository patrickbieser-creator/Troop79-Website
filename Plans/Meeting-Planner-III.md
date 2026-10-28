# Meeting Planner III — plan from a focus, then fill the gaps

**Status:** ACTIVE: building P0 onward (goal: every phase, deployed). Tech-lead reviewed; Patrick answered 2026-10-28.
**Parked:** 2026-10-28
**Priority:** High: it changes how every meeting gets planned.

## Overview

Design III (`prototypes/meeting-plan-III/`, README + `This Week.dc.html` + `Theme Calendar.dc.html`; claude.ai
"Meeting Planning — Design III") plans a meeting **centrally, up front**:

1. The planning team picks the night's **focus**: one or more focus sets.
2. Every **active** scout lands in a group for the rank they're working on.
3. A **scout × requirement checklist** shows what each scout could work on tonight.
4. Rows with nothing checked are the gaps the team fills by hand. Requests and offers (Design II) become the gap
   filler, not the starting point.

The internal goal is the **60-40 rule**: at least 60% of the scouts working on Scout through First Class should start
a rank requirement in the focus. The 60% target is never shown in the UI; only the coverage bar and the gap count
are shown.

Design III keeps every Planner II / Build a Plan domain rule (Plans/Completed/Meeting-Planner-II.md,
Plans/Completed/Build-A-Plan.md) except where the README or this plan says otherwise.

## Problem / Opportunity

Our first real use of Design II left some scouts with **nothing planned for them**. That happened because the plan
grew bottom-up from picks and offers. B9 (orphans) reports gaps after the fact, but nothing builds the night around
covering every scout.

## Decisions (Patrick, 2026-10-28)

| # | Decision |
|---|---|
| 1 | **Who's coming folds into This week.** The tab retires; its jobs move (see "Folding in Who's coming" below). |
| 2 | **A "Nothing assigned" row is clickable** → a small menu: Requests and offers (one of their picks or an offer), Help teach, Move to <group> (incl. a merit badge group). |
| 3 | **Grid cells are display-only** ("could work on it"). The group teaches the set. |
| 4 | **Eagle scouts join the Merit badge group.** |
| 5 | **Publish snapshot is reworked** (see "Publish and the family page" below): an email per family listing this week's options with their scout's suggestions marked, and a magic link to the member meeting page, where they answer Coming / Not sure yet / Can't make it and sign up for 2–3 things, suggested or not, and may request a requirement outside the list. |
| 6 | **Existing picks and offers show as extra classes** alongside the groups ("From requests and offers"). |
| 7 | **A big group stays one class**; split by hand on Rotations if needed. |
| 8 | **Merit badges:** a meeting may offer several merit badges, and may have no rank work at all. |
| 9 | **Goal: build every phase and deploy.** Design II's planner, member page card and emails were only tested, never used widely, so **nothing built for meeting planning needs to be preserved**: retire freely, no per-item confirmation. Defaults taken: a republish emails only families whose options or suggestions changed (quiet "Email everyone"); every active family gets the email. |

## Folding in Who's coming (Decision 1)

Who's coming (`/planner`, `board-view.tsx`) does six jobs. Each needs a home before the tab retires:

| Job today | Home in This week |
|---|---|
| Attendance bars (scouts and adults by answer) | The coverage strip gains "Coming 14 · Not sure 3 · Can't 2 · No answer 9", scouts and adults. |
| Haven't answered + Send reminders | A "No answer (n)" filter on the grid (scouts) and a list of adults with no answer, with the existing reminder action (adults send email only). |
| Everyone wall / person drawer: enter an answer for someone | Click any name chip → the existing person drawer (`PersonDrawerView`). |
| Requests with no teacher (Assign, who can teach, Send request) | The "From requests and offers" classes (Decision 6), each with the same teacher slot as a group. |
| Adults' answers (who's coming to teach) | Teacher-slot candidates show their answer; adults coming with nothing to teach are listed under the teacher slots. |
| After the meeting: "Would you like to update attendance?" | Moves to the top of This week (it's already on Rotations). |

Other implications:
- **`/planner` becomes This week.** Emailed links, the account menu and `/member/meeting`'s "Back to the Meeting
  Planner" already point at `/planner`, so they keep working with no redirect. `/planner/build` redirects to `/planner`
  (query kept); Suggestions, Has/Needs and Invite stay as views/tabs. Tabs: **This week · Invite · Rotations · Focus
  sets · Has/Needs**.
- This week gains the **meeting switcher** for every planner (Who's coming showed only the next meeting).
- View-only holders lose nothing: everything Who's coming showed is on This week.
- Tests that drive `board-view.tsx` move or retire with it (`planner-board-view`, `planner-board-edit`, parts of
  `meeting-planner-board`).
- The retirement is the last step of P1/P2, not before: Who's coming stays until This week carries all six jobs.

## Publish and the family page (Decision 5)

- **Publish snapshot** freezes the families-visible plan (focus, the night's options, each scout's suggested
  options) as snapshot n, and emails **one message per family** (adults only, as today): the focus of the meeting,
  the list of options this week, their scout's suggested ones marked, and one **magic link** that signs them in to
  `/member/meeting`.
- **`/member/meeting`** keeps Coming / Not sure yet / Can't make it as it is, and shows:
  - the meeting's **focus**;
  - **this week's options**, with "Suggested for <scout>" on the ones placement chose;
  - a tick per option; the page asks for **2–3** (a soft target; the existing cap of 5 picks stays);
  - "Request something else": the existing pick list and merit badge search (`scout-board.tsx`), outside the options.
- **Picks are real picks** on the option's topic (`fr:` / badge / extra class). A scout who ticks a group is pinned
  in it on Rotations; one who doesn't answer is still placed by placement. A request outside the options is an
  ordinary pick and shows under "From requests and offers".
- **Publish new snapshot** after changes: the page shows the newest snapshot. Planners see "Families are seeing
  snapshot n" until they publish again.
- The **magic link** reuses the site's sign-in token path (`login_tokens` → `/signin/verify`), one per recipient per
  send, expiring at 6 PM Central on the meeting day like invite links. qa-lead reviews it.
- **Relationship to the Invite tab:** pick invites to scout families are replaced by this email. The Invite tab keeps
  **teacher** asks (B10 teach pages unchanged).

## What already exists (code map, 2026-10-28)

| Design III piece | Today | Reuse / change |
|---|---|---|
| A meeting's plan | `meeting_topics` for a `calendar_entry_id`; Build a Plan (`/planner/build`, `?meeting=`, next 4 meetings) | Keep it as the one store. |
| Focus sets | `focus_sets`, `focus_set_labels`, `focus_set_items(topic_key)` (rank AND merit badge requirements, any level); "last used" derived from `meeting_topics.seeded_at`; search RPCs `focus_requirement_search` / `_counts`; Focus sets tab | Reuse it all. **No paired merit badge column**: one has to be added. |
| Adding a focus set to a meeting | `plannerAddFocusSetAction` → `meeting_seed_focus_set` adds ONE `fg:<setId>` topic (one class, one teacher), with items frozen in `meeting_topic_members` | **Changes meaning**: in III a focus set is split by rank into groups (see Technical Approach). |
| Active roster, rank, "working on" | `loadBoardScouts` (scouts.active), `nextRankOf`, `loadScoutProgress` (ledger_active + mb_progress), `rank-calculus` roll-up | Reuse it. The grid's ✓ is "leaf open for this scout" per `rankNodeSatisfied`; `topicParts` is the closest existing per-scout sub-requirement check. |
| RSVP | `meeting_intents` (coming / undecided / not_coming) + `effectiveIntent` (a pick implies Coming) | Reuse it for the chip tints. |
| Teachers | `meeting_topic_teachers`, `teaching_skills`, counselors, `assessTeacher` | Reuse them; group teacher candidates = matching skill + Merit badge group scouts set to Teach. |
| Live | Rotations: one arrangement over the live plan (`meeting_rotations`, `meeting_classes`, `meeting_class_members`, `meeting_reconcile`, presence draft, approved attendance) | The README's Live view = Rotations showing one class per group. Don't build a second Live. |
| Publish | The admin agenda (`meeting_sessions`, published to `/events/[id]`); the old `meeting_plans` snapshot table (B4 retired every reader; kept until Patrick confirms the drop) | **Snapshot is new.** See Open Questions. |
| Merit badge night | "A merit badge night is just a meeting" (Decision 10); `board_mode / board_mb_id` were DROPPED (20261210100000, D-430) | A per-meeting **merit badge** choice is new: it is the one seeded `mb:<id>` topic. |
| Styling | The planner is a **public** route: public tokens only, and `--admin-*` is blocked by `design-system-census.test.ts` | **The README's rank colors name `--admin-*` tokens.** Add public rank-chip tokens with the same hex values instead (see Technical Approach). |

## Domain rules (from the README, restated as testable rules)

- **Groups:** one group per rank being worked on, **only when the focus has items for that rank**.
  - No rank → **Scout** group; Scout → **Tenderfoot**; Tenderfoot → **Second Class**; Second Class → **First Class**.
  - **Merit badge group:** First Class, Star, Life and Eagle. Each of them **Teaches** or takes **one of the night's
    merit badges**. They are not counted toward coverage.
- **Merit badges: zero, one or several per meeting.** A meeting can be all merit badges with no rank work at all.
  - The night's badges = every badge whose requirements are in the focus sets, plus any badge added directly.
    Each badge is its own group (a class) whose columns are that badge's focus requirements (or, for a badge added
    directly with no focus items, its open top-level requirements per scout).
  - A Merit badge group scout's switch is Teach or one of the badges (the first badge by default).
  - Any scout (a gap fill, Decision 2) can be moved into a badge group; younger scouts are never put there
    automatically.
  - **A rank-free night:** no rank groups exist, the grid shows the badge sections, and every counted scout reads
    "Nothing assigned" until placed. The coverage strip still shows (it's honest: nobody is on rank work), and its
    gap count is the to-do list. Nothing is hidden or blocked.
- **Columns:** a group's columns are the **highest picked** focus items for its rank or badge, in catalog order. A
  focus set holding FC 7a and 7a.1–7a.4 gives one column, 7a; a set holding only 7a.2 gives 7a.2. (Built 2026-10-28:
  real sets pick parents and children together, so expanding to leaves would give 30 columns.)
- **✓** = the scout hasn't signed that leaf off. Blank = signed off, or not in the focus.
- **Working ahead:** a scout whose own group has no ✓ left (or doesn't exist tonight), and who has an open ✓ in the
  next group, is placed in the next group automatically. There is no approval and no label; the rank-colored chip shows it. It goes one step only,
  and never into the Merit badge group.
- **Coverage (counted scouts):** every active scout in the Scout through First Class groups. That is the whole
  active roster, not just those coming. A scout counts once they have ≥1 ✓ where they're placed.
- **Nothing assigned:** a counted scout with no ✓ and no gap fill. Copy: "Nothing assigned", or "Nothing assigned ·
  every offered requirement is done".
- **Requirement classes don't filter focus sets** (D-440: tags never filter a focus set). The grid shows every focus item.
- **The plan is never locked.** Live (Rotations) is the same plan.
- **Can't-come scouts** are counted and gridded (whole roster) but are not placed in a group class on Rotations.
  Reconcile already removes unpinned not_coming members.
- **Teacher slot per group:** "No teacher yet" is flagged but never blocks anything.

## Acceptance Criteria

- [ ] A seed holder picks one or more focus sets for a meeting from a searchable, label-filtered popover. Each row
      shows labels, requirement count and "Last used …" / "Not used yet". Picked sets show as removable chips.
- [ ] "+ Add a focus set" builds and saves a new set inline (name, labels, rank and merit badge requirement search,
      grouped "In this set"). A blocked Save marks the field and says "Can't save yet: … (+N more)". The saved set
      joins tonight's focus.
- [ ] Every active scout appears exactly once, in the group the rules above place them in.
- [ ] Rank groups appear only for ranks the focus covers. A meeting can offer several merit badges, and a meeting
      with only merit badges (no rank work) plans and runs with no errors or empty rank cards.
- [ ] The checklist grid shows one section per group (rank or badge), with leaf codes as columns and a ✓ per open
      leaf. Rows with nothing assigned are tinted, and filters isolate Nothing assigned and No answer.
- [ ] Clicking a Nothing assigned row offers Requests and offers / Help teach / Move to <group>; the choice sticks
      and the row stops being a gap.
- [ ] Name chips use the scout's current rank color, with the rank in the accessible name. Group-card chips use the
      RSVP tint (coming green, can't-come gray, others white). Clicking a name opens the person drawer.
- [ ] The coverage strip shows the rank-work count, %, a bar, "N with nothing assigned", "N groups without a
      teacher" and the answer counts. No target, badge or meets/below label appears anywhere.
- [ ] Each group (rank, badge, or extra class from requests and offers) has a teacher slot; the candidates are adults
      with a matching skill (counselors first for a badge), plus Merit badge group scouts set to Teach.
- [ ] The Merit badge group card has a per-scout switch: Teach, or one of the night's badges.
- [ ] Every job Who's coming did is on This week, and `/planner` shows This week.
- [ ] Rotations shows one class per group with its teacher, plus badge and extra classes, and every plan edit shows
      there without a reload.
- [ ] Publish snapshot emails each family once: the focus, this week's options, their scout's suggestions marked,
      and a magic link to `/member/meeting`. After an edit, This week says families see snapshot n until republished.
- [ ] `/member/meeting` shows the focus, the options with "Suggested for <scout>", ticks (2–3 asked, 5 max), Coming /
      Not sure yet / Can't make it, and "Request something else". A tick is a real pick and lands the scout in that class.
- [ ] View holders see everything read-only; every write is refused on the server for the wrong right. Scouts
      (incl. the SPL) can't publish (email is adults only).
- [ ] Works at 390px (the grid scrolls sideways inside its own box; the page never does).

## Test Plan (stubs first)

Pure placement (`lib/focus-plan.ts`):
- [ ] `Placement_NoRankScout_GoesToScoutGroup()`
- [ ] `Placement_SecondClassScout_GoesToFirstClassGroup()`
- [ ] `Placement_FirstClassThroughEagle_GoToMeritBadgeGroup()`
- [ ] `Placement_ScoutDoneWithOwnFocus_MovesToNextGroup_WhenItHasOpenWork()`
- [ ] `Placement_ScoutDoneWithOwnFocus_StaysAndShowsNothingAssigned_WhenNextGroupHasNone()`
- [ ] `Placement_NeverMovesYoungerScoutIntoBadgeGroupAutomatically()`
- [ ] `Groups_OnlyRanksTheFocusCovers_AppearAsGroups()`
- [ ] `Groups_TwoBadgesInFocus_MakeTwoBadgeGroups()`
- [ ] `Groups_BadgeOnlyNight_HasNoRankGroups_AndEveryCountedScoutIsAGap()`
- [ ] `OlderScout_DefaultsToFirstBadge_AndCanTeach()`
- [ ] `Columns_ExpandTopLevelFocusItem_ToItsLeaves_InCatalogOrder()`
- [ ] `Columns_UnionAcrossSeveralFocusSets_WithoutDuplicates()`
- [ ] `Check_IsOpen_WhenLeafNotSignedOff_AndBlank_WhenParentSatisfiedByNOf()`
- [ ] `Coverage_CountsWholeActiveRoster_NotJustComing()`
- [ ] `Coverage_ExcludesMeritBadgeGroup()`
- [ ] `GapFill_ClearsNothingAssigned_ButNotRankWorkCount()`
- [ ] `NothingAssigned_SaysEveryOfferedRequirementIsDone_WhenNoOpenWorkAnywhere()`
- [ ] `Suggestions_ForScout_AreTheirPlacedGroup()`

Screen, actions and family page:
- [ ] `ThisWeek_ShowsNoTargetOrMeetsLabel_Anywhere()`
- [ ] `ThisWeek_NothingAssignedFilter_ShowsOnlyGapRows()`
- [ ] `ThisWeek_CarriesEveryWhosComingJob()` (answers, no-answer list + reminders, person drawer, requests with no
      teacher, attendance prompt)
- [ ] `NameChip_AccessibleName_SpellsOutRank()`
- [ ] `Viewer_SeesThisWeekReadOnly_AndIsRefusedOnEveryWrite()`
- [ ] `NonSeeder_IsRefused_WhenChangingFocusOrBadges()`
- [ ] `ScoutEditor_IsRefused_WhenPublishing()`
- [ ] `FocusBuilder_SearchesMeritBadgeRequirements()`
- [ ] `FocusBuilder_BlockedSave_MarksNameAndCountsMore()`
- [ ] `ApplyPlacement_KeepsPinnedAndHeldScouts_SkipsNotComing()`
- [ ] `Reconcile_DoesNotEvictFocusGroupMembers_WithAPickList()`
- [ ] `GroupTeacher_ShowsInRotations_WithoutReload()`
- [ ] `PublishSnapshot_SendsOneEmailPerFamily_WithSuggestionsMarked()`
- [ ] `PublishSnapshot_ThenEdit_ShowsEarlierVersionNotice_AndPublishNewSnapshot()`
- [ ] `MagicLink_SignsInToMemberMeeting_AndExpiresAt6pmMeetingDay()`
- [ ] `MemberMeeting_ShowsFocusAndSuggestedOptions_FromLatestSnapshot()`
- [ ] `MemberMeeting_TickOutsideSuggestions_IsAPick_AndPlacesScout()`
- [ ] `MemberMeeting_RequestSomethingElse_ShowsAsExtraClass()`
- [ ] `MemberMeeting_TickRemovedOption_IsRefusedWithReason()`
- [ ] `RankChipTokens_ArePublicTokens_NotAdmin()` (covered by the design-system census)

## Technical Approach (tech-lead reviewed 2026-10-28; Patrick's answers folded in)

1. **Placement is computed in TS, not stored.** A pure `lib/focus-plan.ts` takes the roster, ranks, progress
   (`loadScoutProgress`, incl. `mb_progress`), catalog and the meeting's focus items and badges, and returns the
   groups, columns, ✓ cells, coverage and gaps. SQL can't compute it: the leaf roll-up lives in TS, and sign-offs fire
   no triggers. This week derives it on every read. Only **choices** are stored: focus, badges, teachers, older
   scouts' roles, gap fills.
2. **Focus = the meeting's `fg:` topics, unchanged.** Picking a set still calls `meeting_seed_focus_set` (items
   frozen in `meeting_topic_members`, as in B5b). Removing it still unseeds. The `fg:` topic stays pickable for old
   plans, but an `fg:` that has groups is **not taught as its own class**: `_meeting_topic_on_plan` returns false for it.
3. **A group is a topic of new kind `focus_group_part`**, one per rank or badge per meeting (not per set), so
   several sets give the union of their columns: key `fr:<rankId>` for a rank group, `fr:mb:<mbId>` for a badge group.
   Teachers, invites, picks, the teacher mirror and Rotations classes all work unchanged on a topic.
   - Migration: widen `meeting_topics_kind_check`, add the branch to `meeting_topics_one_reference`, refuse `fr:`
     keys in `_meeting_topic_id` and `meeting_seed_topic` (only the planner's RPCs create them).
   - **Reconcile guards:** step 3a evicts unpinned members with a pick list that lacks the class's topic, so exempt
     `focus_group_part` classes from 3a (placement, not picks, put most members there). A family's tick IS a pick on
     the `fr:` topic, which pins them. The "begins on its own" rule counts fr / fg as plan.
   - **Materialize with `meeting_apply_focus_placement(entry, actor, jsonb [{person, key}])`.** It takes
     `_meeting_live_lock` first and writes members `pinned=false`, skipping not_coming scouts, pinned members and
     `meeting_live_holds`. It removes only the unpinned group members who left the placement, then calls
     `_meeting_live_bump`. It runs on a focus or role edit, on opening Rotations, and from This week's refresh, and
     is skipped when the placement hash hasn't changed. It bypasses the 8-per-class and 2-per-scout late-pick caps
     (Decision 7: a big group is one class).
   - Membership isn't stored before the arrangement begins. This week is derived on read.
4. **Badges:** the night's badges = badges in the focus sets' items (their `fr:mb:` groups) plus badges added
   directly ("+ Merit badge", an `fr:mb:` group with no focus items: its columns are each scout's open top-level
   requirements of that badge). `focus_sets.merit_badge_id` (nullable FK) is a suggestion shown in the picker, not a
   rule. There is no per-meeting badge column (`board_mb_id` was dropped, D-430).
5. **Roles and gap fills:** `meeting_scout_roles(calendar_entry_id, person_id, role, topic_key null)`, one row per
   scout per meeting. Roles: `teach` (an older scout teaching or helping), `group` (moved to a named group or badge,
   by hand — a gap fill or an older scout's badge choice), `request` (placed from requests and offers, topic_key =
   the pick/offer). No row = placement decides. A hand choice is pinned in Rotations.
6. **Snapshot and family email:** `meeting_plan_snapshots(calendar_entry_id, n, payload jsonb, payload_hash,
   published_by, published_at)` (not `meeting_plans`, D-432). Payload = focus names, options (topic key, title,
   teacher if set), and per-scout suggested keys. "Changed since" = hash of the canonical payload vs the latest.
   - Email: a new template `meeting.plan_published` through the existing digest pipeline (`meeting_invites`, one per
     family, adults only, per-send caps), with a magic link minted on the `login_tokens` path, scoped to land on
     `/member/meeting?meeting=<entry>`, expiring 6 PM Central meeting day. qa-lead designs the link before P4 builds.
   - `/member/meeting` reads the latest snapshot for the focus and suggestions, and live topics for what can be
     ticked (a ticked option that's since been removed is refused with a reason).
7. **Screen:** This week is `/planner` (the page Who's coming used). `/planner/build` redirects there with its query;
   Suggestions keeps its `?view=`. Tabs: This week · Invite · Rotations · Focus sets · Has/Needs. Two columns at
   ≥1100px, stacked below. Public components only (`Button`, `Drawer`, `Notice`, `TabStrip`, `EmptyState`) and the
   existing person drawer.
8. **Rank colors:** public tokens `--rank-{new,scout,tenderfoot,second,first,star,life,eagle}-{bg,ink}` with the
   README's hex values. `--admin-*` is blocked on public routes.
9. **Freshness and performance:** one loader for the screen (about 30 scouts, one `loadScoutProgress`), with its
   query count pinned in a test. The 10s poller watches `meeting_board_stamp` and refetches only on change.
   Sign-offs don't move the stamp, so the grid refetches when the tab regains focus, and has a quiet Refresh.
10. **Fixtures:** delete `meeting_classes` before topics (D-437).

## Implementation Steps (each phase ships when qa passes; migrations wait on a branch until Patrick says ship, D-404)

1. **P0 (no migration):** `lib/focus-plan.ts` (ranks AND badges, rank-free nights) + the pure tests; public
   rank-chip tokens.
2. **P1 (no migration):** This week, **read-only**, at `/planner/this-week` behind the tab strip while Who's coming
   stays: header with meeting switcher and coming-weeks strip, focus chips, coverage strip (incl. answer counts),
   group cards (RSVP tints, "N need it"), checklist grid, Nothing assigned / No answer filters, legend, the person
   drawer on name click. The focus popover is browse-only (adding a set today makes a single `fg:` class on Rotations).
3. **P2 (one migration, worktree):** `focus_group_part` + reconcile guards, `meeting_apply_focus_placement`,
   `focus_sets.merit_badge_id`, `meeting_scout_roles`. Screen: focus add/remove, "+ Merit badge", teacher slots,
   the Merit badge group switch, the inline focus-set builder (incl. MB requirements), gap fill on row click
   (Decision 2), From requests and offers classes with teacher slots, reminders. **Then fold:** This week moves to
   `/planner`, Who's coming retires, `/planner/build` redirects.
4. **P3:** Rotations shows the groups as classes (rank, badge, Helping teach, From requests and offers), applied on
   open and on every focus or role edit.
5. **P4 (migration):** Publish snapshot + family email + magic link + the reworked `/member/meeting`. Pick invites
   to scout families leave the Invite tab.
6. **P5:** Theme calendar on real focus sets and groups (per-week coverage, group × week grid).
7. **P6:** retire leftovers (Decision 9, no confirmation needed): Design II surfaces Design III replaces, the
   `meeting_plans` table, dead tables/RPCs.

Per phase: tech-lead review of the migration before P2/P4, qa-lead after each phase (and on the magic link before
P4), full quality gate, changelog bullets in the feature commit.

## Open Questions (for Patrick)

- [x] Who's coming → folds into This week (Decision 1).
- [x] Nothing assigned row → menu (Decision 2). Grid → display-only (3). Eagle → Merit badge group (4).
- [x] Publish → family email + magic link + reworked member page (5). Picks and offers → extra classes (6).
      Big group → one class (7). Several badges / rank-free nights (8).
- [x] (default, Decision 9) **Republishing:** does "Publish new snapshot" email every family again, or only families whose scout's
      options or suggestions changed? Lean: only the changed ones, with "Email everyone" as a quiet option.
- [x] (default, Decision 9) **Who gets the family email:** every active scout's family, or skip families who already answered Can't make it?
      Lean: every active family; Can't make it families get it too (plans change).

## Notes

- The README asks that rank-color hex values match the Troop 79 workspace tokens; this plan keeps the hex values and
  only changes the token names (public vs admin).
- Theme Calendar.dc.html is directional only (old theme list, old bands).
- Related: D-440 (requirement classes), D-426/D-429/D-437 (Rotations), D-404 (ship on Patrick's word).
