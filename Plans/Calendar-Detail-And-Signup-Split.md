# Calendar Detail Pages and the Signup Split

**Status:** Planned — steps 1 and 2 of the four-part sequence already shipped (2eb567d)
**Created:** 2026-08-15
**Owner:** Patrick

---

## Overview

Every calendar entry becomes a linkable detail page, reachable from both the list
and month views, and signup moves off that page onto its own permalinked route.
The detail page becomes the informational destination — including the meeting
agenda, which lost its dedicated page in the calendar unification — and signup
becomes a deliberate second step.

Steps 1–2 (URL state for view+month, month-grid symmetry) shipped on 2026-08-15.
This plan covers steps 3 and 4.

---

## Problem / Opportunity

Today only entries with a signup carry a link, and that link goes to a page that
is half description and half form. Three groups want different things from the
same data:

- **The public and prospective families** want to read what the troop does. They
  are the majority of traffic and currently have almost nowhere to land — a
  meeting agenda has no address of its own.
- **Current families** want to commit to an event. Signup is critical but
  infrequent per visit, and burying it inside the detail page makes the page feel
  like paperwork.
- **Anyone sharing a link** — "here's the Court of Honor" — needs a permalink
  that isn't a form.

Splitting them lets each page do one job, and gives the agenda a permalink again.

---

## Acceptance Criteria

1. `Visitor_ReachesDetailPage_FromTheListRow` — the date pill, title and category
   all navigate to `/events/[id]`.
2. `Visitor_ReachesDetailPage_FromAMonthChip` — chips in the month grid navigate
   to the same place.
3. `Visitor_ReturnsToWhereTheyWere_WhenLeavingADetailPage` — the back link
   restores view, month, category and search.
4. `ScreenReader_HearsOneLinkPerRow` — not three; the row exposes a single tab
   stop with the event title as its accessible name.
5. `Family_ReachesSignup_FromTheListWithoutOpeningDetail` — a signup control sits
   on the right of the row, separately clickable from the row link.
6. `Family_SeesTheyAlreadySignedUp_OnTheDetailPage` — with who, before opening
   the form.
7. `Signup_HasItsOwnAddress` — `/events/[id]/signup` loads the form directly and
   survives a bookmark.
8. `Signup_ExplainsItself_WhenClosedOrFull` — a bookmarked signup URL after the
   deadline explains rather than 404s or shows a dead form.
9. `Entry_WithoutSignup_OffersNoSignupControl` — in either view or on the detail
   page.
10. `MeetingAgenda_HasAPermalink` — `/events/[id]` for a meeting renders its
    agenda and can be linked to directly.

---

## Test Plan

**DOM tests** (`tests/*.test.tsx`, the jsdom project added 2026-08-15) are the
right tool for most of this — every criterion above is about what renders and
what is focusable, which the DB suite cannot see.

- `CalendarRow_ExposesOneLink_WithTheEventTitleAsItsName` — guards criterion 4,
  the one most likely to regress silently. Assert exactly one element with
  `role="link"` per row.
- `CalendarRow_SignupControl_IsSeparatelyFocusable_FromTheRowLink` — the nested
  interactive trap. Two tab stops, not one, and not three.
- `CalendarRow_OmitsSignupControl_WhenTheEntryHasNoSignup`
- `BackLink_CarriesViewMonthCategoryAndQuery_FromTheUrlItWasBuiltWith` — pure
  function over search params; unit-testable without rendering.
- `DetailPage_ShowsSignupStatus_WhenTheHouseholdAlreadyResponded`
- `SignupPage_ExplainsClosure_WhenTheDeadlineHasPassed`

**Manual/browser:** the stretched-link overlay is a layering behaviour — verify
by clicking the row's empty space, the title, and the signup control, at desktop
and mobile widths.

**Not tested:** which of the three regions a mouse click lands on. That is the
browser's hit-testing, not ours.

---

## Technical Approach

### Linking (step 3)

**One link, stretched.** A real `<a>` on the title supplies the accessible name;
`::after { position: absolute; inset: 0 }` makes the whole row clickable. The
date pill and category text are then plain text sitting under a transparent
overlay — clickable, not separately focusable. This is what satisfies criteria 1
and 4 at the same time, which three separate `<a>`s cannot.

