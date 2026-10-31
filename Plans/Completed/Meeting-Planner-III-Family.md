# Meeting Planner III — Family page

**Status:** SHIPPED v1.259.0 (2026-10-30, main 7bab8e59). F1–F5 done; migrations 20261231600000 and 20261231700000 in production.
**Parked:** 2026-10-30
**Priority:** High

## Overview

Rebuild the family page (`/member/meeting` signed in, `/i/plan/<token>` from the email) to match the redesigned
`prototypes/meeting-plan-III/Family.dc.html` and its README section "Screen: Family page". Every card, scout or adult,
gets the same shape: first name, group line, badge, the plan as one line per item with minutes, and the same three
answers: **This plan looks good · Change my plan · Can't make it this week**. Scouts get a 4-thing / 60-minute plan
limit. Adults and Junior Leaders get a 3-class / 60-minute teaching limit, and the teach board moves inside their card.

## Problem / Opportunity

What shipped in session 70 (v1.258.0) still says "Coming · …" with 4–6 answers that differ by card, caps
suggestions at 5 with no time budget, and keeps a separate teach board with no limit on adults. Families can
over-commit a scout past one meeting, and adults can sign up for more than they can deliver.

## Decisions (Patrick, 2026-10-30)

- **D1. 60 minutes** for both limits. Meetings are 90 minutes, and 30 of those go to other things.
- **D2.** Write this plan, then build. Stop only for critical decisions.
- **D11. A class counts for at most one meeting (60 min)** (`CLASS_MAX_MIN`). Every catalog time is 15 per part today,
  so a first-aid class summed to 120 and nobody could take one. Patrick: some requirements (first aid) take two
  meetings; "we will simply schedule it again when that occurs" — nothing tracks a carry-over.

## Decisions made here (defaults, not critical, can be revisited)

- **D3. Limits are checked in server code, not in a migration.** `familyWrite` already re-derives the scout's plan.
  It counts planned items still ticked plus requests, and their minutes, before any request or re-tick. The suggestion
  RPC's cap becomes `4 − ticked planned items`, so the count still holds under the board lock. Minutes are checked in
  TypeScript, which is enough because only one household writes a scout. Adults are checked the same way in
  `teach-actions` before `teachTopic`.
- **D4. Minutes** come from `teach_minutes` through `topicWords(...).minutes` / `itemPart`, with a default of 15. A
  group item is the sum of its open sub-requirements. A whole merit badge (`mb:`) or help-teach has no catalog value,
  so it uses **45** for an MB class and **15** for help teach, the prototype's numbers. The new formatter is
  `{code} - {N} min`.
- **D5. A Merit badge group scout's** "help teach" becomes an **Also on Sunday** item (+ Request). It still writes the
  `meeting_scout_helpers` row, and it counts as one thing of 15 minutes. The `mb` and `help` answers go away, so
  answers are `ok | change | out`. Old saved helper rows still read back.
- **D6. Adult "help teach"** = a second (or later) `meeting_topic_teachers` row on a group that already has a
  teacher. There's no new column: the earliest row is "Teaching" and later rows are "Helping teach".
- **D7. Pre-assigned** = a teacher row whose `entered_by_person_id` is not the teacher. Rows the adult entered
  themself are "signed up on this page", and Clear gives those back.
- **D8. Adults-only classes.** The Merit badge group requires a counselor for that badge (`counselorFor`). Other
  classes use the existing skill rule (`youth_teachable` via `assessTeacher`). There's no new per-class flag (the CPR
  example rides on the skill).
- **D9. First names on every card**, as the README says. This reverses session 70's full-name headers on
  `/member/meeting`.

## Known gaps (qa-lead 2026-10-30, accepted)

- **The limits are checked in code before the write, not under a lock.** Two requests at the same instant (two tabs)
  can both pass: a teacher could reach 4 classes, or a scout 5 things. The page serializes its own taps; only the
  scout request count is also held in the database. The teaching cap left the database in `20261202100000`.
- **Planner screens are not limited.** A leader assigning from This week, the drawer or Suggestions can put anyone over
  3 classes / 60 minutes on purpose.
