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
| 10 | **Live at the meeting is Design III's own view; Rotations retires** (Patrick, 2026-10-28). Session cards derived from the plan, tap to check in, attendance approved after the meeting. No rotation numbers, locations, moves or arrangement engine. |

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
- [ ] Live at the meeting shows one session per group with its teacher, plus badge, Helping teach and extra
      sessions, derived from the plan, and tapping a name checks the scout in.
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

## Technical Approach (revised 2026-10-28 after Decision 10: Rotations retires)

Decision 10 removes the arrangement engine. That deletes the hardest part of the tech-lead review (reconcile guards and
materializing placement into `meeting_class_members`): **nothing is materialized; Live is derived like the rest.**

1. **Placement is computed in TS, never stored** (`lib/focus-plan.ts`, P0). Inputs: roster, ranks, progress (rank
   AND merit badge ledger codes), catalog, the meeting's focus items, its direct badges, and the planners' choices.
2. **Focus = the meeting's seeded `fg:` topics** (`meeting_seed_focus_set` / unseed, items frozen in
   `meeting_topic_members`). They are the focus record only; never taught as a class.
3. **A group is a `meeting_topics` row of new kind `focus_group_part`** (`fr:<rankId>`, `fr:mb:<mbId>`), so teachers
   (`meeting_topic_teachers`), teacher invites and teach pages (`meeting_invites`, B10), and family picks
   (`meeting_topic_picks`) all work on it unchanged. The row is created **lazily** by `meeting_group_topic(entry,
   actor, key)` the first time something needs it (a teacher, an invite, a pick, a publish), which validates the key
   (a group rank or a real badge). Which groups exist tonight is always the TS derivation; a stale row (its group
   left the focus) is simply not shown.
4. **Direct badges:** `meeting_night_badges(calendar_entry_id, mb_id, added_by_person_id, created_at)`.
   `focus_sets.merit_badge_id` (nullable) is shown in the picker as the set's paired badge, and adding the set offers it.
5. **Hand choices:** `meeting_scout_roles(calendar_entry_id, person_id, role ∈ teach|group|request, ref_key,
   set_by_person_id, set_at)`, one row per scout per meeting. A family's tick on a group option writes a pick; a
   scout who picked a group is placed there (picks outrank placement, roles outrank picks).
6. **Extra classes ("From requests and offers"):** every non-group topic with a Coming scout's pick or a teacher
   offer, each with its own teacher slot (`meeting_topic_teachers`, as today).
7. **Live at the meeting** is This week's second view: session cards derived from the same plan (groups, badges,
   Helping teach, extra classes). Tap a name → `meeting_live_presence` (the existing draft). After the meeting,
   "Would you like to update attendance?" (B8) lists the derived plan's people + anyone ticked present, and writes
   `event_attendance` through Roll Call as today.
8. **Snapshot and family email** (P4): `meeting_plan_snapshots(calendar_entry_id, n, payload jsonb, payload_hash,
   published_by_person_id, published_at)`. Payload = focus names, options (key, title, teacher), per-scout suggested
   keys. "Changed since" = hash of the canonical payload vs the latest. Email `meeting.plan_published`, one per
   family (adults only), through the `meeting_invites` digest pipeline, with a magic link on the `login_tokens` path
   to `/member/meeting?meeting=<id>`, expiring 6 PM Central on the meeting day. A republish emails only families
   whose options or suggestions changed (quiet "Email everyone").
9. **Retire (P6):** Rotations (`meeting_rotations`, `meeting_classes`, `meeting_class_members`, `meeting_live_holds`,
   `meeting_boards.live_*`, reconcile functions and their triggers on picks and intents), the matcher
   (`meeting-board-match`, `loadMatchOrPlacement`), Build a Plan and Suggestions (`meeting-suggest`,
   `build-plan*`), Who's coming, pick invites to families, and `meeting_plans`. The admin agenda's planner feed and
   `/member/meeting` read the derived plan instead.
10. **Screen:** This week at `/planner` (Who's coming's URL, so emailed links keep working). Tabs: This week · Invite
    (teacher asks, by group) · Focus sets · Has/Needs. Public tokens and components only.
11. **Freshness:** one loader per screen, query count pinned; the 10s poller keeps watching the board stamp
    (picks, intents, topics, teachers), plus refetch on tab focus for sign-offs.

## Implementation Steps (one branch, `feat/planner-iii`, shipped together: Patrick's goal is every phase deployed)

1. **P0 (done, 9f96c2d6):** `lib/focus-plan.ts` + 33 tests; public rank and RSVP tokens.
2. **P1:** the This week loader and screen (read side): header, meeting switcher, coming-weeks strip, focus chips,
   coverage strip with answer counts, group cards, checklist grid, filters, legend, person drawer on name click.
3. **P2 (migration):** `focus_group_part` + `meeting_group_topic`, `meeting_night_badges`, `meeting_scout_roles`,
   `focus_sets.merit_badge_id`. Writes: focus add/remove, + Merit badge, teacher slots, Merit badge group switch,
   gap-fill menu, inline focus-set builder (incl. MB requirements), reminders.
4. **P3:** Live at the meeting (session cards, check-in) + attendance review on the derived plan.
5. **P4 (migration):** Publish snapshot, family email + magic link, the reworked `/member/meeting`.
6. **P5:** Theme calendar (per-week coverage, group × week grid).
7. **P6 (migration):** retire what Decision 10 and Decision 9 free up (item 9 above); This week moves to `/planner`;
   Invite asks teachers by group.

Each phase: tests first, full gate; tech-lead on each migration, qa-lead on the whole before shipping (and on the
magic link before P4 is built). Ship: `db push` (DB-first), ff-merge, push, Vercel Ready.

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

## As built (2026-10-28, branch feat/planner-iii)

- **One migration, 20261228100000_planner_iii_groups:** group topics (`focus_group_part`, lazy via
  `_meeting_topic_id`), `meeting_night_badges`, `meeting_scout_roles`, `meeting_plan_snapshots`, `meeting_plan_pages`
  + `meeting_plan_page_claim`, `focus_sets.merit_badge_id`, board stamp (+ roles, badges, snapshots, presence),
  merge_people (+ the new tables, − Rotations). **Rotations retired in the same migration** (Decision 10): its
  triggers, reconcile and meeting_live_* RPCs (presence kept, without the lock), tables, `meeting_boards.live_*` /
  `attendance_seeded_at`, `meeting_topics.class_set_aside_at`, and `meeting_plans`.
- **Columns** are the highest picked focus items (FC 7a, not 7a.1–7a.4). A scout whose own rank has nothing in the
  focus moves to the next group when it has open work.
- **Picks outrank placement, hand choices outrank picks.** Family ticks of a group are picks on its `fr:` topic.
- **Teacher asks** are "Ask by email" in each teacher slot (the existing teacher digest and answer page), so the
  Invite tab retired with Build a Plan, Who's coming and Rotations; their routes redirect to /planner.
- **Family link** per qa-lead: scoped token, own scouts only, 6 PM expiry, superseded on republish, revocable ("Close
  family links…"), GET writes nothing, 200-write cap; test scouts are never emailed.
- **Picks:** at most 3 per scout (the server refuses a 4th); nothing carries over from an earlier meeting.
- **The admin agenda's planner tray** reads This week's sessions.
- PLANNER_WEEKS = 8 (This week's switcher, the Theme calendar, every gate).
