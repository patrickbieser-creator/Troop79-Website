# Build a Plan

**Status:** COMPLETE — B0–B10 + Rotations L0–L3 LIVE (v1.246.0–v1.254.0, 2026-10-23). Meeting Live is now Rotations.

**meeting_plans table kept (one published snapshot, 2026-10-18); drop after Patrick confirms.** B4 retired every reader and writer in src/; the drop is a contraction migration of its own (code-first), guarded to refuse while recent published rows exist.
**Priority:** High: "likely to be the primary method of interacting with the meeting planner".

## Request (Patrick, 2026-10-22)

A new first tab, "Build a Plan". Besides teachers offering a skill (today's behaviour), planners pick focus sets or
single requirements and add them to a Sunday meeting's offerings. The result is a mix the troop hopes to teach, and
planners then invite qualified scouts and teachers to sign up. Admin's generator (who needs what next) is the starting
point for suggestions. Planners can also build a mix by hand, from an existing focus set or a new one. All of it lives
on the planner side as the first tab.

## Design (jenna, UX + tech-lead, build; 2026-10-22)

**One store, no new plan entity.** A plan is the meeting's `meeting_topics`: seeded requirements, `{mbId}-{code}` MB
requirements and `fg:{id}` focus groups, plus teacher-offered and scout-picked topics.
- An offering's teacher is `meeting_topic_teachers` with `for_picks = false`.
- Invites are `meeting_invites` (teach / pick).
- Suggestions the planner is weighing are client state; nothing is written until **Add**.

**The screen** (`/planner/build`, first tab):
- **Header:** a meeting switcher (next 4 meetings, defaulting to the next one) and a sticky summary rail
  ("5 offerings · 3 have teachers · 14 scouts signed up · 6 invited").
- **Plan list:** one row per offering, carrying:
  - its title and code, with an origin tag (Planner / Scouts asked / Teacher offered);
  - a teacher line ("Maria L · agreed", "asked Tue", "Needs a teacher");
  - a scout line ("3 signed up · 5 likely, not yet asked");
  - its state (Ready / Needs a teacher / Needs scouts);
  - controls: a quiet Edit and a ⋯ menu ending in Remove, whose dialog names the consequence. A row that scouts picked
    or a teacher offered can't be removed by the planner.
- **One add row** under the list: "+ Requirement  + Focus set  + New mix", each inline with Cancel.
  - A new mix is always saved as a focus set, auto-named "Mix for Oct 25" and editable, so there is one concept.
- **Suggested** (right column; a sheet on phone): `engine.ts`'s candidate classes, ranked by shared need, up to 8.
  Each reads "6 need it · best teacher: Dan K." with one Add. Nothing is auto-added. Suggestions stream (Suspense),
  so they never block the plan.
- **Invite…:** the one primary button. It opens a review sheet per offering (the teachers to ask, the families to
  offer it to), each person with a one-line reason why they qualify. Nothing sends until "Send N emails". Adults
  only; for a scout, including the SPL, it is greyed with the reason.
  - Qualified teachers: a matching teaching skill, counselors first, scouts only if First Class+ / Junior Leader
    and the skill is youth-teachable.
  - Qualified scouts: they still need it (`isPickOutOfReach`, with the SMC 95% and BoR gates), haven't picked it,
    and haven't answered "can't".
- **Rights (existing):**
  - view → read-only tab;
  - seed → Add / Remove / new mixes;
  - edit → teacher;
  - edit + adult → invites.
- **Phone:** rows become cards, Invite sits in a sticky bottom bar, the add row opens the full-screen Drawer, and
  targets are 44 px.

**Consolidation (one way to add an offering):**
- The seed drawer retires.
- "+ Add an offer" stays everywhere (Decision 10a), but every entry point calls one `plannerAddOfferingAction`.
- The board's class cards move into Build as row states.
- This Sunday becomes **Who's coming** (attendance and replies).
- Admin's generator redirects to Build once B3 is proven; By Scout and Teaching Roster stay.

## Phases

1. **B0 (no migration):** move `engine.ts` and `load-input.ts` to `src/lib/meeting-suggest/`.
   - Suggestions carry the board `key`.
   - A merit badge suggestion becomes its first missing top-level requirement (Decision 10: no whole-badge picks).
   - Fix `topicWords` in the invite senders so `fg:` / `ff:` keys can be invited for.
   - `scoutCandidatesMany` replaces the per-scout loop.
2. **B1 (migration `meeting_seed_many`):** the tab, the plan view, and suggestions with Add (one batched action, one
   lock, returns the changed slice; no page reloads).
3. **B2:** manual add: requirement search, focus set, new mix, the teacher chip.
4. **B3:** Invite (per offering, plus "invite all qualified").
5. **B4:** retire the seed drawer and Admin's generator; rename This Sunday; point "+ Add an offer" at the shared action.
   - Built 2026-10-22: /planner stays Who's coming (no redirect for editors: email links point there). The seed drawer,
     Meeting focus strip, Ready and Offered cards and the nudge drawer retired; an "Edit the plan" strip links to
     /planner/build?meeting=<id> and keeps one "+ Add an offer". Requests with no teacher STAYS on Who's coming (Assign,
     who-can-teach-by-answer and Send request have no home in Build yet).
   - One add path: a teacher-less offer and Focus sets' "Add to the plan" go through plannerAddOfferingAction /
     plannerAddFocusSetAction (seedMany); the board's seed actions and lib seedTopic are gone. Meeting Live's "+ Add an
     offer" only places a class for a topic already on the meeting, so it never seeds.
   - Admin's generator redirects to /planner/build; By Scout + Teaching Roster lived only inside it and moved to
     /admin/advancement/meeting-plan/by-scout. /meeting-plan, publishPlan/unpublishPlan retired; table kept (above).

