# Planner — Station Rotations (merit badge focus nights)

**Status:** Draft, awaiting tech-lead review
**Parked:** 2026-11-08
**Priority:** High (first Climbing MB night is imminent)

## Overview

A second meeting shape for Meeting Planner III. Today a meeting's focus sets become groups and a scout stays in one
group all night. A **station rotation** meeting turns its focus sets into **stations**. Each station stays put with
its teacher(s) all evening, and **traveling groups** visit every station, one **round** each. The planner drafts the
groups from everyone who hasn't earned the badge. Planners adjust the draft, and families accept it or ask for
something else.

First use: Climbing MB, with three stations (I Safety, II Terms, III Ropes & Knots) at about 25 minutes each. Many
single-badge nights will follow, with any number of stations (usually 3–4, sometimes more).

## Decisions (Patrick, 2026-11-08)

1. **Turn it on per meeting.** This week gets a "Stations" mode. The planner puts the meeting's focus sets in station
   order 1..N, and the draft rotation appears. There is no automatic switching.
2. **Who rotates:** every active scout of any rank who has NOT earned the badge, First Class and above included.
   Partial progress still rotates. Scouts who hold the badge keep today's placement: conferences, other night badges,
   helping teach, or a gap for a planner to fill.
3. **A station the scout already finished:** the scout stays with the group. The cells show green, and the scout is
   flagged as a possible helper at that station.
4. **Time goal on the focus set:** `focus_sets` gets a goal in minutes, set once and reused at every meeting. A round
   lasts as long as the longest station's goal. The plan shows the total (3 × 25 = 75 min). There is no per-meeting
   override.
5. **Up to one traveling group per station.** Rank groups stay whole when possible. Neighboring ranks combine only
   when there are more groups than stations. With fewer groups than stations, a station sits empty in some rounds.
   Every group still gets N rounds.
6. **Rounds are numbered, not timed:** "Round 1 · Safety · 25 min". There are no clock times, which matches the
   no-clock planner.
7. **Families** accept the rotation in one tap, or use "Ask for something else", which reaches the planners. Planners
   make any exception by hand. Families can't untick single stations, so exceptions stay rare.
