# Family Identity & Passwordless Auth

**Status:** Phase 0 SHIPPED 2026-08-06. Phases 1&ndash;4 ready to implement — no open questions.
**Phase 0 is a live-defect fix; ship it first and separately, ahead of everything else in this plan.**
**Created:** 2026-08-06
**Priority:** High

## Overview

Bind a family session to a **specific person and household** — without adding a password anyone has
to remember. A parent enters their email (or phone), receives a sign-in link *and* a 6-digit code,
and lands in a 120-day session that says "you are Dana R., Reilly household." Everything that today
relies on a self-asserted household pick (`/profile` edits, `/library/submit-proof`, future
health/permission surfaces) gets a real identity behind it; everything that today works fine on the
shared troop password (event signup, gated reading) is left alone.

This is the **Phase 4 fix** that D-005 deferred and D-027 promised — "closed by per-family magic
links in Phase 4" — scoped down: per-family identity now, full Supabase Auth later (or never).
`profile/actions.ts:148` already names it by number while explaining why
`change_requests.submitted_by_person_id` is hard-coded to null today.

## Problem / Opportunity

`lib/family-session.ts` states the gap in its own header comment:

> ACCEPTED RISK (Plans/Event-Signup.md): this proves the bearer knows the troop password — it does
> NOT bind the session to a household, so any holder could edit another family's signup. Accepted
> for a ~25-family trusted troop and mitigated by the entered_by/updated_by audit columns;
> per-family magic links are the Phase 4 fix. Do not treat this cookie as identity.

That risk was accepted for Event Signup, where `entered_by` / `updated_by` audit columns and a
25-family trust circle make it tolerable. It has since been **inherited by three more features that
are not signup**:

1. **`/profile` (D-055)** — proposes changes to a scout's address, phone, birthdate, school, and
   "Things We Should Know" (D-054, medical-adjacent). The household is chosen from a picker; the
   only thing standing between any password-holder and any family's record is the `t79_profile_household`
   cookie, which is *self-asserted by design* (see that module's header). The consequence is written
   into the code: `change_requests.submitted_by_person_id` is a real FK to `people` that is
   **always written as null**, because nothing in the flow knows who submitted.
2. **`/library/submit-proof`** — same picker, scoping which scouts a submitter may claim.
3. **Whatever comes next.** Every new family-facing surface reaches for the same gate because it
   is the only one available, which steadily raises the value of one shared password printed in
   the Bugle.

The troop password is also **un-revocable per family**. A family that leaves, a device that's lost,
a link forwarded to a wider list — the only remedy is rotating the password for all 25 families at
once, which nobody will do because it's disruptive. There is no "who is this" signal in any audit
row on the family side, and no way to answer "when did the Reillys last touch their record."

Meanwhile the raw material for identity already exists and is *good*: `people` is a real spine with
`primary_email` and `primary_phone`, `households` / `household_members` are stored rather than
inferred (D-030 / D-042), `people_email_idx on people (lower(trim(primary_email)))` already indexes
the exact reverse lookup a sign-in needs, `scout_parent_emails` already tracks bounces and unsubscribes, and
Resend is wired with a deliberate no-auto-send policy. There is no data-modeling work left to do —
only the challenge/verify loop and one cookie.

## Decisions (open questions resolved with Patrick 2026-08-06; record as D-073+ on ship)

1. **Roll our own on `signed-cookie.ts`, do NOT adopt Supabase Auth for families.** Supabase Auth
   would mean an `auth.users` row per parent, a second identity space to reconcile against `people`,
   and its built-in mailer is [documented as testing-only and rate-limited to a handful of sends per
   hour](https://supabase.com/docs/guides/auth/auth-smtp) — production requires custom SMTP anyway.
   Every reader/writer in this app already goes through `createAdminClient()` (D-005), so RLS-backed
   per-user policies — the one thing Supabase Auth would genuinely buy — earn nothing today. We
   already own HMAC token signing, a session-cookie pattern used three times (leader, family,
   profile-household), and a transactional mailer.
2. **Email/SMS challenge, not a permanent per-household bearer link.** A printed permanent URL
   (`/f/8Kd2mQx7pL`) is lower-friction still and was seriously considered — see Alternatives — but
   the link *is* the credential forever, and a forwarded email silently leaks a family's record with
   no expiry. Deferred, not discarded: it's the right shape for a future read-only "your family's
   schedule" page.
3. **Send a link AND a 6-digit code in the same message.** One `login_tokens` row, two
   representations. The link is one tap on desktop; the code survives corporate mail scanners that
   prefetch URLs and [burn single-use tokens before the human clicks](https://github.com/better-auth/better-auth/discussions/6985),
   and it survives clients that rewrite links.
4. **Tier 1 stays exactly as it is.** `FAMILY_PASSWORD` keeps gating event signup and gated reading.
   Nobody gets locked out of signing up for a campout because their email bounced. Identity is
   *additive*, layered above the family gate — the same relationship `t79_profile_household` already
   has to it.
5. **Scouts verify, but into a narrower grant (Patrick, 2026-08-06 — option (c)).** A scout's
   verified session unlocks proof submission *as themselves* and nothing else — never demographics,
   never another scout. Bounded enough to be YPT-defensible: minimal message content, no widening by
   navigation, leader review still downstream of everything.
6. **A scout may only ever claim their own work (Patrick, 2026-08-06).** This overrides
   `submit-proof/actions.ts`'s current premise that "the roster picker is a courtesy, not a binding
   proof." It is not a courtesy. Until the system can *prove* which scout is submitting, scouts do
   not submit at all — Phase 0 closes the path rather than narrowing it, and Tier 2-S reopens it on
   a verified basis. No intermediate "mostly right" state.
7. **A narrow, documented exception to `lib/email.ts` design rule #1** ("NOTHING sends
   automatically"). That rule exists so a signup form can't quietly mail 25 families on its first
   test — an un-sendable mistake. A sign-in challenge is the opposite shape: **one** recipient, an
   address already on the roster, triggered by that person's own action, rate-limited, and useless
   to anyone who didn't ask for it. The exception must be written into `email.ts`'s header comment
   at implementation time, not left implicit, and the `confirm: true` dry-run convention still
   applies to every *other* caller.

## Access Tiers (the model this plan establishes)

| Tier | Content | Gate | Cookie |
|---|---|---|---|
| 0 — Public | First name + last initial, rank, calendar, news, library | none | — |
| 1 — Family | Event signup, full roster names, meeting plans, proof submission | `FAMILY_PASSWORD` | `t79_family_session` |
| 2-S — Scout | Proof submission **as themselves**, own library history | verified challenge, `subjectKind: 'scout'` | `t79_identity` |
| 2 — Household | Own scout's address, birthdate, phone, "Things We Should Know", contact edits | verified challenge, `subjectKind: 'adult'` | `t79_identity` |
| 3 — Leader / Scout admin | `/admin/*` | `LEADER_PASSWORD` / `SCOUT_PASSWORD` | `t79_leader_session` |

Both verified tiers imply Tier 1 — a verified identity cookie satisfies `hasFamilyAccess()` without
the troop password, exactly as a leader session does today in `gateAudience()`.

**Tier 2-S is not "Tier 2 for scouts."** It is a separate, smaller grant that happens to use the
same machinery. A scout's verified session proves *which scout* is submitting proof — the whole
point, and the permanent fix for what Phase 0 patches — and unlocks nothing else. Under Tier 2-S
the scout picker does not exist at all: the scout is the session, not a form field. The check is
`subjectKind === 'adult'` on every Tier 2 surface, applied server-side in
`requireHouseholdIdentity()`, so a new page cannot accidentally ship scout-readable by omission.
This is the same defense-in-depth reasoning `proxy.ts` already applies to `SCOUT_ALLOWED_PREFIXES`
("that's exactly how the advancement/* pages leaked before this").

Because a scout challenge means the site sends mail to a minor, scout messages carry the same
minimal content rule as all others — troop name, code, nothing about the scout, their household, or
what they're submitting — and a scout's verified session can never widen itself by navigation.

## Acceptance Criteria

**Phase 0 — close the scout free-pick NOW (do not wait for Phase 1)**

`submit-proof/actions.ts:163-172`: on the scout-login path, the only server-side validation of the
posted `scoutId` is that the scout exists and is `active`. Any holder of `SCOUT_PASSWORD` can
therefore file proof under **any** active scout's name. The module header documents this as
deliberate ("the roster picker is a courtesy, not a binding proof; the leader reviewing the
submission is the actual check on who it's from") and Resource-Library.md decision 4 says the same.
**Patrick has overridden that premise (2026-08-06):** a scout may claim only their own work.

The likeliest failure here is not malice — it's a **misclick**. A dropdown of ~30 names, no
confirmation step, and an approval path that writes to `ledger_entries` means one wrong selection
puts a false advancement record under the wrong scout. Advancement is the troop's system of record
for rank; "the ledger is wrong and nobody noticed" is materially worse than the inconvenience of a
tighter gate.

This is cheap to fix right now because **Phase 2 of the Library shipped 2026-08-06 — today.** There
is effectively no installed base to disrupt.

**DECIDED (Patrick, 2026-08-06): disable the scout path.** Not "narrow it," not "add a confirmation
step," not "make the reviewer check." The scout-login path to proof submission goes away until
Tier 2-S can prove *which* scout is submitting. The rejected alternative was keeping the path and
asking the reviewing leader to confirm the identity claim — rejected because it relocates the hazard
onto someone who has no independent way to verify it, which is the same mistake the current design
already made.

- [x] `submitProofAction` refuses `audience === 'scout'` outright, server-side, with its own error
      code — the same shape as the existing `audience === 'leader'` refusal at
      `submit-proof/actions.ts:139`, which is already precedent for "this gate is not a path here."
      The entire `else` branch at `:163-172` (the bare `active`-only scout lookup) is **deleted**,
      not guarded. A dead branch left behind is a branch someone re-enables.
      **Shipped 2026-08-06** via a testable `proofSubmissionAllowedFor()` gate (`lib/library.ts`),
      not an inline audience check — the regression guard (`ScoutLogin_IsRefused_WhenSubmittingProof`)
      tests the pure function directly.
- [x] The household path is untouched and remains fully working. A scout submits from a
      family-bound device, or a parent submits for them. **Shipped 2026-08-06.**
- [x] **Do not dead-end a scout.** The entry points that link into proof submission (the "I did
      this" affordances, e.g. `library/mb/[mbId]/mb-proof-picker.tsx`) must explain the situation at
      the button — not let a scout fill in a form and get refused at the end. Say what to do
      instead: submit from a family device, or ask a parent. A scout who hits a wall after typing up
      their work is a scout who doesn't come back. **Shipped 2026-08-06** — both the rank
      requirement page and the MB proof picker check `gateAudience()` server-side and swap the
      button for an explanatory note when `audience === 'scout'`, rather than gating only at submit.
- [x] `scout-roster-picker.tsx` is **removed**, not orphaned. Tier 2-S has no picker by design — the
      scout *is* the session — so this component has no future caller. Leaving it in the tree is an
      invitation to re-wire exactly the behavior being removed. **Deleted 2026-08-06.**
- [x] `submitted_via`'s `'scout'` value stays in the schema. No new rows will carry it until
      Tier 2-S, existing rows keep theirs, and Tier 2-S will use it again. Do not migrate it away.
      **Unchanged 2026-08-06** — schema untouched, only the write path was closed.
- [x] `submit-proof/actions.ts`'s header comment and `Resource-Library.md` decision 4 are both
      corrected in the same commit. A stale comment asserting the old trust model is how this
      reappears in six months. **Corrected 2026-08-06.**
- [x] The admin review screen no longer implies attribution it doesn't have. `fromLabel: 'Scout
      login'` reads like "we know who this is"; for the surviving household path it should read as
      the household it actually came from. **Shipped 2026-08-06** — the code path that produced
      `fromLabel: 'Scout login'` no longer exists; `fromLabel` is always the household label now.

**Phase 1 — identity core**

- [ ] `/signin` accepts an email or phone, and responds **identically** whether or not it matches
      the roster ("If that address is on our roster, a code is on its way") — no membership oracle.
- [ ] A matching `people.primary_email` / `scout_parent_emails` address receives one message
      containing both a sign-in link and a 6-digit code, valid 15 minutes, single-use.
- [ ] Redeeming either representation sets `t79_identity` bound to `person_id` + `household_key`,
      120-day max age, `httpOnly` + `sameSite=lax` + `secure` in production.
- [ ] The link's landing page **consumes nothing on GET**. It renders "Continue as Dana R." and
      consumes the token on POST — a scanner prefetch cannot burn it.
- [ ] `gateAudience()` returns a new `'household'` audience for a verified identity cookie, and
      `hasFamilyAccess()` is true for it without `FAMILY_PASSWORD`.
- [ ] Deep link survives the round trip: bounced from `/profile?scout=abc`, you land back there.
- [ ] Rate limits enforced server-side: max 3 challenges per person per 15 min, 10 per IP per hour,
      5 wrong code attempts before that token is dead.
- [ ] Tokens stored as SHA-256 hashes with a server-side pepper — a database dump yields no usable
      credential. Redemption invalidates all other outstanding tokens for that person.
- [ ] `login_tokens` has RLS enabled, zero policies, service-role only (D-051 pattern), from the
      first migration.
- [ ] `next_path` is passed through `safeInternalPath()` (`lib/safe-redirect.ts`) on redemption. A
      redirect target read back out of the database is an open redirect on the app's highest-value
      form; that helper already documents the `/\evil.com` bypass a `startsWith('/')` check misses.
- [ ] With `RESEND_API_KEY` **or** `EMAIL_FROM` unset the flow degrades to leader-issued codes and
      says so — it does not crash. `emailConfigured()` requires both (`email.ts:38`) and
      `sendEmail()` already returns `status: 'skipped'` rather than throwing (`email.ts:60-66`).

**Phase 2 — bind the existing surfaces**

- [ ] `/profile` requires Tier 2. The household picker disappears for a verified visitor — their
      household is resolved from `household_members`, server-side, never from a form field.
- [ ] `change_requests.submitted_by_person_id` is populated from the verified session rather than
      left null, and the admin review panel shows *who* submitted.
- [ ] Submitting a change for a scout outside the verified person's household is rejected
      server-side, preserving the existing check at `profile/actions.ts:108-112` ("That scout is not
      in your household") — which today has **no test coverage at all**. Add it here; D-055 shipped
      without a single `/profile` test.
- [ ] `/library/submit-proof` prefers the verified household when present, falls back to today's
      picker under Tier 1. Under Tier 2-S the scout picker collapses to the verified scout alone.
- [ ] `/profile` refuses a `subjectKind: 'scout'` session with a clear message, not a redirect loop.
- [ ] **Event Signup recognizes a verified visitor and never re-challenges them** — no second
      password prompt, and the household picker arrives pre-selected. See below.
- [ ] Event Signup's *contract* is otherwise untouched: `?household=`, the formData `householdKey`,
      and `submit_household_signup`'s `p_allowed_person_ids` validation (D-064) all stay as they are.
- [ ] `signup_entries` gains `entered_by_person_id` / `updated_by_person_id` (nullable FKs to
      `people`), written when the submitter is verified and left null otherwise. Additive only — the
      existing `entered_by` / `updated_by` text columns keep working for Tier 1 submissions.

### Event Signup pass-through (answers "am I challenged twice?" — no)

A verified session already satisfies the family gate, because `gateAudience()` returns a verified
audience and `hasFamilyAccess()` is true for it — the same path a leader session takes today. So the
password prompt simply does not appear. Three levels of integration were considered:

| | Behavior | Verdict |
|---|---|---|
| (a) Gate only | Skip the password, still show the "find yourself" picker | Leaves obvious friction on the table |
| **(b) Prefill** | **Skip the password, pre-select their household, visible "signing up as the Reilly household · switch" affordance** | **Adopted** |
| (c) Lock | Restrict signup to their own household | Rejected |

(c) is rejected because it is a *capability regression*, not a security win. One parent handling a
carpool, a leader signing up a family who called them, a household covering a friend's scout — all
legitimate today, all broken by locking. D-027's accepted risk (a shared-password holder could edit
another family's signup) is a **mis-signup**: correctable, audited, and low-stakes in a way a
birthdate edit is not. Identity doesn't need to close it; it makes it *attributable*, which is the
better outcome. That's what `entered_by_person_id` is for — "who really did this" stops being a text
label someone typed and becomes a real FK, the same upgrade `entered_by` gave the ledger on the
leader side.

**Phase 3 — leader tooling & hardening**

- [ ] Marking a person or scout inactive on the roster bumps `session_epoch` automatically, via a
      database trigger — verified by updating a row with direct SQL, not through the app.

- [ ] Roster person rows gain a "Send sign-in link" action and a "last verified" timestamp.
- [ ] A leader can mint a one-time code to read aloud or print, for a family with no working email.
- [ ] A leader can revoke a person's sessions (bump `people.session_epoch`) — the practical answer
      to a lost phone, which the shared password cannot give today.
- [ ] `X-Robots-Tag: noindex` on every Tier 1+ route.
- [ ] Audit: confirm the Bunny pull zone serves no youth photos at guessable public URLs, and that
      the private proof-media bucket (2026-08-06 migration) is the only path for images of minors.

## Test Plan

Vitest, integration-style against local Postgres (D-049 pattern). Names follow `Tests/CLAUDE.md`'s
`{Subject}_{ExpectedBehavior}_When{Condition}()` convention — the existing suite is inconsistent
about the `When` clause; this plan is not:

- [ ] `Parent_ReceivesChallenge_WhenEmailMatchesRoster()` — a `login_tokens` row is created and
      exactly one recipient resolved.
- [ ] `Stranger_GetsIdenticalResponse_WhenEmailIsNotOnRoster()` — no row created, response body and
      status byte-identical to the match case.
- [ ] `Token_IsRejected_WhenAlreadyRedeemed()` — and sibling tokens for the same person die with it.
- [ ] `Token_IsNotConsumed_WhenLinkIsFetchedByGet()` — the scanner-prefetch guard; GET leaves
      `consumed_at` null.
- [ ] `Token_IsRejected_WhenOlderThanFifteenMinutes()`
- [ ] `Challenge_IsRefused_WhenFourthRequestArrivesInWindow()`
- [ ] `Code_IsRejected_WhenFiveAttemptsAlreadyFailed()`
- [ ] `IdentitySession_ResolvesHousehold_WhenFormSuppliesAConflictingKey()` — a forged `household`
      field is ignored entirely; membership is read server-side.
- [ ] `VerifiedParent_IsRefused_WhenSubmittingForScoutOutsideOwnHousehold()`
- [ ] `IdentityCookie_SatisfiesFamilyGate_WithoutTroopPassword()`
- [ ] `LeaderSession_CannotVerify_AsIdentityCookie()` — role-discriminator check, the same failure
      `family-session.ts` guards against — after this ships, all four cookie types share one key.
- [ ] `NextPath_IsRejected_WhenItEscapesTheOrigin()` — open-redirect guard on the stored `next_path`.
- [ ] `RevokedPerson_SessionIsRejected_AfterEpochBump()`
- [ ] `SessionEpoch_IsBumped_WhenRosterMarksPersonInactive()` — the trigger fires on a direct SQL
      update, not just through the app.
- [ ] `ScoutSession_IsRefused_WhenReachingProfile()` — Tier 2-S cannot reach Tier 2.
- [ ] `ScoutSession_CanSubmitProof_WhenClaimingOnlyThemselves()` — and is refused for another scout.
- [x] `ScoutLogin_IsRefused_WhenSubmittingProof()` — **Phase 0. Shipped 2026-08-06** in
      `tests/proof-submission-gate.test.ts`, testing `proofSubmissionAllowedFor()` directly rather
      than the Server Action (no cookie-mocking infra exists in this suite, D-049's boundary). The
      scout path is closed entirely, so the assertion is "refused," not "refused for another scout."
      It must keep passing after Tier 2-S ships, at which point a *verified* scout succeeds for
      themselves while a bare `SCOUT_PASSWORD` session still cannot submit at all. Same test, two
      mechanisms — this is the regression guard for the whole thread.
- [ ] `VerifiedFamily_IsNotChallenged_WhenOpeningEventSignup()` — the pass-through; no password
      prompt, household pre-selected.
- [ ] `VerifiedFamily_CanStillSignUpAnotherHousehold_WhenSwitching()` — the (c)-rejection guard;
      prefill must not silently become a lock.
- [ ] `AnonKey_CannotRead_LoginTokens()` — RLS zero-policy verification. Copy the shape from
      `tests/resource-library.test.ts`'s `AnonKey_CannotRead_AnyLibraryOrSubmissionTable` and
      `tests/proof-media.test.ts`'s `AnonKey_CannotReadOrWrite_ProofMediaBucket`; don't reinvent it.

## Technical Approach

**Schema — one new table, one new column.**

```
login_tokens        id, person_id FK people(id),
                    channel(email|sms), sent_to text,           -- audit: where it actually went
                    token_hash text unique,                      -- sha256(link token + pepper)
                    code_hash text,                              -- sha256(6-digit code + pepper)
                    next_path text,                              -- deep-link preservation
                    attempts int not null default 0,
                    expires_at timestamptz not null,
                    consumed_at timestamptz,
                    created_by_leader text,                      -- set when a leader minted it
                    created_ip inet, created_at timestamptz default now()
                    partial index on (person_id) where consumed_at is null
                    RLS enabled, zero policies (D-051)

people              + session_epoch int not null default 0       -- bump = revoke all sessions

passkey_credentials (Phase 4) id, person_id FK people(id),
                    credential_id text unique,                   -- base64url
                    public_key bytea, sign_count bigint,
                    transports text[], aaguid text, backed_up boolean,
                    nickname text,                               -- "Dana's iPhone"
                    created_at, last_used_at
                    RLS enabled, zero policies (D-051)
```

**Revocation fires from a database trigger, not app code** (Patrick, 2026-08-06). A trigger on
`people` (`active` → false, or `inactive_reason` set) and on `scouts` (`active` → false) bumps
`session_epoch` for the affected person and, for a scout, for the adults of their household. App
hooks were rejected because they miss the paths that actually matter: bulk roster-import accepts,
direct SQL corrections a leader runs in the Supabase console, and merges. One caveat to design
around explicitly — `person_directory`'s `no_longer_youth` is *computed* from birthdate, so a scout
turning 18 changes their classification **without any row being written**, and no trigger will fire.
Aging out therefore needs either a scheduled sweep or acceptance that an aged-out scout keeps a
Tier 2-S session until their roster row is touched. Given Tier 2-S grants only proof submission,
the sweep is the cleaner answer but not urgent; state the choice rather than leaving it implicit.

No `identity_sessions` table. The session lives in the signed cookie; `session_epoch` is the
revocation lever, and `login_tokens` doubles as the audit trail ("last verified" = most recent
`consumed_at`). Retention: prune consumed/expired rows after 90 days, same routine-job shape as the
proof-media retention item.

**Modules.** `lib/identity-session.ts` — a fourth session type on `signed-cookie.ts`, alongside
leader/family/profile-household. Payload `{ role: 'identity', subjectKind: 'adult' | 'scout',
personId, householdKey, displayName, epoch, iat }`. The `role` discriminator is load-bearing for the
same reason it is in `family-session.ts`: all cookie types share `LEADER_SESSION_SECRET`, so without
it a leader token replayed into the identity cookie would verify. `subjectKind` is load-bearing for
the *second* reason — it is the only thing separating Tier 2-S from Tier 2, so it must be validated
in `verifyIdentitySession()` (reject anything that isn't exactly one of the two literals) rather than
trusted where it's read. `lib/identity-challenge.ts` — mint / send / verify, framework-agnostic so
it stays usable from the Edge runtime if `proxy.ts` ever needs it.

**Epoch checks cost a query, so spend them deliberately.** `verifyIdentitySession()` is pure crypto
by default (matching today's `gateAudience()` cost profile). The `session_epoch` comparison runs
only on (a) Tier 2 *page loads* and (b) every Server Action that writes. A revoked session may
therefore still render one cached read; it can never write. That tradeoff is the whole reason the
epoch approach beats a sessions table, and it should be stated in the module header.

**`t79_profile_household` is superseded, not deleted.** It remains the Tier 1 fallback for a
visitor who has the troop password but hasn't verified. Tier 2 surfaces check `t79_identity`
*only*. Resolve household from `household_members` server-side on every request — never trust a
key that arrived in a form field or URL, which is precisely the weakness this plan closes.

**Recipient resolution needs a NEW reverse lookup — this is real work, not reuse.**
`lib/email-recipients.ts` exports only `recipientsForScouts()`, which walks *scout → parents* via
`relationships` where `type = 'parent_of'`. Sign-in needs the opposite direction (email → person),
which does not exist today. Two consequences:

- An adult with no `parent_of` edge — committee member, chartered-org rep, an ASM whose kids were
  never in the troop — is **unreachable** through that module. The reverse lookup must go straight
  at `people` (the `people_email_idx` on `lower(trim(primary_email))` is already there for it) plus
  `scout_parent_emails`, not through the scout graph.
- The deliverability filter (`bounced_at` / `unsubscribed_at`) currently lives inline at
  `email-recipients.ts:86`. Extract it so both callers share one rule. A bounced or unsubscribed
  address must not be a valid challenge destination, and the UI needs a "we can't reach that
  address, ask a leader" path that still doesn't confirm membership.

**Email content is minimal by policy.** Subject and body name the troop and nothing else — no scout
names, no household composition, no requirement detail. A sign-in message is the one piece of troop
mail most likely to be forwarded, screenshotted, or read on a lock screen.

**SMS (Phase 3, optional).** `people.primary_phone` already exists on the spine and is read and
written by the Roster (`people-table.tsx`, `person-actions.ts`) and roster-import, so there's a
maintained value to send to; parent phone numbers also tend to be more current than email on a troop
roster. Twilio behind the same `identity-challenge.ts` interface; the `channel` column exists from
day one so adding it is not a migration. Check the column's actual fill rate before committing —
if it's sparse, this is a data-entry task before it's an engineering one.

## Implementation Steps

0. **SHIPPED 2026-08-06.** ~~Phase 0, ship first and separately: refuse `audience === 'scout'` in
   `submitProofAction` and delete the free-pick branch; explain the change at the "I did this" entry
   points; remove `scout-roster-picker.tsx`; correct the module header and `Resource-Library.md`
   decision 4; fix the reviewer's `fromLabel`. Add
   `ScoutLogin_IsRefused_WhenClaimingProofForAnotherScout()`. No schema change, no dependency on
   anything below — this ships on its own.~~ (Test landed as `ScoutLogin_IsRefused_WhenSubmittingProof`,
   matching the Test Plan section's naming rather than this line's — same regression guard.)
1. Migration: `login_tokens` + `people.session_epoch` + revocation triggers + RLS + indexes.
2. `lib/identity-session.ts` and `lib/identity-challenge.ts`; extend `gateAudience()` with the
   verified audiences and add `requireHouseholdIdentity()` (adult-only) alongside
   `requireFamilyAccess()`. Write the reverse email → person lookup.
3. `/signin` route: request form → sent confirmation → code entry → POST-consume landing page.
   Rate limiting, enumeration-safe responses, `safeInternalPath()` on `next_path`.
4. Vitest suite for Phase 1 criteria; lint + build; deploy behind no UI entry point yet.
5. Add the "Sign in" entry to `site-nav.tsx`'s utility bar next to Profile; soft-launch to two or
   three families before troop-wide.
6. Phase 2: bind `/profile` (adult-only) and `/library/submit-proof` (adult or scout); populate
   `submitted_by_person_id`; Event Signup prefill + `entered_by_person_id`. Add the `/profile` test
   coverage D-055 shipped without — there is none today.
7. Phase 3: roster "Send sign-in link" + "last verified" + revoke; leader-issued offline codes;
   `noindex` headers; CDN/bucket audit; `.env.example` repair.
8. Phase 4 (passkeys): only after the RP-ID question is answered. Table + registration offer on the
   post-verification screen + discoverable-credential sign-in; magic link retained as the recovery
   path forever.
9. Record decisions D-073+ in `Agents/Architect/Memory/DECISIONS.md`; update `family-session.ts`'s
   accepted-risk comment and `signed-cookie.ts`'s stale consumer list to match what shipped.

## Phase 4 — Passkeys (adopted and unblocked, Patrick 2026-08-06)

Passkeys are the natural end state of this design, not a departure from it: the magic link proves
who you are *once*, and the passkey makes every subsequent sign-in a fingerprint or face-scan with
nothing typed. It is strictly better than the shared password on both axes at once — less friction
*and* more security, which is rare enough to be worth taking.

**The flow.** Immediately after a family's first successful verification, the confirmation screen
offers "Set up one-tap sign-in on this device." That placement matters: it's the one moment the
user has just proven identity, is already in a security frame of mind, and has a reason to care.
Registration is WebAuthn via `@simplewebauthn/server` + `@simplewebauthn/browser`. Use
**discoverable credentials** (resident keys) so returning sign-in is "tap Sign in" with no email
entered at all.

**Why this is unusually well-suited to a troop.** Passkeys sync through iCloud Keychain and Google
Password Manager, so one registration on a parent's phone typically covers their laptop and tablet
too — the "I set it up on the wrong device" failure that plagued early WebAuthn largely doesn't
apply to how families actually use phones now.

**Non-negotiables:**

- **The magic link is never removed.** It is the recovery path when a phone is lost, a device is
  replaced, or a passkey sync fails. A passkey-only account is a family locked out of their scout's
  record with no self-service way back in.
- **`session_epoch` revocation applies identically**, and a leader revoke deletes that person's
  `passkey_credentials` rows too — otherwise "revoke" silently means "revoke everything except the
  strongest credential."
- **Do not hard-fail on `sign_count`.** Many platform authenticators always return 0; treating a
  non-incrementing counter as cloning evidence would lock out iPhones.
- **Adults only.** A scout registering a passkey on a shared school Chromebook is a foreseeable
  mess; Tier 2-S stays on challenge codes.
- **Pin `PASSKEY_RP_ID` in env; never derive it from the request host.** Passkeys are bound to the
  registrable domain and do not survive a move. Deriving the RP ID from `req.headers.host` means a
  preview deployment registers credentials that are useless in production — and the failure is
  silent until a family tries to sign in.

## Alternatives Considered

- **Permanent per-household bearer link** (`/f/{token}`, printed on a card at the Court of Honor).
  Genuinely zero friction, works for a grandparent with no email, no mailer dependency at all.
  Rejected as the *primary* mechanism because the link never expires and forwarding it silently
  grants full access. Worth revisiting for a read-only "your family's schedule" surface where the
  blast radius is a calendar, not a birthdate.
- **Supabase Auth with Google sign-in.** Most parents would tap "Sign in with Google" and be done,
  and it would give real per-user RLS. Rejected for now: a second identity space to reconcile
  against `people`, a mailer that needs replacing anyway, and RLS that earns nothing while every
  path runs on the service role. Note that Phase 4 gets the *passkey* half of this benefit without
  the identity-space cost. Revisit if the app ever grows a non-service-role data path.
- **Per-family passwords.** Solves binding, reintroduces exactly the memorization burden this plan
  exists to avoid, and creates 25 reset requests a year.

## Open Questions — RESOLVED (Patrick, 2026-08-06)

- [x] **Scouts: option (c).** A scout may verify their own identity, but a scout session unlocks
      *only* library/proof surfaces — never demographics, never another scout, never household
      contact info. This creates **Tier 2-S**, strictly narrower than Tier 2 (see Access Tiers).
      Enforced by a `subjectKind` discriminator in the cookie, checked server-side on every Tier 2
      surface, not by which pages happen to link where.
- [x] **Two parents, one household.** Both verify independently, both land in the same household.
      D-055's silent-submission model holds unchanged — neither parent is shown the other's pending
      request. (Consequence to accept knowingly: the "one pending request per entity" partial unique
      index means the second parent's submission *overwrites* the first's, and neither is told. That
      was already true under the shared password; identity doesn't worsen it, but now the admin diff
      will at least name who won.)
- [x] **Divorced / split households.** Most recent membership wins. No switcher at launch. If a
      parent lands in the wrong household, a leader corrects `household_members` — membership was
      always meant to be leader-correctable, never re-derived.
- [x] **Session length: 120 days**, matching `FAMILY_COOKIE`. Revocation, not expiry, is the safety
      lever — which is exactly why `session_epoch` has to work.
- [x] **Aged-out and departed: automatic bump on roster change.** Implemented as a Postgres trigger,
      not app code — see Technical Approach. App-level hooks miss the paths that matter (bulk
      roster-import accepts, direct SQL corrections, the `no_longer_youth` age computation in
      `person_directory` that turns 18 without anyone touching a row).

- [x] **Passkey RP ID: committed.** A hostname move is unlikely (Patrick, 2026-08-06), so Phase 4 is
      unblocked. Set the RP ID to the **registrable domain**, not the full host — a bare-apex vs
      `www` mismatch is the ordinary way this gets broken, and it's a one-way door either way.
      Record the chosen value in `.env` as `PASSKEY_RP_ID` rather than deriving it from the request
      host, so a preview deployment can never silently register credentials against the wrong domain.

- [x] **Phase 0: disable the scout path** (Patrick, 2026-08-06). Accepted cost, stated plainly: a
      scout at a meeting, on their own phone, with the scout password, cannot submit proof until
      Tier 2-S ships. That capability is ~1 day old and the household path covers the same need.

## Open Questions — still open

None. This plan is ready to implement.

## Notes

- Closes the accepted risk documented in `lib/family-session.ts` and referenced from
  `lib/profile-household-session.ts`. Both headers should be updated to point here on ship.
- Related: D-005 (public-launch security model; deferred per-user auth to Phase 4), D-027 (the
  accepted risk this plan closes), D-051 (RLS zero-policy), D-054 ("Things We Should Know" is
  medical-adjacent — the single strongest argument for Tier 2), D-055 (change_requests /
  self-service demographics), D-064 (household-membership validation on signup), D-049 (test
  approach).
- **Supersedes Resource-Library.md decision 4** ("the shared scout password — scout picks their
  name; leader review catches misuse") and D-062 insofar as it relies on that. That decision was
  reasonable when the alternative was no scout path at all; it is not what Patrick intends, and the
  reviewing leader has no independent way to verify an identity claim, so "leader review catches
  misuse" was never load-bearing in the way it reads. Update both documents when Phase 0 ships —
  a superseded decision left standing in a plan file is how the old behavior gets rebuilt later.
- D-005's rule still binds: every new loader here uses `createAdminClient()`. The anon key cannot
  read app data and `login_tokens` must not become the exception.
- Deliberately does **not** touch Event Signup. Its accepted risk was evaluated against a different
  threat model (a mis-signup, correctable, audited) and the `?household=` contract is load-bearing
  across `events/[id]/page.tsx` (searchParams), `household-picker.tsx`, `slot-first-form.tsx`, and
  the redirect targets in `events/[id]/actions.ts`.
- **Tier 2's "never from a form field" rule is a deliberate departure from Event Signup, not a
  continuation of it.** `submitSignupAction` reads `householdKey` out of formData
  (`events/[id]/actions.ts:78`) and D-064's mitigation is that the key is re-resolved server-side
  through `loadHouseholdByKey()` into `p_allowed_person_ids` before the RPC will accept it. That is
  sound for signup. For Tier 2 the household is derived from the verified `person_id` and the form
  never gets a say at all — say so at the implementation site so the difference reads as intentional.
- New env: `IDENTITY_TOKEN_PEPPER` (32 bytes, generate like `LEADER_SESSION_SECRET`). Reuses
  `LEADER_SESSION_SECRET` for cookie signing and `RESEND_API_KEY` / `EMAIL_FROM` for delivery.
  Optional Phase 3: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM`.
- **Fix `.env.example` while you're in there.** It currently documents only Supabase,
  `NEXT_PUBLIC_SITE_URL`, `LEADER_SESSION_SECRET`, and Bunny — it never mentions `FAMILY_PASSWORD`,
  `LEADER_PASSWORD`, `SCOUT_PASSWORD`, `RESEND_API_KEY`, `EMAIL_FROM`, or `EMAIL_REPLY_TO`, all of
  which are live in code. Adding `IDENTITY_TOKEN_PEPPER` without closing that gap continues a drift
  that will eventually cost someone a broken local setup.
- No rate limiter exists anywhere in `next-app/src` today, and there are no `X-Robots-Tag` /
  `noindex` headers. Both are genuinely new — don't plan around a helper that isn't there.
- `signed-cookie.ts`'s header comment is stale: it names leader + family as its only consumers and
  has since gained `profile-household-session.ts`. Update it to four when this ships.
- Parked ideas: "remember this device" as a concept distinct from session length; a family-visible
  history of their own submitted change requests; the permanent per-household link (see
  Alternatives) as a read-only "your family's schedule" surface.
