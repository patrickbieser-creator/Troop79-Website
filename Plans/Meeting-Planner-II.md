# Meeting Planner II

**Status:** IN PROGRESS: P1–P4 SHIPPED v1.240.0–v1.243.0 (2026-10-21, 4c87a4e1 → a7232203); P5 left
**Parked:** 2026-10-21
**Priority:** High

## Overview

A redesign of meeting planning, moved out of Admin onto the public site at `/planner`. The design handoff is
`prototypes/meeting-plan-II/` (README + four `.dc.html` screens + screenshots). There are four screens: the This Sunday
board (design **1a only**), the person/action drawer, Meeting Live, and Focus sets. The planner is reached from a new
item in the account menu under the signed-in name (`app/_components/account-control.tsx`).

It is built on v1 (`Plans/Meeting-Requests-And-Teaching-Offers.md` and `Plans/Matcher-Tune-Up.md`). Several pieces are
reused as they are:
- the loaders `lib/meeting-board*.ts`;
- picks, intents, `entered_by_person_id`, `effectiveIntent`, `onBehalfAccess`;
- teaching skills and `teach_minutes`;
- the matcher;
- teacher invites (T-5 P1) and scout offers (T-5 P2), which are already real email logged in `meeting_invites`.

## Problem / Opportunity

The v1 This Sunday tab sits in Admin, has small name buttons, can't seed a meeting, and keeps nothing a leader arranges
at the meeting, because the matcher recomputes on every load. Scouts and adults can't see the plan. The SPL, who runs
the meeting, is refused every board write because they sign in as a scout.

## Decisions (Patrick, 2026-10-21)