8. **Teachers belong to a station for the whole evening** (Patrick: "We don't rotate teachers in the evening. They
   teach one thing for the evening."). The groups rotate to them. Teachers are not modeled per round.

9. **Groups are named Group 1, Group 2, Group 3** by position, never by rank (Patrick: "If I have to make
   re-assignments, assigning a rank to a group could be confusing."). The ranks a group was seeded from are a quiet
   subtitle only. A hand move is "Move to Group 2" and stores the group number. A move to a number that doesn't exist
   (without the moved scouts) falls back to placement.
10. **Turning Stations off and on again keeps** the station order and the hand moves.
11. **Station names are the focus set names as they are.** Patrick removes the numerals from the sets himself.
12. **No goal on any station:** "No time goal yet", never blocking. **Helpers** are a hint only. **Checklist columns**
    stay in station order. **On a phone** the rotation grid stacks one block per group.

13. **Stations and other groups on one night** (Patrick, 2026-11-08): a station night can also carry ordinary Planner
    III groups (for example Citizenship in the Community) and Scoutmaster Conferences. The planner says explicitly
    who is in the rotation and who is in a group. The draft puts non-holders in the rotation and holders on today's
    placement, and hand moves override both.
14. **Double assignment is allowed, flagged, never enforced.** A scout can be in a rotation group (or a regular
    group) AND something optional (a conference, a second group). The screen calls it out quietly ("Also in: …", "2
    double-assigned"), never as an error and never blocking. Patrick manages it by hand. This needs an "also"
    assignment that doesn't replace the scout's one primary role (today `meeting_scout_roles` holds one row per scout
    per meeting).

## Draft algorithm (pure, computed on every read like `lib/focus-plan.ts`)

- **Badge:** taken from the stations' focus items (`climbing-*`). All stations must belong to one badge. Rank-skill
  station nights are out of scope for v1 (see Open Questions).
- **Candidates:** active scouts without the badge awarded. Unassigned (`role: none`) and hand roles still win, with
  the same precedence as today: hand > help-teach > picks > placement.
- **Seed groups by the rank being worked on:** Scout · Tenderfoot · Second Class · First Class. First Class+ scouts
  without the badge fold into the First Class group. Empty groups are dropped.
- **While there are more groups than stations N, merge from the top:** the two highest-rank groups combine first.
  This follows Patrick's stated goal: keep Scout and Tenderfoot whole, combine Second + First. It is not
  smallest-pair merging, which on 2026-11-08's roster would have merged Tenderfoot + Second instead. Sizes may come
  out uneven (8 | 4 | 11 tonight), and planners move scouts by hand.
- **Rotation:** group g (0-based) is at station (g + r) mod N in round r. Every group visits every station once.
- **Checklist:** columns = every station's items, grouped by station. A scout's done cells are green, using the same
  rules as badge columns today (`mbNodeSatisfied`, part = half green).
- **Badge holders** go through today's `buildFocusPlan`, with the station focus sets removed from their focus keys.
  Night badges, conferences and helpers keep working.

## Acceptance Criteria

- [ ] A focus set has an optional goal in minutes, editable on the Focus sets screen and shown wherever its card
      shows.
- [ ] A planner can turn Stations on for a meeting, order the stations, and turn the mode off again. Turning it off
      brings back today's plan unchanged.
- [ ] The draft puts every active non-holder in one traveling group, never more groups than stations, and keeps rank
      groups whole unless merging is needed.
- [ ] The rotation grid shows each round with each group's station, plus the round length and the total time.
- [ ] A planner can move a scout between traveling groups and unassign a scout. The draft never overrides a hand move.
- [ ] Badge holders appear in today's placement, not in the rotation.
- [ ] The teacher email names the station, its minutes, and the groups coming through it round by round.
- [ ] The family email and card show the group and the station order, with one-tap accept and "Ask for something
      else". Every state stays a proposal (planned / asked / confirmed / changed, per split-groups-and-confirmations).
- [ ] **Station sign-off sheets (Patrick liked the 2026-11-08 stopgap):** a printable page per station. It shows
      the teacher, the minutes and each round's group, plus a table of scouts × the station's leaf requirements with
      tick boxes. Done cells print pre-ticked or greyed. There is no "Here" column (Patrick). It is for entering at
      Fast Entry afterward.
- [ ] Saved meeting plans capture and restore Stations mode, the station order and the hand moves.
- [ ] Create/edit/delete: turning Stations on can be undone, station order can be edited, and removing a focus set
      from the meeting removes its station. The time goal can be edited and cleared.

## Test Plan

- [ ] `Planner_CanSetFocusSetGoalMinutes_WhenEditingFocusSet()` (DB + action)
- [ ] `Draft_PlacesEveryNonHolder_WhenStationsOn()`
- [ ] `Draft_ExcludesBadgeHolders_FromRotation()`
- [ ] `Draft_KeepsRankGroupsWhole_WhenGroupsFitStations()`
- [ ] `Draft_MergesSmallestNeighbors_WhenMoreGroupsThanStations()`
- [ ] `Draft_PutsOlderNonHoldersInOwnOrNearestGroup()`
- [ ] `Rotation_EveryGroupVisitsEveryStationOnce()` (N = 3, 4, 6, and fewer groups than stations)
- [ ] `Draft_KeepsScoutWithGroup_WhenStationAlreadyDone()` (helper flag set)
- [ ] `Draft_HonorsHandMoveAndUnassign_OverPlacement()`
- [ ] `Round_LengthIsLongestStationGoal_AndTotalIsSum()`
- [ ] `TurningStationsOff_RestoresStandardPlan()`
- [ ] `SavedPlan_RoundTripsStationsModeOrderAndMoves()`
- [ ] `TeacherEmail_NamesStationRoundsAndGroups()`
- [ ] `FamilyEmail_ShowsGroupStationsAndAskForOther()`
- [ ] Migration: the new columns are covered by the date-floor and posture tests (no anon grants, RLS on).

## Technical Approach (tech-lead reviewed 2026-11-08)

- **Schema (DB-first, additive):**
  - `focus_sets.goal_minutes smallint null check (goal_minutes between 5 and 240)`.
  - **`meeting_rotation_stations(calendar_entry_id, topic_id → meeting_topics on delete cascade, position, updated_at,
    unique(entry, topic_id), unique(entry, position))`.**
    `topic_id` points at the meeting's `fg:<setId>` topic, which is already the per-night snapshot.
    Don't name it `meeting_stations`: that was a retired Build-a-Plan table. Add it to `meeting_board_stamp` (count
    and max(updated_at)) or the poller won't refresh. `meeting_unseed_topic` treats a station like picks and
    teachers.
  - **Hand moves store a group number** (decision 9, superseding tech-lead's seed-rank idea, which Patrick found
    confusing): `meeting_rotation_moves(calendar_entry_id, person_id, group_number smallint, primary key (entry,
    person_id))`. The engine forms groups without the moved scouts, then adds each one to their group. `role:'none'`
    and `teach` in `meeting_scout_roles` work unchanged. `merge_people` must gain the moves table (full function body
    in that migration).
  - **The switch is its own row** (decision 10, superseding "no rows = off"):
    `meeting_rotations(calendar_entry_id pk, on boolean, updated_at)`. Turning it off keeps the stations and moves.
- **Teachers:** use `meeting_topic_teachers` on the `fg:` topic, with no new table. `twSetTeacherAction`
  (this-week-actions.ts:106) accepts only group and request keys, so widen it to `fg:`. this-week.ts:475 excludes `fg:`
  from the extra classes, so add a station-teacher read path. Check the one-teacher rule in `teachTopic` against a
  station that has two teachers.
- **Saved plans:** capture in `lib/saved-plans`. Restore stations LAST in `meeting_load_saved_plan`: it unseeds focus
  sets not in the plan, and the cascade would otherwise drop them. Stations mode ignores splits.
- **Pure engine:** new `lib/station-rotation.ts` next to `lib/focus-plan.ts`, with no I/O. This week calls it when the
  mode is on and feeds the holders to `buildFocusPlan` with the station focus keys removed.
- **UI:** a This week mode toggle, a station-order list (drag or up/down), a rotation grid (rounds × groups) and
  per-group member lists with Move. The Tonight drawer gains "Move to group". Build against a prototype if Patrick
  wants one (Brad), as with Planner III.
- **Emails:** new templates for the rotation teacher and the rotation family. "Ask for something else" records an
  answer row the planners see in Responses this week.

## Implementation Steps

1. Migration plus focus set goal minutes (UI and action). This ships alone and is useful immediately.
2. `lib/station-rotation.ts` with the full engine test set. It is pure and can ship alone.
3. The `meeting_rotation_stations` schema and actions, plus the stamp update and the unseed and saved-plan guards.
   Then the This week toggle and the rotation grid (read-only draft).
4. Hand moves and the Tonight drawer.
5. Teacher and family emails plus "Ask for something else".
6. Saved plans round trip, qa-lead, and ship.

## Open Questions

- [x] First Climbing night = **tonight, Nov 8** (id 141). It runs on a printed stopgap sheet, and the feature is for
      later badge nights.
- [x] Older non-holders **always fold into the First Class group** (Patrick: "I can move them manually as needed").
      There is no separate Older seed group.
- [x] Screens: **Brad prototypes first** (prototypes/station-rotations/), and the build follows the prototype.
- [ ] Should the existing split groups (Scout Group 2) be ignored on a station night? Assumed yes: traveling groups
      replace them.
- [ ] Rank-skill station nights (stations from rank requirements): v2?
- [ ] Should the night badges that holders work on (for example Citizenship) also be stations, or stay as today?
      Assumed today.

## Notes

- Related memory: meeting-planner-iii, split-groups-and-confirmations, meeting-requests-board ("Merit badge nights:
  adults assign rotations through stations, and scouts don't choose").
- The retired Rotations tab (Build a Plan L1–L3, dropped 2026-10-28) was a different thing (class arrangement for a
  published meeting). Don't revive its tables.