- **An offer on several dates is checked against this Sunday only.** The limit is per meeting on the page that shows it.
- **F5: a forwarded email link acts as its recipient** until 6 PM Sunday (qa-lead 2026-10-30), teaching card included:
  it can take or drop classes, release a planner-assigned class through Not sure yet → take me off, and say Can't
  make it with a note. Kept on purpose: the design offers take-me-off on the email page, it sits behind a confirm a
  mail scanner can't press (GET writes nothing), every write is counted, and Emails can revoke or supersede the link.
- **F5: a link that is both full (200 writes) and out of scope now says "limit" before "scope"** (the shared
  `_meeting_plan_page_open` helper counts first). The write still rolls back; only the refusal word differs.

## Acceptance Criteria

- [ ] Every card: first-name title, a group-only line (adults: teaching / helping teach / not teaching a group yet),
      badge (Needs an answer · ✓ Plan looks good · ✓ Changes sent · Can't make it · Not sure yet).
- [ ] The word "Coming" appears nowhere on the page.
- [ ] Three answers on every card, with sub-lines per card kind as in the prototype.
- [ ] The plan list is one line per item: label · `{code} - {N} min`. Requests show in it with a **Requested** tag.
- [ ] Change my plan (scout): planned items as checkboxes, Also on Sunday with + Request, search with + Request. A
      request joins the checklist ticked, and unticking it withdraws the request. Saved line: "✓ Saved · 1 change,
      2 requests sent to the planners".
- [ ] Scout limit: 4 things and 60 minutes. A counter shows both, turns yellow when full, and disabled buttons say why
      ("Limit reached", "Needs 45 min · 30 left", "untick something to add this back"). The server refuses over-limit
      writes with the same words.
- [ ] Household one-tap: "✓ All of these plans look good", then "✓ You're all set for Sunday".
- [ ] Ledes (family / scout self / adult teacher / Junior Leader) and the two-line footer.
- [ ] Adult card: the plan lists their classes. Change my plan holds: Classes that need a teacher (I'll teach this),
      Classes with a teacher (I'll help teach), Scouts are asking for these, Offer something. The load meter shows
      "N of 3 classes · M of 60 minutes", and the server refuses past either limit.
- [ ] Adult Can't make it: an optional note (3 lines, 240 characters, counter, its own Send).
- [ ] Adult with nothing assigned: the class list is open on the first visit, with only Can't make it under it. Once
      they have a class, a return visit shows the standard card.
- [ ] Clear on an adult gives back that adult's own sign-ups. If they're pre-assigned, a yellow panel offers: take me
      off for now / keep me on / never mind.
- [ ] Junior Leader card: adult-style card, scout limits on teaching rules, adults-only classes shown but not takeable.

## Test Plan

Unit (`tests/family-week-*.test.ts(x)`, `tests/teach-*.test.ts`):
- [ ] `Family_SeesThreeAnswers_OnEveryCardKind` (rank, done, mb)
- [ ] `Family_NeverSeesComing_AnywhereOnThePage`
- [ ] `Family_CardTitle_IsFirstNameOnly`
- [ ] `Family_PlanItem_ShowsCodeDashMinutes`
- [ ] `Family_Request_JoinsChecklistWithRequestedTag`
- [ ] `Family_CannotRequest_WhenFourThings` (button "Limit reached")
- [ ] `Family_CannotRequest_WhenMinutesWouldPass60` ("Needs N min · M left")
- [ ] `Family_CannotReTick_PlannedItem_WhenFull`
- [ ] `FamilyWrite_RefusesRequest_OverFourThings` (db)
- [ ] `FamilyWrite_RefusesRequest_OverSixtyMinutes` (db)
- [ ] `FamilyWrite_RefusesReTick_OverLimit` (db)
- [ ] `FamilyWrite_HelpTeach_WritesHelperRow_AndCountsFifteen` (db)
- [ ] `Minutes_GroupItem_SumsOpenSubs`, `Minutes_DefaultsTo15`
- [ ] `Teacher_CannotTake_FourthClass` (db)
- [ ] `Teacher_CannotTake_ClassPast60Minutes` (db)
- [ ] `Teacher_HelpTeach_IsSecondTeacherRow` (db)
- [ ] `JuniorLeader_CannotTake_MeritBadgeGroup`
- [ ] `Teacher_Clear_ReleasesOwnSignups_KeepsPreassigned` (db)
- [ ] `Teacher_ClearTakeMeOff_ReleasesPreassigned` (db)
- [ ] `Teacher_NothingAssigned_SeesOpenClassListFirst`
- [ ] `Teacher_CantMakeIt_NoteLimited240And3Lines`

## Implementation Steps

Status 2026-10-30: F1–F4, F3b and F5 built (uncommitted to production, v1.259.0 block in changelog).

1. **F1 Scout card (shared view)**: `lib/family-week` gives items minutes and codes, requests as plan items, Also
   with minutes, and choices `ok | change | out`. `family-week.tsx` gets the new copy, badges, ledes, footer, one-tap.
   Tests first.
2. **F2 Scout limits**: client counter and disabled states, and server checks in `familyWrite` (D3).
   `SUGGESTION_CAP` is retired in favor of `PLAN_MAX = 4`, `PLAN_MAX_MIN = 60`.
3. **F3 Adult card**: replace `teach-board.tsx`'s layout with the card pattern. Change my plan holds needs-teacher,
   help-teach, scouts-asking and offer. Add the load meter and server limit in `teach-actions` (D6, D8).
   **F3b (built on feat/teacher-cant-make-it-note, waits for ship):** Can't make it gets its note. Needs a `meeting_intents.note` column (additive migration, on a
   branch until Patrick says ship), shown to planners with the group's decline notes.
4. **F4 Mark and clear flows**: open-list first visit, Clear with the pre-assigned panel (D7).
5. **F5 Adults on the email link** (`/i/plan/<token>`): **built on feat/plan-link-teacher-cards, waits for ship
   (DB-first migration `20261231700000_plan_page_teacher.sql`) and a qa-lead security pass.**
   - `meeting_plan_pages.as_teacher`; a link may carry no scouts only when it is a teacher link.
     `meeting_plan_page_claim_teacher` shares `_meeting_plan_page_open` (lock, open state, epoch, the 200-write count)
     with `meeting_plan_page_claim` (unchanged signature and refusals).
   - The write core moved to `lib/teach-write` (server-only, not a server action). `teach-actions` checks the session
     and calls it; `planPageTeachAction` claims the link and calls it as the recipient, never a leader.
   - **Offers from the link are for that Sunday only** (the form lists one date; the action refuses any other).
   - **Adults without scouts get their Coming? reminder as a teacher link** (no scouts, as_teacher); someone who may
     not teach keeps `/member/meeting`. Household plan/reminder links are as_teacher when the recipient may teach on
     the date (loadTeacherPeople: every active adult, or a Junior Leader at their own address). `/i/teach` unchanged.
   - The TeacherCard takes `write(op)`; `/member/meeting` wraps teach-actions (teacher-card-member.tsx).
6. qa-lead pass, full gate, changelog, ship (code-only for F1–F4; no migration).

## Open Questions

- [x] F4: no auto-restore (Patrick 2026-10-30: "if someone removes a class using take me off, they can start over for now"). The README says answering again after "take me off" **puts the pre-assigned class back**. Doing that needs
      a memory of the released class, which means a migration. Until then the card says "If a class is still open,
      you can pick it again" and doesn't restore it automatically. OK?
- [x] F5: adult cards appear on the email link page (Patrick approved the design 2026-10-30); `/i/teach` stays for teach asks.
- [ ] Where does a signed-in adult's Can't make it note live? (`meeting_invites.decline_note` is per invite.)
      Answer in F3: reuse it when there's an invite, otherwise attach it to the intent.

## Notes

- Spec: `prototypes/meeting-plan-III/README.md` "Screen: Family page" + `Family.dc.html` (Patrick's, uncommitted).
- Code: `src/lib/family-week.ts`, `src/app/(public)/member/meeting/{family-week,teach-board,teach-actions,page}.tsx`,
  `src/app/(public)/i/plan/*`, `lib/meeting-board-picklist.ts` (`teachMinutes`, `topicWords`), `lib/this-week.ts`.
- Specialist notes 2026-10-30: there's no teaching cap today (`20261202100000_meeting_teach_no_cap`). Adult
  help-teach has no model. The plan page is scouts-only by token scope.
