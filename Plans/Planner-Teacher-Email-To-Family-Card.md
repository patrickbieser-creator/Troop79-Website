# Planner Teacher Email → the Family Card (retire /i/teach)

**Status:** Active (answers in 2026-11-01)
**Parked:** 2026-11-01
**Priority:** High (blocks sending this week's planner emails)

## Overview

The Emails screen's teacher email ("can you teach?") opens `/i/teach/<token>`, the Build a Plan B10b
answer page from 2026-10-22. That page predates the family card and doesn't match it. Session 72
(D-464, commit 11776fcc) pointed planned teachers at it because the teacher email was built on the
old `createInviteDigest` pipeline. This plan points every teacher email at the family link
`/i/plan/<token>` minted as a teacher link (the same `TeacherCard` as `/member/meeting`), then
deletes `/i/teach`, its table, the digest pipeline, and the picker's "Also this Sunday" path.

Patrick, 2026-11-01: "I don't see anything there I want to keep, including the search requirements
as designed on that card."

## Problem / Opportunity

- Two pages answer the same question with different rules. `/i/teach` has per-class Yes / Not this
  week, no Coming / Can't make it / Not sure, no "This plan looks good", no Change my plan, no
  scout cards, and a frozen send-time snapshot.
- A No on `/i/teach` never touches attendance, while the card's Can't make it is deliberately not
  a No (D-464), so the two disagree about the same adult.
- A parent who is also a planned teacher gets two emails to two different pages.
- **Found while planning (an existing bug, affects today's adult reminders too):**
  `supersedeOlderPlanPages` closes every older link for a (meeting, recipient) pair. A newer link
  with fewer scouts (an adult's teacher-only reminder) therefore closes that parent's family link.
  Their kids' cards then read "There's a newer plan". This plan's teacher links would hit it on
  every send, so the fix goes here.

## Acceptance Criteria

- [ ] The teacher email's button opens `/i/plan/<token>`, showing the recipient's teacher card;
      no email links to `/i/teach` any more.
- [ ] A planned teacher answers there with This plan looks good (confirms every card they're on),
      Change my plan, or Can't make it, recorded exactly as from `/member/meeting` (C2/C-D6).
- [ ] An adult asked about a group they aren't planned on sees that group first on the card and
      can take it in one tap (Open Question 1 decides whether they can also say No to it).
- [ ] A newer email's link never closes an older link it doesn't cover (a parent's family link
      survives their teacher email; an adult reminder no longer closes a family link).
- [ ] The Emails screen still shows asked / Answered yes / Said not this week / Changed since yes
      for teacher rows, read from `meeting_emails` + `meeting_teacher_answers`, not `meeting_invites`.
- [ ] The teacher email copy and button match the new page (no "answer yes or no").
- [ ] `/i/teach` is deleted outright (Q3: the only teach links ever sent were Patrick's own tests,
      verified in production 2026-11-01: 3 teach invites, all to person 82). A stale link 404s.
- [ ] The interest picker is only on `/member/teaching`; the "Also this Sunday" path is gone.
- [ ] Dead code is removed: `meeting-teach-pages`, `meeting-invite-digest-db`,
      `meeting-invite-digest-send`, the `/i/teach` actions, and their tests (the BACKLOG item
      "retire the test-only invite senders" closes here).
- [ ] `meeting_invite_pages` (the /i/teach table) is dropped in a code-first migration after the
      code deploys; `meeting_invites` kind teach rows are read nowhere (left in place, no data migration).
- [ ] Full gate green: lint 0, typecheck, full suite, build. The test count may drop as B10b tests
      go; say by how many.

## Test Plan

Written first; each fails before its step.

- [ ] `TeacherEmail_LinksToFamilyPlanPage_WhenSent` — a prepared teacher email's action URL is
      `/i/plan/<token>`; the minted page is `as_teacher`; no `meeting_teach_pages` row or teach invite.
- [ ] `SameBatchLinks_BothStayOpen` — family + teacher email to one parent in one batch.
- [ ] `PlanLink_DoesNotCloseOlderScouts_WhenNewerLinkHasFewer` — regression for the supersede bug
      (adult reminder after a family email).
- [ ] `TeacherEmail_DeletesMintedLink_WhenSendFails` — the undo path still holds.
- [ ] `PlannedTeacher_ConfirmsCard_WhenPlanLooksGoodOnLink` — card state `confirmed`, Emails row
      "Answered yes".
- [ ] `AskedAdult_SeesAskedGroupFirst_OnTeacherLink` — the asked group key travels on the link
      and opens at the top of the card.
- [ ] `AskedAdult_TakesAskedGroup_WhenTappingTeachThis` — slot row + yes answer.
- [ ] (Q1 = yes) `AskedAdult_SaysNotThisWeek_RecordsSaidNo` — off-card No answer, Emails row
      "Said not this week", note shown on Needs a teacher.
- [ ] `TeacherRow_IsAsked_FromSentTeacherEmailOnly` — the Emails screen without `meeting_invites`.
- [ ] `TeacherEmailPreview_MatchesSentCopy` — the preview's button label and wording match.
- [ ] `InterestPicker_HasNoAlsoThisSunday_OnMemberTeaching`.

## Technical Approach (revised after tech-lead, 2026-11-01)

- **Supersede guard, not a fold (`plan-pages.ts`):** `mintPlanPage` unchanged; a teacher email's
  link is `{ asTeacher: true, scoutIds: [] }`. `supersedeOlderPlanPages` takes `{ scoutIds,
  asTeacher, queuedAt }` and closes only older links the new one COVERS (older scouts ⊆ new scouts,
  and not losing the teacher card) created before the email row was queued. A family link and a
  teacher link to the same parent both stay open; the reminder bug is fixed by the same rule.
- **Asked classes read at render time (no migration):** `loadTeacherWeek` passes the person's
  `teacherAsks` (sent teacher emails, already loaded by `loadThisWeekData`) into
  `buildTeacherWeek`, which returns `asked: TeacherClass[]` (keys via `canonicalGroupKey`, from
  `needs` or `taught`, minus anything in `mine`, minus keys no longer groups), each with `saidNo`.
  `TeacherCard` shows a "We asked about" block outside the edit view: I'll teach this / Not this
  week (+ optional note); after a No it reads "You said not this week" and can still be taken.
  `/member/meeting` gets the same block.
- **Decline op:** `teach-write` `{ op: 'decline', key, note }` → `recordTeacherAnswers` no + note
  (note through `cleanDeclineNote`); refused unless `key` is in the person's asked set and not on
  their card; added to both TEACH_OPS allowlists.
- **Prepare:** teacher branch throws unless `mayTeach`; mints the plan link; one shared
  `teacherEmailItems()` feeds both prepare and the Emails preview (button "See my plan and answer").
- **Emails screen / this-week-db:** asked people from the log (kind teacher, status sent); "Said
  not this week" from the group's saidNo; `meeting_invites` kind teach read nowhere (also check
  `loadInviteRows`).
- **Deletion (Phase 1, code):** `/i/teach`, `meeting-teach-pages`, digest db/send,
  `meeting-invites-send` (orphaned), `fillYesPlans`/`setTeacherNoNote`, `teaching-interests`
  page functions + picker `allowNow`/`now`/`canTeachNow`, their tests. Keep
  `meeting-invite-digest` (scoutsHelpedText), `meeting-invite-email`, `meeting-invites-db`,
  `meeting-invite-audit`, `decline-note`.
- **Phase 2 migration (after Phase 1 is live):** re-create `merge_people` without its
  `meeting_invite_pages` clause (diff vs production `pg_get_functiondef`), drop
  `meeting_invites.page_id`, the teach-page answer/search functions, then `meeting_invite_pages`.
- No saved `email_templates` rows exist for the two teacher kinds in production (checked
  2026-11-01), so changing the defaults is enough.

## Implementation Steps

Phase 1 (pure code, worktree `.claude/worktrees/teacher-email`, branch feat/teacher-email-family-card):
1. Failing tests (supersede guard incl. `SameBatchLinks_BothStayOpen`; asked block; decline op +
   refusal; prepare link + mayTeach; preview = sent copy; Emails rows from log).
2. Supersede guard. 3. teacher-week asked. 4. decline op. 5. TeacherCard block.
6. Prepare + shared items + copy. 7. Emails screen / this-week-db reads. 8. Deletions.
9. Full gate; qa-lead; changelog in the feat commit; ship = ff main → Vercel green.

Phase 2: 10. drop migration as above; backup → dry-run → push.

## Open Questions (answered 2026-11-01)

Patrick: 1 yes, 2 sounds good, 3 "No invites were sent out to anyone. It is not an issue.", 4 agreed.

- [ ] **Q1. Can an asked (not planned) adult say No?** Recommend **yes**: a "Not this week" next
      to I'll teach this, with the optional note, recorded as a No for that group, so the Emails
      screen stops showing them as asked. Without it, the only reply is to ignore the email.
- [ ] **Q2. Button wording.** Recommend "See my plan and answer →" for both teacher emails.
- [ ] **Q3. Old teach invites (`meeting_invites` kind teach) from past meetings.** Recommend we
      stop reading them (they only matter to the meeting they were for) and leave the rows; no data
      migration.
- [ ] **Q4. One email or two for a parent who is also a planned teacher?** Recommend keeping two
      (the family email and the "can you teach?" email). With the superset rule both open the same
      page, so the second costs nothing.

## Notes

- Related: D-464 (proposals/confirmations), D-465 (scout teacher addresses), D-466 (teacher email
  content), F5 (teacher card on the family link), Plans/Completed/Meeting-Planner-III-Confirmations.md.
- A Junior Leader teacher link: `/i/plan` already shows only their teaching card on their own link.
- Ship rule: Phase 1 is code only; Phase 2 drop is code-first (after Phase 1 is live).
- tech-lead review 2026-11-01: GO with the changes above.