## Test plan (stubs first)

- `Engine_Suggestion_CarriesBoardKey`
- `Engine_MeritBadge_SuggestsRequirementKeyNotWholeBadge`
- `SendPickInvites_FocusGroupKey_Sends`
- `SendTeachInvites_FocusGroupKey_Sends`
- `ScoutCandidatesMany_AgreesWithScoutCandidates_PerKey`
- `BuildPlan_AddSuggestion_UsesBoundedRoundTrips`
- `NonSeeder_IsRefused_WhenAddingOffering`
- `ScoutEditor_IsRefused_WhenInviting`
- `NewMix_SavesFocusSetAndSeedsItOnce`
- `Invite_RefusesScoutWhoAlreadyFinishedKey`

## Risks

- **Performance:** nothing in Build may reload the whole board per click. Return slices, and pin the query count in
  a test. This is today's lesson, D-pending.
- **Suggestion cost:** suggestions read the whole ledger. Stream them, and cache if slow.
- **Email volume:** invites are one email per topic per family.

## Decisions (Patrick, 2026-10-22)

| # | Decision |
|---|---|
| 1 | An added offering is **live to scouts at once**. Added = offered; email invites are the only extra gate. No draft state. |
| 2 | Invites go out as **one digest per family**: each family gets one email listing every offering their scout (or the adult) is invited to, not one email per topic. This needs a new digest template (`meeting.invite_digest`) and recipient grouping like reminders (P5b: one email per recipient naming everything it covers). It lands in B3. |
| 3 | **Publish to Site retires.** `/meeting-plan` and the `meeting_plans` snapshots retire in B4, and Build a Plan is the plan of record. |
| 4 | **This Sunday becomes "Who's coming"**, and Build a Plan works on **any of the next 4 meetings** (meeting switcher). Tabs: Build a Plan · Who's coming · Meeting Live · Focus sets. |
| — | Defaults both reviewers agreed on, taken without asking: a new mix is always saved as a focus set; seed holders build, others see it read-only; a row that scouts picked or a teacher offered can't be removed by the planner. |

## B5: Suggestions mode (Patrick + jenna, 2026-10-22)

