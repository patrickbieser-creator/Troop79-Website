# Verified Signup — event signup requires a signed-in family

**Status:** Active
**Created:** 2026-08-26
**Priority:** High
**Decision:** Patrick, 2026-08-26 — "the time has come to move family security to the next level."
Risks 1–8 in the Notes were reviewed and accepted.

## Overview

Event signup stops accepting the shared troop password as sufficient authority to sign a
family up. The password stays as **first base** (it still opens the event page and the sign-in
screen); **second base is a verified identity** — an emailed link/code or a passkey — and only a
verified adult session (or a leader) may pick a household and write a signup. Leaders keep
every admin path (roster Add / Edit / job claims on a family's behalf) as the escape hatch.

Phase B adds the scout-initiated request: a signed-in scout on an event that needs adult
authorization asks, the household's adults get an email, and a parent's verified session is
the authorization.

## Problem / Opportunity

Today anyone who knows the troop password (it is printed in the Bugle) can open `/events/[id]/signup`,
type any family's name and sign that family up, cancel their signup, or claim jobs in their
name — with no record of who did it. Found live by Patrick 2026-08-26 after signing out to test.
This was Tier 1 by design (D-027: "Tier 1 stays exactly as it is") with the verified path
deliberately optional; the verified flow is now proven (5 people, 3 passkeys, Resend live), all
25 active-scout households have an adult email on file, and **no real signups have happened yet**
— so the switch costs nothing in migration and the security gain is total.

## Acceptance Criteria

Phase A — verified signup (ship first, in one release):

- [ ] `/events/[id]/signup` with only the family-password cookie shows the **"Sign in to sign up"**
      panel (no household picker, no form): what to expect (code by email, ~1 minute), a primary
      button to `/signin?next=/events/[id]/signup`, and the trouble line.
- [ ] A verified **adult** session lands back on the signup page with the picker pre-selected to
      their own household; **Change household** remains available (carpool / guardian case) and
      every write still records `entered_by_person_id` / `updated_by_person_id`.
- [ ] A verified **scout** session sees "Ask a parent to sign in" (no form, no picker).
- [ ] A leader session behaves exactly as today.
- [ ] `submitSignupAction`, `cancelSignupAction`, `claimSlot`/`unclaimSlot` (every Server Action
      that writes signup data) **reject** a request whose audience is `'family'` — server-side, not
      just hidden UI.
- [ ] Reading the event page (`/events/[id]`) and the sign-in screen still only need the troop
      password (first base unchanged).
- [ ] The status bar on the signup form says **who is signed in** ("Signed in as Dana Bieser —
      signing up the Bieser household · Change household · Sign out") on both the person-first
      and slot-first forms, one bar, top of the form.
- [ ] Sign-in screen and the "Sign in to sign up" panel carry **"Trouble signing in? Text Patrick — or email {troopEmail()}."** No phone number on the
      site, and no title (Mindy is the Scoutmaster) — Patrick, 2026-08-26.
- [ ] After a successful email/code sign-in that was started from a signup page, the signup page
      offers **once** (dismissable, remembered in localStorage): "Next time, sign in with your
      phone, fingerprint, or face — no code to type." → the existing passkey registration.
- [ ] Roster › adult › **"Send sign-in link"** action: a leader emails a fresh magic link to that
      adult's `primary_email` (reuses `requestChallengeForPerson`, same rate limits, logged to
      `login_events` as `method: 'leader_link'` on redemption). Disabled with a reason when the
      adult has no email.
- [ ] **No "send to any address" tool** (Patrick, 2026-08-26, rescinding the Utilities idea): a
      sign-in link goes only to an address already on the roster — the roster is the prerequisite
      and the only place the action lives. A second parent's address is added to the roster first
      (adult Edit), then the link is sent. `login_tokens` still records `origin = 'leader'` and
      `sent_by_person_id` so Recent Logins can show "link sent by Patrick for Dana Bieser".
- [ ] Copy: the gate lede no longer says "No account, no email"; `docs/training/*` family script
      and the leader/admin script describe the new flow; a Bugle notice draft is written to
      `docs/bugle/verified-signup-notice.md`.
- [ ] Quality gate green; qa-lead review (security-relevant) VERDICT ≠ BLOCK before push.

Phase B — scout request, parent authorizes (after one signup cycle on Phase A):

- [ ] Builder › Settings: **"Needs a parent to sign up"** toggle per signup; default ON for
      Campout / Outing kinds, OFF for Troop Meeting.
- [ ] A verified scout on a needs-parent signup sees "Ask a parent to sign me up". **The screen
      tells the scout exactly what will happen before they press it:** which adults will be
      emailed (by name), what the email says, and that a parent has to sign in to confirm. → creates a
      `signup_requests` row (scout_person_id, signup_id, note, created_at, resolved_at) and emails
      the household's adults: "Ben asked to go to the Fall Campout — sign in to confirm" with a
      `next=` link straight to the signup page.
- [ ] A parent completing the signup resolves the request (any write by a verified adult of that
      household on that signup marks it resolved). Roster tab shows open requests as a muted row
      ("asked by Ben, waiting on a parent").
- [ ] **Cancelling needs a parent too.** A verified scout cannot cancel a needs-parent signup; the
      form says so up front ("Your parent signed you up — ask them if you need to cancel") with
      an "Ask a parent to cancel" button that emails the adults the same way. Rationale (Patrick):
      first-year scouts get anxious before a first campout and would cancel if they could.
- [ ] On a needs-parent = OFF signup (meeting-night activities, future), a verified scout may sign
      themselves up — subject to Phase B's own qa review.

## Test Plan

Phase A (db + dom + source-property, following D-049's cookie boundary):

- [ ] `SignupPage_ShowsSignInPanel_WhenAudienceIsFamily()` — dom: page body with `audience='family'`
      renders the Sign-in panel and no `HouseholdPicker`.
- [ ] `SignupPage_PreselectsOwnHousehold_WhenVerifiedAdult()` — existing
      `event-signup-leader-prefill.test.ts` extended: adult identity → picker preselected, Change
      household present.
- [ ] `SignupPage_AsksForAParent_WhenVerifiedScout()` — dom.
- [ ] `SubmitSignup_Rejects_WhenAudienceIsFamily()` — source-property: every exported write action
      in `events/[id]/actions.ts` calls `requireVerifiedSignupAccess()` (the new guard), and that
      guard throws on `'family'`. (Direct call needs a cookie; assert the guard's logic with the
      audience injected, and the call sites by source.)
- [ ] `RequireVerifiedSignupAccess_AllowsLeaderAndAdult_RejectsFamilyAndScout()` — unit on the
      guard with `gateAudience` injectable.
- [ ] `EventPage_StillOpensWithTroopPassword()` — existing family-gate tests keep passing unchanged.
- [ ] `StatusBar_NamesTheSignedInPerson_OnBothForms()` — dom, person-first and slot-first.
- [ ] `PasskeyOffer_ShowsOnce_AfterCodeSignInFromSignup()` — dom with localStorage.
- [ ] `SendSignInLink_EmailsTheAdultsAddress_AndIsRateLimited()` — db: calls the action's inner
      function with an injected transport (the `EMAIL_LIVE_TESTS` guard keeps Resend out).
- [ ] `SendSignInLink_DisabledWithReason_WhenNoEmail()` — dom.
- [ ] `SendSignInLink_LogsTheSender()` — db: `login_tokens` row carries origin + sent_by_person_id.
- [ ] `SendSignInLink_OnlyEverUsesTheRosterAddress()` — source-property: the action takes a person
      id, never an address from the form.
- [ ] `TroubleLine_HasNoPhoneNumber()` — source-property on the two copy sites (guards the
      no-number decision).
- [ ] Tests never send mail (D-243) — unchanged.

Phase B: `ScoutRequest_EmailsHouseholdAdults()`, `ScoutRequestScreen_NamesTheAdultsItWillEmail()`,
`ParentSignup_ResolvesOpenRequest()`, `NeedsParentDefault_OnForCampoutOffForMeeting()`,
`ScoutSelfSignup_AllowedOnlyWhenNeedsParentOff()`, `ScoutCancel_Rejected_OnNeedsParentSignup()`.

## Technical Approach

- **One new guard, `requireVerifiedSignupAccess()`** in `lib/family-access.ts`: leader/scout-role
  legacy sessions → pass (as today); `'household'` → pass only when `subjectKind === 'adult'` and
  epoch current (reuse `requireHouseholdIdentity`); `'family'` and verified-scout → throw. Every
  write action in `events/[id]/actions.ts` swaps `requireFamilyAccess()` for it. `hasFamilyAccess()`
  / `gateAudience()` are untouched — they still gate reading.
- **Page branching** in `events/[id]/signup/page.tsx` on `gateAudience()` + `getIdentitySessionIfValid()`:
  `null` → password gate (unchanged); `'family'` → Sign-in panel; `'household'`+scout → parent
  panel; `'household'`+adult / leader → today's picker/form with the adult's household preselected
  (the prefill already exists for leaders — generalize it).
- **`/signin` keeps its own troop-password gate** (9793c61) — first base. `next` is already
  supported and `safeInternalPath`-checked.
- **Send sign-in link** = a Server Action on the roster's adult row calling
  `requestChallengeForPerson(person_id, { ip, requestedBy })` with a new `origin: 'leader'` field on
  `login_tokens` (additive column, DB-first deploy) so the login_events row can say `leader_link`.
  Capability: `roster.manage` (whatever guards the adult Edit today).
- **Status bar**: one component, `signup-status-bar.tsx`, replacing the two hand-rolled bars;
  props: person label, household label, `onChangeHousehold`, sign-out form.
- **Passkey offer**: reuse `passkey-manager`'s registration pieces; the offer renders when
  `login_events.is_first_login`-equivalent is signalled via `?welcome=1` on the `next` redirect
  (set by `verifyCodeForPersonAction` when `next` points under `/events/`) and no passkey exists.
- **No schema change for Phase A** except the additive `login_tokens.origin`. Phase B adds
  `signup_requests` and `event_signups.needs_parent`.
- Deploy order: DB-first for the additive column, then code. Nothing to backfill.

## Implementation Steps

Phase A (one day):

1. Guard + tests (`family-access.ts`, `family-access.test.ts`) — red → green.
2. Write actions onto the guard; source-property test.
3. Signup page branching + Sign-in panel + parent panel + adult preselect; dom tests.
4. Status bar component on both forms; dom test.
5. Trouble line on `/signin` and the panel; source-property test.
6. Passkey offer after code sign-in from a signup page.
7. Migration `login_tokens.origin` + `sent_by_person_id`; roster-row "Send sign-in link" action +
   button; Recent Logins line; tests.
8. Copy: gate lede, `docs/training/*`, `docs/bugle/verified-signup-notice.md`.
9. Styleguide: status bar + Sign-in panel specimens (public guide).
10. Gate → qa-lead review → changelog → push → `db push` → Patrick tests signed-out, as an adult,
    as a scout (mint a scout session locally), as a leader.
11. Patrick sends the Bugle notice + reminders until every household has signed in once (query:
    households with ≥1 successful `login_events` row — add it to the Recent Logins dashboard as
    "N of 25 households have signed in").

Phase B: separate plan section activation after the first real signup cycle.

## Open Questions

- [x] Phone number on the site? **No** — "Text Patrick" without a number; families have it.
- [x] Roll-out window? **Now** — no signups exist yet; committee members are the only users.
- [x] Scouts and passkeys? **Stay adults-only** (D-119, shared-Chromebook risk); scouts use the
      30-day code session for proof submission only.
- [x] Phase B: a needs-parent signup requires a parent to cancel too. **Yes** (Patrick, 2026-08-26).

## Notes

**Risks reviewed and accepted by Patrick, 2026-08-26:**
1. First-time wall at deadline time → mitigated by the Bugle notice + reminders until all 25 have
   signed in once; 120-day adult sessions make it ~3 times a year after that.
2. Wrong/stale email on file → Patrick is 99% sure the roster addresses are current (same list
   delivers the Bugle); reminder asks families to add the second parent's email on `/profile`;
   leader "Send sign-in link" is the ten-second fix.
3. Shared devices / wrong session → status bar always names who is signed in; scout sessions get
   "ask a parent".
4. Guardians not on the household → phone call to a leader first; leaders' admin paths are the
   escape hatch and don't change.
5. Leaders signing up on a family's behalf → already covered by roster Add / Edit / job claims.
6. Email deliverability is load-bearing → trouble line + leader escape hatch; encourage passkeys.
7. Scouts signing themselves up → Phase B makes a parent the authorization for campouts/outings;
   the parent-facing confirmation email (live) is the safety net either way.
8. Copy and training scripts describe the old flow → rewritten in the same release.

**Passkey adoption** — say "sign in with your fingerprint / face", offer it right after a
successful code sign-in, make it obviously optional and reversible. Expect 30–40%.

Related: D-027 (Tier 1 design, now superseded for signup writes), D-119 (passkeys adults-only),
D-124 (UV required), `Plans/Family-Identity-Auth.md` Phase 3 (send sign-in link — delivered here).
