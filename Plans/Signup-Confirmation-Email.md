# Signup Confirmation Email

**Status:** Draft — awaiting Patrick's answers to the Open Questions
**Drafted:** 2026-08-25
**Priority:** High

## Overview

When a family submits (or updates) a signup, the app sends a confirmation email. The signup
builder gets a **Confirmation email** block: an on/off switch, up to five leader addresses that
receive a copy of every confirmation, a subject line, and an **Edit message…** dialog where the
leader writes the body using merge fields — `[name]`, `[event]`, `[date]`, and the rest — with a
live preview rendered from the event's own data.

Today nothing is sent on submit. The transport exists (`lib/email.ts` on Resend: per-recipient
sends, a dev relay via `EMAIL_REDIRECT_TO`, `renderEmail` for a plain readable layout) and is
already used by the roster's "email non-responders" and the identity sign-in mail.

## Problem / Opportunity

- Families get no receipt. The only proof a signup "took" is the form's Saved state — nothing
  in their inbox to forward to a spouse or find on event day.
- Leaders running the event (the person collecting money, the driver coordinator) find out who
  signed up only by opening the roster. A copy of each confirmation is the lowest-effort
  "something happened" signal, and five addresses covers a campout's leadership.
- The message has to be the leader's words, per event ("bring the health form", "meet at the
  church lot at 7"), not a one-size template — hence the editable body with merge fields.

## Acceptance Criteria

- [ ] The Signup builder has a **Confirmation email** block, off by default on new signups.
- [ ] The block holds: enabled toggle · up to **five** additional recipient addresses · subject ·
      the body (opened in a dialog via **Edit message…**). Invalid or duplicate addresses are
      refused with a field-level message; a sixth address cannot be added.
- [ ] The dialog shows the merge fields as insert buttons, a textarea, and a live **Preview** that
      renders the message with this event's real data (title, dates, location, deadline) and
      sample people. Save is dirty-gated with Discard, per the Save standard.
- [ ] On a successful family submit (new or edited signup), one email goes to the submitting
      household's address(es) and one copy to each configured leader address — individually,
      never a shared To:. Nothing is sent when the block is off or when email is unconfigured.
- [ ] A send failure never fails the signup; it is logged on the signup and visible to leaders.
- [ ] The rendered email includes the standard roster summary (who's going, jobs claimed) after
      the leader's message, so the leader's body can stay short.
- [ ] Merge fields render from real data; an unknown `[token]` is left as typed (never crashes,
      never leaks HTML); all user content is escaped.
- [ ] The dev relay (`EMAIL_REDIRECT_TO`) applies, so local/dev never mails real families.

## Test Plan

Pure (db project):
- [ ] `RenderConfirmation_ReplacesEveryKnownToken_FromSignupContext()` — `[name]`, `[scouts]`,
      `[event]`, `[date]`, `[time]`, `[location]`, `[deadline]`, `[going]`, `[jobs]`, `[link]`.
- [ ] `RenderConfirmation_LeavesUnknownTokens_AndEscapesHtml()` — `[foo]` survives literally;
      `<script>` in a scout's note is escaped in both html and text.
- [ ] `RenderConfirmation_DateToken_IsARangeForMultiDay_AndOneDayOtherwise()` — via `fmtRange` /
      `fmtDateLong` (Central-pinned, per the date standard).
- [ ] `Recipients_AcceptUpToFive_RejectSixth_InvalidAndDuplicates()` — normalise lower-case + trim.
- [ ] `ConfirmationRecipients_AreHouseholdPlusLeaders_Deduped()` — the household's adults' emails
      + the five, each once; the submitter is never mailed twice.
- [ ] `SendConfirmation_IsSkipped_WhenBlockOff_OrEmailUnconfigured()` — returns `skipped`, no send.
- [ ] `SendConfirmation_Failure_DoesNotThrow_AndIsLogged()` — Resend error → signup still ok,
      `last_confirmation_error` written.
DOM project:
- [ ] `ConfirmationBlock_IsOffByDefault_AndRevealsFieldsWhenOn()`.
- [ ] `ConfirmationBlock_Recipients_ShowFieldError_OnBadEmail_AndCapAtFive()`.
- [ ] `MessageDialog_InsertsTokenAtCursor_AndPreviewUpdatesLive()`.
- [ ] `MessageDialog_SaveIsDirtyGated_DiscardRestoresLastSaved()`.
- [ ] `SubmitAction_SendsAfterRpcSuccess_NeverBefore()` (action test with a stubbed transport).

## Technical Approach

**Data (one migration, additive, DB-first):** columns on `event_signups` — the block is 1:1
with a signup and the builder already edits that row.

| column | type | notes |
|---|---|---|
| `confirm_enabled` | boolean not null default false | the block's switch |
| `confirm_recipients` | text[] not null default '{}' | ≤ 5, checked in the action and by a `check (cardinality(confirm_recipients) <= 5)` |
| `confirm_subject` | text | null → default `Signed up: [event]` |
| `confirm_body` | text | the leader's message with merge fields; null → default template |
| `confirm_last_error` | text | last send failure, cleared on the next success |

Plus a small `signup_confirmation_log` (signup_id, household_id, sent_at, to text[], status,
detail) so the roster can show "confirmation sent 2:14 PM" per household. (Phase 2 if Patrick
wants the first cut lighter — the `last_error` column alone satisfies "visible to leaders".)

**Merge fields** — a pure module `lib/signup-confirmation.ts`:

| token | value |
|---|---|
| `[name]` | the submitting adult's display name (fallback: household label) |
| `[scouts]` | the scouts going, comma-joined (`Avery and Blake` / `Avery, Blake and Casey`) |
| `[event]` | calendar entry title |
| `[date]` | `fmtDateLong` for one day, `fmtRange` for multi-day |
| `[time]` | start–end via the calendar-shared time formatter, blank if none |
| `[location]` | entry location, blank if none |
| `[deadline]` | signup deadline, `fmtDay` |
| `[going]` | "3 going (2 scouts, 1 adult)" for this household |
| `[jobs]` | the household's claimed jobs, or blank |
| `[link]` | absolute URL of the public event page |

`renderConfirmation(template, ctx)` → escaped text; `[unknown]` untouched. The email is
`renderEmail({ heading: subject, intro: body, bullets: rosterSummary, actionUrl: link })` so it
inherits the existing plain layout; the leader's body is the intro paragraph(s) (line breaks →
paragraphs), the household's rows are the bullets.