Patrick: the retired Admin generator was more useful than the 8-item Suggested column. Restore all of it in Build a Plan.

- **Container:** a Suggestions *mode* of Build a Plan, not a modal (Patrick chose jenna's design). The main area becomes the
  suggestions workspace. The plan shrinks to a slim live rail on the left (items, count, Invite…). On a phone it goes
  full-screen, with the plan behind a "Plan (n)" button (the existing Drawer).
- **Entry:** the heading bar reads "Suggestions  + Requirement  + Focus set  + New mix". Suggestions is first, and the three
  manual adds stay unchanged.
- **Lenses:** a sticky bar holds the meeting date, the lens switch, and filters (rank, MB only, show what's already on the plan).
  - **Group Sessions** (default): one card per session, grouped by rank. Each card shows the requirement, N need it, the
    group of up to 8 by name, and the best teacher.
  - **By Scout:** each scout's next 3 requirements, plus MB suggestions for older scouts.
  - **Teaching:** who can teach what.
  - **Needs a campout:** a collapsed footer on every lens, with no Add.
- **Add:** one click per session or per requirement. Ticking works across lenses, with "Add N to the plan". Items already on
  the plan show "On plan" + Remove. A plan item is a topic, and its likely scouts are computed live, so there is no
  partial-overlap state.
- **Retire:** the right-hand Suggested column, and the Admin By Scout / Teaching Roster page once these lenses match it
  (Patrick: yes). Old links redirect to Build a Plan's Suggestions.

## B6: Invite tab (Patrick + jenna, 2026-10-22)

Patrick: invites come after the plan is built, so they get a whole screen, not a sidebar. Tabs: Build a Plan · **Invite** ·
Who's coming · Meeting Live · Focus sets. Route `/planner/invite?meeting=<id>`, with the same meeting switcher as Build.

- **Desktop, three zones:**
  - **Left (280px):** the offerings, each with its readiness: Ready / Needs a teacher / Needs scouts, a status line like
    "Maria L agreed · 5 likely · 2 asked · 1 yes", and "3 ticked".
  - **Centre:** the selected offering. Teachers first, then scouts. Each row has a tick, the name, a reason line, a status
    chip (Not asked · Asked Tue · Yes · Can't · Picked it · Asked <24h, which is blocked and greyed with the reason), and who
    gets the email ("Parents: Dana, Rob").
  - **Right (320px, sticky):** a Review grouped by recipient ("Walters family: Charlie (Tenderfoot 4a), Finn (First aid 9)"),
    with a Preview email button that opens a Dialog rendered by the real digest renderer.
  - The one primary is **"Send N emails to M families"**, at the foot of the Review.
  - A **By offering | By person** switch. By person shows one row per scout or adult, listing every offering they could
    be asked about, with the same tick state.
  - Quiet per-offering controls: Tick all likely, Clear, Show all eligible (n), and a collapsed "Said no (n)".
- **Not ready → warn (Patrick).** A Notice names the offerings with no teacher, and their teacher asks start ticked. An
  empty plan blocks, and its EmptyState links to Build. A past or closed meeting is read-only.
- **Re-ask (Patrick):** after 24h with no answer, yes, but unticked and shown as "Asked Tue".
- **Who sees it (Patrick):** viewers and the SPL see the tab read-only. Send is greyed with "Only adults send email" and
  refused on the server.
- **Likely:** the existing rule (README:102, meeting-planner-board.ts:19): working on that rank (their next rank), hasn't
  picked or finished it, not Can't, not `isPickOutOfReach`. It now applies everywhere:
  - **Focus group:** likely if the scout's next rank is the rank of at least one unfinished member of the mix.
  - **MB requirement:** likely if the scout has that badge in progress.
  - Delete the `topic == null` shortcut in `isLikelyFit` (build-plan.ts:83).
  - "Show all eligible (n)" lists the remaining candidates, unticked.
  - Reason lines: "Working on First Class · mix covers 4a, 5c · Coming".
- **Teachers:**
  - The assigned teacher shows as a locked line, then pending asks, then the top 5 qualified adults (counselors first).
  - "Show everyone who could teach (n)" reveals the rest, with scout teachers last, labelled.
  - Teachers start ticked only when the offering has no teacher and no pending ask.
- **Leaves Build a Plan:** Invite…, the sticky invite bar, the per-row Invite, InviteSheet, and "N invited" in the rail.
  Build's bottom bar instead gets one primary, "Next: Invite →", once the plan has an offering. "N invited" lives only in
  the Invite tab's summary.
- **Phone:** one column. The offering list drills into a detail view, with a sticky "Send N emails · Review" bar that
  opens the Drawer.
- **Tech-lead items:**
  - Per-send caps: 20 offerings, 200 invites, 100 emails. At a cap, mark the overflow in place and say "send again".
  - A loader for whole-meeting invite status per person: `loadInviteRows`, not just the 24h `invitedLately`.
- **Amendment (Patrick, 2026-10-22):** Build a Plan rows keep a per-row Invite, but only as an afterthought inside the ⋯
  menu, above Remove. The row's visible controls become "Needs a teacher · Edit · ⋯". The menu item opens the Invite tab
  with that offering selected (`/planner/invite?meeting=<id>&offering=<key>`). The primary invite path is the Invite tab.

## B5b: Editing a mix on a plan doesn't touch the master focus set (Patrick, 2026-10-22)

- Saving a mix's requirements from Build a Plan's Edit panel changes only **this meeting's copy** (its `meeting_topics`
  row). The master focus set is left alone. Today B2's `meeting_edit_mix` writes both.
- A separate, quiet action, "Also update the focus set '<name>'…", opens an **"Are you sure?"** danger-style Dialog that
  names the set and the effect: future plans that add it get the new version, and meetings already using it keep theirs.
  Confirm → the master set is updated as well.
- Meetings already using the set keep the version they had, whichever way it is saved.
- It needs a new migration that splits or flags `meeting_edit_mix` (an "update master" parameter); 20261215 is already in
  production. The screen copy changes to match ("Changes this meeting only").
- Rights: seed, as now. Ships after B5, ahead of B6, because it touches the same Edit panel.

## Planner out of Admin (Patrick, 2026-10-22), done with B6

- The planner lives on the public side, and Admin gets no planner link. Remove Admin Home's "requests with no teacher"
  attention row (`dashboard/attention-items.ts`, which links to /planner).
- ~~Keep Advancement › Has Needs~~: superseded by B7 (Has/Needs moves to the planner; the Admin page retires after Patrick approves the new one).
- **Keep the meeting editor's agenda builder and its planner feed** (Patrick): an agenda combines hand-entered items with
  what comes from the meeting planner, and a publishable version goes out on the public calendar and its page.
- **Check and fix if needed:** the agenda tray (`meetings/load-agenda.ts`) predates Build a Plan and feeds from the
  matcher. It should reflect the meeting's actual plan (Build a Plan's offerings and their teachers, or Meeting Live's
  saved placement once Live has started, via `loadMatchOrPlacement`), so the published agenda matches what will be taught.
- Admin › Access keeps the planner-rights columns. The old /admin/advancement/meeting-plan URLs stay as redirects only.

## B7: Has/Needs as a planner tab (Patrick + jenna, 2026-10-22)

- **Placement:** the last tab, after Focus sets. Route `/planner/has-needs`, labelled "Has/Needs". Page title: "Who has it,
  who needs it". Check that TabStrip scrolls on a phone now there are six tabs.
- **Port** of Admin's `/admin/advancement/has-needs`, reusing `lib/has-needs.ts`, on public tokens and components only.
  - **Desktop:** the picker on the left (the four lower ranks as leaf checkboxes; MB chip search drilling into a badge;
    "any 2 of" groups shown but not tickable).
  - **Centre:** Has · Needs · Partial as three columns, Partial naming what's missing, counts in aria-live.
  - **Right:** a sticky "Checked (n)" tray with removable chips and Clear.
  - A rank filter on the results. The selection lives in the URL (`?pick=…`) so a view can be shared.
- **Phone:** a Requirements | Results SegmentedControl, plus a sticky bar "3 checked · 9 have · 14 need · See who".
- **Who sees it (Patrick):** anyone with planner View (Decision 4).
- **Add hook (Patrick: yes):** when one requirement is the whole selection, the tray shows "Add <4a> to <Oct 25> plan" for
  seed holders. It uses the existing `plannerAddOfferingAction`, with a meeting choice defaulting to the next meeting,
  and shows "On plan" once added. Multi-item selections stay lookup-only.
- **Distinct from Suggestions:** Suggestions = "what should we teach?" (ranked by the engine). Has/Needs = "who is where on
  this?" (you pick the requirement). No ranking, teacher or invite logic here.
- **Retire Admin's Has/Needs only after Patrick approves the new page.** Then delete the folder, the nav entry and the
  styleguide sample, update the admin-hub and section-nav tests, and redirect permanently to `/planner/has-needs`.
- **Status (2026-10-22):** B7 built on `feat/build-plan-suggestions` (779e4065). **Admin Has/Needs retirement is pending
  Patrick's approval of `/planner/has-needs`**; until then `/admin/advancement/has-needs` stays as it is. Decision taken
  in the build: the add hook adds the ticked leaf's TOP-LEVEL requirement (ticking First Aid 9b offers "Add First Aid 9"),
  since a plan offering is a whole top-level requirement.

## B8: Meeting Live is reversible; attendance is approved, never automatic (Patrick, 2026-10-22)

Tech-lead found "Start Meeting Live" is a one-way door with no confirmation. On the meeting day, the first Live open also
auto-marks every placed scout and teacher present, with ledger credit (`seedLiveAttendance`). Patrick: "Nothing should
happen automatically."

- **No automatic attendance.** Remove the day-of auto-seed.
- **Presence taps on Live are a draft.** They are stored on the arrangement (`meeting_class_members.present` or similar)
  and never touch event_attendance or the ledger directly.
- **"Would you like to update attendance?"** appears after the meeting is over, on Meeting Live and on Who's coming.
  - It opens a checklist pre-filled from the draft: placed scouts, teachers, visitors and anyone ticked present, grouped,
    each with a tick.
  - "Record attendance for N people" writes event_attendance through the existing Roll Call path, with its ledger credit.
  - Re-running it shows what's already recorded and applies only the differences.
  - **Who approves (Patrick): anyone with planner Edit, the SPL included.**
- **"Discard Live arrangement"** is allowed any time, including the meeting day. It sits behind an Are-you-sure Dialog
  that names what's lost and what stays.
  - It deletes the rotations, classes, members and draft ticks, clears `live_started_at` and bumps `live_version`, so the
    matcher view returns and new picks flow again.
  - It KEEPS approved attendance, visitors (guest people), and topics or teacher sign-ups added from Live.
- **Start Meeting Live** asks to confirm when the meeting is in the future.
- **Stale-tab guard:** an edit from an old Live tab must return STALE, not silently restart Live. Auto-start only for
  `s:` preview cards, or require an expectStarted flag.
- Needs a new migration (the discard RPC under the Live lock, plus any attendance-draft column), deployed DB-first.
  Also write an ADR amending Decision 9 / D-427.

## B5 fix: the Teaching lens (Patrick, 2026-10-22), shipping with B7

The Teaching lens's row checkbox and Add acted on the leader's first not-on-plan requirement and added it with no teacher.
Ticks were keyed by item, so other leaders sharing that item lit up. Patrick chose: **requirement chips become the
controls.** Each chip shows:
- "Add with <Name> teaching" (seed + edit) when the requirement isn't on the plan;
- "Assign <Name>" when it's on the plan without them;
- "on plan · teaching" when they already teach it.

There is no row-level checkbox or Add, and Teaching rows are out of the cross-lens multi-select.

## B9: Finding orphans (Patrick, 2026-10-22)

The engine's suggestions don't cover every scout:
- `engine.ts` skips scouts with no plannable suggestion and no campout item (~line 505), so they vanish from By Scout.
- Group sessions need at least 2 scouts, so a solo need never makes a card.
- There's a cap of 3 suggestions per scout.

Who's coming's "coming, nothing assigned" covers only Coming scouts against their picks, not the plan. Patrick: build all three.

1. **Build a Plan:** the summary rail gains "N scouts have nothing on this plan".
   - Count active scouts, excluding "Can't make it", for whom no offering on the plan is a likely fit (the shared likely
     rule, against the plan's actual offerings).
   - Clicking it opens a list: each scout with their likely next items and an Add (seed right, existing add action).
     Adding an item re-counts.
2. **Suggestions › By Scout:** list EVERY active scout. Those without suggestions get a one-line reason, such as
   "Nothing to plan: Scoutmaster conference waits for 95% of First Class", "No merit badge in progress", "Only time-based
   or Scout spirit left" or "Finished everything plannable". The engine reports the reason instead of skipping the scout.
3. **Suggestions › Group Sessions:** a "Solo needs" footer lists requirements only one scout needs (scout + requirement +
   Add), so they aren't lost.

## Rotations: one arrangement over the live plan (Patrick + tech-lead + jenna, 2026-10-22)

**Trigger:** on Oct 25 (entry 133), Live was started at 18:21. Afterwards Patrick was made Star 6's teacher (18:23) and
Anjali picked Star 6 (18:27). Live had no Star 6 class, so she couldn't be placed. Tech-lead found 8 ways the plan and
Live drift apart (plan = topic teachers, picks and intents; Live = class teacher and members), among them:
- a placed scout who later says Can't stays placed, and B8's checklist pre-ticks them;
- a teacher set on a card never reaches the plan;
- a plan Remove of a topic that has a class leaves an invisible class;
- a mix edit leaves the class's title stale.

**Decisions (Patrick):**
1. **Adopt the model.** There is one arrangement from planning time on. Adding an offering creates its class in Not
   scheduled, and rotations can be arranged any time, even with empty classes. Meeting Live is renamed **Rotations**,
   with a Today layer for attendance on the meeting day. The one-way Start retires, and Discard becomes "Reset to match
   picks". Built in phases L0–L3, each shipped when qa passes.
2. **Late picks auto-land** in their class, marked **New** until a planner dismisses it. A pick with no class waits
   in "Not in a class yet", with "Create class and place".
3. **Pinned scouts** (moved or added by hand) are never moved or removed automatically. If they say Can't or drop the
   pick, they're **flagged** with a Remove button. Unpinned scouts leave on their own.
4. **One teacher.** Choosing a teacher on a class card changes the plan's teacher. Only a repeat of a class can carry
   its own override.

**Phases:**
- **L0 (no migration):** a "Needs attention (n)" strip on the current Live screen, each case with a one-click fix:
  - an offering with no class → Make a class;
  - a scout who picked something with no class → Create class and place;
  - a placed scout who said Can't or dropped the pick → Remove / Keep;
  - a teacher that differs between plan and class → Use X / Use Y;
  - a class whose offering was removed → Keep as extra / Remove class.

  "Coming, nothing assigned" is renamed "Not in a class yet", and its chips show what each scout picked.
- **L1 (migration):** `meeting_class_members.pinned` and `meeting_reconcile(entry)` under the Live lock, called from
  every pick, intent, teacher and merge write once an arrangement exists. Auto-placement is persisted and sticky,
  marked New. Existing members of entry 133 are migrated as pinned. The B8 attendance review counts only current members.
- **L2 (migration):** one shared teacher. `class.teacher_person_id` becomes a nullable per-repeat override, and a card
  teacher writes through to the topic teacher for a single-repeat class. A new topic offering, teacher or pick
  auto-creates an unscheduled class once an arrangement exists, and Build's add always creates one.
- **L3:** rename the tab to Rotations, add Build row "Rotation 1 · 2 · 3" chips, retire Start (an arrangement exists
  once anything is arranged; the matcher becomes a one-time "Suggest an arrangement"), simplify the agenda seam, write
  an ADR amending D-426 / D-429 / Decision 8.

### As built (2026-10-23, session 67)

**L1 (LIVE v1.254.0, migration 20261224100000):**
- `_meeting_reconcile_core` runs under the Live lock, on an upcoming meeting with an arrangement, and touches scouts only.
  - Unpinned members leave when they say Can't, or drop the class's pick. That needs their own pick list; carried picks
    are invisible to the database. Merged sibling classes and "Not sure yet" scouts with no picks are spared.
  - Coming scouts' current picks land in a class of that topic. The scout must be held out of nothing, teaching nothing
    and in fewer than 2 classes. The class must have fewer than 8 and a rotation they're free in; fewest members wins.
    They land unpinned and `is_new`.
- It runs from `_meeting_live_bump` (every Live edit), from deferred constraint triggers on picks and intents, and
  after the server's Start.
- A hand move pins. Taking a scout out of a topic by hand writes `meeting_live_holds`. Placing them back clears it, and
  Discard clears it.
- "New" chips: Mark seen (sheet) and Mark all seen (bar). Dismissing doesn't pin.
- Lock order: pick and answer writers take the board lock, then the Live lock (`_meeting_live_lock_if_started`), then
  write. Live edits never take a board lock. The merge_people vs Live-move edge is accepted.

**L2 (LIVE, migration 20261225100000):** (qa follow-up: a card's teacher becomes the topic's `lead`; nobody's sign-up is deleted; Can't teachers refused; "No teacher yet" is that class only)
- `meeting_classes.auto` / `teacher_override`, and `meeting_topics.class_set_aside_at`.
- "On the plan" = seeded, a teacher who hasn't said Can't, or a Coming scout's current pick.
- Reconcile makes a Not scheduled auto class per topic on the plan. It removes empty auto classes that leave the plan.
- A single class without an override mirrors `_meeting_plan_teacher`, and the sync bumps the card version.
- A card's teacher on a single class writes the plan: the chosen teacher signs up and the others come off. A repeat
  keeps its own teacher.
- Removing a topic's last class by hand sets the topic aside until a class is made for it, or it is seeded again.
- Start signs the matcher's class teachers up for their topics.
- Topic and teacher writers take the Live lock up front. Needs attention no longer flags a repeat's teacher.

**L3 (LIVE, migration 20261226100000) design:** (qa follow-ups: /member/meeting shows only taught classes via `taughtOnly`; Reset refused once the meeting is over)
- **Auto-start:** `meeting_reconcile` begins an empty arrangement (rotations 1 and 2) on an upcoming, published, open
  meeting as soon as anything is on its plan. There is no Start button. Rotations shows the arrangement from the
  plan's first offering. A meeting with nothing planned shows an empty state that points at Build a Plan.
- **More actions:**
  - "Reset to match picks" (`meeting_live_reset`) replaces Discard: classes back to Not scheduled, scouts by their
    picks, hand moves and holds gone. It keeps what Discard kept (recorded attendance, visitors, offerings, teacher
    sign-ups).
  - "Suggest an arrangement" (`meeting_live_suggest`) is the matcher once: the arrangement is replaced by the matcher's,
    then reconciled. Both actions sit behind a danger confirm that names what's lost.
- **Build rows:** a "Rotation — 1 2 …" pressed-button group on each offering's class (the same control as Live's
  "Move to"). A repeated offering shows its rotations as text, with a link to Rotations.
- **Rename:** the tab, title and copy say "Rotations"; `/planner/live` redirects to `/planner/rotations` (query kept).
- **ADR:** D-437 amends D-426, D-429 and Decision 8.

## B10: The teacher digest and the "choose what you'll teach" page (Patrick, 2026-10-22)

The By person view on the Invite tab already batches one adult's classes into one digest email. Patrick's additions:
1. Each class line in the teacher email says how many scouts it would help, with their names (first name + last
   initial), e.g. "Ten 3a · Square Knot use: 3 scouts (Finn P, Anjali S, Leo K)".
2. **One answer page.** A single link in the email opens a page listing all of that adult's teach invites for the
   meeting. They tick and submit once.
3. **Talent discovery** on the same page: "What else would you enjoy teaching, now or in the future?" They pick from
   the full range of requirements and merit badges (search), so the troop learns about talents it didn't know of.
   - "Now" is an offer for this meeting; "future" is recorded interest.
   - Design open: where this is stored and how it relates to `teaching_skills` / set_teaching_skills (D-403 change
     log + review) and /member/teaching.
- Security design open: today each /i/<token> link answers exactly one invite (qa-lead M-series). A digest link
  would answer only that recipient's invites for that one meeting and expire the same way.

**B10 spec (tech-lead) and decisions (Patrick, 2026-10-22)**

Phases:
- **B10a (code only):** scout lines in the teacher digest. A pure helper `scoutsHelped` lists picked scouts first, then
  likely ones; Can't-make-it scouts are excluded. Cap 5 + "and N more", names in boardName format (first name + last
  initial). The count and names are snapshotted on the teach row at send time. The per-invite links stay for now.
