# Meeting Planner III — Planned, asked, confirmed

**Status:** SHIPPED v1.260.0 (2026-11-01, main 9aa9cc2f). C1–C5 + qa-lead fixes done; test gaps in BACKLOG.
**Parked:** 2026-10-31
**Priority:** High

## Overview

Everything This week shows is a **proposal**. A teacher on a card is *planned*, a scout in a group is *suggested*. Emails
ask the people involved to confirm, and only their answer makes it real. Every teacher slot and every scout plan carries
one of four states, shown on the cards and the Emails screen:

| State | Teacher | Scout |
|---|---|---|
| **Planned** | on a card, not yet emailed | placed by the plan, family not yet emailed |
| **Asked** | confirm email sent, no answer | plan email sent, no answer |
| **Confirmed** | said Yes to that card | family said "This plan looks good" (or sent changes) |
| **Said no** | said No → off the card, card flags "Needs a teacher" with their note | "Can't make it" → off the cards (as today) |

Plus **Changed since yes**: a confirmed person whose card changed after they said yes (other requirements, another group)
keeps their yes, marked, and the Emails screen offers a new email. Nothing goes out by itself.

## Problem / Opportunity

The system treats a planned teacher as committed. The Emails screen refuses to email Mindy because she is "already
teaching it", although she has never been told. Nothing records a confirmation: a teach-page Yes only marks an invite
row, the family teacher card's "This plan looks good" only says "coming", and nothing snapshots what someone agreed to.
Planners can't tell a proposal from a commitment.

## Decisions (Patrick, 2026-10-31)

- **C-D1.** A group with a planned teacher: the Emails screen offers to email **the planned teacher only** ("You're
  planned to teach Scout Group 1 — Yes, I can / No"). Other qualified adults are offered only for groups with no
  planned teacher.
- **C-D2.** A **No** takes them off the card at once, and the card shows **Needs a teacher** with their note.
- **C-D3.** **Chip style per state**: planned = plain outline; asked = outline + "asked"; confirmed = filled green ✓;
  said no = red. The same on group cards, the Adults card, Live and the checklist.
- **C-D4.** A plan change after a yes: **flag for re-send** ("plan changed since they said yes"); the yes stays.
- **C-D5.** Scouts: a family's "This plan looks good" shows the scout as **confirmed** (green ✓), and a later change
  to that scout's plan is flagged the same way.

## What exists (Explore map, 2026-10-31)

- `meeting_topic_teachers` = on the card (planner, teach page and family teacher card all write it). No answer state.
- `meeting_invites` (kind teach) minted per teacher email: `response` accepted/declined + `decline_note`.
- Teach page No deletes the row only if they had said Yes; family "Can't make it" sets intent not_coming and hides
  their rows on This week but doesn't delete them.
- `meeting_emails.plan_sent` + `planChanged` flag family plan emails changed since SENT; nothing for teachers, and
  nothing captures the plan at the moment of a yes.

## Technical Approach (to confirm with tech-lead before C1)

1. **Answer on the slot.** `meeting_topic_teachers` gains `answer` ('yes' | null), `answered_at`, `answered_plan` (jsonb:
   the card's requirement keys and title at the yes). A No deletes the row (C-D2) and keeps its note on a small
   `meeting_teacher_declines` log (person, key, note, at) so the card can say who said no. Asked = a sent teacher email
   for that person and card after the row was made (from `meeting_emails`).
2. **One state function** (pure): `teacherState(row, emails, plan) → planned | asked | confirmed | changed` and
   `scoutState(familyAnswer, emails, plan) → planned | asked | confirmed | changed`. Every screen reads it.
3. **Writers.** Teach page Yes and the family teacher card's "This plan looks good" set `answer='yes'` + snapshot on
   each row they hold; a planner moving or editing the card leaves the yes and lets the snapshot comparison flag it.
   Family "This plan looks good" snapshots the scout's plan on their answer row.
4. **Emails screen.** Teachers tab: planned and changed-since-yes teachers are the rows (no "already teaching it");
   confirmed ones show ✓ and aren't offered; groups with no planned teacher list free qualified adults to ask.
   Email copy for a planned teacher: "You're planned to teach **Scout Group 1**: 1a … Can you? Yes / No".
5. **Chips** (C-D3) through one class per state, on public tokens.

## Tech-lead review (2026-10-31): go with changes (supersedes Technical Approach 1)

1. **Answers in their own tables**, not columns on `meeting_topic_teachers` (that row is deleted on No and on a planner
   move, and merge_people copies it by column list): `meeting_teacher_answers (entry, person, group_key, answer yes|no,
   note, answered_at, answered_plan)`, PK (entry, person, group_key); `meeting_scout_answers (entry, person,
   answered_at, answered_plan)`. A yes counts only while the slot exists. A No upserts 'no' (+ note) and deletes the
   slot; "Needs a teacher" reads the note from it (no separate declines log).
2. **Group keys canonical at read time** (`canonicalGroupKey`): a yes on `fr:scout~2` reads as `fr:scout` while merged.
3. **Teach page Yes writes the answer in its own transaction**, on both its 'yes' and 'unchanged' branches.
4. **merge_people** moves answers (on conflict do nothing); **meeting_board_stamp** counts them.
5. **Asked** = newest of a sent teacher email (meeting_emails, about.group canonicalised) or a teach invite row,
   after both the slot's created_at and any earlier answer.
6. **Teacher snapshot** `{group (canonical), itemKeys (sorted column keys), title}`; changed = group or item keys differ;
   the title is display only (a split rename never flags anyone).
7. **Scouts**: the family's choice isn't stored today (derived from intent + a changed flag). `meeting_scout_answers`
   is written with "This plan looks good" (snapshot = `planSentOf` shape) and cleared on Change / Can't make it;
   changed-since-yes reuses `planChanged`.
8. **Adult "Can't make it"** is not a No: those rows stay hidden as today (state `hidden`); Needs-a-teacher counts them.
9. C-D6: one family-page confirm writes one answer row per card, each with its snapshot, in one transaction.

## Implementation Steps

1. **C1** schema + pure state functions + tests (DB-first, additive).
2. **C2** writers: teach page and family teacher card set the answer; a No takes them off the card; decline log.
3. **C3** This week: chips by state on group cards, Adults card, teacher list, Live; "Needs a teacher" on a card a No
   emptied.
4. **C4** Emails screen: planned teachers first (C-D1), new confirm email copy, changed-since-yes flags for teachers and
   families (C-D4, C-D5).
5. **C5** scouts: confirmed chip and changed-since-yes on the checklist and family rows.
6. qa-lead, full gate, ship (migration waits for Patrick's "ship").

## Open Questions

All answered 2026-10-31:

- **C-D6.** An adult's family-page "This plan looks good" **confirms every card** they're planned on.
- **C-D7.** **Asked stays asked** until they answer: no expiry, no automatic reminder.
