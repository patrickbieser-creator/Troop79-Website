# Signup Confirmation Email

**Status:** Draft — awaiting Patrick's answers to the Open Questions
**Drafted:** 2026-08-25 (rev 5 — resend on edit as an update; scout-only signups cc every parent; strict dedup)
**Priority:** High

## Overview

When a family submits (or updates) a signup, the app sends **two different messages**:

1. **Family confirmation** — the receipt, to **every member of the family who signed up** and
   has an email address (the adults, and any scout with an email on their person record),
   plus the submitting adult: what they signed up for, where and when, what they owe and how
   to pay, echoed back in full.
2. **Leader notification** — to up to **five** leader addresses set on the signup (the "cc"
   list): who just signed up, what they chose, and a link to the roster. A leader panel option,
   **Use the family message**, sends the leaders the family receipt instead of a separate
   leader template.

Both are written from a **reusable template library**: site-wide templates (name · audience ·
subject · body with merge fields), managed under Lookups & Admin, so "Campout confirmation",
"Meeting RSVP receipt", "Fundraiser shift notice" are written once and picked per event. The
signup builder's **Confirmation email** block picks a template for each audience and can
**customize** the copy for this event without touching the library. One **message editor**
dialog (textarea, merge-field insert buttons, live preview from the event's real data) serves
both the library and the per-event customization.

Today nothing is sent on submit. The transport exists (`lib/email.ts` on Resend: per-recipient
sends, a dev relay via `EMAIL_REDIRECT_TO`, `renderEmail` for a plain readable layout) and is
already used by the roster's "email non-responders" and the identity sign-in mail.

## Problem / Opportunity

- Families get no receipt. The only proof a signup "took" is the form's Saved state — nothing
  in their inbox to forward to a spouse or find on event day.
- Leaders running the event (the person collecting money, the driver coordinator) find out who
  signed up only by opening the roster. A short notification per signup is the lowest-effort
  "something happened" signal — and it is a different message from the family's receipt: the
  leader wants the household, the choices and a roster link, not "reply if anything changes".
- The words are the leader's, per event kind, not a one-size template — but the same campout
  wording is wanted every campout. A library, not a per-event rewrite.

## Acceptance Criteria

- [ ] **Template library** under Lookups & Admin → *Email templates*: list, add, edit, retire.
      Each template has a name, an **audience** (Family or Leader), a subject and a body with
      merge fields, edited in the shared message editor with a live preview. A template in use
      by a signup cannot be deleted (retire hides it from pickers; existing signups keep it).
- [ ] The library ships with two seeded templates per audience (see Defaults) so the block
      works the moment it is switched on.
- [ ] The Signup builder has a **Confirmation email** block, off by default. When on it shows two
      sub-panels, **Family** and **Leaders**, each with: a template picker (audience-filtered) ·
      **Customize for this event…** (opens the message editor pre-filled from the template; a
      customized message shows "Customized — Reset to template") · for Leaders only, up to
      **five** recipient addresses (validated, deduped, sixth refused) · a per-audience on/off.
- [ ] The message editor shows the merge fields for that audience as insert buttons, the subject
      and body, and a live **Preview** rendered with this event's real data (title, dates,
      location, deadline, payment instructions) and sample people. Save is dirty-gated with
      Discard, per the Save standard.
- [ ] On a successful family submit (new or edited signup): the **Family** message goes to
      every signed-up member of the household who has an email (adults and scouts alike, no
      age limit) plus the submitting adult; **when only scouts signed up, every parent in the
      household is cc'd** so an adult always sees it. The **Leader** message goes to each
      configured leader address. Every recipient individually, never a shared To:. Nothing is
      sent for an audience that is off, and nothing at all when email is unconfigured.
- [ ] **No duplicates, ever:** addresses are normalised (trim, lower-case) and deduped across
      the whole send — a parent whose address is also on a scout's record, two people sharing
      one family mailbox, a leader who is also a parent on this signup, or the same address
      typed twice in the cc list — each gets ONE email. When one address qualifies for both
      messages it receives the **family** receipt (it is a family member first) unless
      "Use the family message" is on, in which case the point is moot.
