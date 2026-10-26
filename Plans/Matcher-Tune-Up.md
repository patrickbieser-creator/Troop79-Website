# Matcher Tune-Up — feedback on the first release

**Status:** Parked (collecting feedback; nothing built)
**Parked:** 2026-10-19
**Priority:** High
**Follows:** `Plans/Meeting-Requests-And-Teaching-Offers.md`, Phases 0a–3b, live as v1.238.0.

## Overview

Patrick's tune-up list for the first release of the meeting board and matcher. Each item
records what he asked for, plus the context already in the codebase. Items stay parked
until the list is complete and reviewed, and then they're built in priority order.

## Feedback items

### T-1. A "what you'd be teaching" page for every teaching skill

**Patrick (2026-10-19):** Each skill on "What I can teach" links to a page that describes
what will be taught, a suggested curriculum, resources and so on. Someone who checks
"I can teach first aid" then knows what they're getting into and what's expected.

- **Managed in admin.** It has the full content tools: videos, images, rich content, links
  to documents, and links to external resources.
- **Linked from `/member/teaching`**, one link per skill row.
- **Also on the public site under Library.** A new card there carries the same links.

Context, to check before designing:

- The 13-row `skills` lookup is the list behind the card and Admin › Lookups. The page
  should key to `skills.id`.
- **Content-managed pages** (`site_pages`, edited at Admin › News & Events › Pages, since
  v1.209.0) already do markdown pages with no JSX copy. Decide whether a skill guide is a
  `site_pages` row (child page under a "Teaching guides" parent) or its own table.
  Prefer reuse ([[feedback-simplify-dont-layer]]).
- **Media:** the News CMS already has Bunny CDN, `{{gallery}}` / `{{gallerylink}}` /
  `{{video}}` tokens and no embeds. Reuse those for the videos and images.
- **Resource Library** is an enrichment layer keyed by ledger composite codes, with a
  moderation queue. A skill guide could list the library resources for the requirements
  that skill covers, via `rank_requirements.skill_id`, so curated links aren't
  duplicated. **Decided:** each skill page lists the existing Library resources for its
  requirements, automatically, with a per-entry hide.
- Public Library card: the guides are useful to families too. Confirm there is nothing
  members-only in them before they go public.

Open questions:

- [x] **One page per skill, or per requirement?** Patrick (2026-10-19): **one page per
      skill.** It also links to the resources already in the Library for that skill's
      individual requirements. No per-requirement pages are written; the requirement-level
      material comes from the Library entries for the requirements behind the skill
      (`rank_requirements.skill_id` → ledger composite codes).
- [x] **Public or members-only?** Patrick (2026-10-19): **the pages are public.** They're
      reachable from the public Library card and from "What I can teach". Because of
      that, a guide carries no member-only content (contact details, named scouts), and
      the editor should say so.
- [x] **Who may edit?** Patrick (2026-10-19): **any leader with admin privileges.**
      Teachers don't edit their skill's guide unless they're such a leader. At build,
      map this to the existing capability that edits site pages, rather than inventing a
      new one, and confirm it with Patrick if those two differ.
- [x] **No guide yet?** Patrick (2026-10-19): **show a hint** on that skill's row in
      "What I can teach", e.g. "Teaching guide coming soon". Keep it quiet, per
      [[feedback-scout-ui-style]]. Admin should also be able to see which skills still lack
      a guide.
- [x] **Library resources on a skill page: automatic or hand-picked?** Patrick
      (2026-10-19): **automatic, with a per-entry hide.** The list builds itself from the
      skill's requirements (`rank_requirements.skill_id` → the Library's composite
      codes), so new Library resources show up without anyone editing the guide. An admin
      can hide an individual entry from that skill's page.

### T-2. Anywhere from 1 to 12 teaching blocks a meeting

**Patrick (2026-10-20):** A meeting can have anywhere from 1 to 12 teaching blocks. The number
depends on how many adults show up and can meet the scouts' requests.

Context:

- Today there are three different caps. `meeting_boards.block_count` has a check of 1–4
  (`20261115100000_meeting_board.sql`). The `meeting_set_board` RPC refuses anything outside
  1–3 (`20261117100000_meeting_board_settings.sql`). The matcher clamps to 3
  (`lib/meeting-board-match.ts:162`). The per-scout cap is
  `min(MAX_TOPICS_PER_SCOUT, blocks)`, at most 2 topics a scout.
