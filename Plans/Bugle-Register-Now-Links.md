# Bugle "Register Now" Links — identity-hinted sign-in from the weekly newsletter

**Status:** SHIPPED v1.119.0 (2026-09-06) — code + migration live. Remaining are Patrick's steps
9–10 (one-time EmailOctopus export diff; paste the copied link into the Bugle template and send
one test issue to yourself first). qa-lead implementation review: SHIP_WITH_FIXES 83/100, fixes
applied (route-level tests, admin spacing token, cookie-lifetime reconciliation below).
**Parked:** 2026-09-05
**Priority:** Medium

## Overview

A **Register Now** button in the EmailOctopus Bugle lands a family on the event's signup page.
Warm browsers (live 120-day session or passkey) see the form immediately, as today. Cold
browsers see, inline on the event page, "**Continue as Dana R.?** Email me a code" — one tap
sends the code, six digits, and they are on the form with their household preselected. No
troop password, no name search. The only thing the email carries is the recipient's own
address, merged by EmailOctopus into the link; the site never stores anything in EmailOctopus
and nothing in the email is a credential.

Approach B of the original five (see "Rejected approaches" in Notes for the record).

## Problem / Opportunity

Since Verified Signup (D-245) a signup write needs a verified adult session. From a Bugle link,
a parent without a live session today goes: event page → "Sign in to sign up" → type the troop
password → find your name → "Email me a code" → inbox → type six digits → back to the event.
Four context switches before the decision. Login walls are the documented #1 killer of signup
response (D-027). The hinted path removes the password and the name search, leaving only the
code; passkeys and the 120-day session are how families stop paying even that.

## Decisions (Patrick, 2026-09-05)

| # | Decision | Answer |
|---|---|---|
| — | Credential in EmailOctopus, site-sent invitation, or Bugle on Resend | **None of these.** Addresses already in EmailOctopus are the only integration. |
| — | Who may sign up | **Unchanged.** `verifiedSignupVerdict()` rules hold; scouts stay on the list and get the existing parent handoff (D-246). |
| — | Troop password on the hinted path | **Skipped.** Probing risk accepted; reasonable precautions welcome. |
| B1 | Landing page | **Event page**, sign-in inline in the existing "Sign in to sign up" panel. `/signin` also fixed to bounce a live identity session to `next`. |
| B2 | Scrub the address from the URL | **Yes** — first request moves it into a 10-minute signed cookie and 303s to the clean URL. |
| B3 | Reveal the name on the first screen | **Yes** — "Continue as Dana R.?" |
| B4 | One address → several people | **Show them by name, adults first.** |
| B5 | Live session for a different person than the hint | **Proceed as the session holder.** No new UI. |
| B6 | Passkey ordering | **Reuse `passkeyPlacement()`** — passkey primary when the browser is a known holder. |
| B7 | Precautions | **Per-IP cap on hinted resolves, logged to the failed-logins dashboard; existing send limits unchanged; "code sent" shows the masked address.** |
| B8 | Plus-addressing / redirector | **Restore `+` from space in the local part; test-send one issue first.** |
| B9 | "Not you?" | **Quiet link to ordinary `/signin`.** |
| B10 | List drift | **One-time EmailOctopus export ↔ `person_emails` diff before the first issue. No ongoing sync.** |
| B11 | Authoring convenience | **"Copy Bugle link" on the admin event page.** |
| B12 | Bugle copy | **Patrick handles it.** No doc change. |

## What we build on (verified 2026-09-05)

- Sessions are HMAC cookies (`lib/signed-cookie.ts`); `t79_identity` is `httpOnly`,
  `sameSite: 'lax'` (correct for a click arriving from email — do not tighten to `strict`),
  `secure` in prod, 120d adult / 30d scout. Revocation is `people.session_epoch`.
- `lib/identity-challenge.ts`: `resolveChallengeTarget()` (email → person; first match; active +
  householded only), `requestChallengeForPerson()` (3/person/15min, 10/IP/hour), `maskEmail()`,
  code + link redemption, POST-only redeem, `next_path` via `safeInternalPath()`.
- `/signin` (`signin/page.tsx`, `signin/actions.ts`): password gate → name picker → code form;
  `passkeyPlacement()` + `PASSKEY_HINT_COOKIE`; `setIdentityCookie()` is the single choke point
  that also writes `login_events`. **Does not redirect a valid identity session** (renders the
  picker) — B1 fixes this.
- `events/[id]/signup-panels.tsx`: the "Sign in to sign up" / "Ask a parent to sign in" panels,
  both linking to `/signin?next=`.
- `login_events.method` is `check (method in ('link','code','passkey'))`; `failure_reason` is free
  text. The Recent Logins dashboard has a separate failed-logins list.
- Links must use the canonical `https://www.troop-79.com` host (cookie jar + passkey RP, D-119).
- EmailOctopus rewrites links through its click-tracking redirector; hex/lowercase-safe values
  survive (D-122). The recipient-address merge tag is believed to be `{{EmailAddress}}` — confirm
  in the editor.