- [ ] **Edits resend, marked as an update:** an edited signup sends both messages again with
      `[changed]` = "Updated signup", the subject prefixed "Updated: " when the template's
      subject does not itself use `[changed]`, and a first line in the body noting what changed
      when it can be stated simply (people added/removed, jobs, rides); otherwise "Your signup
      was updated." Cancellations do not send in this cut.
- [ ] The Leaders panel offers **Use the family message**: when on, the leader template picker
      and Customize are hidden and every leader address receives the family receipt (rendered
      for the family audience — leader-only fields stay blank).
- [ ] A send failure never fails the signup; it is logged on the signup and visible to leaders.
- [ ] The family message can echo the whole signup back — going, guests, days, jobs, rides, price
      tiers, amount due, payment instructions, question answers — via `[summary]` or appended
      automatically when the template lacks it. The leader message has the same fields plus the
      household's contact details and a `[roster_link]`.
- [ ] `[location]` and a `[map]` Google Maps link are available to both; the map link is blank
      when the entry has no location.
- [ ] Merge fields render from real data; an unknown `[token]` is left as typed (never crashes,
      never leaks HTML); all user content is escaped.
- [ ] **Reply-To is the first leader address** in the cc list, on both messages (Patrick,
      2026-08-25); when the list is empty, the troop address (`troopEmail()`).
- [ ] The dev relay (`EMAIL_REDIRECT_TO`) applies, so local/dev never mails real families.

## Test Plan

Pure (db project):
- [ ] `RenderMessage_ReplacesEveryKnownToken_ForEachAudience()` — every token in the tables below;
      leader-only tokens render blank in a family template (never leak contact details there).
- [ ] `MapToken_IsAGoogleMapsSearchUrl_FromTheLocation_AndBlankWithout()` — URL-encoded, link in
      HTML, bare URL in text.
- [ ] `AmountDueToken_ComesFromSignupEntryBalances_NotFromPrices()` — overrides and payments
      already applied; "$0.00" when settled.
- [ ] `SummaryToken_OmitsBlankLines_AndIsAppended_WhenTheTemplateLacksIt()` — family audience only.
- [ ] `RenderMessage_LeavesUnknownTokens_AndEscapesHtml()`.
- [ ] `RenderMessage_DateToken_IsARangeForMultiDay_AndOneDayOtherwise()` — `fmtRange` / `fmtDateLong`.
- [ ] `ResolveMessage_UsesTheEventOverride_ElseTheTemplate_ElseTheSeededDefault()`.
- [ ] `Recipients_AcceptUpToFive_RejectSixth_InvalidAndDuplicates()`.
- [ ] `FamilyRecipients_AreEverySignedUpMemberWithAnEmail_PlusTheSubmitter()` — a scout with an
      email gets it; a scout without one is skipped, not an error; a household adult who did NOT
      sign up is not mailed unless they submitted — EXCEPT:
- [ ] `FamilyRecipients_CcEveryParent_WhenOnlyScoutsSignedUp()` — all household adults added.
- [ ] `Recipients_AreDedupedAcrossBothMessages_CaseAndWhitespaceInsensitive()` — a parent's
      address on a scout's record, a shared family mailbox, a leader who is also a parent here,
      the same cc typed twice: one email each; the family receipt wins a tie.
- [ ] `EditedSignup_ResendsBoth_MarkedAsUpdate()` — `[changed]` = "Updated signup", subject gets
      "Updated: " unless it already uses `[changed]`, the change line lists people/jobs/rides diffs.
- [ ] `LeaderUseFamilyMessage_SendsTheFamilyReceipt_ToTheLeaders_WithLeaderTokensBlank()`.
- [ ] `ReplyTo_IsTheFirstLeaderAddress_ElseTheTroopAddress()`.
- [ ] `SendConfirmations_SkipAnAudienceThatIsOff_AndEverythingWhenUnconfigured()`.
- [ ] `SendConfirmations_Failure_DoesNotThrow_AndIsLogged()`.
- [ ] `Template_InUse_CannotBeDeleted_CanBeRetired()`.
DOM project:
- [ ] `TemplateLibrary_ListsByAudience_AddEditRetire()`.
- [ ] `ConfirmationBlock_IsOffByDefault_AndShowsFamilyAndLeaderPanelsWhenOn()`.
- [ ] `ConfirmationBlock_TemplatePicker_IsFilteredByAudience()`.
- [ ] `ConfirmationBlock_Customize_MarksTheMessageCustomized_AndResetRestoresTheTemplate()`.
- [ ] `ConfirmationBlock_LeaderRecipients_ShowFieldError_OnBadEmail_AndCapAtFive()`.
- [ ] `MessageEditor_InsertsTokenAtCursor_AndPreviewUpdatesLive()`.
- [ ] `MessageEditor_SaveIsDirtyGated_DiscardRestoresLastSaved()`.
- [ ] `SubmitAction_SendsBothAudiences_AfterRpcSuccess_NeverBefore()` (stubbed transport).

