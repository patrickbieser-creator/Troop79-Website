# Scout/Family Self-Service Demographics (Review-Approval)

**Status:** Shipped — v1.16.0, 2026-07-21 (see D-055)
**Priority:** Medium

## Overview

Let a family update their own scout's demographic info from the public side — address, phone,
email, school, grade, swim classification, birthdate, and "Things We Should Know" (D-054) — without
a leader manually transcribing it in the admin Scout editor. Every submitted change lands in a
pending-review queue and only takes effect once a leader approves it; nothing a family submits
touches the live record directly.

Reached from a new **"Profile"** link in the public site's utility bar (`site-nav.tsx`) — the
generic "manage your own account info" entry point familiar from other sites, deliberately separate
from Event Signup's household picker (see Technical Approach). It's the natural home for "other
future considerations" beyond this plan's scope — family-level preferences, notification settings,
whatever comes next — not a one-off bolted onto the signup flow.

## Problem / Opportunity

Today, every demographic field on a scout record (`scouts` table, edited via
`scout-form.tsx`) is leader-entered only. Families have no way to correct their own
address/phone/school when it changes, so the admin data quietly drifts stale between roster
imports. The same is true of the new "Things We Should Know" field (D-054) — its entire value is
being current and quickly accessible on a campout, which a leader-only entry path doesn't achieve.

## Acceptance Criteria

- [ ] A "Profile" link appears in the public site's utility bar (`site-nav.tsx`, alongside "Members
      Login"), leading to a standalone `/profile` flow — not a step bolted onto Event Signup's
      household picker, even though it uses the same `FAMILY_PASSWORD` gate underneath.
- [ ] A family, authenticated via `FAMILY_PASSWORD`, can submit a proposed update to any of the
      fields listed below for a scout in their own household.
- [ ] Submitted changes are stored as a pending request and have **zero effect** on the live
      `scouts` row, any public page, or any other family/scout-facing view until approved.
- [ ] Submission is silent — no persistent "pending" status view for the family. A simple
      on-submit confirmation is sufficient; nothing further is surfaced to them until/unless a
      leader acts on it.