## Acceptance Criteria

Hint intake
- [ ] `GET /events/{id}/signup?for=<address>` (and `/signin?for=`) reads the hint, sets a signed
      `httpOnly` `t79_hint` cookie (person candidates + display names, 10-minute maxAge,
      `sameSite: 'lax'`), and 303-redirects to the same URL without `for`. The address never
      reaches the rendered page, `location.search`, or a second request log line.
- [ ] A `+` in the local part that arrived as a space is restored before lookup (`pat troop@` →
      `pat+troop@`); the lookup is otherwise the existing case-insensitive trim.
- [ ] An address that resolves to nobody (unknown, inactive, bounced/unsubscribed, no household)
      sets no hint cookie and lands on today's page unchanged.
- [ ] `Referrer-Policy: strict-origin-when-cross-origin` is set explicitly on the app.

Warm browsers
- [ ] A valid identity or leader session on the event page ignores the hint entirely (B5) and
      renders the form as today.
- [ ] `/signin` with a valid identity session redirects to `safeInternalPath(next, '/member')`
      before rendering anything (fixes the picker-again regression).

Cold browsers — the hinted panel
- [ ] With a hint cookie naming exactly one adult: the signup panel reads "Continue as
      **{name}**?" with one primary button **Email me a code** (posting a Server Action that calls
      `requestChallengeForPerson` with `next` = this event's signup path), a quiet **Not you?**
      link to `/signin?next=`, and the passkey button placed per `passkeyPlacement()` (primary when
      the browser is a known holder, the code button secondary).
- [ ] With a hint cookie naming several people: the panel lists them by name, adults first, one
      button each ("Email {name} a code"), same "Not you?" link.
- [ ] With a hint that resolves only to a scout: the existing "no email / sign in as a parent
      instead" handoff renders (D-246: the code goes only to the chosen parent's own address).
- [ ] After the send, the code screen shows "We emailed a code to **d\*\*\*\*@gmail.com**" and the
      existing code form; redemption is unchanged and lands on `next` with the household
      preselected and the passkey offer once, as today.
- [x] The hint cookie is cleared on redemption (`setIdentityCookie`). It is deliberately KEPT
      through the send: it is what authorises "Send another code" and "send to a different
      address" on the code screen for a visitor who never typed the troop password
      (`requestForPersonAction`), and it expires on its own at 20 minutes — just past a code's
      15. Reconciled with qa-lead's implementation review, 2026-09-06.

Precautions (B7)
- [ ] Hinted resolves are capped per IP (20/hour). Over the cap, the hint is ignored and today's
      page renders — no error, no distinguishable message.
- [ ] Every hinted resolve that finds nobody writes a `login_events` row with `success: false`,
      `method: 'hint'`, `failure_reason: 'hint-unknown'`, IP and UA; the per-IP cap counts those
      rows. The constraint is widened to include `'hint'`; the dashboard's failed list shows them.
- [ ] Send limits (3/person/15min, 10/IP/hour) apply to hinted sends unchanged.

Authoring (B11)
- [ ] Admin event page shows a read-only **Bugle link** field with a Copy button:
      `https://www.troop-79.com/events/{id}/signup?for={{EmailAddress}}` (host from `siteUrl()`).

List drift (B10)
- [ ] One-time: Patrick exports the EmailOctopus list; a throwaway script diffs it against
      deliverable `person_emails` and reports addresses in one place but not the other. Result
      recorded here. No code ships for this.

## Test Plan

Pure helpers (db project)
- [ ] `HintAddress_RestoresPlusFromSpace_InLocalPartOnly()`
- [ ] `HintAddress_NormalisesCaseAndWhitespace()`
- [ ] `HintCandidates_OrdersAdultsBeforeScouts()`
- [ ] `HintCandidates_ExcludesInactiveBouncedAndUnhouseholded()`
- [ ] `HintCookie_RoundTripsThroughSignAndVerify()` and `HintCookie_RejectsWrongRole()` (same
      role-discriminator rule as the other cookies)
- [ ] `HintRateLimit_IgnoresHintOverPerIpCap()`
- [ ] `HintRateLimit_CountsOnlyHintUnknownRows()`
- [ ] `LoginEvents_AcceptsMethodHint()` (constraint)

Panel rendering (dom project)
- [ ] `HintedPanel_RendersContinueAs_ForSingleAdult()`
- [ ] `HintedPanel_RendersNamedChoices_ForSeveralPeople()`
- [ ] `HintedPanel_RendersParentHandoff_ForScoutOnly()`
- [ ] `HintedPanel_PlacesPasskeyPrimary_WhenDeviceKnown()`
- [ ] `HintedPanel_AlwaysOffersNotYou()`
- [ ] `HintedPanel_IsIgnored_WhenSessionAlreadyValid()`