## Technical Approach

**Data (one migration, additive, DB-first).**

`email_templates` — the library:

| column | type | notes |
|---|---|---|
| `id` | bigserial pk | |
| `name` | text not null unique | "Campout confirmation" |
| `audience` | text not null check in ('family','leader') | which merge fields and which recipients |
| `subject` | text not null | merge fields allowed |
| `body` | text not null | merge fields allowed; line breaks → paragraphs |
| `retired_at` | timestamptz | hidden from pickers; existing references keep working |
| `created_at` / `updated_at` | timestamptz | |

Columns on `event_signups` — the block is 1:1 with a signup:

| column | type | notes |
|---|---|---|
| `confirm_family_enabled` | boolean not null default false | |
| `confirm_family_template_id` | bigint references email_templates | null → seeded default for the audience |
| `confirm_family_subject` / `confirm_family_body` | text | the per-event customization; null → use the template |
| `confirm_leader_enabled` | boolean not null default false | |
| `confirm_leader_template_id` | bigint references email_templates | |
| `confirm_leader_use_family` | boolean not null default false | "Use the family message" — leaders get the family receipt; the leader template/override are ignored while on |
| `confirm_leader_subject` / `confirm_leader_body` | text | |
| `confirm_recipients` | text[] not null default '{}' | the leader list, ≤ 5 (`check (cardinality(confirm_recipients) <= 5)`) |
| `confirm_last_error` | text | last send failure, cleared on the next success |

Resolution order for a message: event override → chosen template → the audience's seeded
default (so a signup with the block on but nothing picked still sends something sensible).

Plus a small `signup_confirmation_log` (signup_id, household_id, audience, sent_at, to text[],
status, detail) so the roster can show "confirmation sent 2:14 PM" per household. (Phase 2 if
Patrick wants the first cut lighter — `confirm_last_error` alone satisfies "visible to leaders".)

**Merge fields** — a pure module `lib/signup-confirmation.ts`. Patrick, 2026-08-25: "any
reasonable field in the form that a family might want echoed back to them" — so the set is
everything the signup knows about this household, grouped. Every field is available to both
audiences except the *Leader only* group, which renders blank in a family template.

*The event*

| token | value |
|---|---|
| `[event]` | calendar entry title |
| `[date]` | `fmtDateLong` for one day, `fmtRange` for multi-day |
| `[time]` | start–end via the calendar-shared time formatter, blank if none |
| `[location]` | the entry's location text as written (there is no separate street-address column — the location field *is* the address when a leader types one) |
| `[map]` | a Google Maps link built from `[location]` — `https://www.google.com/maps/search/?api=1&query=<url-encoded location>`; blank when there is no location. A link in HTML ("Open in Google Maps"), the bare URL in text |
| `[deadline]` | signup deadline, `fmtDay` |
| `[link]` | absolute URL of the public event page |

*The household's signup*

| token | value |
|---|---|
| `[name]` | the submitting adult's display name (fallback: household label) |
| `[scouts]` | the scouts going, comma-joined (`Avery and Blake` / `Avery, Blake and Casey`) |
| `[adults]` | the adults going, same shape |
| `[going]` | "3 going (2 scouts, 1 adult)" for this household; waitlisted people noted ("Casey — waitlist") |
| `[guests]` | named guests / "+2 guests", or blank |
| `[days]` | for multi-day events with per-day pricing, the days each person chose, or blank |
| `[jobs]` | the household's claimed jobs, with dates when a job is off the event's date, or blank |
| `[rides]` | driving out / back and seats offered, or "needs a ride out / back", or blank |
| `[answers]` | the household's answers to the signup's questions, `Question: answer` per line, or blank |
| `[notes]` | their volunteer note / guest note, or blank |
| `[slip]` | "Permission slip required" and/or "AHMR part C required" when the signup says so, else blank |

