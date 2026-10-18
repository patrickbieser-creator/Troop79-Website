# Meeting Requests & Teaching Offers — Scouts Ask, Adults Offer, the Board Matches

**Status:** Parked — design complete; reviewed 2026-10-18 (tech-lead, troop79-specialist, jenna); every question answered; prototyped and reviewed by Patrick 2026-10-18. Ready to activate
**Parked:** 2026-10-18
**Priority:** High — replaces weekly hand-guessing of who shows up and who teaches
**Extends:** `Plans/Meeting-Plan-Advancement-Suggestions.md` Phase 3 ("scout requests + instructor signup"), which was sketched and never designed.

## Overview

A two-sided board for each troop meeting. Scouts, usually with a parent, check **up
to five** things they want to work on, from a list ordered the way they should earn
them (Scout → Tenderfoot → Second Class → First Class → Star+, then merit badge
make-up). Adults and junior leaders sign up to teach **one or two** items, either by
answering what scouts asked for or by posting an offer first ("I can teach knife
sharpening on Nov 1 and Nov 8"). Everyone also says whether they're coming. A
matcher runs **live**, all the way up to the meeting, and turns the board into a
candidate agenda. The candidate agenda drops into the existing meeting editor's
candidate tray, and an at-meeting display shows it on a screen. The leader still
decides.

A **"What I can teach" card on the member page** lets adults and junior leaders keep
their own teaching skills current. It mirrors Admin › Lookups. Edits apply
immediately, and admin can review and undo them but does not approve them first.

## The circularity, and how to break it

"Scouts pick from what adults offer" and "adults offer what scouts want" look
circular only if they are two separate lists that wait on each other. **Make them
one list.** Every item on the board is a **topic** for a given meeting, and a topic
has two counters:

```
                       ┌───────────────────────────────┐
  scout picks ───────► │  TOPIC (for Sunday Nov 1)      │ ◄─────── adult commits / offers
  (demand)             │  Tenderfoot 4a — First aid     │          (supply)
                       │  wanted by 6 · teacher: J.P.   │
                       └───────────────────────────────┘
```

- A topic can **start from either side.** A scout's pick creates demand on a topic
  nobody has offered ("6 scouts want it, no teacher"). An adult's offer creates
  supply on a topic nobody has asked for ("Mr. Vest is teaching knife sharpening, 0
  scouts so far").
- **Both sides look at the same board, so each one feeds the other.** Neither side
  has to go first.
- **No deadline to beat, just a soft close.** Patrick: decisions get made at the last
  minute, and even last-minute matching beats hand-guessing. The board stays open
  until **Sunday 5:30 pm**, and the match is recomputed on every change. The screen
  never tells anyone they're too late.

The board is the meeting's state, the matcher is a pure function over that state,
and the agenda is the human decision. This is the same split as Plan → Agenda →
Record in `Plans/Completed/Meetings-Page.md`.

## Problem / Opportunity

Today Patrick builds each meeting by hand from guesses about (a) which scouts will
come, (b) what they need, and (c) which adults will be there and what they can
teach. The engine already answers (b) from the ledger. Nothing captures (a) or (c),
nothing captures what scouts *want*, and the "who can teach what" tables are a
partial, hand-entered list (local mirror 2026-10-18: 50 adult skill rows across 10
leaders, 15 junior-leader rows across 6 scouts).

## Decisions

**Locked by Patrick (2026-10-18):**

1. **Teaching blocks: one or two per meeting, three rarely.** Each meeting has a
   block count. It defaults to 2, the leader can set 1, and 3 only on purpose. **The
   matcher assigns a scout at most two topics, even when the meeting has three
   blocks.** The scout screen says "you'll work on one or two of these." Patrick:
   signing up for three sets the wrong expectation, and the rare fast finisher can
   improvise a third at the meeting. Adults likewise commit to 1–2.
2. **The board closes Sunday 5:30 pm, softly.** There is no earlier cutoff, the
   matcher runs live, and nothing on screen discourages a late sign-up. Email and
   alert nudges for last-minute sign-ups come later (Phase 5).
3. **Parents and scouts pick together.** A signed-in parent sees a pick card for each
   scout in their household and can pick for them. A signed-in scout picks for
   themself. Both write the same rows, and the row records who entered it. This
   follows Verified Signup's household model.
4. **Attendance intent for everyone.** A scout's picks and an adult's commitments
   mean "I'm coming." Each person also gets explicit choices:
   - **Coming**: implied by any pick or commitment, or set directly.
   - **Not sure yet**: scout: "put me where it makes sense," and
     the matcher places them using the engine's ledger suggestion. Adult: "put me
     where I'm needed," and the matcher offers them wanted-no-teacher topics within
     their skills.
   - **Can't make it this week**: hides that person's carried picks or offers from
     this meeting's counts, but keeps them for next week.
   - No answer = unknown, shown as unknown, never treated as absent.
   This intent feeds Roll Call's expected list as a soft signal. It is never
   recorded as attendance, consistent with Roll Call's "presence is recorded,
   absence is inferred."
5. **Self-service teaching skills.** Adults and junior leaders edit their own "what I
   can teach" checkboxes on the member page. Edits take effect immediately. Admin
   reviews a change log and can undo any add or edit, and nothing waits for
   approval.
6. **Re-key the teacher tables to people records.** `leader_skills` and
   `scout_instructors` move from `leader_code` / `scout_id` to `person_id`.
   Patrick: parents must be able to teach and get into the mix. Any adult person
   (leader, parent, or other household adult) can hold teaching skills and commit
   to topics, with no leader code needed. Junior leaders resolve through their
   person row's scout link. Admin › Lookups and the Meeting Plan engine move to
   `person_id` in the same phase.
7. **An independent system, not event signup.** Patrick: this is outside the norm
   of signing up for an event and will branch quickly past what event signup needs.
   Its tie to advancement is the defining difference. The board gets its own tables
   and modules (`meeting_topics`, picks, teachers, intents) and does **not** reuse
   `signup_slots` / `signup_slot_claims`. It shares only the spines everything
   shares: `calendar_entries` for which meeting, and `people` for who.
8. **Ranking is optional.** A scout may number their picks 1–5 or just check them.
   An unranked pick sorts after the ranked ones, in catalog order. Ranking never
   blocks saving.
9. **Everyone sees everything, by name.** Scouts, parents, adults, and the meeting
   display all see who picked what and who's teaching, as first name + last initial.
   Patrick: scouts often pick what their friends are doing, and the live board at
   the meeting needs names anyway.
10. **Merit badge meetings use stations.** On a themed MB night the board offers no
    regular rank advancement. It offers that badge's requirements as **stations**,
    usually 3–4, set up around the Northwoods meeting space. The meeting runs in
    **rotations**: groups move from station to station. So the "at most two topics"
    rule (Decision 1) does not apply in MB mode. **Scouts don't choose (Q-E):** every
    scout who comes is assigned a rotation unless they already have the badge.
    Adults are in charge of the rotations. The matcher drafts groups that skip
    stations a scout has already finished in the ledger, and adults rearrange
    freely. A scout who has the badge is listed as "has the badge: help teach or
    other work," and an adult places them at a station as a helper or on something
    else. On an MB night the scout card shows the badge and "you'll be assigned a
    rotation" plus Coming / can't make it, with no pick list. Teachers still commit
    to a station. Rank picks carried from earlier weeks are held, not shown, and
    come back at the next regular meeting.
    **Closed mode**, meaning no board and no matching, is for meetings and events
    the troop doesn't run as skill sessions: campout prep meetings, the Christmas
    party, a clinic at another location run by someone else. Recommend **closed is
    the default for every non-meeting calendar entry**, and the leader picks
    rank / merit badge / closed on each meeting.
11. **Junior leader (for teaching) = First Class or above, OR grade 9+** (14 and going
    into high school). Patrick (Q-D): Scouting encourages older scouts to teach
    younger ones, so err toward over-ambitious, never limiting. **Any First Class+
    scout may offer to teach, and nothing can switch that off.** The roster's
    `scouts.junior_leader_override` can add a younger scout ('yes'), and its 'no'
    only removes the grade-based path, never the First Class path. The grade half
    is the existing `lib/participant-class.ts` rule (grade 9–12, June 15 rollover).
    The flag is permission to *offer*, not a guarantee to teach: adults still decide
    who actually teaches when they fix the agenda, and the matcher only proposes.
    It is one shared helper beside participant-class, not a second definition.
12. **Self-service skill edits alert the admin workstation; no email.** Unreviewed
    changes show as a count on admin home that links to Lookups › Recent
    teaching-skill changes. Each row gets Undo and Mark reviewed.
13. **The meeting display is a public link.** It needs no sign-in, so the
    meeting-room TV just opens the URL. It shows first name + last initial, topics or
    stations, and teachers, and nothing else: no contact details, no ledger detail.

**Approved by Patrick (2026-10-18), originally recommended:**

14. **One board per meeting, keyed to the meeting's `calendar_entries` row**, the same
   spine as signups, attendance, and agenda.
15. **The pick unit is a top-level requirement row**, the lettered row the engine
   rolls up to (e.g. `tenderfoot-4a`, with 4a.1–4a.8 taught together). There is no
   "Tenderfoot 4" parent row; verified in the DB 2026-10-18. Sibling picks that
   share a skill (4a–4d, all first aid) merge into one session in the matcher. A
   merit badge pick is the badge, with an optional note ("make-up: req 5").
16. **Order guides but does not restrict.** The list goes next rank's unfinished
   meeting-venue requirements → later ranks → badges in progress → all badges.
   Everything is pickable. Outing-only requirements are greyed with "needs an
   outing."
17. **Five picks per scout per meeting**, enforced in the database. Picks are a
   preference pool. Assignment is capped at 2 (Decision 1).
18. **Picks carry forward.** When the next meeting's board opens, untaught picks are
    pre-filled, keep their first-asked date, and stay editable. Requirements the
    ledger shows as finished drop off.
19. **Broad offers.** An adult may offer a *skill* ("First aid") instead of a
    requirement. The matcher expands it through `rank_requirements.skill_id`. An
    offer can list several dates, each its own commitment row.
20. **The matcher suggests and never auto-publishes.** It feeds the candidate tray
    and the live display. Promoting into `meeting_sessions` stays a leader action.

## "What I can teach" card (member page)

**Where:** `/member`, shown to adults and to junior leaders (Decision 11: First
Class+ or grade 9+, with the roster override winning). It is a card in the same
family as the scout-account and wreath cards, built from the public design-system
pieces.

**What it shows:** it mirrors Admin › Lookups exactly, with the same 13-row `skills`
list and sort order.

- **Adults:** every skill, as checkboxes. Adult-only skills (first aid, woods tools,
  fire safety, aquatics) carry "Adults only (Guide to Safe Scouting)", except first aid, which says "Adults only (troop rule)". The Guide to
  Safe Scouting requires qualified supervision for aquatics, woods tools, and fire,
  but it does not make first aid adult-only. That one is our rule, so the label
  says so (specialist review).
- **Junior leaders:** only `youth_teachable` skills. This is the same server guard as
  `setScoutInstructorSkills` in `lookups/actions.ts`. It is a safety rule, not an
  approval gate, so it stays on the self-service path. Each skill also shows
  "you've completed this," or "complete it first to teach it in a meeting." The
  matcher still requires the scout to have completed the requirement.
- Dirty-gated **Save** + **Discard changes**, the house edit-form standard.
- Merit badge counselor status is shown read-only ("You're a registered counselor
  for: …"). It comes from council registration, so it is not self-service.

**Writes:** the same tables admin writes, `leader_skills` / `scout_instructors`.
There is one source of truth, and the admin screen and member card show the same
data. `scout_instructors.authorized_by` records "self" vs. a leader's name.

**Admin review, never blocking:**

- Every add or remove, from either surface, writes a row to a small change log:
  who, whose skills, skill, added/removed, when, and from member or admin.
- Admin › Lookups gets a **Recent teaching-skill changes** list with an **Undo** per
  row. Undoing an add removes the skill. Undoing a remove restores it. The undo is
  itself logged.
- Undo is the only lever. There is no pending state, and self-entered skills count
  for matching right away.
- **Alert, not email (Decision 12):** admin home shows "N teaching-skill changes to
  review," linking to the list. Undo and Mark reviewed both clear a row from the
  count.
- Optional later: tell the person when admin undoes their change. Not in scope now.

**Who sees the card:** every adult person (leaders and parents alike), plus junior
leaders. This works because of the `person_id` re-key (Decision 6). A parent with
no leader code checks skills like anyone else. Admin › Lookups lists teachers by
person and no longer by leader code, so parents appear there too.

## Matching rules (deterministic — testable)

Recomputed on every board change until Sunday 5:30 pm:

1. **Qualified teachers** = people whose `leader_skills` / `scout_instructors` row
   covers the topic's skill (self-entered counts). Junior leaders must also have
   completed the requirement, and MB sign-offs need a registered counselor. A
   non-counselor can teach, but the session is flagged "sign-off needs a counselor."
2. **Live topics** = ≥1 qualified, committed teacher, plus ≥2 picks (1 allowed for
   MB make-up).
3. **Assign scouts:** at most one topic per block, and **at most two topics per
   scout** in any case. Each topic is capped at 8, the engine's existing cap. A
   teacher covering two blocks can split an oversubscribed topic.
4. **Tie-breaks:** the scout's own ranking if given (Decision 8), then closest to
   rank completion, then longest asked (`first_asked_on`). Nobody should ask for six
   weeks and never get taught.
5. **Undecided people** (Decision 4) are placed last. Scouts get the engine's ledger
   suggestion, ideally into a session already live. Adults are offered wanted-no-
   teacher topics within their skills.
6. **Unmatched output** is part of the result: *Wanted, no teacher* (with weeks
   asked) is the recruiting list. *Offered, no takers* is the leader's call.
   *Coming with nothing assigned* falls back to the engine.
7. **Engine reuse:** `satisfaction.ts` (`nodeSatisfied`) and the ordering and venue
   rules in `meeting-plan/engine.ts`. No second completion calculus.

**Merit badge meeting mode (Decision 10)** swaps rules 2–3:

- Topics are the badge's **stations**, one per requirement or group of
  requirements, usually 3–4. The leader sets them up. Teachers commit per station;
  the counselor rule from rule 1 applies.
- **Every coming scout without the badge** goes into a **rotation group** (≤8), with
  no scout choice. Groups visit stations in turn, so there are as many rotations as
  stations. The two-topic cap does not apply.
- A scout who already finished a station's requirement, according to `mb_progress`
  and the ledger, skips that station. That rotation shows as "free / help out."
- Scouts who already have the badge go to a **"has the badge"** list for adults to
  place as station helpers or on other work.
- The draft balances group sizes and keeps patrols together. Adults move scouts
  between groups freely, and the draft is only a starting point.
- Rank picks are held for the next regular meeting, keeping their `first_asked_on`.

## Surfaces

| Who | Where | What they do |
|---|---|---|
| Adult / junior leader | `/member` → **What I can teach** card | Check and uncheck qualified skills, which save immediately. Mirrors Admin › Lookups. |
| Scout, or parent for their scout | `/member` → **Sunday's meeting** card | Coming / not sure yet / can't make it, plus ≤5 picks from the ordered list with "teacher coming" badges. "You'll work on one or two." |
| Adult / junior leader | `/member` → **Teach at a meeting** | Coming / put me where needed / can't make it. "Wanted, no teacher" first. "I'll teach this" (1–2). "Offer something" (skill or requirement, several dates, note). |
| Leader | Admin › Advancement › Meeting Plan → **Requests & Offers** tab | Live board, counts, live match, unmatched lists. Edit on someone's behalf (phone or text). Set the block count. |
| Leader | Admin › Lookups → **Recent teaching-skill changes** | Review and undo self-service skill edits. |
| Leader | Meeting editor candidate tray | Matched sessions arrive pre-filled and promote as today. |
| Everyone at the meeting | **Meeting board display** (Phase 4) | The "fast-food order screen." A full-screen live view of sessions, teachers, and who's in each. New sign-ups pop in as they arrive. Big type, works on a projector or TV, read-only, auto-refreshing. |
| Families | Bugle / public `/meetings` | The published agenda is still the one public answer. Bugle links to the pick card. |

Privacy (Decisions 9 and 13): everyone sees names, as first name + last initial,
everywhere: the scout pick card ("Finn P and Anjali S picked this"), the teacher
board, and the meeting display. The display is a **public link**, e.g.
`/meetings/2026-11-01/board`, with no sign-in. It carries `noindex`. Its loader returns only display
names, topics or stations, teachers, and counts, never contact details or ledger
detail. That is the same rule the public `/meetings` agenda follows today.

## Data model sketch (for tech-lead review — not final)

```sql
-- A topic on a meeting's board. Created lazily by the first pick or offer.
create table meeting_topics (
  id bigint generated always as identity primary key,
  calendar_entry_id bigint not null references calendar_entries(id) on delete cascade,
  kind text not null check (kind in ('rank_req','merit_badge','skill','freeform')),
  rank_requirement_id ... null,   -- top-level requirement node
  mb_id text null references merit_badges(id),
  skill_id text null references skills(id),
  title text null,                -- freeform only ("Knife sharpening")
  unique nulls not distinct (calendar_entry_id, kind, rank_requirement_id, mb_id, skill_id, title)
);

-- Scout demand. ≤5 per scout per meeting, enforced by the RPC.
create table meeting_topic_picks (
  topic_id bigint references meeting_topics(id) on delete cascade,
  scout_id text references scouts(id) on delete cascade,
  priority smallint null check (priority between 1 and 5),  -- optional ranking
  first_asked_on date not null,   -- survives carry-forward; fairness tie-break
  note text,                      -- "make-up: req 5"
  entered_by_person_id bigint references people(id),  -- scout or parent
  primary key (topic_id, scout_id)
);

-- Teacher supply. ≤2 per person per meeting.
create table meeting_topic_teachers (
  topic_id bigint references meeting_topics(id) on delete cascade,
  person_id bigint references people(id) on delete cascade,
  note text,
  primary key (topic_id, person_id)
);

-- Attendance intent, scouts and adults alike. Soft signal, never attendance.
create table meeting_intents (
  calendar_entry_id bigint references calendar_entries(id) on delete cascade,
  person_id bigint references people(id) on delete cascade,
  intent text not null check (intent in ('coming','undecided','not_coming')),
  entered_by_person_id bigint references people(id),
  updated_at timestamptz not null default now(),
  primary key (calendar_entry_id, person_id)
);

-- Teaching-skill change log (both surfaces write; admin undoes from it).
create table teaching_skill_changes (
  id bigint generated always as identity primary key,
  person_id bigint not null references people(id),   -- whose skills
  skill_id text not null references skills(id),
  action text not null check (action in ('added','removed')),
  source text not null check (source in ('member','admin','undo')),
  changed_by_person_id bigint references people(id),
  changed_at timestamptz not null default now(),
  undone_by_change_id bigint references teaching_skill_changes(id),
  reviewed_at timestamptz null    -- null = counts toward the admin-home alert
);

-- On meetings (Decisions 1, 10):
--   board_mode text default 'rank' check (board_mode in ('rank','merit_badge','closed'))
--   board_mb_id text null references merit_badges(id)   -- MB mode only
--   block_count smallint default 2 check (block_count between 1 and 4)
--     (rank mode: blocks, 1–3; MB mode: rotations = number of stations)
-- 'closed' = no board this week (campout prep, Court of Honor, etc.).
-- MB stations are meeting_topics rows of kind 'merit_badge' with a requirement
-- reference and an optional location label ("back room", "parking lot").
```

- **Re-key (locked):** `leader_skills(leader_code, skill_id)` →
  `teaching_skills(person_id, skill_id)`. `scout_instructors(scout_id, skill_id)`
  folds into the same table, and the youth rule is checked through the person's
  scout link and `skills.youth_teachable`. One table means one admin editor and one
  member card. Backfill maps `leader_code` → `leaders.person_id` and `scout_id` →
  the scout's `person_id`. tech-lead confirms the merge versus keeping two re-keyed
  tables. Either way, both are keyed by `person_id`.
- Recommend the five-pick and two-commitment caps live in RPCs. The blocks cap on
  assignment lives in the matcher.
- **No event-signup reuse (locked, Decision 7).** Similar shapes, such as "claim a
  slot," are a coincidence, not a reason to share tables. The board will grow
  advancement-specific needs that event signup should never carry.
- **Live updates:** the board and the display need near-real-time refresh. Options
  are polling every 10–15 s or Supabase Realtime. Polling fits the service-role-only
  posture without opening anon realtime channels. Recommend polling.
- RLS: service-role only, per the security posture. All reads go through
  `createAdminClient` loaders.

## Acceptance Criteria

- [ ] An adult sees every skill on the "What I can teach" card. A junior leader sees
      only youth-teachable skills. Saving updates the same rows Admin › Lookups shows.
- [ ] Every self-service add or remove appears in admin's Recent changes. Undo
      reverses it and is logged. Nothing waits for approval.
- [ ] A parent with no leader code can save teaching skills and commit to teach.
- [ ] Every existing `leader_skills` / `scout_instructors` row survives the re-key.
- [ ] A scout, or their parent, sees the next meeting's pick list in earning order,
      with finished requirements absent and outing-only ones greyed.
- [ ] A scout cannot hold more than 5 picks for one meeting. The database refuses
      the 6th, and the screen says why.
- [ ] No scout is assigned more than 2 topics, even in a 3-block meeting.
- [ ] Untaught picks carry forward with their first-asked date, and finished ones
      drop off.
- [ ] Scouts and adults can mark Coming / Not sure yet / Can't make it.
      Picks and commitments imply Coming.
- [ ] Sign-ups are accepted until Sunday 5:30 pm with no "too late" messaging. The
      match updates on each change.
- [ ] Matched sessions appear in the meeting editor's candidate tray and promote
      through the existing flow. Nothing publishes automatically.
- [ ] Picks may be ranked 1–5 or left unranked, and saving never requires a rank.
- [ ] Every board view shows who picked and who teaches, as first name + last
      initial.
- [ ] On a merit badge meeting, the board offers only that badge's stations, and the
      matcher drafts rotation groups for every scout who comes without the badge,
      skipping finished stations. Adults can rearrange them, badge holders are
      listed for adult placement, and carried rank picks reappear at the next
      regular meeting.
- [ ] Campout prep meetings, parties, and outside clinics have no board ('closed').
- [ ] Every First Class+ scout sees the "What I can teach" card regardless of the
      roster override. A grade 9+ scout sees it unless overridden 'no'. A younger
      scout sees it when overridden 'yes'.
- [ ] Self-service skill changes raise a count on admin home that clears on Undo or
      Mark reviewed. No email is sent.
- [ ] (Phase 4) The meeting display opens from a public link with no sign-in, shows
      only display names, topics, and teachers, and refreshes without a reload.

## Test Plan

- [ ] `Adult_SeesAllSkills_OnWhatICanTeachCard()`
- [ ] `JuniorLeader_SeesOnlyYouthTeachableSkills_OnWhatICanTeachCard()`
- [ ] `JuniorLeader_IsRefusedAdultOnlySkill_WhenPostedDirectly()` (server guard, not just UI)
- [ ] `Adult_SelfAddedSkill_CountsForMatchingImmediately()`
- [ ] `Leader_SeesSelfServiceChange_InRecentChanges()`
- [ ] `Leader_UndoAdd_RemovesSkillAndLogsUndo()`
- [ ] `Leader_UndoRemove_RestoresSkill()`
- [ ] `Parent_WithoutLeaderCode_CanSaveTeachingSkills()`
- [ ] `Parent_CanCommitToTeachTopic()`
- [ ] `Rekey_PreservesEveryExistingSkillRow()` (migration backfill: 50 adult + 15 junior rows survive)
- [ ] `Scout_SeesNextRankRequirementsFirst_WhenOpeningPickList()`
- [ ] `Scout_CanPickHigherRankOrMeritBadge_WhenNotNextInOrder()`
- [ ] `Parent_CanPickForHouseholdScout()` / `Parent_CannotPickForOtherFamilysScout()`
- [ ] `Scout_IsRefusedSixthPick_WhenFiveAlreadyHeld()` (database-level, db project)
- [ ] `Scout_PicksCarryForward_WhenPriorMeetingDidNotTeachThem()`
- [ ] `Scout_FinishedPickDropsOff_WhenLedgerSatisfiesIt()`
- [ ] `Scout_PickImpliesComing_WhenNoIntentSet()`
- [ ] `Scout_NotComing_HidesPicksFromThisMeetingCounts_ButKeepsThemForNext()`
- [ ] `Adult_IsRefusedThirdCommitment_WhenTwoHeldForMeeting()`
- [ ] `Matcher_AssignsAtMostTwoTopics_WhenMeetingHasThreeBlocks()`
- [ ] `Matcher_SkillOfferCatchesRequirementPicks_WhenSkillMatches()`
- [ ] `Matcher_CapsSessionAtEight_WhenTopicOversubscribed()`
- [ ] `Matcher_PrefersLongestAsked_WhenTopicFull()`
- [ ] `Matcher_PlacesUndecidedScout_ByEngineSuggestion()`
- [ ] `Matcher_OffersUndecidedAdult_WantedNoTeacherTopicsInTheirSkills()`
- [ ] `Matcher_ListsWantedNoTeacher_WhenDemandUnmet()`
- [ ] `Matcher_FlagsCounselorNeeded_WhenMbTeacherNotCounselor()`
- [ ] `Scout_CanSavePicks_WithoutRanking()`
- [ ] `Matcher_HonorsScoutRanking_WhenTopicFull()`
- [ ] `Scout_SeesWhoElsePicked_ByFirstNameLastInitial()`
- [ ] `JuniorLeader_FirstClassScout_CanAlwaysOfferToTeach_EvenWithOverrideNo()`
- [ ] `JuniorLeader_GradeNineScout_ExcludedOnlyByOverrideNo()`
- [ ] `JuniorLeader_YoungerScout_IncludedByOverrideYes()`
- [ ] `Leader_SeesAdminHomeAlert_WhenSkillChangeUnreviewed()`
- [ ] `Leader_MarkReviewed_ClearsAlertWithoutUndoing()`
- [ ] `Matcher_BuildsRotationGroups_WhenMeritBadgeMode()`
- [ ] `Matcher_AssignsEveryComingScout_WithoutBadge_InMeritBadgeMode()`
- [ ] `Matcher_ListsBadgeHolders_ForAdultPlacement_InMeritBadgeMode()`
- [ ] `Scout_SeesNoPickList_OnMeritBadgeNight()`
- [ ] `Board_DefaultsClosed_ForNonMeetingCalendarEntry()`
- [ ] `Matcher_SkipsFinishedStation_ForScoutInRotation()`
- [ ] `Scout_RankPicksHeld_DuringMeritBadgeMeeting_AndReturnAfter()`
- [ ] `Board_RefusesPicks_WhenMeetingClosed()`
- [ ] `Visitor_SeesMeetingDisplay_WithoutSignIn()`
- [ ] `Visitor_MeetingDisplay_ExposesOnlyDisplayNames()` (no email, phone, or ledger fields in the payload)
- [ ] `Leader_PromotesMatchedSession_IntoMeetingSessions()`
- [ ] `Engine_Unchanged_WhenBoardEdited()`

## Review findings (2026-10-18) — applied

tech-lead (GO with changes), troop79-specialist (needs clarification), and jenna
reviewed this plan. The items below are **applied** and supersede the sketch
above wherever they conflict. Items needing Patrick are under **Review questions**.

**Data model (tech-lead + specialist)**

- **One merged `teaching_skills(person_id, skill_id, authorized_by, authorized_at)`.**
  `leaders.person_id` and `scouts.person_id` both exist (nullable). The backfill
  `RAISE`s on any unresolvable row and asserts rows in = rows out. The only
  null-person code with skills locally is `Camp` (`is_person=false`), which is
  dropped explicitly. Leader codes that belong to *active scouts* (MST, JPII, OV,
  VK, KP) backfill to the scout's person, and the write-time **and** read-time
  `youth_teachable` guard applies to them. Ship additive first, switch the code,
  then drop the old tables. Add `teaching_skills` to `merge_people` (`on conflict
  do nothing`).
- **`merit_badge_counselors` re-keys to `person_id` too.** Parents who are
  counselors must count, which extends Decision 6.
- **Skill writes become one diffing RPC** that writes the change-log rows in the
  same transaction. Today's delete-then-insert can wipe a person's skills on a
  mid-way failure.
- **Change log simplified:** `reverted_at` + `reviewed_at` on the row. An undo is
  an ordinary logged row, with no `undone_by_change_id` chain.
- **Topics keyed by `topic_key`, not row ids.** Use the ledger composite code
  (`tenderfoot-4a`, `<mbId>-<code>`, `mb:<mbId>`, `ff:<normalized title>`), unique
  on `(calendar_entry_id, topic_key)`. Catalog re-imports and code edits change row
  ids, so this keeps picks safe through a reseed. A CHECK enforces one reference
  per kind.
- **Skill offers are not topics.** A broad offer is a teacher-side row,
  `meeting_teaching_offers(calendar_entry_id, person_id, skill_id)`, which the
  matcher expands. `meeting_topics` loses `kind='skill'`, so demand counts stay
  clean.
- **Board settings live in `meeting_boards(calendar_entry_id pk, board_mode,
  board_mb_id, block_count)`**, not on `meetings`, because a meeting entry can exist
  without a `meetings` row. No row means the default: rank for meeting entries,
  closed for everything else, resolved in one tested helper.
- **Caps in RPCs with an advisory lock per (person, meeting)**, plus the
  authorization re-check (household link, or self) inside the RPC.
  `calendar_entry_id` is denormalized onto picks and teacher rows for the count.
  Only 'closed' boards refuse writes; 5:30 pm is display-only.
- **"Implied coming" is a loader rule, not stored.**

**Domain (specialist)**

- **One completion calculus:** export the engine's `rankNodeSatisfied` /
  `isGroupSatisfied` and share it with `satisfaction.ts`. Don't add a third.
- **The pick list reuses the engine's `NOT_PLANNABLE` set** (tenure, Scout Spirit,
  POR, MB counts, Eagle project) and the 95% Scoutmaster-conference gate. Ordering
  beyond the next rank (later ranks, MBs in progress, all MBs) is new code.
- **`canOfferToTeach(person, meetingDate)`** replaces the "junior leader" helper
  name: `ranks.sort_order` ≥ First Class, OR grade 9–12 as of the meeting date
  (unless override 'no'), OR override 'yes'. The engine's two `isStarPlus` teacher
  gates switch to it (Phase 0a).
- **"Finished it themselves"** = the scout's current rank is at or above the
  requirement's rank, OR `nodeSatisfied` on the ledger. Test rank first, because
  historical ranks often lack requirement rows. The card shows "N of M
  requirements" per skill, not yes/no. The scout must not be in that session's
  audience.
- **MB nights:** "has the badge" = `mb_progress.awarded`, checked first. Then
  per-station `mbNodeSatisfied`. Badges with no requirement rows (5 of 69) can't be
  chosen for MB mode.
- **MB venue greying** is mostly "either" until MB venue curation grows. Accepted.

**UX (jenna)**

- **Member page stays a grid of link cards.** Add two cards:
  - **"Sunday's meeting"** → `/member/meeting`. The card shows live state ("Coming ·
    3 picks"). The page holds the scout pick section and, for adults, the teach
    section.
  - **"What I can teach"** → `/member/teaching`. This standing profile keeps its own
    dirty-gated Save + Discard changes.
- **Parents with several scouts:** one scout at a time via a switcher ("Finn · 3
  picks"), with a one-line household summary above it. Never stacked lists.
- **Intent and picks save on tap** with an inline "Saved," like the house one-click
  rule. There is no Save button on the weekly page. Intent is a three-way
  SegmentedControl that is keyboard-operable and announced with `aria-live`.
- **Pick list:** a sticky "Your picks (3 of 5)" tray on top, with optional ranking
  through Up/Down buttons (no drag-and-drop; touch targets of 44 px or more). The
  next rank is open, later ranks are collapsed with counts, and MBs sit behind a
  search with "Badges you're working on" shown first. Friends show as "Finn P,
  Anjali S +4"; a teacher shows as one quiet "Teacher: Mr. Vest" tag. A 6th pick
  stays tappable and says in place "You have 5. Take one off to add this."
- **Admin consolidation, not a 4th tab:** the live board becomes the Meeting Plan's
  first tab, "This Sunday". Group Sessions becomes read-only matcher output linking
  to the editor tray, the one place a leader acts. Teaching Roster becomes read-only
  with "Edit in Lookups." The on-behalf edit reuses the member pick component.
- **Display:** light, high-contrast, names ≥ 28 px, topics ≥ 40 px, and fade-only
  "pop in" honoring reduced motion. A column per block. In MB mode, a station grid
  with Now/Next. A stale indicator ("Updating… last updated 6:42") after 30 s of
  failed polls. No site chrome. A closed meeting shows "No sign-ups this week."
- **Microcopy** adopted: "Pick up to 5 things to work on. You'll do one or two of
  them." · "Scouts are asking for these" · "I'll teach this" · "You're teaching 2.
  Remove one to add another." · after 5:30 pm: "This week's plan is set. You can
  still tell us you're coming." (never "closed" to scouts). · Can't make it: "Got it.
  Your picks are saved for next week."
- **After assignment,** the member page tells a scout which pick they got ("You're
  in First aid, your #2"). This is not shown on the TV.

**Live updates (tech-lead):** polling on a version stamp (`max(updated_at)` +
counts) every ~10 s, with jitter, paused when the tab is hidden, and stopping after
the meeting. Data refetches only when the stamp changes. The public loader returns
a closed DTO, uses `unstable_cache` with 5–10 s revalidation + `updateTag`, and is
tested with a canary person whose email and phone must not appear in the JSON.

**Review questions for Patrick**

- [x] **R1. One-scout sessions:** allowed. Patrick: the meeting space is open, and
      everyone is visible to everyone else, so no extra rule is needed.
- [x] **R2. Public board link:** a standard URL (`/meetings/<date>/board`) with no
      token or date restriction. First name + last initial is nothing beyond what the
      public site already shows. Add `noindex` only.
- [x] **R3. Label:** "Junior Leader" is the troop's term and stays on screen. The
      internal helper may still be named `canOfferToTeach`.
- [x] **R4. Wording:** "Not sure yet," with the helper line "We'll find something
      that fits," for scouts and adults.

## Prototype feedback (2026-10-18) — applied

Prototype: `prototypes/meeting-board/` (Brad). It has two walkthroughs, one regular
week and one MB night, plus every support screen. Patrick's feedback:

- **"Can't make it" + a pick asks "Sunday's meeting, or later?"** A scout who can't
  come can still pick, and that records a wish for a *future* meeting, not a sign
  they're coming. The row asks inline: **Later** (primary, the likely answer) or
  **At Sunday's meeting**, which switches them to Coming. Later picks show "For a
  later meeting" in the tray. They don't count toward this meeting's demand or
  imply Coming, and they carry forward as normal picks to the next board. Schema:
  a `later boolean` on `meeting_topic_picks`, cleared on carry-forward. Test:
  `Scout_PickWhileNotComing_AsksWhen_DefaultsLater()`,
  `Matcher_IgnoresLaterPicks_ForThisMeeting()`.
- **Ranking ("Put them in order") as designed.** Approved.
- **Outing-only rows are fully disabled.** The dashed checkbox stays as designed
  and can't be tapped, with no warning message. This is an exception to the "never
  silently disable" pattern, because the "Needs an outing" line already says why.
- **Names: first name + last initial, no period.** "Finn P, Anjali S +4". The
  period is noise. Formal adult names ("Mr. Vest") keep their honorific period.
  This applies to every board surface, including the agenda and TV.
- **Brad's questions, all answered yes:**
  1. Scout-facing screens and the TV show adults formally ("Mr. Vest"). Admin shows
     first name + last initial ("Dan V").
  2. Woods tools, fire safety, and aquatics say "Adults only (Guide to Safe
     Scouting)". First aid says "Adults only (troop rule)".
  3. A broad skill offer counts as **one** of an adult's two commitments, even when
     it fills both blocks.
  4. Admin home keeps the "Sunday: N requests with no teacher" row next to the
     teaching-skill-changes alert.
  5. The published public agenda lists every scout per session (first name + last
     initial).

## Phasing (each phase ships value alone)

0a. **Re-key migration + engine switch.** Additive `teaching_skills` and the
    `merit_badge_counselors` re-key, a checked backfill, `merge_people` coverage,
    the engine on `person_id`, and the engine's scout-teacher gate moved from Star+
    to `canOfferToTeach`. Drop the old tables in a later migration.
0b. **"What I can teach" card + admin review/undo + admin-home alert.** It fixes
    the incomplete tables at the source and improves today's Meeting Plan teacher
    list right away.
1. **Scout and parent picks + attendance intent + leader demand view.** The ≤5 pick
   card, Coming / not sure yet / can't make it, carry-forward, and an admin tab with
   live counts. This replaces the biggest guess: who is coming and what they want.
2. **Teacher board.** Adult intent, "I'll teach this" against demand, and standing
   offers across dates. Scouts see "teacher coming."
3a. **Live matcher → candidate tray** for rank mode: the deterministic match,
    unmatched lists, promote, block count, and board mode.
3b. **Merit badge mode:** stations, rotation draft, badge holders, adult
    rearranging.
4. **Meeting board display.** The full-screen "order screen" for the meeting room,
   with live sessions and new sign-ups popping in.
5. **Nudges.** Email and alerts for last-minute sign-ups: adults with matching
   skills when a topic has demand and no teacher, and scouts when a teacher signs up
   for their pick. Hold this until 1–4 have run a few real weeks.

## Implementation Steps

1. ~~Patrick confirms Decisions 14–20 and closed-by-default~~: approved 2026-10-18.
2. ~~Reviews~~: tech-lead, troop79-specialist, and jenna done 2026-10-18 (see Review
   findings). R1–R4 answered 2026-10-18. Original review scope: the re-key mechanics,
   the topic model shape, polling vs. realtime, and the public display loader.
   troop79-specialist review: the junior-leader helper beside
   `lib/participant-class.ts`, the counselor rule, pick ordering against
   `advancement-catalog.ts`, and MB station ↔ `mb_progress`. jenna: the three
   member cards and the meeting display.
3. Build one phase at a time, tests first per the Test Plan. qa-lead before each
   deploy (new signed-in write surfaces for scouts, parents, and adults).

## Open Questions

- [x] **Q1. Blocks per meeting:** 1–2, 3 rarely. Scouts are assigned at most 2.
- [x] **Q2. Cutoff:** soft close Sunday 5:30 pm, live matching, nudges later.
- [x] **Q3. Who picks:** parents and scouts together.
- [x] **Q4. Ranking:** optional, never required (Decision 8).
- [x] **Q5. Attendance intent:** yes, for scouts and adults, plus "can't make up my
      mind" (Decision 4).
- [x] **Q6. Names:** everyone sees everything, first name + last initial (Decision 9).
- [x] **Q7. Themed meetings:** merit badge mode with 3–4 stations and rotations, plus
      a "closed" mode for campout prep and similar (Decision 10).
- [x] **Q-A. Junior leader:** First Class+ or grade 9+, roster override wins
      (Decision 11).
- [x] **Q-B. Skill-edit notice:** admin-home alert, no email (Decision 12).
- [x] **Q-C. Meeting display:** public link, first name + last initial (Decision 13).
- [x] **Q-D. Override vs. First Class:** no. Any First Class+ scout may always offer
      to teach. Adults decide who actually teaches (Decision 11).
- [x] **Q-E. MB-night rotations:** adults assign them and scouts don't choose. Every
      scout who comes gets a rotation unless they have the badge, and badge holders
      help teach or do other work (Decision 10).

## Notes

- Builds on: `Plans/Meeting-Plan-Advancement-Suggestions.md` (engine, `skills`,
  `leader_skills`, `scout_instructors`), `Plans/Completed/Meetings-Page.md` (agenda,
  `meeting_sessions`, candidate tray), the calendar unification
  (`meetings.calendar_entry_id`), the people spine (`people.id`), Verified Signup
  (household picks), and Roll Call (intent as a soft expected-list signal).
- Admin today (`lookups/actions.ts`): `setLeaderSkills` and `setScoutInstructorSkills`
  replace a person's whole set with delete + insert, behind `roster.manage`. The
  member card needs a self-scoped variant, and both paths must write the change log.
  Diffing the before and after sets gives the log rows.
- Research note: no mainstream troop software (Scoutbook, TroopTrack, Troopmaster)
  does demand-driven meeting matching, the same gap as the original Meeting Plan.