- Patrick's framing suggests the block count should follow supply (the adults coming)
  rather than be a fixed setting chosen in advance. Decide which before building.

Answered and BUILT (Patrick, 2026-10-20; v1.239.1):

- [x] **A block is a teaching session**, one adult teaching one group, not a time slot.
      Session length can't be predicted and meetings are fluid, so nothing is bound to a
      period. Up to 12 a meeting (`MAX_BLOCKS`), filled by the matcher; no count to choose
      (the old 1–3 setting is gone; `meeting_boards.block_count` is stored but unused).
- [x] **Rough halves stay as a guide:** about 4:15–4:45 and 4:45–5:15. Each session gets a
      suggested half (`MatchSession.half`) that keeps a scout's two and a teacher's two apart
      where possible; it never refuses a match. Blocks are numbered first half, then second.
- [x] **2 topics a scout** stays. A teacher leads up to 2 sessions (`SESSIONS_PER_TEACHER`);
      an oversubscribed topic splits into a Group B under the same teacher.
- Empty blocks show compressed as "Not filled" on Group Sessions. The Live match left This
  Sunday (Patrick: unnecessary there).
- Follow-up with T-3: once requirements carry a teaching time, the halves could weigh it.

### T-3. An expected teaching time on every requirement

**Patrick (2026-10-20):** Add an expected time to teach to each requirement. Default them all
to **15 minutes** as a head start; Patrick will go back and edit the times. Every requirement
has a typical amount of time it takes to teach. This also tells adults what's expected of them.

Context:

- Rank requirements live in `rank_requirements`, with sub-requirements under `parent_id`.
  Merit badge requirements live in `merit_badge_requirements`. A new minutes column defaults
  to 15. It's additive, so it goes DB-first, and the migration waits for "ship" (D-404).
- Show it to adults where they commit to teach (`/member/teaching`, the Sunday board) and
  in T-1's skill guide. The matcher and T-2 can use it to fit topics into a meeting's time.

Open questions:

- [ ] Where does Patrick edit the times? Admin › Advancement lookups per requirement, a
      bulk grid by rank, or both?
- [ ] Is the time per top-level requirement, per sub-requirement (see T-4), or both, with a
      parent's time being the sum of its parts?
- [ ] Merit badge requirements too, or rank requirements only for now?

### T-4. Show sub-requirements as the Clipboards break them out

**Patrick (2026-10-20):** The First Aid requirements need to be displayed as their
sub-requirements, the way they're entered on the Clipboards today. The same goes for the
lashing requirements and anywhere else a requirement is broken out into sub-requirements.

Context:

- Meeting-board picks and topics are keyed to the TOP-LEVEL requirement
  (`parent_id is null`; `lib/meeting-board-picklist.ts:207`, `topicSkill`). So a First Aid
  pick reads as one topic, while the Clipboard (`/scouts/[id]`, the sign-off grid) lists
  each sub-requirement separately.
- Changing the topic key to sub-requirement codes affects `meeting_picks`, teaching
  commitments, the matcher's demand and sibling grouping, `isPickFinished`, and the skill
  lookup (sub-requirements inherit `skill_id` from their parent). Ask tech-lead before
  picking a design.

Open questions:

- [ ] Do scouts pick the individual sub-requirements (4a, 4b…), or still pick the parent
      and the board and teachers then see its open sub-requirements listed?
- [ ] Does a sub-requirement the scout has already signed off drop out of the pick?

**T-3 and T-4 BUILT (2026-10-20, 8ff7ac3c):** `teach_minutes` (default 15, 1–240) on rank and
merit badge requirements, edited in Admin › Lookups › Req codes. A requirement with
sub-requirements takes the sum of its parts. Scouts still pick the parent; its parts are
listed under it everywhere on the board, and a scout's signed-off parts are marked.
Known gap: the Merit Badge Catalog tree editor deletes and re-inserts a badge's
requirements on save, which resets their minutes to 15. That doesn't matter yet, because
whole-badge topics carry no time.

### T-5. Nudge batches: invite scouts and leaders to a topic, with a quick-expiring link

**Patrick (2026-10-20):** To get the troop on board, a leader batches up scouts for a
requirement and emails them or their parents: "We're going to offer that this Sunday." The
email carries a link straight into their page, with no sign-in, that expires quickly. There
they accept the suggestion ("Sure, I'll come") or pick something else and submit, which
kicks off the matching. The same for leaders: "We'd like to teach this on Sunday. Who'd be
useful?" Each leader gets a link to confirm they'll teach it.