*Money*

| token | value |
|---|---|
| `[prices]` | the price tiers each person was booked at (`Avery — Scout $45; Dana — Adult $30`), or blank |
| `[amount_due]` | this household's balance from `signup_entry_balances` (owed − paid), "$0.00" when settled |
| `[paid]` | what they have already paid, or blank |
| `[payment]` | `event_signups.payment_instructions` as the leader wrote it (Venmo handle, "checks to…"), or blank |

*Everything at once*

| token | value |
|---|---|
| `[summary]` | the whole echo-back as a bulleted block: going, guests, days, jobs, rides, prices, amount due, answers — every non-blank line above, in that order. For the **family** audience this is also appended after the body when the template does not contain it, so a short leader message still ships with the receipt. For the leader audience it is opt-in |

*Leader only* (blank in a family template)

| token | value |
|---|---|
| `[household]` | the household label ("The Bieser family") |
| `[email]` / `[phone]` | the submitting adult's contact details |
| `[roster_link]` | absolute URL of the event's admin roster (`/admin/calendar/{entryId}?tab=signup&view=roster`) |
| `[headcount]` | the event's running total after this signup ("31 going of 40") |
| `[changed]` | "New signup" or "Updated signup" — available to BOTH audiences (moved out of Leader-only in rev 5) |
| `[changes]` | for an update, the plain-language diff ("Added Blake; dropped the Friday setup job; now driving out with 3 seats"), or "Your signup was updated." when the diff is not simple; blank for a new signup |

`renderMessage(template, ctx, audience)` → escaped text; `[unknown]` untouched. The email is
`renderEmail({ heading: subject, intro: body, bullets: summaryLines, actionUrl })` so it
inherits the existing plain layout; the body's line breaks become paragraphs; the family's
action button is "Open event", the leader's is "Open roster".

**Sending** — in `submitSignupAction` after `submit_household_signup` succeeds and the
`updated_by` stamp is written: `sendSignupConfirmations(signupId, householdKey, writtenRows,
change)` loads the signup's confirm columns + the two resolved messages; builds one context from
the written rows + the household (`loadHouseholdByKey` is already in hand) + the balance; for each
enabled audience resolves recipients — **family:** the email of every person on the written
rows (adults and scouts, via `people.email`) plus the submitting adult, and, when no adult is
among the written rows, every adult in the household (`households` → `people` where
`participant_class` is an adult class); **leaders:** `confirm_recipients`. Then ONE dedup pass
over both lists (trim + lower-case): an address in both goes to the family list only. Renders
(the leader audience renders the family message instead when `confirm_leader_use_family` is on)
and `sendEmail({ …, replyTo: confirm_recipients[0] ?? troopEmail(), confirm: true })` per
audience (`sendEmail` gains an optional `replyTo`; Resend supports it directly). For an **update** the sender diffs the
written rows against the previous rows (the RPC returns the household's current rows; the
previous state is read just before the write) to fill `[changes]` and set `[changed]`. Try/catch per audience:
on failure write `confirm_last_error` and continue to the redirect. Never `await` it before the
redirect if it would slow the family's submit past ~1s — Resend is fast; measure, fall back to
Next's `after()` if not. `cancelSignupAction` does **not** email in this cut (Open Question 2).

**Template library UI** — Lookups & Admin → *Email templates*: the standard lookups editor
shape (list with Add, inline name/audience, **Edit message…** opening the message editor;
Retire instead of Delete when in use). `calendar.write`.

**Builder UI** — `ConfirmationPanel` in `events/[id]/builder-panels.tsx`, after the Questions
block: `FormSection` "Confirmation email" with the master toggle; inside, two `FormSection`s
**Family** and **Leaders** each with its own enabled toggle, template `<select>` (audience-
filtered, retired ones hidden unless selected), a one-line preview of the resolved subject,
**Customize for this event…** (opens the message editor pre-filled; saving writes the
`confirm_*_subject/body` override and marks the panel "Customized" with **Reset to template**),
and for Leaders the five `RecipientRow` inputs (type=email, shared field kit, per-field error)
plus a **Use the family message** checkbox at the top of the panel — when ticked, the leader
template picker, subject preview and Customize collapse away, and a hint says "Leaders receive
exactly what the family receives".
Saves through `updateConfirmation(signupId, entryId, fields)` (`calendar.write`); help badge on
the block title (`help.tsx: signup.confirmation`) explaining template vs. customization.

