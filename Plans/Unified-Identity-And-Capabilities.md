# Unified Identity & Capabilities

**Status:** Ready to implement — all open questions resolved 2026-08-16
**Created:** 2026-08-16
**Priority:** High
**Supersedes on completion:** the shared-password half of `Plans/Family-Identity-Auth.md`. That plan
built the identity core; this one finishes the job by removing everything it was layered on top of.

## Overview

Collapse five overlapping trust mechanisms into **one sign-in and one session**, and replace the
tier/role model with **capabilities resolved per person**. A parent, a leader, a scout, and a leader
who is also a parent all sign in the same way, once, and get exactly the grants attached to their
`people` row — no second login, no second identity, no role picker.

The identity core already exists and is shipped. What this plan adds is (a) a capability layer keyed
on `people.id`, (b) three more ways to actually reach a family that email alone cannot, and (c) the
retirement of `FAMILY_PASSWORD` / `LEADER_PASSWORD` / `SCOUT_PASSWORD` as credentials.

## Problem / Opportunity

### Five mechanisms, two identity spaces

| Mechanism | Cookie | Binds to a person? | Revocable? | Set by |
|---|---|---|---|---|
| `FAMILY_PASSWORD` | `t79_family_session` | No | Troop-wide only | `lib/family-session.ts` |
| Email challenge | `t79_identity` | **Yes** — `people.id` + household | **Yes** — `session_epoch` | `lib/identity-session.ts` |
| `LEADER_PASSWORD` + authorized-adult name | `t79_leader_session` role=`leader` | No — a *label* from `leaders` | No | `admin/login/actions.ts` |
| `SCOUT_PASSWORD` + free-text name | `t79_leader_session` role=`scout` | No | No | `admin/login/actions.ts` |
| `library_superusers` | — | Keyed on `leaders.code` | Row delete | migration `20260807000000` |

Plus `lib/profile-household-session.ts` (`t79_profile_household`), superseded by Tier 2 but still
resident in the tree.

Two families of problem fall out of that table.

**1. Two identity spaces means two logins for the same human.** A leader who is also a parent is a
`leaders.code` in one space and a `people.id` in the other. They authenticate twice to do two things
that are both "being themselves at Troop 79."

`lib/session-person.ts` exists solely to paper over this, and its own header names the fix:

> What it does NOT store is a person_id, so the label has to be matched back — the same match the
> login itself performed, run in reverse. That reverse match is why this lives behind a function
> rather than being inlined: it is lossy in principle (two adults sharing a label would collide),
> and the durable fix is to put person_id in the session token at login so nothing has to be
> re-derived.

**The bridge already exists.** `leaders.person_id` was added in
`20260720100000_people_identity_spine.sql:149`, is indexed (`leaders_person_idx`), and is maintained
through every revision of `merge_people` up to `20260815200000`. Unifying leader identity into the
person spine is wiring, not a migration project.

**2. Roles are too coarse, and the tree already grew a capability table to escape them.**
`library_superusers` grants one specific ability (view the Library as any active scout) to specific
named humans, outside the role system entirely — deliberately, per the migration's own header ("A
NEW TABLE rather than a `leaders.library_superuser boolean` flag column"). That is the first row of
a capability model, built without being named as one. The Scout-news and meeting-plan asks below are
the second and third.

### The onboarding problem

Two doors for families, each failing differently:

- **Shared password** — one string, printed in the Bugle, un-revocable per family, no identity
  behind any write. Fine for a high-trust troop; the failure mode is quiet rather than dangerous.
- **Email challenge** — real identity, but it dead-ends when the email bounces, isn't received,
  doesn't exist (grandparent, second household), or — most commonly — **the parent can't remember
  which address the troop has on file.** The last one is self-inflicted: the flow asks for the email
  instead of asking who they are.

Onboarding ~25 families and ~30 scouts through a channel with four failure modes and no fallback is
the thing this plan has to fix. Everything else is cleanup.

### The scout surface is a deny-by-omission allowlist that has already leaked

Scouts reach News drafting through `/admin/*`, gated by `SCOUT_ALLOWED_PREFIXES` in `src/proxy.ts`.
That list is an allowlist of prefixes on a surface whose default is leader-only, and its own comment
records why it exists:

> it exists so a *new* page can't accidentally ship readable-by-scout just because nobody remembered
> to add the per-page check (that's exactly how the advancement/* pages leaked before this).

Adding the meeting-plan tool to that list widens a surface that has failed once. The alternative —
move the two scout-appropriate features off `/admin` entirely — deletes the list and the bug class
with it.

## Decisions

Recorded here as proposed; confirm before activation. Numbering continues on ship as D-111+.

1. **One session cookie, capabilities resolved server-side.** The cookie carries
   `{ personId, householdKey, epoch, iat }` and says nothing about what the bearer may do. Grants
   come from a `person_capabilities` read on the same round trip as the epoch check. Capabilities in
   the token would go stale exactly when it matters — a leader who steps down mid-session keeps
   every grant until the cookie expires.
2. **Capabilities, not tiers.** Tier 2 / Tier 2-S / leader / scout collapse into named grants. The
   household surface is not a grant — it falls out of `household_members`, which is the point of the
   spine (D-030 / D-042).
3. **`FAMILY_PASSWORD` is demoted, not deleted.** It stops being a credential that grants access and
   becomes the gate on the *name picker* — the onboarding step that starts a challenge. Families
   keep the one-string simplicity they have now; the output of the flow becomes a bound, revocable,
   per-person session instead of an anonymous bearer cookie.
4. **Scout-appropriate features move to the public side behind capabilities**, rather than `/admin`
   being widened for scouts. `SCOUT_ALLOWED_PREFIXES` is deleted, not extended.
5. **`SCOUT_PASSWORD` and `LEADER_PASSWORD` retire in that order**, and only after the identity path
   has carried real traffic. `LEADER_PASSWORD` is last out because it is the current break-glass.
6. **No Supabase Auth.** Unchanged from `Family-Identity-Auth.md` decision 1 — every path still runs
   through `createAdminClient()` (D-005), so RLS-backed per-user policies still earn nothing, and a
   capability table is strictly less machinery than a second identity space.

## The capability model

```
person_capabilities   person_id  bigint  references people(id) on delete cascade
                      capability text                    -- see the vocabulary below
                      granted_at timestamptz default now()
                      granted_by bigint references people(id)   -- a real FK, not a typed label
                      primary key (person_id, capability)
                      RLS enabled, zero policies (D-051)
```

### Today's mechanisms are replaced, not wrapped

Every mechanism in the "granted today by" column below **goes away** as a way of granting anything.
After this plan there is exactly one grant mechanism in the system: a row in `person_capabilities`
keyed to a `people.id`, written by a leader through an admin screen. Knowing a password grants
nothing. Appearing in a particular table grants nothing.

Starting vocabulary — deliberately small; add grants when a surface needs one, never speculatively:

| Capability | Grants | Granted today by | Granted after this plan |
|---|---|---|---|
| `advancement.write` | Fast entry, ledger, roll call, BoR | `LEADER_PASSWORD` | `person_capabilities` row |
| `roster.manage` | Full names, contact info, demographics — read **and** edit, plus change-request review | `LEADER_PASSWORD` | `person_capabilities` row |
| `calendar.write` | Calendar entries, events, signup blocks | `LEADER_PASSWORD` (leader-only since 2026-08-14) | `person_capabilities` row |
| `news.write` | Edit any article and flip its status live/not-live. Leader-side — *proposing* an article needs no grant | `SCOUT_PASSWORD` (draft) / `LEADER_PASSWORD` (publish) | `person_capabilities` row |
| `meeting_plan.use` | **Generate** a meeting plan and publish the snapshot. *Reading* the published plan is already public and needs no grant | `LEADER_PASSWORD` | `person_capabilities` row |
| `library.moderate` | Approve/reject Library submissions and proofs | `LEADER_PASSWORD` | `person_capabilities` row |
| `library.proxy_view` | View the Library as any active scout | `library_superusers` table | `person_capabilities` row |

The "granted after" column is uniform on purpose. **That uniformity is the whole point of the
plan** — one table to read when asking "may this person do this," one screen to change it, one
place to look when auditing who can do what.

What each mechanism's retirement means concretely:

- **`LEADER_PASSWORD`** — stops being how you *become* a leader. A leader signs in as themselves
  (Phase B) and their grants come from their person row. Survives only as break-glass until Phase E,
  then goes entirely (Open Question 3).
- **`SCOUT_PASSWORD`** — deleted in Phase C. A scout who writes news signs in as themselves and
  proposes articles that land pending. No grant is involved on the scout side at all.
- **`library_superusers`** — its rows become `library.proxy_view` grants during the Phase A seed.
  The table itself stays in the schema for one release as the seed's provenance, then drops. It
  keeps its `leaders.code` key while it lives, because of the D-019 rename cascade.
- **`FAMILY_PASSWORD`** — never granted a capability and still doesn't. It changes job from "gate on
  content" to "gate on the name picker" in Phase D.

### Baseline — what needs no grant at all

Being a verified person in a household already carries the entire family surface. None of this is a
capability, none of it appears in `person_capabilities`, and none of it can be revoked without
revoking the person:

- Sign up for an event (own household, or another household — the carpool case, deliberately kept)
- View and propose edits to your own household's demographics
- Submit proof for yourself (scout) or your own scouts (adult)
- **Propose a news article** — adult or scout; lands `'pending'`, a leader approves it
- Read all gated content: full roster names, meeting plans, calendar detail

Proposing a change request, submitting a proof, and proposing an article are all the same shape:
*hand something to a leader.* None of them is a privilege, so none of them is a capability.

This matters for the matrix below: a parent with **zero** capabilities is a fully functional user.
Capabilities are for acting on the troop's behalf, never for acting on your own.

### Who can do what — proposed starting matrix

**This is a proposal, not a description.** The capability *vocabulary* is an engineering decision;
who holds which bundle is troop governance and yours to set. Review this table specifically —
it is the fastest way to catch a grant that's in the wrong place.

Legend: **ADV** `advancement.write` · **ROS** `roster.manage` · **CAL** `calendar.write` ·
**NEWS** `news.write` · **MP** `meeting_plan.use` · **LM** `library.moderate` ·
**LPV** `library.proxy_view`

| Persona | ADV | ROS | CAL | NEWS | MP | LM | LPV |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Public visitor (no session) | | | | | | | |
| Verified scout | | | | | | | |
| Youth leader (SPL / PL) | | | | | ✓ | | |
| Verified adult (parent/guardian) | | | | | | | |
| Adult leader (ASM) | | | ✓ | ✓ | ✓ | | |
| Membership / committee chair | | ✓ | | | | | |
| Advancement chair | ✓ | ✓ | | | ✓ | ✓ | |
| Comms / newsletter lead | | | ✓ | ✓ | | | |
| Librarian | | | | | | ✓ | ✓ |
| Troop admin | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

**`roster.manage` is deliberately held by three rows, not by every adult leader** (Patrick,
2026-08-16). It is the heaviest grant in the table — every family's address, birthdates, and
medical-adjacent "Things We Should Know" (D-054), plus the authority to approve their change
requests. A general ASM runs the calendar, the meeting plan, and news without ever needing it.
Making that distinction possible is a large part of why the capability model is worth building at
all; a model where everyone holds everything is just the shared password with extra steps.

Three things to notice, because they are the substance of the design:

1. **Public visitor and verified adult have identical capability rows — both empty.** The difference
   between them is not a capability; it's that one of them is a known person in a household. That is
   the baseline surface above, and it's the common case.
2. **There is no "scout contributor" row, and that is the point.** A scout who writes news holds no
   capability at all — proposing an article is baseline, and the article lands not-live for a leader
   to approve. See "Publishing is a filter, not a permission" below. `news.write` in this table is
   the *leader* grant: edit anything, flip the flag.
3. **Nothing nests.** A youth leader is not "a weaker adult leader"; an advancement chair holds no
   news grants. This is why the Alternatives section rejects role inheritance — these grants
   genuinely don't stack into a ladder, and pretending they do is how someone ends up with
   `roster.manage` because it came bundled with something else.

### What the two collapses mean (Patrick, 2026-08-16)

**`roster.read` + `roster.write` → `roster.manage`.** Seeing a family's contact details and editing
them are one grant. This is the simpler and more honest model — in practice anyone trusted to read
every family's address and medical-adjacent notes is trusted to fix a typo in them, and a read-only
roster grant was always going to be a distinction nobody could explain. It does mean the grant is
now unambiguously heavyweight — which is why Open Question 7 resolved by keeping it to a short list
rather than handing it to every adult leader.

**`news.author` + `news.publish` → `news.write`** — and the review step it looked like it was
carrying moves where it belonged all along. See the next section, which is the more important half
of this decision.

## Publishing is a filter, not a permission (Patrick, 2026-08-16)

**The reframe.** Whether something is live is a property of the *record*, not of the person who
created it. A scout proposes a news article from the public side; it is saved not-live; a leader
flips it live from the admin. Nothing about that flow needs a second capability, because the scout
was never in the admin to begin with — **admin access itself is the gate on the flag.**

This is not a new mechanism. It is the mechanism this app already uses everywhere except the two
surfaces in question:

| Surface | Status column | Shipped |
|---|---|---|
| `change_requests` | `'pending' \| 'approved' \| 'rejected'` | D-055, `20260721040000` |
| `library_submissions` | `'pending' \| 'published' \| 'archived'` | `20260721100000:52` |
| Resource proofs | `'pending' \| 'approved' \| 'returned'` | `20260721100000:120` |
| `meeting_plans` | `'draft' \| 'published'` — RLS hides drafts from the public page | `20260711000000:85` |
| **`articles`** | **`'draft' \| 'published'`** — no pending state | `20260706000000:39` |
| **`calendar_entries`** | **none at all** | — |

A family proposing a demographics change and a scout proposing a news story are the same shape of
act, and they should use the same shape of mechanism. Two surfaces are the odd ones out; fixing them
is catching up, not inventing.

### What this changes in the model

**Proposing is baseline. Approving is a capability.**

- **Any verified person can propose a news article** — adult or scout, no grant required, the same
  way anyone can propose a demographics change or submit a library proof (Patrick, 2026-08-16). It
  lands `'pending'`.
- **There is no public proposal surface for calendar entries** (Patrick, 2026-08-16). Event
  suggestions arrive by email and Band and get entered by a leader; a web form for them would be a
  channel nobody uses. Calendar entries still gain a status, for a different reason — see below.
- `news.write` and `calendar.write` become **leader-side grants only**: edit anything, and flip the
  status. They are what put you in the admin, which is the only place the flag can be flipped.

So there is no "Scout contributor" persona and no scout-held grant. **A scout contributing news
needs no capability at all** — they need to be a verified scout, which they already are. That is
strictly simpler than what this plan proposed yesterday, and it removes the awkward case where a
youth held an admin capability.

### Two schema changes — deliberately NOT symmetrical

The two surfaces get different state sets because they have different problems. Forcing them to
match would add a state to `calendar_entries` that nothing can ever produce.

1. **`articles.status` gains `'pending'`** → `'pending' | 'draft' | 'published'`.
   `'draft'` stays for a leader's own work-in-progress; `'pending'` means proposed from the public
   side and awaiting review. The public-side editor writes `'pending'` and is structurally incapable
   of writing anything else.
2. **`calendar_entries` gains `status`** → `'draft' | 'published'`, default `'published'`.
   **No `'pending'` — nothing can propose one.** This state exists for a different reason: so a
   leader can work up an entry (a campout with dates still moving, a fundraiser being negotiated)
   without it appearing on the family-facing calendar. That capability doesn't exist today at all —
   an entry is live the instant it is saved. Defaulting to `'published'` means every existing row
   and every current leader workflow behaves exactly as it does now.

If a public proposal surface for events is ever wanted, adding `'pending'` to that check constraint
is a one-line migration. Adding it now would be a state with no writer.

**Do not overload `on_calendar` to mean "approved" or "live"** (Patrick agreed, 2026-08-16).
`calendar_entries.on_calendar` (`20260809120000`) is a *display* filter — it is how a news-shaped
entry stays off the month grid while remaining a real, published entry (the D-011 feed-merge work,
v1.28–v1.30). "Should this appear on the month grid" and "is this live at all" are independent axes:

| | `status = 'published'` | `status = 'draft'` |
|---|---|---|
| `on_calendar = true` | Normal event — grid, list, event page | Leader's WIP — invisible everywhere public |
| `on_calendar = false` | News-shaped entry — feed and its own page, no grid | Leader's WIP — invisible everywhere public |

The top-right cell is a normal, existing case with real rows in it today. Collapsing the two axes
would silently un-publish every one of them.

**The main risk in this change is a missed read path, not the migration.** The calendar is read from
the homepage hero and card row, the month grid, the list view, the event detail page, the signup
page, and the roll-call/attendance surfaces. A `status` column that isn't filtered in all of them
means a draft leaks somewhere. Inventory the readers before writing the migration, and add the
filter at the loader level rather than per-caller wherever the code allows it.

### Why this is better than the capability split it replaces

- **A new public-side surface cannot leak by omission.** Under a `news.publish` capability, shipping
  a page that forgot the check publishes things. Under a status default, the worst a forgotten check
  does is create a `'pending'` row nobody sees.
- **The review queue becomes uniform.** One admin pattern — pending items, approve or reject —
  already exists for change requests and the Library. News and events join it rather than each
  growing a bespoke flow.
- **It matches how the troop actually works.** A scout writing up a campout isn't exercising a
  privilege; they're handing something to a leader. The data model should say that.

### The admin screen, and bundles

Grants are flat rows, but nobody should tick nine boxes per person. The admin screen offers
**bundles** — "Advancement Chair," "Comms Lead," "Scout Contributor" — that correspond to the matrix
rows above.

**A bundle is a button, not a layer.** Applying one writes individual `person_capabilities` rows and
then forgets it existed; there is no `bundle_id` on the row, no inheritance to resolve at check
time, and no way for a bundle definition changing later to silently alter someone's access. After
applying a bundle the leader can add or remove single grants freely, and the person's row set is
always the literal truth about what they can do. This keeps the ergonomics of roles without
reintroducing the resolution problem that made roles wrong here.

The screen shows, per person: their grants, who granted each and when (`granted_by` is a real FK to
`people`, not a typed label), their last verified timestamp, and a **Revoke all sessions** button
that bumps `session_epoch`. Grant changes take effect on the person's next privileged action — the
combined epoch-and-grants read means a removed capability stops working immediately, with no
sign-out required and no stale cookie to wait out.

Without this screen the table is only editable in the Supabase console, which is exactly how
`leaders.can_login` drift starts. It ships in Phase A, with the table.

## Onboarding — the flow, end to end

### The rule that makes all of this safe: there is no self-registration

**A person must already exist on the roster before they can sign in.** Every path below is a way of
*claiming an identity a leader already created* — never a way of creating one. The family password
does not create access; at most it helps someone find the row that is already waiting for them.

This is why demoting `FAMILY_PASSWORD` to a name-picker gate is not the security hole it sounds
like. Today, knowing that string *is* access. After Phase D, knowing it gets you a list of names
and a masked phone number, and nothing else happens until a code lands on a device the troop
already had on file.

### Path 1 — a new family joins mid-year (the default)

**Step 0 — leader, before the family ever visits the site.** A leader adds the scout and their
parents through the existing roster admin: `people` rows, a household, `household_members`. No
capabilities are granted — being in a household is not a grant. *This step exists today and does not
change.*

**Step 1 — family visits, clicks "Sign In."** Public content was already visible without it.

**Step 2 — the family gate.** They enter the troop password, from the Bugle or a welcome email or a
leader who told them at a meeting. **This does not sign them in.** It unlocks the next screen only.

**Step 3 — "Find yourself."** A roster list. They tap their own name. No email typed, nothing
recalled — this is the step that fixes *"I don't remember which address you have for me."*

**Step 4 — masked destination.** *"We can text ••••4471, or email d•••@gmail.com."* They pick one.
The masking is server-side; the raw values never reach the browser. If neither looks right, the
screen offers *"Neither of these is me — ask a leader for a code,"* which routes to Path 3 instead
of dead-ending.

**Step 5 — challenge delivered.** One message, containing both a sign-in link and a 6-digit code,
valid 15 minutes, single-use. *Existing behavior, unchanged — the code survives corporate mail
scanners that burn the link before the human clicks.*

**Step 6 — redeem.** Tap the link (which consumes nothing on GET, renders "Continue as Dana R.", and
consumes on POST) or type the code. *Existing behavior, unchanged.*

**Step 7 — signed in.** `t79_identity`, bound to their `person_id` and household, 120 days.

**Step 8 — passkey offer** (once Phase 4 ships). *"Set up one-tap sign-in on this device."* Offered
at the one moment they have just proven who they are and have a reason to care. Adults only.

**Step 9 — done, and everything works.** Event signup, their household's demographics, proof
submission, full roster names. No further gates, because the baseline surface needs no capability.

Steps 1–2 and 4–7 exist in some form today. **Step 3 is the new one**, and it is the one that
changes the success rate.

### Path 2 — bulk onboarding at a Court of Honor or parent meeting (the fast one)

This is the path for onboarding 25 families at once, and it skips the family password, the name
picker, and email entirely.

1. **Before the event**, a leader selects a set of people and mints a claim-card batch — one
   `login_tokens` row per person, long expiry, `created_by_leader` stamped. The screen renders a
   printable sheet, one card per person: their name, a short code, the URL, and the expiry date.
2. **At the event**, cards are handed out. A family goes to the URL on their phone, types the code,
   and is signed in as themselves.
3. **A leader sits with anyone stuck** and can watch them register a passkey on the spot — which
   means that family never types anything again, ever.

Ten minutes at a table replaces three weeks of chasing email. This is the single highest-throughput
onboarding mechanism in the plan, and it is the one to schedule step 5 of the implementation around.

### Path 3 — no working email, no mobile phone (the grandparent case)

A leader mints a single one-time code and reads it aloud, texts it from their own phone, or writes
it down. Same `login_tokens` row, same single-use semantics, same resulting session. The person
never needs a deliverable address on file at all.

This is also the fallback whenever Path 1 stalls at step 4 — wrong address, bounced, unsubscribed,
or *"neither of those is me."*

### Path 4 — a scout signs in

Identical to Path 1, with three differences: the session carries `subjectKind: 'scout'`, no passkey
is offered (a scout registering a passkey on a shared school Chromebook is a foreseeable mess), and
the session runs **30 days rather than 120**. A scout gets the baseline youth surface — which
now includes proposing a news article or a calendar entry, since those are baseline rather than
granted. A scout needs no capability to contribute news.

### Path 5 — returning, after the first time

Passkey: one tap, nothing typed. No passkey: the 120-day session usually means they were never
signed out; if they were, it's steps 1–7 again, which now takes about twenty seconds because they
know their own name is on the list.

### Reach matrix — every way this can fail, and what catches it

| Situation | Path | Fails today? | How common |
|---|---|---|---|
| Email on file, arrives fine | 1 | No | 39 of 41 adults |
| Doesn't remember which email the troop has | 1 (name picker shows it, masked) | **Yes** | Unmeasurable, and the likeliest of all |
| Address on file is old or wrong | 1 → 3 (the "neither is me" branch) | **Yes** | Unknown until families try |
| Email bounces or was unsubscribed | 3 | **Yes** | Tracked in `scout_parent_emails` |
| Prefers text; phone is more current | 1, choosing SMS | **Yes** | 38 of 41 adults have a phone |
| Phone but no email at all | 1 via SMS, or 3 | **Yes** | **2 adults** |
| No contact info of any kind | 3 | **Yes** | **0 adults in active households** |
| Twenty families at once at an event | 2 | **Yes** — no bulk path exists | Every Court of Honor |
| Not on the roster yet | Leader adds them first. No self-registration. | n/a — by design | — |
| Returning family, new device | 5, or 1 again | No | — |
| Lost phone, needs everything cut off | Leader revokes: `session_epoch` bump | **Yes** — impossible today | Rare, unrecoverable today |

**Calibration (measured 2026-08-16, production snapshot).** Every adult in an active-scout household
is reachable by at least one channel — 41 of 41. Nobody is stranded, and an earlier draft of this
plan implied otherwise. The honest argument for Phase D is therefore **not** "families cannot sign
in." It is:

- **Recall, not reachability, is the blocker.** The address exists; the parent doesn't remember it.
  That's the name picker, and it's the highest-value item in the phase.
- **Throughput.** Twenty-five families onboarding one email at a time takes weeks and never quite
  finishes. Claim cards make it one table at one event.
- **Recovery.** Bounces, stale addresses, and lost devices have no self-service answer today.

SMS is worth building for deliverability and preference, but it moves raw reach by two people. Do
not sequence the phase around it.

## Acceptance Criteria

### Phase A — capability layer (additive, reversible) — **SHIPPED 2026-08-16**

- [x] `person_capabilities` exists with RLS enabled and zero policies, verified by an anon-key test.
      Migration `20260816120000_person_capabilities.sql`.
- [x] Seeded from the current sources of truth — **but NOT from `leaders.can_login` directly.**
      `can_login` is true for 21 rows, including non-person codes (Summer Camp, Turner Hall) and for
      **an active scout who teaches** (JPII / person 25). Seeding from the flag would have granted a
      youth `roster.manage`. The seed replicates `isAdultPerson()` instead: 9 adults, the scout
      correctly excluded. Guarded by `NoActiveScout_HoldsAnyCapability_AfterSeed`, falsified before
      being trusted.
- [x] The epoch check and the grant read resolve in **one** query — `person_authz(p_person_id)`
      returns `(session_epoch, capabilities[])`. `lib/capabilities.ts` exposes `loadPersonAuthz()`,
      `hasCapability()`, `hasAnyCapability()`.
- [x] `/admin/access` lists people and their grants, toggles a single grant, applies a bundle, shows
      `granted_by` + `granted_at` per cell, clears all grants, and revokes all of a person's
      sessions (`session_epoch` bump). Reachable from Setup in the sub-nav.
- [x] A bundle writes individual rows and stores no bundle reference —
      `Bundle_ExpandsToFlatCapabilities_WithNoBundleReference` asserts the expansion is flat
      capability strings only.
- [x] Removing a grant takes effect on the person's next privileged action, with no sign-out —
      `Capability_IsRefused_WhenGrantIsRemoved` and `Capability_IsRefused_WhenSessionEpochIsStale`.
- [x] Nothing behaves differently yet. Phase A shipped dark — no other surface reads the table, and
      `/admin` still runs on `LEADER_PASSWORD`.
- [x] **Bootstrap guard:** `AtLeastOnePerson_HoldsEveryCapability_SoTheSystemIsNotBricked`. Someone
      must hold every capability at seed time or the grants screen itself is unreachable. Also
      falsified before being trusted.

**Not done in Phase A:** visual verification in a real browser. The screen has 9 DOM tests covering
behavior and accessible naming, but its CSS has never been rendered.

**Seed outcome to review:** 9 adults hold `advancement.write` + `calendar.write` + `news.write` +
`meeting_plan.use`; Patrick additionally holds `roster.manage`, `library.moderate`, and
`library.proxy_view`. `roster.manage` and `library.moderate` are otherwise **unassigned** — assign
them on `/admin/access` to whoever actually holds those roles.

### Phase B1 — one session, admin entry — **SHIPPED 2026-08-16 (not browser-verified)**

- [x] An identity session holding capabilities reaches `/admin/*` with no second login.
      `lib/admin-actor.ts` resolves either credential into one `AdminActor`; callers never branch on
      which cookie arrived, which is what lets Phase E delete the legacy path without touching a page.
- [x] The authorization split is explicit and costed: **proxy** (Edge, every request) checks
      signatures only; **workspace layout** (once per page load) does the single `person_authz` read
      and turns away zero-capability actors inline; **page/action** asks for a specific capability.
      An identity session's revocation is first noticed in the layout, by design.
- [x] `LEADER_PASSWORD` works unchanged in parallel.
- [x] `requireCapability()` / `requireAnyCapability()` exist (`lib/require-capability.ts`) with
      requireRole()'s throw-if-refused shape.
- [x] `/admin/login` offers "sign in as yourself", carrying `?next=` through to `/signin`.
- [x] Correct logout per credential — clearing the wrong cookie would leave someone apparently
      signed in but unable to act.
- [x] **Last-holder guard on the grants screen.** Revoking a capability nobody else holds is
      refused, on both the single-toggle and "Clear grants" paths. Written as a last-holder rule
      rather than a don't-demote-yourself rule, because two admins demoting each other in either
      order is the same dead end. Falsified before being trusted.

### Phase B2 — convert the call sites (NOT DONE)

`requireRole()` is called from **129 sites across 45 files**, plus **53 `ensureLeader()` calls**.
Converting them is mechanical but large, so B1 shipped a shim instead: `requireRole()` now accepts an
identity actor, and `satisfiesLegacyRole()` maps the coarse role conservatively — an identity actor
satisfies `'leader'` **only by holding every capability**.

**That strictness is deliberate and must not be relaxed for convenience.** `requireRole(['leader'])`
guards the ledger, the roster, the calendar and Scoutbook export all at once; mapping it to "holds
any capability" would let an ASM with `calendar.write` reach the advancement ledger — a silent
privilege widening. Guarded by `LegacyLeaderRole_IsRefused_WhenIdentityActorHoldsOnlySomeCapabilities`
and falsified (`every` → `some`) to confirm it bites.

Consequence to accept meanwhile: a **partially**-granted leader signing in as themselves gets a
"Not switched on yet" panel and is told to use the password. Full troop admins get the whole
workspace. Nobody is ever granted more than they should have at any point in the transition.

- [x] **Advancement converted — SHIPPED 2026-08-16.** 58 guards across 23 files, plus the five
      local `ensureLeader()` wrappers **inlined rather than renamed** (a helper called
      `ensureLeader` that checks `roster.manage` is precisely the stale name this codebase's
      comments warn about — and inlining puts the capability at each call site, which is the point
      of the model). `session.leader` → `session.label` at 20 sites; the value is identical for a
      legacy actor, and verified rather than typed for an identity one.

      | Surface | Capability |
      |---|---|
      | fast-entry, ledger, records, audits, mb-progress, dashboard, meetings, scoutbook-export | `advancement.write` |
      | meeting-plan | `meeting_plan.use` |
      | roster, roster-import, lookups | `roster.manage` |
      | has-needs | **left on `requireRole`** — the scout-visible surface; its capability is a Phase C question |

- [x] **Sub-nav filters by capability**, and the workspace gate relaxed from full-admin to
      any-capability accordingly. A nav item with no `capability` means *not yet converted* and
      stays full-admin-only — that default is what makes relaxing the gate safe, since a
      partially-granted person is never shown a link whose page would throw. The nav is not the
      boundary (the page guard is); it just stops offering links that cannot work. Guarded by
      `tests/admin-nav-capabilities.test.ts`, falsified (`!= null &&` → `== null ||`).
- [x] **Browser-verified 2026-08-16.** A fixture person holding only `advancement.write` signed in
      via `/signin/verify` and got exactly the right workspace: Dashboard, Fast Entry, Roll Call,
      Ledger, Submit & Present, MB Progress, Audits, Scoutbook Export — with News & Events and Setup
      absent entirely, and Meeting Plan / Roster / Event Rosters / Has-Needs filtered out. Direct
      URL to a `roster.manage` page refused. Granting the same person all seven produced the full
      nav, confirming the identity path reaches full admin. Fixture removed afterward.

      Three defects found and fixed in the pass, none caught by the test suite:

      1. **An unconverted page threw a raw 500** for a partially-granted actor. Guards signal
         refusal by throwing, and there was no error boundary — so `/admin/access` rendered a stack
         trace. Added `admin/(workspace)/error.tsx`, which distinguishes a refusal ("You can't open
         this page", with the message) from a real fault, and logs only the latter. A refusal is an
         ordinary event — a bookmark, a stale link, a capability revoked since the tab opened.
      2. **The zero-capability panel collapsed into a ~120px column.** It rendered a `<main>` inside
         `styles.workspace`, which is a two-column grid whose first track is the sub-nav — with no
         SubNav sibling, main landed in the nav column. That branch has no nav by design, so it now
         gets its own plain container. It was also missing `<ArticleStyleTokens />`.
      3. **A dropped space in JSX** — "Manage the roster(every family's address". Exactly the
         `next-app/AGENTS.md` gotcha: the space after an inline element is lost when the following
         text wraps to the next source line. Fixed with an explicit `{' '}`.

      Also re-verified: the sticky table header now works (the `max-height` fix), and the legacy
      `LEADER_PASSWORD` session still sees the full workspace.

- [ ] Convert the remaining sections: News, Calendar, Resource Library, Media Manager, Photo Albums,
      Event Rosters, Utilities, `/admin/access` itself. Add each one's `capability` to its nav item
      in the same commit as its guards.
- [ ] Delete `satisfiesLegacyRole()`'s identity branch and the layout's "Not switched on yet" panel
      once the last call site is converted.
- [ ] Audit stamps (`ledger_entries.entered_by`, `change_requests.submitted_by_person_id`,
      `signup_entries.entered_by_person_id`) resolve from the actor's `personId` directly.
      `requireRole()` already returns the identity actor's verified display name for `entered_by`,
      which is a stronger value than the legacy path's typed username — but the *id* path is still
      unconverted.
- [ ] `leaderSessionPersonId()`'s reverse label match leaves the identity path entirely.
- [ ] A leader who is also a parent signs in once and can both record advancement and edit their own
      household, with no cookie swap and no sign-out in between. **This is the acceptance test for
      the whole plan** — structurally true after B1 for a full troop admin, but unverified in a
      browser and not yet true for a partially-granted leader.

### Phase C — scout surfaces move off /admin

- [ ] Migration: `articles.status` gains `'pending'`; `calendar_entries` gains
      `status text not null default 'published' check (status in ('draft','published'))`.
      `on_calendar` is untouched and keeps its display-filter meaning.
- [ ] News authoring lives on a public-side route open to any verified person — adult or scout,
      **no capability**. Submissions land `'pending'`. The public-side editor is structurally
      incapable of writing any other status, verified by a test that posts a forged status value.
- [ ] The admin review queue lists pending articles and can approve or reject, following the
      change-request and Library moderation pattern rather than a bespoke flow.
- [ ] An author can see and edit their own pending article, and cannot see or edit anyone else's.
- [ ] **Every calendar read path filters `status`.** Inventory first: homepage hero, homepage card
      row, month grid, list view, event detail page, signup page, roll call/attendance. A draft entry
      is invisible on all of them, and the event page returns not-found rather than rendering.
- [ ] The admin calendar screen can save an entry as a draft and flip it live later. This capability
      does not exist today — an entry is live the moment it is saved.
- [ ] No public proposal surface for calendar entries is built. Event suggestions arrive by email
      and Band (Patrick, 2026-08-16).
- [ ] **The meeting-plan viewer needs no work — `/meeting-plan` is already public** and already
      reduces scout names to first name + last initial. What moves is nothing; what changes is that
      the *generator* is governed by `meeting_plan.use` rather than `LEADER_PASSWORD`.
- [ ] A holder of `meeting_plan.use` who is a youth leader can generate a plan that lands `'draft'`;
      publishing the snapshot stays with leaders. `meeting_plans.status` already supports this and
      RLS already hides drafts — no schema change.
- [ ] `SCOUT_ALLOWED_PREFIXES` and `SCOUT_LANDING` are **deleted** from `src/proxy.ts`, which reduces
      to "an admin capability, or bounce to sign-in." A narrowed list left behind is a list someone
      widens again.
- [ ] `SCOUT_PASSWORD` is removed from the login form, the env, and `.env.example`.
- [ ] Existing scout drafts survive the move with their authorship intact.

### Phase D — reach

- [ ] **Name-picker sign-in.** A family picks themselves from the roster and is shown *masked*
      destinations ("text ••••4471" / "email d•••@gmail.com"), never the full value. No recall
      required. Adopted per Open Question 1.
- [ ] **SMS.** Twilio behind the existing `identity-challenge.ts` interface; the `channel` column has
      been there since `20260806210000`. Fill-rate check is **done** — 93% of adults in active
      households have a phone, so it's viable. Sequence it *last* in the phase: it adds two people to
      raw reach (Open Question 6), and its real value is deliverability and preference.
- [ ] **Leader-issued codes.** A leader mints a one-time code to read aloud or hand over
      (`login_tokens.created_by_leader` already exists for the audit stamp). This is the answer for a
      family with no working email at all.
- [ ] **Claim cards.** A leader bulk-mints one-time codes for a set of people and gets a printable
      sheet, one card per person, each expiring on a chosen date. Designed for a Court of Honor or
      parent meeting — onboarding 25 families at one table instead of over three weeks of email.
- [ ] Every channel lands in the same place: a bound `t79_identity` session. Channels differ in
      delivery, never in what they grant.
- [ ] `FAMILY_PASSWORD` no longer grants access to anything. It gates the name picker only.

### Phase E — retirement and hardening

- [ ] A server-side break-glass CLI exists, is documented, and has been **run successfully once** —
      it mints a `login_tokens` row for a named person straight against the database. No web-facing
      emergency path is added. This gates the next item.
- [ ] `LEADER_PASSWORD` removed.
- [ ] Admin capabilities require a passkey (depends on `Family-Identity-Auth.md` Phase 4). No interim
      step-up ships before then — leaders see no change until passkeys land, at which point admin
      sign-in gets *easier*, not harder.
- [ ] Scout sessions issue at 30 days, adults at 120, keyed off `subjectKind`.
- [ ] `lib/family-session.ts` and `lib/profile-household-session.ts` deleted, along with their
      cookies. `signed-cookie.ts`'s consumer list drops from four to one.
- [ ] Passkey requirement on elevated capabilities (Open Question 2) — after Phase 4, not before.
- [ ] The aged-out sweep runs on a schedule. `person_directory.no_longer_youth` is computed from
      birthdate, so a scout turning 18 writes no row and fires no trigger —
      `Family-Identity-Auth.md` flags this already, and a capability model raises the stakes from
      "keeps proof submission" to "keeps whatever grants they held."

## Test Plan

Vitest, `db` project (`.test.ts`, node, serial, against local Postgres) unless noted. Naming per
`Tests/CLAUDE.md`: `{Subject}_{ExpectedBehavior}_When{Condition}()`.

**Capability layer**
- [ ] `AnonKey_CannotRead_PersonCapabilities()` — RLS zero-policy check. Copy the shape from
      `tests/identity-auth.test.ts`'s `AnonKey_CannotRead_LoginTokens`; don't reinvent it.
- [ ] `Person_HasLeaderGrants_WhenSeededFromCanLogin()` — the migration seed is correct, not merely
      non-empty.
- [ ] `LibrarySuperuser_KeepsProxyView_AfterSeeding()` — the one existing capability survives the
      generalization.
- [ ] `Capability_IsRefused_WhenSessionEpochIsStale()` — revocation and authorization resolve
      together; a bumped epoch denies the grant even though the row still exists.
- [ ] `CapabilityCheck_IssuesOneQuery_WhenResolvingEpochAndGrants()` — guards the combined read from
      silently splitting back into two.

**One session**
- [ ] `LeaderParent_CanRecordAdvancementAndEditOwnHousehold_WithinOneSession()` — the headline case.
- [ ] `IdentitySession_ReachesAdmin_WhenHoldingAdminCapability()`
- [ ] `IdentitySession_IsBouncedFromAdmin_WhenHoldingNoAdminCapability()`
- [ ] `LedgerEntry_StampsRealPersonId_WhenWrittenFromUnifiedSession()` — no label round-trip.
- [ ] `LeaderCookie_CannotVerify_AsIdentityCookie()` — the role-discriminator guard, re-asserted;
      all cookie types still share `LEADER_SESSION_SECRET`.

**Scout surfaces**
- [ ] `Scout_CanProposeArticle_WhenHoldingNoCapability()` — proposing is baseline.
- [ ] `ProposedArticle_LandsPending_WhenSubmittedFromPublicSide()`
- [ ] `PublicEditor_CannotWritePublishedStatus_WhenStatusIsForgedInFormData()` — the structural
      guard. A posted `status=published` is ignored, not honored.
- [ ] `DraftEntry_IsAbsentFromEveryPublicReadPath_WhenNotYetPublished()` — parameterized over the
      full reader inventory (homepage hero, card row, month grid, list view, event page, signup,
      roll call). One test, one list; adding a reader without adding it to the list fails.
- [ ] `EventPage_ReturnsNotFound_WhenEntryIsDraft()` — a permalink to a draft leaks nothing.
- [ ] `PublishedEntry_StaysOffMonthGrid_WhenOnCalendarIsFalse()` — the two-axes guard: `status` and
      `on_calendar` are independent, and the D-011 feed-merge behavior must survive this change.
- [ ] `ExistingEntries_RemainPublished_AfterStatusColumnMigration()` — the default actually holds
      for every backfilled row.
- [ ] `Author_CanEditOwnPendingArticle_ButNotAnothersPendingArticle()`
- [ ] `Leader_CanFlipStatusToPublished_WhenHoldingNewsWrite()`
- [ ] `Scout_IsBouncedFromAdvancement_WhenReachingAdminDirectly()` — the regression guard for the
      leak `SCOUT_ALLOWED_PREFIXES` was written to prevent, re-established without the allowlist.

**Reach**
- [ ] `NamePicker_ShowsMaskedDestinationsOnly_WhenPersonSelected()` — no full address or number ever
      reaches the client.
- [ ] `NamePicker_IsRefused_WhenFamilyGateNotSatisfied()`
- [ ] `LeaderCode_IsSingleUse_WhenRedeemedTwice()`
- [ ] `ClaimCard_ExpiresOnChosenDate_WhenRedeemedAfterward()`
- [ ] `ClaimCardBatch_MintsOneTokenPerPerson_WithNoCrossRedemption()` — card A cannot sign in as
      person B.
- [ ] `SmsChallenge_LandsInSameSession_AsEmailChallenge()` — channels differ in delivery only.
- [ ] `ScoutSession_ExpiresAfterThirtyDays_WhenIssued()` — and an adult's at 120, from the same
      issuing path, so the two can't drift apart.
- [ ] `BreakGlassCli_MintsUsableToken_WhenRunAgainstDatabase()` — the recovery path is tested once,
      before `LEADER_PASSWORD` is removed, not discovered during an outage.

**DOM** (`.test.tsx`, `dom` project — `tests/setup-dom.ts` is required, not decorative)
- [ ] `SignInPage_AnnouncesMaskedDestination_WhenNameSelected()` — accessible name is the masked
      string, not the raw value.
- [ ] `AdminNav_OmitsUngrantedSections_WhenCapabilitiesAreNarrow()` — the nav reflects grants rather
      than rendering links that bounce.

## Technical Approach

**One query for epoch + grants.** `isEpochCurrent()` already costs a read on every privileged write,
and `identity-session.ts`'s header is explicit that this spend is deliberate and bounded. Fold the
capability read into it — one row out carrying `session_epoch` and the person's grants — and
authorization becomes free relative to today's cost profile. This is the single most important
implementation constraint in the plan: two separate reads would double the per-write cost and invite
someone to cache the grants, which reintroduces the staleness that keeping them out of the cookie
was meant to avoid.

**Session shape.** `t79_identity` gains nothing. `personId`, `householdKey`, `epoch`, `iat`, and the
`role: 'identity'` discriminator are already there and already sufficient. `subjectKind` stays —
adult-vs-scout remains a real distinction for the YPT-shaped rules (no passkeys for scouts, shorter
sessions, minimal message content) even after tiers give way to capabilities.

**`library_superusers` stays keyed on `leaders.code` at first.** It participates in the
`LEADER_CODE_REFERRERS` rename-cascade in `admin/advancement/lookups/actions.ts` (D-019), so rekeying
it to `person_id` is its own change with its own regression risk. Phase A reads it and writes
`library.proxy_view`; rekeying is a follow-up, not a prerequisite.

**Name-picker masking is server-side.** The roster page sends masked strings; the raw address never
crosses the wire. Masking in the browser would defeat the entire point.

**Claim cards reuse `login_tokens` unchanged.** A card is a row with a long expiry and
`created_by_leader` set — the same table, the same single-use semantics, the same
`sha256(secret + pepper)` storage. The printable sheet is a render, not a schema change. This is the
permanent-bearer-link idea from `Family-Identity-Auth.md`'s Alternatives section, made safe by being
single-use and expiring, which is exactly what got the original rejected.

**Phases A and B are additive and reversible.** Every retirement lives in C, D, or E. If the plan
stalls after B, the app is strictly better than today (leaders log in once) and nothing is broken.

## Implementation Steps

0. **Finish `Family-Identity-Auth.md` Phase 3 first** — revoke UI, leader-issued codes, "last
   verified," `noindex` headers, the CDN audit. Every step below assumes a leader can revoke a
   session and mint a code. Note that the epoch triggers listed there as outstanding **are actually
   shipped** (`20260806210000_identity_auth_phase1.sql:64-111`, both the `people` and `scouts`
   triggers) — that checkbox is stale, and the remaining Phase 3 work is smaller than it reads.
1. Migration: `person_capabilities` + RLS + seed from `leaders.can_login` and `library_superusers`.
2. `lib/capabilities.ts` — `requireCapability()`, combined epoch+grant read. Admin grants screen.
3. Phase B: `/admin` accepts an identity session with an admin capability. `LEADER_PASSWORD` stays
   in parallel. Audit stamps switch to the session's `personId`.
4. Phase C: move News drafting, then the meeting-plan tool, to public routes. Delete
   `SCOUT_ALLOWED_PREFIXES`. Retire `SCOUT_PASSWORD`.
5. Phase D: name picker, SMS, leader-issued codes, claim cards. Demote `FAMILY_PASSWORD`.
6. Phase E: retire `LEADER_PASSWORD` with a break-glass in its place. Delete
   `family-session.ts` and `profile-household-session.ts`. Step-up, if adopted. Aged-out sweep.
7. Passkeys — `Family-Identity-Auth.md` Phase 4, unchanged, and best done right after D so the
   families onboarded at a Court of Honor register a passkey while they are sitting there.

**Sequencing note:** step 5 changes what every family sees, so it wants to land immediately before a
Court of Honor or parent meeting, not mid-season. Steps 1–4 are invisible to families and can land
whenever.

## Alternatives Considered

- **Extend `SCOUT_ALLOWED_PREFIXES` to cover the meeting-plan tool.** Cheapest by far — one line.
  Rejected because it widens a deny-by-omission allowlist on a surface whose own comment records that
  it has already leaked once. The prefix list is a mitigation for a structural problem; adding to it
  buys a feature by making the structural problem worse.
- **Boolean columns on `leaders` (`can_publish_news`, `can_moderate_library`, …).** Simpler than a
  join table for the first three grants and worse for every one after. It also keeps grants in the
  `leaders.code` space, which is the split this plan exists to close — and the
  `library_superusers` migration already rejected exactly this shape, on Patrick's explicit ask.
- **Roles with inheritance (`scout < parent < leader < admin`).** Familiar, and wrong for this
  troop: a youth leader with `meeting_plan.use` is not a subset of a parent, and a Library superuser is not a
  weaker admin. The grants here genuinely don't nest.
- **Supabase Auth with Google sign-in.** Re-evaluated and re-rejected for the same reasons as
  `Family-Identity-Auth.md` decision 1 — a second identity space to reconcile against `people`, and
  RLS that earns nothing while every path runs on the service role. Passkeys (Phase 4) capture the
  low-friction half of the benefit without the identity-space cost.
- **Keep two doors and just improve each.** The honest minimal option: better email copy, an SMS
  fallback, leave the passwords alone. Rejected because it leaves the leader-is-also-a-parent double
  login untouched, which is the specific thing Patrick asked to fix.

## Open Questions — ALL RESOLVED (2026-08-16)

Record as decisions D-111+ on ship.

- [x] **1. RESOLVED: adopt the name picker.** A visitor picks their name from the roster and sees
      *masked* destinations only ("text ••••4471"), server-side. This is a deliberate reversal of
      `Family-Identity-Auth.md` Phase 1's "no membership oracle" rule, made on the grounds that first
      name + last initial is already Tier 0 public, the picker sits behind the troop password, and
      the failure it fixes — *"I don't remember which address you have for me"* — is the single
      likeliest reason a family never finishes signing in. **Update `Family-Identity-Auth.md`'s Phase
      1 acceptance criterion when this ships**; a superseded security decision left standing in a
      plan file is how the old behavior gets rebuilt later.
- [x] **2. RESOLVED: passkey-gated admin, no interim step-up.** Nothing changes for leaders until
      Phase 4. Once passkeys ship, elevated capabilities require one — which is *less* friction than
      today's password, not more, while removing the 120-day-cookie-to-all-PII exposure. The
      14-day re-challenge option was rejected as friction with a shelf life.
- [x] **3. RESOLVED (recommended, Patrick to override if wanted): break-glass is a server-side CLI,
      not a web path.** A script mints a `login_tokens` row for a named person, run against the
      database directly. It needs DB credentials Patrick already holds, adds **zero web-facing
      attack surface**, and reuses the existing table unchanged — strictly better than an env-gated
      emergency password, which is a permanently-live endpoint on the public internet. Document it
      and test it once before `LEADER_PASSWORD` retires; that gate stands.
- [x] **4. RESOLVED: no exposure problem — the viewing half is already public.**
      `src/app/(public)/meeting-plan/page.tsx` already renders the published snapshot to anonymous
      visitors, with scout names reduced to first name + last initial by `publicName()` and per-scout
      advancement suggestions shown. Adult teachers and MB counselors are named in full there today
      (`page.tsx:186`). So `meeting_plan.use` covers **generation and publishing only**; the
      generator's sole delta over the public page is full names instead of initials, which is not a
      new exposure. `meeting_plans.status` (`20260711000000:85`) already does draft/published with
      RLS hiding drafts — so a youth leader generating a draft that a leader publishes is the same
      pattern as news, already built.
- [x] **5. RESOLVED: 30 days for scouts, 120 for adults.** Keyed off `subjectKind`. Shared school
      devices are the risk; a scout session grants no PII, so re-verification is cheap; and at 94%
      scout phone coverage it's a 20-second text.
- [x] **6. RESOLVED: phone coverage is 93% — SMS is viable, but it is a deliverability feature, not
      a reach feature.** Measured against the 2026-08-15 production snapshot, families of *active*
      scouts: 41 adults, 38 with phone (93%), 39 with email (95%), **41 reachable by at least one
      channel (100%)**. Only **2 adults have a phone and no email**, so SMS adds almost nothing to
      raw reach. Active scouts: 29, with 28 phone / 26 email / 28 either. Build SMS for
      deliverability and preference; do not schedule Phase D around it.
- [x] **7. RESOLVED: `roster.manage` goes to a short list.** Advancement chair, membership/committee
      chair, and troop admin. General ASMs hold `calendar.write`, `news.write`, and
      `meeting_plan.use` and never need the roster grant. See the matrix and the note beneath it.
- [x] **8. RESOLVED (Patrick, 2026-08-16): review is a status filter, not a permission.** A scout
      proposes from the public side, the item lands not-live, and a leader flips it from the admin —
      which they can do because admin access is itself the gate. Proposing becomes baseline, and
      `news.write` / `calendar.write` become leader-side grants only. See "Publishing is a filter,
      not a permission."
- [x] **9. RESOLVED (Patrick, 2026-08-16): proposing is open to everyone.** Adults and scouts both
      submit news articles. No capability, no narrowing.
- [x] **10. RESOLVED (Patrick, 2026-08-16): no public event-proposal surface.** Event suggestions
      come through email and Band, which is the right channel for them; a web form would go unused.
      `calendar_entries` still gains `status`, but `'draft' | 'published'` only — the state exists so
      a leader can stage an entry before it goes live, not to receive proposals.

## Notes

- Depends on `Plans/Family-Identity-Auth.md` Phase 3. Phase 4 (passkeys) is now a **hard dependency
  for Phase E**, since Open Question 2 put the admin step-up behind it — `LEADER_PASSWORD` can retire
  before passkeys land, but the PII exposure it was meant to close stays open until they do.
- **Two corrections owed to `Family-Identity-Auth.md` when this ships:** its Phase 1 "no membership
  oracle" acceptance criterion is superseded by Open Question 1, and its Phase 3 `session_epoch`
  trigger checkbox is stale (both triggers shipped in `20260806210000:64-111`). A superseded security
  decision left standing in a plan file is how the old behavior gets rebuilt later.
- Related decisions: D-005 (service-role everywhere — the reason Supabase Auth still earns nothing),
  D-019 (`LEADER_CODE_REFERRERS` rename cascade — why `library_superusers` keeps its
  `leaders.code` key for now), D-030 / D-042 (households stored, not inferred), D-049 (test
  approach), D-051 (RLS zero-policy), D-054 ("Things We Should Know" is medical-adjacent — the
  strongest argument for step-up), D-064 (household-membership validation on signup), D-073+
  (identity core).
- `Family-Identity-Auth.md`'s Phase 3 checkbox for the `session_epoch` trigger is **stale** — both
  triggers shipped in `20260806210000_identity_auth_phase1.sql:64-111`. Correct it there when Phase 3
  is picked up rather than re-implementing them.
- The Event Signup contract stays untouched, exactly as `Family-Identity-Auth.md` insisted:
  `?household=`, the formData `householdKey`, and `submit_household_signup`'s
  `p_allowed_person_ids` validation are all load-bearing across four files. Verified-visitor prefill
  (option (b), not (c) lock) remains the adopted behavior — a parent covering a carpool is still
  legitimate under a capability model.
- Every new loader uses `createAdminClient()` (D-005). `person_capabilities` must not become the
  exception, the same way `login_tokens` didn't.
- Parked ideas that this plan makes cheaper but does not include: a family-visible history of their
  own submitted change requests; "remember this device" as a concept distinct from session length;
  a read-only permanent per-household schedule link (now that claim cards establish the printed-token
  pattern, the blast-radius argument for a *read-only* version is easier to make).