#### What exists (researched 2026-10-20; file refs under `next-app/`)

- **Sign-in links:**
  - The data is in `login_tokens` (`identity-challenge.ts`).
  - Links last 15 minutes and are single use.
  - Rate limits are 3 per person per 15 minutes and 10 per IP per hour.
  - Opening the link (GET on `/signin/verify`) only shows "Continue as X". The POST redeems
    it, so mail scanners that prefetch links can't use it up.
  - `requestChallengeForPerson(sb, personId, {nextPath, createdByLeader})` already mints a
    link from admin (the Roster's "Send sign-in link").
  - A link only ever goes to the person's own address; there is no parent fallback.
- **Email:**
  - Mail goes out through Resend (`lib/email.ts`), one message per recipient.
  - `confirm: true` is required to actually send. `EMAIL_REDIRECT_TO` reroutes all mail in
    dev.
  - Templates are a registry in `lib/email-templates.ts`. Adding a kind takes no migration.
    Merge tokens look like `[event]`.
  - Bulk-send precedent: `emailNonResponders` (events), dry run by default.
- **Parents:**
  - `recipientsForScouts(scoutIds)` (`lib/email-recipients.ts`) follows each scout's
    parent links to every deliverable parent address.
  - The sign-in picker has its own inline "no-email scout picks a parent" logic.
- **Accept actions:**
  - `meetingAddPickAction` lets you act for yourself or your household's scouts.
  - `meetingTeachAction` is for yourself only.
  - Both check the session epoch and the meeting date. A parent reaches a scout's board
    with `?scout=<id>`. `?for=` is honoured only for leaders.
- **Logs:**
  - `audit_log` has no `meeting` area yet; its check constraint needs widening.
  - `login_tokens.created_by_leader` records who sent a link.

#### Proposed design

1. **Two buttons on This Sunday, where the need shows.**
   - **"Invite teachers…"** on a "Wanted, no teacher" row. It opens a dialog listing the
     ask-first shortlist, the "Ask" and "Listed the skill" people ticked and everyone else
     unticked. Then come the subject and a short message (from the template), a preview,
     and **Send to N**.
   - **"Offer to scouts…"** on any topic, including one with a teacher that wants more
     scouts. Candidates are scouts who still need the requirement (`isPickFinished` false),
     have it in reach (next rank first) and haven't said they can't make it. Those who
     haven't picked it are ticked.
   - Opt-in ticks, like the EmailOctopus sync. Nothing sends without the leader pressing
     Send.
2. **One email per recipient, family-aware.**
   - A scout with their own address gets their own email.
   - A scout's parents always get one, through `recipientsForScouts`.
   - A family with two invited scouts gets one email listing both (decided per family at
     send time).
   - Adults get their own email.
3. **The link: a meeting invite token, not a plain sign-in link.**
   - A new `meeting_invites` table: id, calendar_entry_id, topic_key, kind (`pick` |
     `teach`), invitee person (the scout, or the adult), recipient person (who the email
     went to), token_hash, expires_at, sent_by, sent_at, opened_at, consumed_at,
     response (`accepted` | `changed` | `declined` | null), responded_at.
   - The table is service-role only and doubles as the "who did we ask" log.
   - The link `/i/<token>` follows the sign-in pattern: the GET shows "Continue as Pat
     Bieser — for Anjali" and the POST redeems it. Scanners can't use it up.
   - Redeeming signs the recipient in (the same session as a sign-in link, so the cookie
     and epoch rules are unchanged). It then lands on `/member/meeting?scout=<id>&invite=<id>`
     for a parent, or `/member/meeting?invite=<id>` for themselves.
   - **Expiry:** proposed 48 hours, never past the meeting's day, and single use. The
     plain 15-minute sign-in TTL is too short for an email read later. A spent or expired
     link lands on sign-in with `next` set, so nothing is lost.
4. **The accept card on `/member/meeting`.**
   - A scout or parent sees: "Mr. Bieser suggested Tenderfoot 4a, First Aid, for Sunday.
     [Yes, I'll come] [Pick something else]". Yes calls `meetingAddPickAction` with
     `markComing: true` as their #1, records `accepted`, and the board rematches.
     "Pick something else" scrolls to the pick list. Any pick saved records `changed`.
   - An adult sees: "Can you teach First Aid (Tenderfoot 4a, about 40 min) on Sunday?
     [Yes, I'll teach it] [Not this week]". Yes calls `meetingTeachAction` and records
     `accepted`. Not this week records `declined`; it does not mark them can't-make-it.
   - The card shows the topic's parts (T-4) and time (T-3).
5. **Feedback on the board.**
   - Each invited topic on This Sunday shows "Invited 6 · 2 yes · 1 changed".
   - "Invite again" skips anyone invited for this topic and meeting in the last 24 hours.
6. **Copy** lives in two new template kinds, `meeting.invite.scout` and
   `meeting.invite.teacher`, editable at Admin › Lookups › Email templates. Tokens:
   `[name]`, `[scout]`, `[topic]`, `[parts]`, `[minutes]`, `[day]`, `[link]`, `[sender]`.
7. **Who may send:** `meeting_plan.use`, the capability that already runs the board. Each
   send also writes an `audit_log` row (new `meeting` area).

#### Phases

- **P1, teachers:** the table, invite token, `/i/` route, teacher dialog, accept card,
  template and board counts. Adults only. This is the smaller surface and proves the link.
- **P2, scouts and parents:** the candidate list, family grouping, the scout accept card,
  and parents accepting for a scout.

#### Security review needed before building

The link signs someone in from an email, just as a sign-in link does, but lives 48 hours
instead of 15 minutes. qa-lead should review:

- the TTL;
- hash-only storage;
- the confirm step;
- that the session it grants is no wider than a sign-in link's;
- that a parent's invite for a scout only reaches that household;
- the per-send cap (proposed 40 recipients).

#### Test plan (outline)

- **Pure:**
  - candidate selection (scouts who need it, adults by ask-first tier);
  - family grouping;
  - token expiry (48 hours, capped at the meeting day);
  - response transitions.
- **DB:**
  - invite rows hash-only;
  - redeem is single use;
  - a parent can accept only for their own scout;
  - a past meeting is refused.
- **DOM:**
  - each dialog sends only the ticked people;
  - "Yes, I'll come" adds the pick as #1 and marks Coming;
  - "Not this week" records declined without changing intent;
  - the board counts.

Answered (Patrick, 2026-10-20):

- [x] **Link life:** expires at **6:00 PM Central on the meeting day**, and is single use.
- [x] **Parents:** **always** copied on a scout's invite.
- [x] **"Yes, I'll come"** makes it the scout's **#1**.
- [x] **Sender:** **"Troop 79 Bugler"**, never a named leader.
- **Start P1** (teachers).
- Per-requirement information pages are an aspiration, in BACKLOG, for later.

**P1 SHIPPED (2026-10-20, f9cbd3a4; migration 20261129100000 in production).** One change from
the plan, made after the qa-lead review: the link is a **scoped capability, not a sign-in**.
`/i/<token>` answers its one invite, yes or not this week, and never creates a session, so a
forwarded email can't become access to the site. qa-lead's required fixes (design M1–M7 and two
code reviews) are all in. P2 (scouts and parents) still needs its own review: a parent answering
for a scout is a recipient other than the invitee, which needs its own rule. "Pick something
else" will need the Sunday page, so P2 likely pairs a scoped "Yes" with a sign-in link for
anything more.

**P2 SHIPPED (2026-10-20, 21e7b862; migration 20261130100000 in production).** The leader
offers a requirement from This Sunday ("Offer to scouts…" on a topic, or "Offer a requirement
to scouts…").

- **Who gets the email.** Parents always: a `parent_of` relationship AND an adult in the
  scout's household. The scout too, from 13 and with a verified address. Each recipient gets
  one email with a link per scout.
- **What Yes does.** It is one transaction (`meeting_answer_pick_invite`): the pick becomes the
  scout's #1, the scout is marked coming, and the other family members' links close
  ("superseded").
- **No and Pick something else.** "Not this week" closes only the decliner's own link. "Pick
  something else" is a plain sign-in link to the scout's Sunday page.
- **Reviews.** qa-lead reviewed the design and the code; every required fix is in.

Not built yet:

- the candidate action's own test;
- a boundary test at the 100-email cap;
- a scout who turns 13 or loses their verified address between send and answer (the answer
  doesn't re-check the age).

## Acceptance Criteria

(Filled in when the list is complete.)

## Test Plan

(Filled in per item before building.)

## Implementation Steps

1. Collect the remaining feedback items.
2. Review the list with Patrick and set priorities; answer the open questions.
3. Consult jenna on surfaces, tech-lead on data shape, then build one item at a time.