**Message editor** — one shared client component (`_components/message-editor-dialog.tsx`):
Dialog with subject input, merge-field buttons for the audience (insert at cursor via the
`MarkdownEditorHandle.insertAtCursor` pattern), body textarea, live preview pane
(`renderMessage` with real event logistics + sample people), Save/Discard per the standard.
Used by the library editor and the builder's Customize.

**Roster surface** — `roster-view.tsx` shows a muted "Confirmation: sent 2:14 PM · failed —
retry" per household from the log (Phase 2), and a **Resend confirmation** row action.

**Defaults** — seeded templates (migration), two per audience:

*Family — "Event confirmation"*
> Subject: `Signed up: [event]`
> Body: `Hi [name] — you're signed up for [event] on [date]. We'll be at [location] ([map]). Amount due: [amount_due]. [payment] Reply to this email if anything changes before [deadline].`
> (the `[summary]` block follows automatically)

*Family — "Meeting RSVP"*
> Subject: `See you at [event]`
> Body: `Hi [name] — [scouts] going to [event] on [date] at [time], [location]. [summary]`

*Leader — "New signup"*
> Subject: `[changed]: [household] — [event]`
> Body: `[household] ([email], [phone]) [changed]: [going]. [jobs] [rides] Amount due [amount_due]. [headcount].` + action "Open roster" → `[roster_link]`

*Leader — "Money watch"*
> Subject: `[event]: [household] owes [amount_due]`
> Body: `[household] signed up: [prices]. Paid [paid], owes [amount_due]. [roster_link]`

## Implementation Steps

1. Migration (`email_templates` + seeds, `event_signups` columns) + `npx supabase db push`.
2. `lib/signup-confirmation.ts`: token render per audience, `[summary]`, recipient validation,
   context builder, message resolution — pure tests first.
3. `events/actions.ts`: `updateConfirmation`, `sendSignupConfirmations` (transport injected);
   `lookups/actions.ts`: template CRUD + retire.
4. `submitSignupAction`: call the sender after success; log/ignore failures.
5. `_components/message-editor-dialog.tsx` (shared) + styleguide specimen under Dialogs.
6. Lookups & Admin → Email templates editor (the existing lookups table shape).
7. Builder `ConfirmationPanel` (Family / Leaders sub-panels, pickers, Customize/Reset, recipients);
   help-map entry.
8. Roster: `confirm_last_error` notice; (Phase 2) per-household sent status + Resend.
9. Changelog; AGENTS.md note on the merge-field convention (the newsletter is the obvious next
   consumer of the library and the editor).

## Open Questions

- [ ] **Cancellations:** no email on cancel in this cut (Patrick decided edits only, 2026-08-25);
      revisit when the log/Resend lands.
- [ ] **Log table now or Phase 2?** Affects step 1 and the roster's "sent" column.
- [ ] **Library scope:** signup templates only for now, or make `audience` open-ended so the
      newsletter / non-responder nudges can join later? (Assumed: the enum starts with the two;
      adding a value is a one-line migration.)

## Notes

- Transport already handles: per-recipient sends, dev relay, unconfigured no-op, dry-run — reuse
  `sendEmail`/`renderEmail`, don't add a template engine. Merge fields are a 60-line replace.
- The date standard applies (`lib/format-date` only; `[date]` must never be a slash form).
- Signup writes go through `submit_household_signup` (RPC owns guests, revives cancelled rows);
  the sender reads its returned rows — no second read of the form.
- Leader-only tokens are the privacy line: a family template must never be able to print another
  household's contact details, and the renderer enforces it by audience, not by trust in copy.
- Related: the roster's "email non-responders" (`events/actions.ts` ~1636) is the pattern for
  preview-then-send; the confirmation is automatic, so it is the opposite shape — hence the log
  and the per-household Resend as the leader's safety valve.