| # | Decision |
|---|---|
| 1 | The planner is a public-site page at `/planner`, using public tokens and `app/_components`. Admin tokens are blocked there by a test and by ESLint. The This Sunday tab is retired. By Scout, Teaching Roster and Publish to Site stay in Admin for now. |
| 2 | Rights start over. Nobody uses the v1 planner, so no current holders need migrating. New capabilities: `meeting_planner.view`, `meeting_planner.edit` and `meeting_planner.seed` (the planning team). The seed right is granted to a person, never inferred from a label. |
| 3 | View is granted one person at a time, not through a bundle. |
| 4 | View-only users see **everything** on the board: Haven't answered, the Everyone wall, likely fits. Only the controls are hidden. |
| 5 | **Email is adults only.** Send request, nudges and reminders are refused to scouts on the server. Among scouts, **only the SPL** (a scout holding `edit`) can change class assignments. |
| 6 | `/member/meeting` stays as each person's own answer page. "Enter for someone" opens the drawer in place. |
| 7 | **No teaching cap for adults** (revised the same day; it was briefly 3). Drop `_meeting_teach_count` from the RPC and remove `MAX_COMMITMENTS` and `SESSIONS_PER_TEACHER`. Adults decide for themselves. No "teaching more than 2" note in the drawer. |
| 8 | **"Session" is renamed "Rotation" everywhere** (one word for rank and merit badge meetings; it is the troop's word). Meeting Live shows Rotations 1–3 plus **"+ Add rotation"** for a 4th, and the list stays open-ended. `MAX_BLOCKS` is removed. Each rotation has an **optional location**, editable on the night. Once anyone changes Meeting Live, **the matcher no longer applies to that meeting**: the saved placement is the truth, and the board stays on screen during the meeting. |
| 8a | **A class can repeat in several rotations** with different scouts: rank, merit badge, or other. Each repeat is its own card (its own teacher, its own scouts). A scout may not be in two repeats of the same class (a conflict line, like the existing overlap lines), and may not be in two classes in the same rotation. |
| 8b | **No patrol grouping.** v1's patrol-together drafting is dropped. |
| 8c | **Retaking is allowed.** A scout who has already finished a class's requirements can still be placed in it (a deliberate refresher). Their chip shows a small, subtle star in the corner so the teacher knows. There is no "Free: help out". |
| 8d | The matcher's per-scout cap (2 topics) and group cap (8) are **suggestions only**. Nothing on Meeting Live enforces them. |
| 9 | "+ Add as visitor" creates a **guest person record** (see Guests as People). Meeting Live takes attendance into `event_attendance` (Roll Call). If the signed-in viewer can't record attendance, a red banner at the top says so. |
| 10 | **A merit badge night is just a meeting.** There is no separate mode, no whole-badge pick, and no stations screen. Planners split a badge's requirements into focus sets (the troop's way for 20 years). Scouts pick single MB requirements or focus groups, exactly as for rank. Repeating classes across rotations (8a) replaces v1's rotation draft. Badge holders are not treated specially; a leader can place anyone. The teacher list shows registered counselors first with a "Counselor" label, without excluding anyone; sign-off is manual and outside the system. The test data in `meeting_stations` and `meeting_rotation_placements` is not migrated, and those tables are retired in P5. |
| 10a | **Every view has "+ Add an offer" for editors** (the board, the drawer and Meeting Live, on desktop and phone). An offer = a class: a topic (one requirement, a focus group, or a free-text title) plus an optional teacher, recorded as entered by the editor. On the board a new offer goes under Offered, no takers, or under Ready to teach once scouts pick it. On Meeting Live it becomes a card in the rotation being viewed. It is hidden from view-only users and refused on the server. It reuses v1's `offerSkill` / `meeting_teaching_offers` path, extended to name the teacher. |
| 10b | **Amendment (tech-lead, 2026-10-21):** in P2 an offer must name a teacher. It is `teachTopic` on a requirement key or a free-text title. A teacher-less offer is a seeded topic, so it arrives in P3 with seeding and focus groups (`meeting_teaching_offers` requires a person and a skill, so it can't hold one). |
| 10c | **P2 splits in two.** P2a covers the drawer, entering answers for someone, Assign, Add an offer with a teacher, and removing the cap (Decision 7). P2b is the emails: Send request and nudges. The matcher's 2-per-teacher stays as a suggestion (8d). |
| 11 | Reminders are a new email that goes through the `meeting_invites` pipeline and links to `/member/meeting`. A scout's reminder goes to their parents, and also to the scout if 13+ and verified (same rule as offers). |
| 12 | **Phone support is required.** The planner is used on desktop 98% of the time, but Meeting Live is used on phones in the room by several leaders at once. |
| 13 | Phases P1–P5, below. Each phase gets a tech-lead/qa-lead review, and migrations wait on a branch until Patrick says ship (D-404). |
| — | Focus-set search queries `rank_requirements` and the merit badge requirement tables on the server, paginated. Seeded topics use the existing `topic_key` formats. |

## Acceptance Criteria

- [ ] The account menu shows "Meeting Planner" only to holders of `view`, `edit` or `seed`.
- [ ] A `view` holder sees the whole board with no edit controls, and every write is refused on the server.
- [ ] An `edit` adult can enter answers for someone, assign a teacher (no cap), send requests, nudges
      and reminders, and run Meeting Live.
- [ ] A class can be placed in more than one rotation, and a scout in two repeats of it shows a conflict.
- [ ] An `edit` scout (the SPL) can run Meeting Live and enter answers. Every email action is refused on the server.
- [ ] Only `seed` holders can seed a meeting or create, edit or seed focus sets. This is enforced on the server.
- [ ] After the first change on Meeting Live, reloading shows the saved placement, never a fresh matcher result.
- [ ] Two leaders editing Meeting Live at once both see each other's changes within a few seconds, and nothing is
      silently lost.
- [ ] Meeting Live works on a 390px phone using the "Move to" controls, with drag-and-drop on desktop.
- [ ] Attendance from Meeting Live appears on that meeting's Roll Call. An unauthorized viewer sees a red banner.
- [ ] A merit badge night can be planned and run in the planner, and stations/rotations no longer need Admin.

## Test Plan

- [ ] `Viewer_SeesFullBoard_WithNoControls()`
- [ ] `Viewer_IsRefused_OnEveryPlannerWrite()`
- [ ] `ScoutEditor_IsRefused_WhenSendingAnyEmail()`
- [ ] `NonSeeder_IsRefused_WhenSeedingOrEditingFocusSets()`
- [ ] `Adult_CanTakeAnyNumberOfTeachingCommitments()`
- [ ] `MeetingLive_ReturnsSavedPlacement_AfterFirstChange()`
- [ ] `MeetingLive_CanAddFourthRotation_AndBeyond()`
- [ ] `MeetingLive_RepeatClass_InSecondRotation_WithDifferentScouts()`
- [ ] `MeetingLive_FlagsConflict_WhenScoutInTwoRepeatsOfSameClass()`
- [ ] `MeetingLive_MarksRetake_WhenScoutAlreadyCompletedClass()`
- [ ] `MeetingLive_ConcurrentMoves_DoNotLoseAWrite()`
- [ ] `MeetingLive_AddVisitor_CreatesGuestPerson()`
- [ ] `MeetingLive_Attendance_WritesEventAttendance()`
- [ ] `FocusSet_Seed_KeepsExistingFocusTopics()`
- [ ] `FocusSearch_MatchesTokensAcrossSourceCodeLabel()` (e.g. "Tenderfoot 4a", "First Aid 9")
- [ ] `SeededTopic_ShowsUnderNoTeacher_WithZeroPicks()`
- [ ] `Reminder_ToScout_GoesToParents()`

## Technical Approach

- **Route:** `(public)/planner/` with tabs or subroutes: board, live, focus-sets. The drawer is a new public
  component (there is no drawer component in either kit).
- **Rights:** a migration widens the `person_capabilities` check. Add the new rights to `lib/capabilities.ts`, seed at
  least one holder (the every-capability-has-a-holder test needs one), and gate with `requireAnyOf`.
  `/api/session-status` returns the planner flag for the account menu. The old `meeting_plan.use` gates and the
  `adultLeader()` refusal are replaced by `edit`, with a separate adult-only check for email.
- **Seeding:** a `seeded_by_person_id` and `seeded_at` on `meeting_topics`, or a `meeting_focus_topics` table.
  Tech-lead picks.
- **Focus sets:** `focus_sets`, `focus_set_labels`, `focus_set_items(topic_key)`, `focus_set_uses`.
- **Saved placement:** a new `meeting_rotations(calendar_entry_id, number, location null)`,
  `meeting_classes(id, calendar_entry_id, topic_id, rotation int null, teacher_person_id, position)` (several rows per
  topic = repeats) and `meeting_class_members(class_id, person_id, present bool)`, plus a `live_started_at` on the
  meeting board. Once that is set, loaders read the placement and the matcher stops running for that meeting. The first open
  of Meeting Live copies the matcher's output into these tables. Concurrency uses a per-meeting version stamp: the
  existing `boardStampAction` with 10s polling, shortened on Live, plus a stale-write check on each move.
- **Attendance:** writes `event_attendance` for the meeting's `calendar_entry_id`. Decide whether the right is `edit`,
  or `edit` plus `advancement.write` (open question).
- **Phone:** the board stacks into one column (the right column moves under the header), and the drawer becomes a
  full-screen sheet. Meeting Live becomes one rotation column at a time with a rotation switcher. "Move to" and tap
  to pick a teacher are the main controls, and drag is desktop-only.

## Implementation Steps

1. **P1:** rights, the account-menu link, `/planner` with the read-only board (1a layout fed by v1 loaders) and a phone
   layout pass.
2. **P2:** board actions and the drawer: enter for someone, Assign (cap 3), Send request and nudges on the existing
   email, the adult-only email check.
3. **P3:** seeding and focus sets (server search), seeded topics in scouts' pick lists.
4. **P4:** Meeting Live: saved placement, open-ended sessions, concurrency, attendance, visitors as guests, phone
   layout.
5. **P5:** reminders. Retire the Admin This Sunday tab, board settings (mode switch), stations and rotations editor.

## Open Questions

- [x] **Focus group as a pick:** a focus group is ONE pick, taught as one class.
- [x] **Who changes class assignments:** the SPL plus adults holding `edit`.
- [x] **Attendance right:** `edit` alone is enough (SPL included) to record attendance on that meeting's Meeting Live.
      Mistakes are easy to correct.
- [x] **Phone mock-ups:** Brad mocks the phone layouts for the board, the drawer and Meeting Live before P1, in
      `prototypes/meeting-plan-II/phone/`.
- [ ] Review Brad's phone mock-ups, then activate P1.

## Notes

- v1 contradictions found in the README: `admin-nav-capabilities` doesn't exist (it's `nav-data.ts` +
  `lib/capabilities.ts`); DataTable is CSS, not a component; email is already real; teaching was capped at 2;
  sessions were capped at 12; the SPL was refused writes.
- Related: `Plans/Roll-Call.md`, `Plans/Guests-As-People.md`, `Plans/Matcher-Tune-Up.md` (T-1 is still parked).
