# Admin › Health Forms — Record sheet redesign

**Status:** Built 2026-11-16, waiting for Patrick's say-so to ship (migration `20270107100000_health_record_sheet.sql`).
**Parked:** 2026-11-16
**Priority:** High. It reworks the **Record sheet (View)** in `Plans/Admin-Health-Forms.md` (phases 2–3), which is built
as a 480px right-side sheet today.

## Overview

The pop-up that opens from **View** on Admin › Health Forms is redesigned as a wider two-pane dialog. The left pane
holds what an adult needs at a glance: the family's medical note and who to contact. The right pane holds the forms,
one card each, with the actions for that form on its card. A footer carries the review state, with an undo, and Close.

Design: Claude Design canvas "Health record pop-up", artboard **B · Two-pane**
(https://claude.ai/artifact/7p5UPTi3LfCETQSx5AKCMH). Artboards A and C are rejected alternatives. The mockup uses a
made-up scout (Sam Kowalski) and made-up contacts.

## Problem / Opportunity

The current sheet (screenshot, Nov 16):
- A red **Missing** sits beside the name with no subject, so it isn't clear what is missing.
- The family's note ("What the family told us") reads like any other field, though it is the most important line.
- A missing form has no next step on it. Reminding the family lives only in the bulk Actions menu.
- Document actions are scattered links: "Download page 1", "View front", "View back".
- "Not reviewed yet." floats alone at the bottom, and there is no clear way to undo a review.
- "Immunization record · Not needed" can't say the other real case: the immunizations are part of the BSA form.
- Prev / Next are small text links.

## The design (version B)

```
┌ Sam Kowalski   Scout · Last upload Nov 13, 2026                     [←] [→]   ✕ ┐
├───────────────────────────────┬─────────────────────────────────────────────────┤
│ ┌ From the family ──────────┐ │ Forms on file                                   │
│ │ Peanut allergy. Carries   │ │ ┌ BSA health form, Parts A and B   [Missing] ─┐ │
│ │ an EpiPen.                │ │ │ No reminder sent yet.                       │ │
│ │ Typed by the family, not  │ │ │ [Email reminder]  [Upload for family]       │ │
│ │ read from the form.       │ │ └─────────────────────────────────────────────┘ │
│ └───────────────────────────┘ │ ┌ Part C   [On file] ──┐ ┌ Insurance card  ───┐ │
│                               │ │ Good until Jul 19,   │ │ [On file]          │ │
│ Who to contact                │ │ 2027 · 1 page        │ │ Front and back     │ │
│ Dana Kowalski                 │ │ [View] [Download]    │ │ [View front][back] │ │
│ (414) 555-0142   (tel: link)  │ └──────────────────────┘ └────────────────────┘ │
│ dana@…            (mailto)    │ ┌ Immunization record  [Not needed | In BSA form]│
│ Chris Kowalski …              │ └─────────────────────────────────────────────┘ │
├───────────────────────────────┴─────────────────────────────────────────────────┤
│ [Not reviewed] · Viewing is logged.                     [Close] [Mark reviewed]  │
│ [✓ Reviewed] by Patrick Bieser on Nov 16, 2026 · …  [Undo review] [Close]        │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Decisions (Patrick, 2026-11-16)

1. **No readiness block.** No "Campout ready / Not yet" summary and no "Waiting on Parts A and B" line. The form cards
   say it.
2. **The left pane starts with the family's note**, in the yellow warning Notice (`admin-status-warning-bg`, title in
   `admin-accent-gold`). Label "From the family"; hint "Typed by the family, not read from the form." When the family
   gave no note, the box is not shown.
3. **Who to contact:** each parent or guardian's name, phone as a `tel:` link, and email as a `mailto:` link.
   **No Text link** in admin. (The public `/health` page keeps Call / Text; unchanged.)
4. **Missing required form** (Parts A and B, insurance):
   - The card spans the full width of the forms pane and has the red outline, so it is the first thing seen and its
     two buttons fit at normal size (no smaller font, no wrapping).
   - **Email reminder** (forest Add style) emails the family about this person only. After sending, the card reads
     "✓ Reminder emailed to <parent> on <date>" and the button becomes **Email again**.
   - **Upload for family** opens the existing Upload dialog for that slot (`via: 'named'`).
5. **On-file forms:** Part C has **View** and **Download**, with "Good until <date> · <n> page(s)". The insurance card
   has **View front** and **View back**. Per-page Replace… / Remove… stay in a ⋯ on each card (AGENTS rule 5).
6. **Immunization record has two states, never red:**
   - **Not needed** — grey Badge, dashed card, "Not required for this scout."
   - **In BSA form** — green Badge, "Included with the BSA health form. No separate upload needed."
   - (Plus the existing **On file** card with View when a separate record was uploaded.)
7. **Close** button in the footer, in addition to the ✕ in the header.
8. **Review can be undone, and the change is recorded.**
   - Not reviewed: neutral Badge "Not reviewed" and a navy primary **Mark reviewed**.
   - Reviewed: green Badge "✓ Reviewed" with "by <name> on <date>", and a secondary **Undo review**.
   - Undo returns to Not reviewed and shows "Review undone by <name> on <date>". Both changes are written to the
     access log. No confirm, because it is reversible either way.
9. ~~Prev / Next become 36×32 bordered buttons.~~ Superseded by decision 10: no Prev / Next.

### Decisions (Patrick, 2026-11-16, after plan review)

10. **No Prev / Next.** Removed from the sheet altogether (replaces decision 9).
11. **Expiration dates, one per document.** Parts A and B share one date; Part C has its own (it may be handed in
    later); the insurance card has its own. When a document is entered, its date defaults to **one year from the day
    it is entered**, and anyone who may change the record can edit it. This replaces asking for the parent's and
    doctor's signature dates (the family screen gets the same single "Good until" date). The immunization record has
    no date.
12. **Part C gets no extra rules.** Missing reads Missing (grey, not red: it is not required). Reviewers know when
    a trip needs it; nothing trip-aware is added to the sheet.
13. **Reminders need no trip.** A health reminder can go any time. The email names what is missing or run out, with
    no trip in it. Sent to every adult in the family with an email, one email per family (as trip reminders already
    do). Trip reminders from `/health` record "last sent" too, so the card shows them.
14. **Families see the full history of reviews.** Mark reviewed and Undo review are written to the access log as
    `review` / `unreview` lines, and appear in the family's history. (As built, qa-lead: every write in the sheet
    leaves its own line, since each answers with the record: `edit` for a Good until or In BSA form change and
    `remind` for a reminder. Those two show on the admin Access log, not in the family's history.)
15. **Upload clears the review** (unchanged). The footer then reads plain "Not reviewed".
16. **In BSA form** is one per-person flag set by a named leader in the sheet. (Not by the family: adding each page
    of Parts A and B would clear their own tick.) It clears whenever a Parts A and B page is added, replaced or removed. "Not needed" is simply an
    immunization record with nothing on file and the flag off.

### Answers to the open questions

- **Q1:** centred 860px dialog.
- **Q2:** see decision 16.
- **Q3:** Mark reviewed stays enabled with missing forms; "Reviewed" means a leader looked, not "complete".
- **Q4:** **Mark reviewed / Reviewed** everywhere.
- **Q5:** see decision 13.

### Depends on

`Admin-Health-Forms.md` phase 3 (writes in the sheet) and the reminder part of phase 4 were never built. This plan
builds the parts it needs: admin upload / replace / remove (via `named`), editing the Good until date, Mark reviewed /
Undo review, the single-person reminder, and the In BSA form flag. Remove all, Add someone and the bulk tools stay in
that plan.

## Acceptance Criteria

- [x] View opens the two-pane dialog (860px wide on desktop). Below 900px the panes stack: family note, contacts,
      then forms. Below 768px it is full width.
- [x] The family note box shows only when a note exists, and comes first.
- [x] Contacts show name, `tel:` phone and `mailto:` email; no Text link.
- [x] A missing required form gets the full-width red card with Email reminder and Upload for family; both buttons fit
      without wrapping at 860px.
- [x] Email reminder sends to that one family, logs it, and the card shows who was emailed and when (survives reload).
- [x] Immunization shows Not needed / In BSA form / On file correctly, and is never red.
- [x] Mark reviewed → Undo review → Mark reviewed works; each change shows who and when and is in the access log.
- [x] Footer Close and header ✕ both close and return focus to the row's View button.
- [x] Still logged-before-shown (`openHealthRecord`), unchanged.

## Test Plan

- [x] `NamedLeader_SheetShowsFamilyNoteFirst_WhenNotePresent()`
- [x] `NamedLeader_SheetHidesFamilyNote_WhenNoNote()`
- [x] `NamedLeader_ContactsShowTelAndMailto_NoTextLink()`
- [x] `NamedLeader_MissingRequiredForm_ShowsEmailReminderAndUploadForFamily()`
- [x] `NamedLeader_CanEmailReminder_ForOnePerson_RecordsSentAtAndRecipient()`
- [x] `NamedLeader_ReminderCard_ShowsLastSent_AfterReload()`
- [x] `Immunization_NotNeeded_ReadsNotNeeded_NeverRed()`
- [x] `Immunization_IncludedInBsaForm_ReadsInBsaForm()`
- [x] `NamedLeader_CanUndoReview_ReturnsToNotReviewed_LogsUndo()`
- [x] `NamedLeader_CanMarkReviewedAgain_AfterUndo()`
- [x] `Sheet_FooterCloseAndX_ReturnFocusToOpener()`
- [x] `GoodUntil_DefaultsToOneYearFromEntry_PerDocument()`
- [x] `GoodUntil_PartsAandBShareOneDate_PartCAndInsuranceHaveTheirOwn()`
- [x] `GoodUntil_CanBeEdited_ByFamilyAndNamedLeader()`
- [x] `InBsaForm_ClearsWhenPartsAandBChange()`
- [x] `Review_And_Undo_AppearInTheFamilysHistory()`
- [x] `Reminder_NoTrip_NamesWhatIsMissing_OneEmailPerFamily()`
- [x] `TripReminder_RecordsLastSent()`
- [x] `NonViewer_CannotRemindUploadReviewOrSetInBsaForm()`

## Technical Approach

- **Container.** Keep `AdminDrawer` / `use-drawer-dialog` behaviour (showModal, focus return, scroll lock, `?person=`,
  Esc / backdrop / Back). Add a `wide` variant (860px, centred dialog rather than right-edge sheet) — or decide to keep
  it right-anchored at 860px; see Q1. Update the styleguide specimen.
- **Layout.** A `flex-wrap: wrap` row: left pane `flex: 0 0 300px`, forms pane `flex: 999 1 480px; min-width: 0`,
  so it stacks on narrow screens. Forms pane is an `admin-form-bg` grid, `repeat(2, minmax(0, 1fr))`; a missing
  required card gets `grid-column: 1 / -1`.
- **Tokens only** from the leader-workspace palette (`admin-*`); Badges for every status; no new colours.
- **Single-person reminder.** Reuse the generalized `buildHealthReminders({ personIds: [id], … })` and
  `healthReminderEmail` from Admin-Health-Forms phase 4. Needs "last notice sent" storage (parked in that plan) — this
  plan un-parks it: store `{ person_id, sent_at, sent_by, recipients }` and show the latest on the card.
- **Immunization state.** One per-person In BSA form flag (decision 16). `kindStatus` for immunization reads it; `HealthMark` in the list shows `—` for not needed and `✓ BSA`
  (or `✓`) for in BSA form.
- **Review undo log.** `setHealthReviewed(off)` writes a `review` or `unreview` line to the access log (the action CHECK
  needs both values — migration). The footer reads the latest review / unreview line for "by <name> on <date>".
- **Contacts.** Read the family's adult contacts with email; skip an email link when none is on file.

## Implementation Steps

1. Migration: access-log actions `review` and `unreview`; `health_reminders_sent` table; per-person In BSA form flag.
2. Store: `setHealthReviewed` logs both directions; `recordReminderSent` / `lastReminderFor`; immunization source
   read/write; tests.
3. `AdminDrawer` wide variant and specimen.
4. Rebuild the sheet markup: header, left pane (note, contacts), forms pane (cards), footer (review state, Close).
5. Wire Email reminder (single person) and Upload for family on missing cards.
6. Immunization states in the sheet and the list's `HealthMark`.
7. Responsive stacking, accessibility pass (labels, focus order, 44px targets where touch).
8. Full gate (lint, typecheck, tests, build); qa-lead review (writes + access); Jenna reviews the built screen.

## Open Questions

- [x] **Q1.** Centred 860px dialog, or keep it anchored to the right edge at 860px (list partly visible behind)?
- [x] **Q2.** Who sets "Immunizations are in the BSA form"? Options: the family ticks it when uploading Parts A and B;
      a named leader sets it in the sheet; or both. Is "Not needed" a troop-wide default, or per person?
- [x] **Q3.** `Admin-Health-Forms.md` disables Mark complete while a required file is missing or expired (with visible
      text). Keep that rule in this design? (The mockup shows Mark reviewed enabled on a record with Parts A and B
      missing.)
- [x] **Q4.** Wording: this design says **Mark reviewed / Reviewed**; the earlier plan says **Mark complete**. Pick one
      and use it in the sheet, the list Status and the family's view.
- [x] **Q5.** Email reminder goes to all of the family's adults with email, or only the primary contact?

## As built (2026-11-16)

- The ⋯ menu on each card became one quiet **Change…** (or **Upload…** when nothing is on file) in the card's action
  row: a native select rendered as a wide dropdown and crowded the cards. It opens replace / remove / add pages and the
  Good until date in place; **Done** closes it.
- An expired required form keeps its View / Download on the red card. A Good until field starts at the document's
  date while it is good, else a year from today (`goodUntilSeed`), so replacing a run-out form doesn't keep the old date.
- Editing Good until clears the review, like any change to the documents.
- With no email on file, the red card says "No email on file for this family. Call them instead." and has no Email
  reminder button. An adult with no parent on file is their own contact.
- Not built: a throttle on Email again (qa-lead S2), a shared busy flag across cards (tech-lead 11). Low risk at
  troop scale; revisit if a double send is reported.

## Notes

- Supersedes the "Record sheet (View)" sketch and "Who to call" line in `Plans/Admin-Health-Forms.md`; everything
  else in that plan (gate, list, bulk actions, logging, Remove all) is unchanged.
- The yellow note box, two-pane split and full-width missing card came from design review; the readiness summary
  was explicitly rejected as redundant.
- Mockup data is fictional; build with real records only behind the existing health gate.