- [ ] If a scout already has a pending request, submitting another shows an in-UI warning before
      the family confirms ("An update is already awaiting review — submitting this will replace
      it") and, once confirmed, the new submission overwrites the old one rather than queuing
      a second request.
- [ ] Every submission sends an email to the troop account (`bsatroop79bg@gmail.com`, via the
      existing Resend integration in `lib/email.ts`) — this is the leader notification; there is
      no separate in-admin count badge to build.
- [ ] Landing on `/profile` immediately shows login state: not logged in (password gate), logged in
      but no household picked yet ("find yourself" step), or logged in as a specific household
      ("Logged in as {name} · {household} household" banner).
- [ ] A "Log out" control is always visible once logged in. Logging out clears the session
      entirely — the next visit (or a re-entered household from the same visitor) starts back at
      the password gate, so a shared device can be handed to a different family.
- [ ] A leader can review a side-by-side diff (current value vs. proposed value) per field and
      Approve (applies the change to the live record) or Reject (with an optional reason) from
      inside the existing Scout editor.
- [ ] The pending-request table has RLS enabled from day one, service-role only, no anon policy —
      learned from D-051 (RLS gap shipped on 9 people-spine tables).
- [ ] "Things We Should Know" is submittable through this flow, per D-054 — NOT leader-entry-only.

## Test Plan

- [ ] `Family_CanSubmitChangeRequest_WhenEditingOwnHouseholdScout()` — a family authenticated via
      FAMILY_PASSWORD, having picked their own household, can submit a proposed field change for a
      scout in that household.
- [ ] `Family_CannotSubmitChangeRequest_ForScoutOutsideTheirHousehold()` — submitting a
      `entity_id` for a scout not in the picked household is rejected server-side (not just hidden
      in the UI) — mirrors D-027's accepted-risk mitigation, not a new gap.
- [ ] `PendingChange_HasNoEffect_UntilApproved()` — after submission, the live `scouts` row, the
      Scout editor's non-pending fields, and every public page render unchanged.
- [ ] `Leader_CanApprovePendingChange_AndItAppliesToLiveRecord()` — approving a `change_requests`
      row updates the corresponding `scouts` column and marks the request `approved` with
      `reviewed_by`/`reviewed_at` set.
- [ ] `Leader_CanRejectPendingChange_AndLiveRecordStaysUnchanged()` — rejecting leaves the live
      record untouched and records the rejection reason.
- [ ] `SecondSubmission_OverwritesFirstPendingRequest_ForSameScout()` — submitting a second change
      request while one is still pending replaces it (single row updated, not a second row
      inserted) rather than queuing both.
- [ ] `Family_SeesOverwriteWarning_WhenPendingRequestAlreadyExists()` — the submit UI surfaces the
      "will replace the existing pending update" warning before the second submission is confirmed.
- [ ] `Submission_SendsEmailToTroopAccount()` — a successful `submitChangeRequest` call triggers an
      email to `bsatroop79bg@gmail.com` via `lib/email.ts`; unconfigured email (no `RESEND_API_KEY`)
      is a no-op, not a failure, matching that module's existing behavior.
- [ ] `AnonKey_CannotReadOrWrite_ChangeRequestsTable()` — direct anon-key REST call against
      `change_requests` returns `[]`/403, matching the D-051 verification pattern.
- [ ] `ProfilePage_ShowsPasswordGate_WhenNoFamilySession()` — visiting `/profile` with neither
      cookie present renders the password gate, not the picker or editor.
- [ ] `ProfilePage_ShowsHouseholdPicker_WhenFamilySessionButNoHouseholdBinding()` — a valid family
      cookie with no household-binding cookie renders the "find yourself" step.
- [ ] `ProfilePage_ShowsLoggedInBanner_WhenHouseholdBound()` — both cookies valid renders "Logged in
      as {name} · {household} household" and the editing UI, not the picker.
- [ ] `LogOut_ClearsBothCookies_AndReturnsToPasswordGate()` — clicking Log out invalidates the
      family session and the household binding together, not just one.

## Technical Approach

**Identity/access — reuse the auth, not the flow.** `FAMILY_PASSWORD` (D-027) is the existing
precedent for "a family identifies themselves without individual accounts" and this plan reuses
that gate — but not Event Signup's household-picker *page*. Profile is its own standalone surface
(`/profile`, reached from the utility bar), because it's a different kind of task than "RSVP to
this specific event": it's the general "manage your account" destination a visitor expects to find
on any site, and the natural home for whatever gets added here later (family notification
preferences, etc.) that has nothing to do with event signup. It still needs its own lightweight
"which household is mine" step after the password gate — that's a smaller, local version of the
same picker component Event Signup uses, not a redirect into that flow.

D-027's accepted risk — the shared password doesn't bind a session to one household, so any holder
could in principle submit for another family — was accepted specifically because Event Signup
writes take effect immediately. Here they don't: the leader review gate is a second, independent
safety net that catches exactly this risk before it can do anything (a leader sees "Smith household
submitted a change to Jones's scout" before it applies). Per-scout magic links stay deferred to
Phase 4 (D-005), same as they are everywhere else in this app; this plan is one more data point for
when that phase gets prioritized, not a reason to build it now.

**Session identity — a second, Profile-scoped cookie, not a change to the audited family session.**
`lib/family-session.ts`'s `FamilySession` is deliberately documented as proof-of-password only
("Do not treat this cookie as identity") and Event Signup relies on that exact contract via its
URL-param-carried household selection (`household-picker.tsx`) — this plan doesn't touch either.
Instead, once a visitor picks their household on `/profile`, a **second** signed cookie
(`t79_profile_household`, same `signed-cookie` helper) stores `{ householdKey, displayName, iat }`.
`/profile` then has three states on load, checked in order: no valid `t79_family_session` → show
the password gate; valid family session but no valid household cookie → show the "find yourself"
step; both valid → show "Logged in as {name} · {household} household" plus the editing UI. This is
strictly additive — it doesn't change what the base family cookie proves, doesn't touch Event
Signup, and gives Profile something none of the shared-password surfaces have had before: a
returning visitor who's already identified themselves. "Log out" clears both cookies together, so
the next visitor at that browser starts cold — the explicit ask being "logout and re-enter the
password for a different family," not just re-picking a household under the same session.

**Data model — generic `change_requests`, not a scout-specific staging table.** Mirrors the
`import_batches`/`import_rows` shape (D-045) that already validated this exact
staged/human-accepted/never-auto-merged pattern for a harder version of the same problem (a 125-row
roster import). Shape:

```
change_requests
  id
  entity_type          text        -- 'scout' today; future-proofs beyond scouts
  entity_id             text        -- scouts.id
  submitted_by_person_id bigint     -- FK to people, not a legacy table (D-042 spine)
  submitted_at          timestamptz
  proposed_changes      jsonb       -- { column: new_value, ... } — only changed fields
  status                text        -- 'pending' | 'approved' | 'rejected'
  reviewed_by            text        -- leaders.code
  reviewed_at            timestamptz
  rejection_reason       text
```

A scout-specific staging table would just duplicate this shape the next time another entity
(adults? households?) needs the same review gate.

**Approval UI — fold into the existing Scout editor, don't spawn a new screen.** Matches this
codebase's standing pattern (D-020 folded Tags into Lookups & Admin; D-038 extended the existing
ledger row rather than a new table) of extending an existing screen over creating a parallel one.
A "Pending Update" panel inside `scout-form.tsx` shows the diff and Approve/Reject actions inline
with the rest of the record a leader is already looking at.

**Fields in scope:** address_line1/2, city, state, zip, phone, email, school, grade (stored as
graduation_year per D-014's existing derivation), swim_class, birthdate, and
`things_we_should_know` (D-054). Out of scope: first/last name, patrol, BSA Member ID, active
status, current_rank — these carry either identity or ledger-derived meaning that a family
self-service edit shouldn't touch.

**Overwrite, not queue.** A second submission for a scout that already has a `pending` row updates
that same row (new `proposed_changes`, `submitted_at` bumped) rather than inserting a second one —
"latest submission wins," and a leader never reviews two stale requests for the same scout. The
submit UI checks for an existing pending row first and warns the family before they confirm, since
this is a destructive action from their point of view (their earlier edit is gone, not merged).

**Notification — email, not an admin badge.** Every successful submission sends an email to the
troop account (`bsatroop79bg@gmail.com`) using the existing `lib/email.ts` (Resend, already wired
for Event Signup per D-035) — no new email infrastructure needed, no in-admin unread-count UI to
build or keep in sync. Submission itself is silent on the family's side — a simple confirmation,
no persistent "your request is pending" view — appropriate for a troop this size where a leader
reads the email directly.

## Implementation Steps

1. Migration: `change_requests` table, RLS enabled with zero policies (service-role only, matching
   D-051's pattern), FK `submitted_by_person_id → people(id)`, unique-ish enforcement (partial
   index or app-level check) so a scout has at most one `pending` row at a time — the mechanism
   backing "overwrite, not queue."
2. Server actions: `submitChangeRequest` (family-role gated; validates the submitting household
   actually contains the target scout; upserts over any existing `pending` row for that scout; on
   success, sends the troop-account email via `lib/email.ts`), `approveChangeRequest` /
   `rejectChangeRequest` (leader-role gated).
3. New `t79_profile_household` signed cookie (`{ householdKey, displayName, iat }`) alongside
   `lib/family-session.ts`, set when a household is picked on `/profile`, cleared (together with
   the family session cookie) on Log out.
4. `/profile` route: three-state render (password gate / household picker / logged-in editor +
   banner, see Technical Approach) using `FAMILY_PASSWORD` gate + the new household cookie. Per-
   scout field editing reuses the same field set/validation as `scout-form.tsx` where practical.
   Warn-and-confirm UI when a pending request already exists for that scout.
5. Utility bar: add a "Profile" link next to "Members Login" in `site-nav.tsx`.
6. Admin UI: "Pending Update" panel in `scout-form.tsx` with a diff view and Approve/Reject
   actions — discoverability comes from the email notification, not a separate badge/counter.
7. qa-lead pass before shipping — this is a new family-facing write path touching PII including
   the most sensitive field in the schema (things_we_should_know); treat with the same scrutiny as
   D-051.

## Open Questions

None outstanding — submission visibility, overwrite behavior, and leader notification were all
settled in the 2026-07-21 planning session (see Technical Approach and Acceptance Criteria above).

- [ ] Should the "which household is mine" step on `/profile` be a genuinely separate, smaller
      component from Event Signup's picker, or the same underlying component rendered outside the
      Event Signup page shell? (Leaning separate/smaller — Profile only ever needs "which scout,"
      never the multi-person RSVP context Event Signup's picker carries — but worth a quick look at
      the existing component before deciding, when this plan is activated.)

## Notes

- Prototype: not built yet. If/when this plan is activated, Brad (UX prototyping agent) can produce
  an interactive HTML prototype of the `/profile` submit flow (including the overwrite-warning
  interaction) and the leader-facing diff/approve panel before any code is written — ask for it
  explicitly when picking this up.
- Troop email account: `bsatroop79bg@gmail.com` — already used site-wide (about page, footer,
  join page) and is the send target for the D-035 Resend integration this plan reuses.
- Related decisions: [D-005] (shared-password model, per-user auth deferred to Phase 4), [D-014]/
  [D-054] (demographics field ownership, medical-data supersession), [D-027] (FAMILY_PASSWORD +
  household-picker precedent, accepted-risk model), [D-035] (Resend email integration this plan
  reuses), [D-042]/[D-043] (person spine field ownership split — this plan's fields stay on
  `scouts`, not the spine), [D-045] (staged/human-accepted import pattern this reuses), [D-051]
  (RLS-from-day-one lesson).
- Originated from a 2026-07-21 session that also fixed the Scout editor's Parents/Guardians layout
  bug and added the "Things We Should Know" field itself (D-054) — this plan is the deferred third
  piece of that same request. Entry-point placement (Profile in the utility bar, not the household
  picker), silent submission, overwrite-with-warning, and email notification were refined in a
  follow-up pass the same day.