Actions and routes
- [ ] `HintIntake_RedirectsToCleanUrl_AndSetsCookie()`
- [ ] `HintIntake_SetsNoCookie_ForUnknownAddress()`
- [ ] `HintedSend_UsesRequestChallengeForPerson_WithEventNextPath()`
- [ ] `HintedSend_ClearsHintCookie()`
- [ ] `Signin_RedirectsValidIdentitySession_ToNext()`
- [ ] `CodeSentScreen_ShowsMaskedAddress()`
- [ ] Source-level guard: the hinted send is a Server Action (form `action=`), same style as
      the D-120/D-122 generator tests, so it keeps Origin-check CSRF protection.
- [ ] Coverage-guard: the new admin "Copy Bugle link" needs no audit row (read-only) — assert
      the existing audit coverage test still passes.

## Technical Approach

- **New module `lib/signin-hint.ts`** (framework-agnostic): `normaliseHintAddress()`,
  `resolveHintCandidates(supabase, address)` (reuses the lookup in `resolveChallengeTarget`,
  generalised to return all matches — export a shared inner function rather than duplicating),
  `HINT_COOKIE` + sign/verify with `role: 'hint'`, `hintRateLimitExceeded(supabase, ip)`.
- **Intake** is one Server Component-side branch used by both the event signup page and
  `/signin`: if `searchParams.for` is present → resolve → set cookie (or not) → `redirect()` to the
  same path minus `for`. Runs before any render so the address is never in a rendered page.
- **Panel**: `signup-panels.tsx` gains a hinted variant fed by the verified hint cookie; the
  send is a new Server Action in `events/[id]/actions.ts` (or `signin/actions.ts`) wrapping
  `requestChallengeForPerson(personId, { ip, nextPath })` and redirecting to
  `/signin?sent=1&masked=…&next=…` — the existing code-form screen.
- **`/signin` bounce**: at the top of `SignInPage`, `getIdentitySessionIfValid()` → redirect to
  `safeInternalPath(next, '/member')`.
- **Rate limit** is a count over `login_events` (`method='hint'`, `success=false`, `ip=?`,
  `created_at > now()-1h`) — one query, only on hinted requests, visible on the dashboard, no
  new table. Migration: widen the `method` check (additive, DB-first).
- **Referrer-Policy** header in `next.config` headers().
- **Copy Bugle link**: a client component on the admin event page; URL built from `siteUrl()`.
- No schema change beyond the constraint. No new session type. Cookie attributes identical to
  the identity cookie except maxAge.
- Deploy order: constraint migration first, then code.

## Implementation Steps

1. Test stubs above (throwing), committed first.
2. `lib/signin-hint.ts` + unit tests green.
3. Migration widening `login_events.method`; apply to prod DB-first.
4. Intake branch + redirect on the event signup page and `/signin`; `/signin` live-session bounce.
5. Hinted panel variants + send action + masked-address code screen; passkey placement reuse.
6. Referrer-Policy header. Admin "Copy Bugle link".
7. qa-lead review (auth path — security mandate): peek limiter, cookie attributes, CSRF shape,
   enumeration behaviour over the cap.
8. Full quality gate (lint / typecheck / test / build); deploy; verify on production with a real
   test send to Patrick's own address through EmailOctopus (checks the redirector keeps the
   query string and the merge tag name is right).
9. Patrick: one-time EmailOctopus export → diff script → record count here → fix outliers in
   the roster.
10. Patrick updates the Bugle template with the copied link; first live issue.

## Open Questions

None blocking. Two things to confirm during step 8, not before: the exact EmailOctopus merge
tag for the recipient address, and that the click-tracking redirector preserves the query string.

## Notes

- **qa-lead review of the full analysis (2026-09-05):** SOUND_WITH_CHANGES, 79/100; ordering
  endorsed; changes folded in — the hinted peek is a new unauthenticated oracle (→ B7 limiter +
  logging; Patrick accepts the residual name/membership disclosure, B3); Server Action for the
  send (CSRF); the emailed-key scope point is moot now that no key exists.
- **Rejected approaches (for the record):** per-recipient bearer key in an EmailOctopus custom
  field (EmailOctopus becomes a credential store, weekly rotation sync, forwarding = session);
  site-sent Resend "Register Now" invitation with a per-event key (sound, but a second email and
  a key in the inbox); moving the Bugle to Resend (out of proportion). Plain deep link with
  `src=bugle` remains a fine fallback and is what the button is for warm browsers anyway.
- **Load-bearing rules kept:** a GET never mints a session; `sameSite: 'lax'`; links on the
  `www` host; identity resolved at redemption (active + live epoch); a code goes only to the
  chosen person's own address (D-246); household scoping unchanged.
- **Prod data question (B4 sizing, non-blocking):** count addresses shared by more than one
  active person — docker-psql recipe in memory; Docker was down on 2026-09-05.
- Related: D-027, D-119, D-121 (`/member` front door), D-122, D-245, D-246;
  `Plans/Verified-Signup.md` (Phase B still parked, unaffected); memory `verified-signup`,
  `bugle-content-patterns`, `dev-server-leader-login`.
