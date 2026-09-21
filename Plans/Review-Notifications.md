# Review Notifications — tell the submitter what happened

**Status:** Active
**Parked:** 2026-09-20
**Priority:** Medium

## Overview

When a leader approves or turns back something a family submitted through the website, email
the person who submitted it: this is what you sent, and this is what happened to it. Two
flows only — the Resource Library "I did this" proof claims and Profile updates (change
requests). Every other submit-then-approve flow in the app is explicitly out of scope
(see Notes).

## Problem / Opportunity

Today a submission disappears into a queue and nothing comes back. The family finds out a
proof was approved only by going and looking at the advancement record; a change request
that was rejected is invisible until someone revisits `/profile`. Patrick, 2026-09-20:

> When an update submitted through the website has been approved, send a notice to the
> person submitting the update to indicate the success of their submission along with a
> confirmation of what was submitted, because they might not remember.

The "they might not remember" is the real requirement. A leader who filed a dozen claims at
a Monday meeting, or a parent who fixed an address three weeks ago, has no idea which item
an approval refers to unless the notice says.

Returned and rejected outcomes are in scope too (Patrick, 2026-09-20) — a submission sent
back for more is the case where silence does the most damage, and `feedback_md` /
`rejection_reason` already hold the leader's words.

## Acceptance Criteria

- [ ] Approving a proof claim emails the person who submitted it, naming the requirement.
- [ ] Returning a proof claim emails them, naming the requirement and including the
      leader's feedback.
- [ ] Approving or rejecting a change request emails the submitter, naming **which fields**
      the update covered — never their values.
- [ ] A leader who files a claim on a scout's behalf is the one notified, not the scout's
      parents (Patrick, 2026-09-20).
- [ ] A submission whose submitter cannot be resolved (legacy row, no deliverable address)
      is skipped silently — the approval itself still succeeds.
- [ ] No notice is ever sent except as the direct result of a leader clicking a review
      control. Nothing batched, nothing scheduled.

## Test Plan

- [ ] `Scout_IsNotified_WhenTheirProofIsApproved()` — approve writes to the resolved address
- [ ] `Leader_IsNotified_WhenTheirProxyFiledClaimIsApproved()` — proxy filing notifies the
      filing leader, NOT the scout's parents
- [ ] `Submitter_IsNotified_WhenProofIsReturned()` — returned carries `feedback_md`
- [ ] `Approval_Succeeds_WhenSubmitterHasNoDeliverableAddress()` — send is skipped, the
      status flip still commits
- [ ] `Approval_Succeeds_WhenSubmittedByPersonIdIsNull()` — legacy rows don't throw
- [ ] `ChangeRequestNotice_NamesFields_AndNeverValues()` — the guard test: asserts the
      rendered body contains the field LABELS and contains none of the submitted values
- [ ] `ProofSubmission_RecordsSubmitter_ForEachSubmitterShape()` — verified scout, verified
      adult, and leader proxy each land the right `submitted_by_person_id`
- [ ] `ProofRedo_KeepsSubmitter_WhenClaimIsReplacedInPlace()` — the v1.126.0 update path
      must set it too, not just the insert
- [ ] `emailForPerson_PrefersDeliverable_AndFallsBackToPrimaryEmail()`

## Technical Approach

Decisions taken with tech-lead, 2026-09-20:

- **This does not violate `lib/email.ts`'s "nothing sends automatically" rule.** The test it
  satisfies: the send happens synchronously as the direct consequence of a named leader
  action, to a single identifiable person, never batched or scheduled — the same class as
  the sign-in code in `identity-challenge.ts`. **No config gate**: signup confirmations are
  gated because they are per-event, customizable and multi-recipient; this is a fixed 1:1
  transactional notice with no per-event variation.
- **`change_requests` already has `submitted_by_person_id`.** Nothing to add there.
- **`requirement_submissions` has no submitter at all** — only `scout_id` and a
  `family`/`scout` enum. Add `submitted_by_person_id bigint references people(id)`, nullable.
  Populate it at BOTH write sites: the insert, and the replace-in-place update added in
  v1.126.0.
- **Never parse `filedByLeaderLine` out of `body_md` as an identity source.** It is prose
  for humans. A null submitter is a skip, not a lookup.
- **Field names only for change requests** (Patrick, 2026-09-20), identical to the
  submit-time email. The medical/allergy reasoning in `profile/actions.ts` applies just as
  hard on the way back out. `fieldLabel()` in `lib/change-requests.ts` already renders the
  labels. Proof notices may name the requirement and proof type — that content is not in
  the sensitive class and today's submit-time email already carries it — but still do not
  reproduce the write-up body.
- **One shared module, `src/lib/review-notifications.ts`**, owning recipient resolution and
  the send. Each caller builds its own bullets; do not force a shared diff abstraction over
  two different data shapes.
- **Add `emailForPerson(personId)` to `lib/person-emails.ts`** — the gap its own docstring
  flags. `email-recipients.ts`'s inline fallback becomes the third caller, so extract now.

## Implementation Steps

Two commits. Capture before notification — a notice built on a column that isn't reliably
populated is worse than no notice.

**Commit 1 — record who submitted**
1. Migration: `requirement_submissions.submitted_by_person_id` (nullable bigint FK).
2. Populate at both write sites in `(public)/library/submit-proof/actions.ts` — verified
   scout and verified adult use `session.personId`; leader proxy uses `actor.personId`.
3. Tests: the three submitter shapes, plus the redo path.

**Commit 2 — send the notice**
4. `emailForPerson()` in `lib/person-emails.ts`; refactor `email-recipients.ts` onto it.
5. New `src/lib/review-notifications.ts`.
6. Wire into `approveSubmission` / `returnSubmission` (`lib/library-data.ts`) and
   `approveChangeRequest` / `rejectChangeRequest`
   (`admin/(workspace)/advancement/roster/change-request-actions.ts`).
7. Tests per the Test Plan, including the values-never-leak guard.

## Open Questions

- [ ] Should the scout's parents ALSO be notified when a leader proxy-files a claim?
      Deferred 2026-09-20 — Patrick chose "the leader who filed it" for now. Revisit only if
      families ask why they didn't hear.
- [ ] Do the other four submit-then-approve flows want this too? Out of scope today; see
      Notes for what each would need first.

## Notes

**Deliberately out of scope**, and what each would need before it could join:

| Flow | Blocker |
|---|---|
| Library resource suggestions | `library_resources.submitted_person_id` exists but the public path never writes it — only a typed `submitted_by_label` name. Gated by the shared troop password, so there is no verified person to attach. |
| News submissions | `articles` stores `author_name` text only. The person_id WAS in hand at submit time and is discarded. |
| Reimbursements | Has `requester_person_id not null` — the readiest of the four. Sends no mail at all today, at submit or decision. |
| Event signups | No approval step; already mails families through `signup-confirmation-send.ts`. |

Production data as of 2026-09-20: 15 change requests, 13 carry a submitter and all 13 of
those resolve to an address; the 2 without predate Tier-2 verified identity and none are
pending. 28 active scouts, 13 with their own email, all 28 with a household adult who has
one — which is why the proof flow notifies the submitter rather than "the scout".

`change_requests` has carried a `one pending per (entity_type, entity_id)` unique index
since July; the partial unique index added to `requirement_submissions` in v1.126.0 follows
that existing convention rather than inventing one.