**Sending** — in `submitSignupAction` after `submit_household_signup` succeeds and the
`updated_by` stamp is written: load the signup's confirm columns; if enabled and
`emailConfigured()`, build the context from the written rows + the household (`loadHouseholdByKey`
is already in hand), resolve recipients = household adults' emails ∪ `confirm_recipients`
(deduped, lower-cased), and `sendEmail({ …, confirm: true })`. Wrap in try/catch: on failure write
`confirm_last_error` and continue to the redirect. Never `await` it before the redirect if it
would slow the family's submit past ~1s — Resend is fast; measure, and fall back to
`after()` (Next's post-response hook) if not. `cancelSignupAction` does **not** email in this cut
(Open Question 3).

**Builder UI** — a new `ConfirmationPanel` in `events/[id]/builder-panels.tsx`, placed after the
Questions block: `FormSection` "Confirmation email" with the toggle; when on: five `RecipientRow`
inputs (type=email, shared field kit, per-field error), Subject input, **Edit message…** Button
opening a shared `Dialog` — textarea + a strip of token Buttons (insert at cursor, the same
`MarkdownEditorHandle.insertAtCursor` pattern the markdown editors use) + live preview pane
(`renderConfirmation` with the event's real logistics and sample people). Save/Discard per the
Save standard; the panel's own Save writes all five columns through a new
`updateConfirmation(signupId, entryId, fields)` action (`calendar.write`) and revalidates the
workbench. Help badge on the block title: what the tokens mean (`help.tsx: signup.confirmation`).

**Roster surface** — `roster-view.tsx` shows a muted "Confirmation: sent 2:14 PM · failed —
retry" per household from the log (Phase 2), and a **Resend confirmation** row action.

**Defaults** — seeded template so the block works the moment it is switched on:

> Subject: `Signed up: [event]`
> Body: `Hi [name] — you're signed up for [event] on [date]. [scouts] going. We'll be at [location]. Reply to this email if anything changes before [deadline].`

## Implementation Steps

1. Migration + `npx supabase db push` (DB-first, additive).
2. `lib/signup-confirmation.ts`: token render, recipient validation, context builder — with the
   pure tests first.
3. `events/actions.ts`: `updateConfirmation` action + `sendSignupConfirmation(signupId,
   householdKey, writtenRows)` (server-only, transport injected for tests).
4. `submitSignupAction`: call the sender after success; log/ignore failures.
5. Builder: `ConfirmationPanel` + `MessageDialog`; help-map entry; styleguide note under Dialogs
   ("message editor with merge fields") if the dialog becomes reusable.
6. Roster: `confirm_last_error` notice; (Phase 2) per-household sent status + Resend.
7. Changelog, AGENTS.md note on the merge-field convention if reused (newsletter is the obvious
   next consumer).

## Open Questions

- [ ] **Who is the primary recipient?** The spec assumes the **family always gets the confirmation**
      when the block is on, and the five addresses are leaders' copies. If the five are meant to
      be the *only* recipients (a notification, not a receipt), the block is simpler and the
      family copy becomes its own toggle.
- [ ] **Edits and cancellations:** send again when a family edits their signup? (Assumed yes —
      subject `Updated: [event]`.) On cancel? (Assumed no in this cut.)
- [ ] **Reply-to:** the troop address (`troopEmail()`), or the first leader address in the list?
- [ ] **Per-household or per-person?** One email per household submit (assumed), not one per scout.
- [ ] **Log table now or Phase 2?** Affects step 1 and the roster's "sent" column.

## Notes

- Transport already handles: per-recipient sends, dev relay, unconfigured no-op, dry-run — reuse
  `sendEmail`/`renderEmail`, don't add a template engine. Merge fields are a 40-line replace.
- The date standard applies (`lib/format-date` only; `[date]` must never be a slash form).
- Signup writes go through `submit_household_signup` (RPC owns guests, revives cancelled rows);
  the sender reads its returned rows — no second read of the form.
- Related: the roster's existing "email non-responders" (`events/actions.ts` ~1636) is the
  pattern for preview-then-send; the confirmation is automatic, so it is the opposite shape —
  hence the log and the per-household Resend as the leader's safety valve.