- **B10b (migration `…_teach_invite_pages`):** a digest page token, one per recipient per meeting per send.
  - Table `meeting_invite_pages`: hash only, recipient_epoch, expires 6 PM Central on the meeting day, superseded_at,
    submit_count, search_count. Teach rows get page_id and no token. Pick invites keep per-invite links.
  - Route `/i/teach/[token]`. The GET writes nothing; the page reads only the snapshot.
  - Submit goes through one RPC (`meeting_answer_teach_page`), which locks the page and claims only that page's invites.
  - A resend mints a new page and supersedes the old one only once the email has gone out.
  - Unknown tokens count toward the per-IP limit. The page reads "for <name>; if that isn't you, don't answer".
  - **Patrick: the page MAY change a Yes to "Not this week" (and back) until the 6 PM expiry.** A Yes → No releases the
    teacher sign-up through the existing unteach path. Re-submits stay capped (raise from 3 if needed).
- **B10c (migration `…_teaching_interests`):** "What else would you enjoy teaching, now or in the future?"
  - A token-scoped search (q ≤ 80 chars, 20 rows, 60 searches per page).
  - An "Also this Sunday" toggle → `teachTopic` as the adult (Build shows "Teacher offered"), at most 5 per submit,
    requirement keys only.
  - "Future" goes in a NEW `teaching_interests` table (person, topic_key, note ≤ 140, source, entry_id, created_at,
    removed_at; unique on person + key), not teaching_skills, so a forwarded link can't edit qualifications.
  - Keys are validated against the catalog. Caps: 15 per submit, 40 active per person.
  - **Patrick: interests don't expire**; the adult removes them on /member/teaching.
- **B10d:** leader and member surfaces.
  - /member/teaching gets "Also enjoy teaching", with Remove, and "Add to what I can teach" through the signed-in
    set_teaching_skills path.
  - **Patrick: no per-class tier in the Invite teacher list**, only a collapsed "New talent (n)" list on the Invite tab
    (last 30 days, by adult). The engine and matcher ignore interests.
- **Template:** extend `meeting.invite_digest`. The teach block's lines read "**Ten 3a** Square Knot use (about 20
  minutes): 3 scouts (Finn P, Anjali S, Leo K)", followed by one "Choose what you'll teach →" button. Update the saved
  production template row at the B10b deploy.
- **Shipping (Patrick): each phase ships when qa passes**, DB-first for B10b/c. Once emails carry page links, roll
  forward rather than revert.