**The signup control escapes the overlay** with `position: relative; z-index: 1`.
This is the only structural reason the row can be a link at all — nested
interactive elements are invalid HTML and behave unpredictably.

`.item` needs `position: relative` as the containing block. `.itemBody` already
has `min-width: 0`.

**The back link** is built from the search params the visitor arrived with. The
detail page reads them and renders `← Back to calendar`; absent params it says
`← Calendar`. Prefer this over `history.back()`, which breaks on a page opened in
a new tab or reached from a shared link.

### Signup split (step 4)

New route `app/(public)/events/[id]/signup/page.tsx`. It takes the gate
(`gateAudience`, `familyGateConfigured`) and the two forms
(`person-first-form`, `slot-first-form`) that live on the detail page today. The
detail page keeps `loadEventDetail`, `MeetingAgenda` and the description, and
gains a signup **summary** — status plus a CTA — but no form.

`loadPartySignup` is called by both: the detail page to answer "are we already
in?", the signup page to prefill. Same function, no new query shape.

The signup page repeats date, time and location in a header. Not a duplicate of
the detail page — enough that someone filling the form isn't bouncing back to
check what time it starts.

---

## Implementation Steps

1. **Back-link helper** — a pure function turning the current search params into
   a `/events?…` href, with its unit test. Small, and everything else uses it.
2. **List row linking** — stretched link on the title, `position: relative` on
   `.item`, signup control moved to the right of the row with `z-index: 1`.
   Retire the inline "Details & signup →" from the category line.
3. **Month chip linking** — chips become links to `/events/[id]`. Reassess the
   day popover here: once chips link directly, its only remaining job is
   overflow for busy days. Likely reduced, possibly removed.
4. **Detail page: back link + signup summary** — status line ("You're signed up:
   Maya, Patrick") and a CTA that reads *Sign up* or *Change your signup*.
5. **Signup route** — move the forms and the gate to
   `/events/[id]/signup`, add the summary header, handle closed/full/no-signup.
6. **Detail page cleanup** — remove the forms, keep agenda and description.

Steps 1–3 are shippable without 4–6; the detail page just keeps its form in the
meantime. Worth landing separately.

---

## Decisions

- **Anonymous visitors see the signup CTA** (Patrick, 2026-08-15). Same position
  on the right of the row as for a signed-in family. Label it so the sign-in
  isn't a surprise — the click leads to the gate, which is fine; a control that
  silently isn't there reads as a missing feature.

- **The day popover goes when the chips become links.** Its job today is to show
  what an event actually is, because nothing in the month view links anywhere —
  step 3 moves that job to the detail page. Its only other job would be
  overflow, and the data says overflow has never happened: across all 121
  populated days, 118 hold one event and 3 hold two, against a `MAX_CHIPS` of 2.
  The "+N more" branch has never rendered.

  So: delete the popover, and raise `MAX_CHIPS` to 4 in the same change. A cell
  is 96px and typically holds one chip; 4 costs nothing today and removes the
  need for overflow UI at all rather than leaving a dead-end "+1 more" behind.
  Revisit only if a day ever genuinely needs more than four.

  Removing it also retires a lot of incidental machinery — edge-clamping,
  reposition-on-scroll, outside-click and Escape handling, auto-select-today —
  and the "Nothing scheduled this day" panel that currently appears when you
  click an empty cell.

## Open Questions

- **Thin entries.** ~30 "No Troop Meeting" rows will each get a permalink with a
  date and a sentence. Suggest `noindex` on entries whose category behaviour is
  `no_meeting`, so search doesn't index near-empty pages. Not a blocker.
- **Does anything still link to a pre-unification meeting URL?** A grep found
  only `/meeting-plan`, which is a different leader-facing tool. Worth a second
  look before assuming no redirect is needed.
- **Day-cell click target.** With the popover gone, does clicking a day's empty
  space do anything? Options: nothing, or navigate to the list filtered to that
  date. Decide during step 3 — it is a small addition either way.

---

## Notes

The month-grid work (step 2) found two CSS bugs of the same family as the list
description fix: a track that cannot shrink below its content. If a third
appears, it is worth a note in PATTERNS.md rather than a third one-off fix.
