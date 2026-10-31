# Meeting Planner III: Emails screen

**Status:** SHIPPED v1.258.0–v1.259.0 (E1–E3+E5 2026-10-29; E4 Resend webhook 2026-10-30, 89df19f2).
**Priority:** High
**Source:** `prototypes/meeting-plan-III/README.md` → "Screen: Emails" and "Screen: Family page", plus `Emails.dc.html` and `Family.dc.html`.

## Resume here

1. tech-lead review is done (see its section).
2. Build E1 → E5 in order. Each phase is committed when green; migrations go on a worktree branch until Patrick says ship (D-404).

## Overview

One screen, This week › **Emails**, for every planner email about a meeting: plan emails to families, teacher invites and "Coming?" reminders. Nothing sends until an adult presses Send. Send goes **now**, one email at a time, each logged where you can see it. The family page that the email opens becomes the **one-tap answer page**. The plan is already set, so families accept it ("looks good"), change it (untick, which applies right away), add suggestions (up to 5), or say they can't come. Opens and deliveries come back from Resend.

## Problem / Opportunity

- Today there are three send paths: Publish snapshot, Remind everyone… and Ask by email. Each batches out of sight, with caps that apply silently. A leader can't see who got what.
- Families are asked to *pick* 2–3 things. Design III reverses that: the plan places every scout, so the family's job is to confirm it or change it. A separate "coming?" question plus a separate "pick" step fails too often.

## Acceptance Criteria

**Emails screen (`/planner/emails?m=<entryId>`):**
- [ ] Only an **adult** holding `meeting_planner.edit` can open it, the Sent log included. Anyone else gets the planner's not-allowed page. Checked on the server, on every action too.
- [ ] Tabs: Scouts and families · Teachers · Coming? reminders · Sent log, each with its count.
- [ ] Nothing is ticked by default. "Select all not sent yet", Clear, and filters Everyone / Not sent yet / Sent.
- [ ] A blocked row ("no parent email on file", …) can't be ticked and says why.
- [ ] The selection counts **emails**, not rows. Siblings with the same parents share one email ("One email covers Lily P and Simon P").
- [ ] The preview shows the To list (a checkbox per recipient), the subject, the rendered body and the answer buttons.
- [ ] "Edit this email" makes a one-off edit, marked "Edited for this email only", with "Use the standard wording" to undo it. The Edit-template link goes to Lookups › Email templates. A History panel shows this person's emails for this meeting.
- [ ] Teachers tab: every group, no-teacher groups first and marked "No teacher yet". Rows list every qualified candidate plus anyone already asked. A Yes **adds** a teacher.
- [ ] "Review and send N emails" opens an inline confirmation that lists every recipient by name. It shows the cap: "N of a 150 limit". Anything over the cap is listed as not sent, never dropped silently. It says in one line what answers do to the plan.
- [ ] Send writes every email to the log as **Queued**. The page then sends them one at a time, and each row turns Sent or **Failed · reason** live.
- [ ] Two tabs pressing Send can't send the same email twice.
- [ ] If the page closes mid-send, the next visit shows "N emails didn't finish sending · Send them now". No timer exists; nothing ever sends without a person pressing a button.
- [ ] Sent log, one line per recipient: when · to · about · kind · sent by · result. Results: Queued → Sent → Delivered → Opened (time) → Answered yes / Said not this week, or Failed · reason.
- [ ] A **"How this works"** disclosure, quiet but always there, states:
  - the 150 cap;
  - one email at a time, and what happens if the page closes;
  - sending never changes the plan, and what each answer does;
  - open tracking;
  - links stop working at 6 PM on meeting day;
  - 5 suggestions per scout;
  - siblings share one email.
  
  The numbers come from the same constants the code enforces.
- [ ] This week loses Publish snapshot, Remind everyone… and Ask by email. Its header gets an **Emails** link, with "(N not sent)" when scouts with a plan haven't been emailed.

**Family page (`/i/plan/<token>` and `/member/meeting`, public palette):**
- [ ] Each scout card shows the plan already ticked, then **one** radio group. The choices depend on the scout:
  - working on a rank: Coming · this plan looks good / Coming · but change the plan / Can't make it;
  - finished everything: Coming · a leader can pick / Coming · I'll choose / Can't make it;
  - Merit badge group: Coming · {badge} / Coming · help teach {focus} / Can't make it.
- [ ] "Not sure yet" is a line, not a button. An unanswered card reads **Needs an answer**, and reminders still find it.
- [ ] Can't make it = intent `cant`, and the scout leaves their group on the plan. Every other choice = `coming`.
- [ ] **Unticking a planned requirement applies right away**: the scout stops being assigned it on This week's checklist. Ticking it again restores it.
- [ ] Anything added ("Also on Sunday" or "Suggest something not on the list") is a **suggestion**, at most **5** per scout, enforced in the database. It shows on This week as a flag on the scout's row.
- [ ] Every tap saves at once ("✓ Saved · 1 change, 2 suggestions sent to the planners"). There is no Send button.
- [ ] The badge reads "✓ Coming" until a change is actually saved, then "Coming · changes sent". Choosing change and then changing nothing counts as looks good.
- [ ] Merit badge group "help teach": the scout becomes a **helper** listed under the named group. They are not a teacher in its slot.
- [ ] A household with 2+ scouts and any unanswered gets "✓ Everyone's coming and the plans look good" (choice 1 for every card). Once every card is answered it becomes "You're all set for Sunday."
- [ ] A finished-everything scout is emailed, using the "finished everything" version of the email. "A leader can pick" puts them in This week's "Not assigned & available" section.
- [ ] Teacher card: Yes, I can teach / Not this week.
  - Yes adds them to the group's teachers.
  - Not this week offers an optional note: 3 lines, 240 characters, a counter, its own Send. The note shows on the group's teacher slot on This week.
- [ ] Email buttons map one to one onto page choices:
  - Yes, coming = looks good, applied at once;
  - Pick something else = opens the page with "change the plan" selected;
  - Not this week = Can't make it;
  - the merit badge email: Yes, merit badge / I'd like to teach / Not this week;
  - the teacher email: Yes, I can teach / Not this week.
- [ ] A button click counts as an open.

**Tracking:**
- [ ] Resend webhook events (delivered, opened, bounced, complained) update the log row, matched by Resend's email id. The signature is verified; an unsigned or bad request is refused. Every email's footer says "Troop 79 can see when this email is opened." The label is plain "Opened".

## Test Plan

Stubs first, named for the criteria. **db** = the db project, against the local DB; **dom** = the dom project.

**E1, data and the send core (db):**
- [ ] `Planner_CanQueueEmails_OneRowPerRecipientPerKind()`: siblings sharing parents give one row covering both scouts.
- [ ] `Planner_CannotQueue_OverTheCap()`: email 151 comes back as overflow; nothing past the cap is queued.
- [ ] `Sender_ClaimsEachQueuedRowOnce_WhenTwoSendersRace()`: two claims at once, one row, exactly one wins.
- [ ] `Sender_ReleasesAStaleClaim_AfterTheTimeout()`: a row stuck "sending" past the claim timeout is queued again; a fresh claim is not.
- [ ] `Sender_MarksFailedWithReason_WhenResendRefuses()`, and on a timeout.
- [ ] `Sender_DeletesTheLink_WhenTheEmailDidNotGo()`: the token page and invite minted for a failed email are removed.
- [ ] `Sender_UsesTheOverride_WhenTheEmailWasEdited()`: the log keeps the exact body sent.
- [ ] `Leader_SeesUnfinishedSends_WhenQueuedRowsRemain()`
- [ ] `Family_CannotAddASixthSuggestion()` (the RPC, under the pick lock).

**E2, the family page and the plan (db + dom):**
- [ ] `Family_UntickRemovesRequirement_FromThisWeek()`, and `Family_RetickRestoresIt()`.
- [ ] `Family_CannotUntick_ARequirementNotInTheirPlan()`
- [ ] `Family_CantMakeIt_TakesScoutOutOfGroup()`
- [ ] `Family_ChangeWithNoEdits_ReadsComing()` (dom: badge).
- [ ] `Household_EveryoneComing_AnswersEveryCard()`
- [ ] `MeritBadgeScout_HelpTeach_ListsAsHelperNotTeacher()`
- [ ] `Teacher_Yes_AddsATeacher_KeepsTheOthers()`
- [ ] `Teacher_NotThisWeek_SavesNote_UpTo240Chars3Lines()`, with over-long input refused on the server.
- [ ] `FinishedScout_LeaderPicks_ShowsInNotAssignedAndAvailable()`
- [ ] `TokenPage_CannotWrite_AnotherHouseholdsScout()`, `TokenPage_Refused_AfterExpiry()` (existing claim behavior, kept).
- [ ] `PlannerRow_FlagsSuggestions()` (dom).

**E3, the screen (dom + db):**
- [ ] `ScoutOnPlanningTeam_CannotOpenEmails()`, `Adult_WithoutEdit_CannotSend()`, with every action re-checked.
- [ ] `Leader_NothingTickedByDefault()`, `BlockedRow_CannotBeTicked()`
- [ ] `Selection_CountsEmailsNotRows()`
- [ ] `Confirm_ListsEveryRecipient_AndTheCap()`
- [ ] `HowThisWorks_NamesTheEnforcedLimits()`: the text is built from the constants.
- [ ] `EmailButtons_MapToPageChoices()` (unit, renderer).
- [ ] `ThisWeek_EmailsLink_CountsNotSent()`

**E4, tracking (db):**
- [ ] `Webhook_RefusesBadSignature()`, `Webhook_OpenedSetsOpenedAt_Once()`, `Webhook_BounceMarksFailed()`, `Webhook_UnknownEmailId_Ignored()`
- [ ] `ButtonClick_CountsAsOpen()`

## Technical Approach

1. **The plan is already set, and "what was sent" is recorded, not frozen (N1, Q2).**
   - This week keeps computing placement (`lib/this-week`). Sending writes each scout's plan *as emailed* (group key, requirement keys) into that email's log row.
   - When a scout's live plan no longer matches the last one emailed, Emails shows the row as "Plan changed since sent" and selectable for a resend. This keeps the footer's promise ("we'll email you if a group or teacher changes") without the email ever changing the plan.
   - The family page shows the **live** plan. The snapshot model ("families see what was published") retires with Publish.
2. **Untick = an exclusion row.** New `meeting_scout_exclusions (calendar_entry_id, person_id, topic_key, set_by_person_id, set_at)`, PK on the first three.
   - `buildThisWeek` drops excluded requirements from that scout's assignment and checklist cells; a scout whose last item is excluded falls to "Not assigned & available".
   - Written through an RPC that checks the key is in the scout's live plan.
   - Leaders see the exclusions on the row and can restore one.
3. **Suggestions get their own table** (tech-lead #3: a pick becomes an "extra" class with scouts attached, `this-week.ts:293-311`, so a pick *changes* the plan).
   - New `meeting_scout_suggestions (calendar_entry_id, person_id, topic_key, suggested_by_person_id, created_at)`. An RPC `meeting_add_suggestion_capped` takes the scout's lock and enforces **SUGGESTION_CAP = 5**.
   - Suggestions only flag the scout's row on This week. A planner who accepts one turns it into a real assignment with the existing planner tools.
   - Old picks keep their meaning. `PLAN_PICK_CAP` stays at 3 for Publish-era pages until E5.
4. **Answers.** Choice → `meeting_intents` (coming / cant).
   - "Help teach" goes in its own table `meeting_scout_helpers (calendar_entry_id, person_id, group_key, set_by_person_id, set_at)`, PK (entry, person). It doesn't go in `meeting_scout_roles`, whose PK of one role per scout would let a family's answer and a planner's hand placement overwrite each other (tech-lead #4). Placement lists the scout under that group as a helper, outside its teacher slot.
   - "A leader can pick" = coming, with no role.
   - The radio's selected choice is derived, not stored:
     - cant → Can't make it;
     - a help role → help;
     - any exclusion or suggestion → change;
     - coming → looks good.
5. **One log for every email.** New `meeting_emails` table:
   - **Identity:** id, calendar_entry_id, kind (`plan` | `teacher` | `reminder`), batch_id.
   - **Who and what:** recipient_person_id, sent_to, about (jsonb: scout ids, or the group key for a teacher), plan_sent (jsonb), subject, body_md_override.
   - **Status:** status (`queued` | `sending` | `sent` | `failed`), failure, claimed_at, resend_id, queued_by_person_id, queued_at, sent_at, delivered_at, opened_at.
   - Answers are read live from intents and invites, not copied.
   - RLS on, service-role only (D-051/D-239), merge_people updated.
6. **The send pipeline, with no batching and no timer:**
   - `queueEmails(selection)`: re-derives recipients on the server (the existing `scoutRecipientsMany` / `adultRecipients` rules), refuses past `EMAIL_SEND_CAP = 150`, and inserts the rows as queued with one batch id.
   - `sendNextEmail(batchId)`: a server action the page calls in a loop.
     1. Claim one row with `meeting_email_claim` (`for update skip locked`, status queued → sending, stamped claimed_at; a sending row older than 2 minutes counts as queued).
     2. Mint its link: a `meeting_plan_pages` token for a plan, or a `meeting_invites` token for a teacher.
     3. Render it (with the override, if any) and send through `sendEmailWithin`, keeping the per-email timeout.
     4. Record sent (with resend_id) or failed. On failure, delete the minted link.
   - Each call sends exactly one email, so the 60-second limit can't bite.
   - The "didn't finish" strip = queued rows in this meeting older than the claim timeout.
7. **Templates.** Keep `lib/meeting-invite-email` and the Lookups templates. The plan email becomes per household, naming each scout's group and requirements. There are three versions: rank, finished-everything and merit badge. The answer buttons are added outside the template, as now. The tracking footer line goes in all three kinds.
8. **Button links.** Buttons go to `/i/plan/<token>?a=ok|change|out|mb|help`. The page applies the answer from a **POST after load, never on GET**, so mail scanners that prefetch links can't answer for families. It then shows the card with the choice selected. The first click stamps opened_at.
9. **Tracking.** `POST /api/resend/webhook` verifies the Svix signature with `RESEND_WEBHOOK_SECRET` and maps `email.delivered/opened/bounced/complained` by resend_id. Unknown ids are ignored. Patrick: turn on open tracking for the sending domain, create the webhook in Resend, add the secret to Vercel (sensitive, production).
10. **Teacher notes.** `meeting_invites.decline_note text` (CHECK ≤ 240 characters and ≤ 3 lines), written by the invite response. The planner's teacher slot shows it.
11. **Retired:**
    - Publish snapshot (`plan-publish.ts`, `this-week-publish*.tsx/ts`, `meeting_plan_snapshots`);
    - Remind everyone…;
    - Ask by email on This week;
    - the batch senders (`REMINDER_BATCH`, `PUBLISH_BATCH`, the time budgets).

    `meeting_plan_pages.snapshot_n` becomes nullable, then is dropped. The old invite and reminder logs stay for their duplicate checks (Q11).

## Implementation Steps

1. **E1, data and send core** (migration DB-first, additive): `meeting_emails` + claim RPC, `meeting_scout_exclusions` + RPC, the `help` role, `decline_note`, SUGGESTION_CAP 5, nullable `snapshot_n`. Then `lib/meeting-emails` (queue, claim, send one, unfinished) with E1 tests.
2. **E2, family page and plan:**
   - rebuild `family-week.tsx` as the one-tap cards and the teacher card;
   - `buildThisWeek` honors exclusions and helpers;
   - This week flags suggestions and shows teacher notes.

   Ships with today's Publish still in place (Publish keeps working, and its emails link to the new page).
3. **E3, the Emails screen.** The route, the four tabs, preview and edit, confirm, the send loop, the strip, the Sent log, How this works. Swap Publish, Remind and Ask on This week for the Emails link.
4. **E4, tracking.** The webhook route, plus "a click counts as an open". Patrick's Resend setup comes before production verify.
5. **E5, retirement** (code-first): remove the publish and batch code, then a migration drops `meeting_plan_snapshots` and `snapshot_n`.

Each phase: tiered gate (full), qa-lead, changelog bullets in the commit, Patrick eyes-on before the next migration ships.

## tech-lead review (2026-10-29): ready with changes, all folded in

Where these differ from the sections above, these win.

1. **Never double-send.**
   - A timed-out send (`meeting-invites-send.ts:360`, "the late send may still land") and a stale `sending` claim are **outcome unknown**, not Failed. The row reads "Unknown: check before resending".
   - Every send passes a Resend `Idempotency-Key` = the `meeting_emails` id, plus a `meeting_email_id` tag. A retry of the same row can't produce a second email.
   - The minted link is deleted only on a definite Resend error.
   - The completion write is guarded by `where status='sending' and claimed_at = <the claim's stamp>`.
   - The claim timeout is 2 minutes. It must stay above the route's `maxDuration` (60s), and a comment says so.
2. **Resend id.** `email.ts:155` throws away `data`. Add a single-recipient send that returns `data.id`, and log the address the email actually went to (`EMAIL_REDIRECT_TO` in dev).
   - The webhook reads the raw body (`req.text()`) before the Svix check, enforces the timestamp tolerance, and must be reachable without sign-in (check the proxy matcher).
   - Updates only move forward: `opened` can arrive before `delivered`.
   - A separate `delivery_status` keeps a bounce on a sent email apart from a send failure.
3. **Suggestions get their own table** (see Technical Approach 3).
4. **Helpers get their own table** (see Technical Approach 4).
5. **The change flag must ignore the family's own answers.**
   - "Plan changed since sent" compares `plan_sent` with the **planner-side** plan: placement before exclusions, intents and helpers. A family's untick never flags itself.
   - Exclusions whose key is no longer in the scout's plan (the focus changed) are ignored by placement and pruned.
   - `meeting_scout_exclusions`, `meeting_scout_suggestions` and `meeting_scout_helpers` all go into `merge_people`, with PK-conflict handling as in `groups.sql:386`.
6. **Email-button answers.**
   - `?a=` is applied once, then stripped with `router.replace`, so a reload can't re-apply an old answer.
   - `ok` applies on load.
   - `out` and `help` **preselect** the choice and need one confirming tap. Scanners that run JavaScript can then never take a scout off the plan.
   - Each answered scout costs one write against the link's 200 cap; expiry and epoch are unchanged.
   - Resending supersedes the older link. "How this works" says so: "Only the newest email's link works."
7. **Phase order.**
   - E1 also makes `meeting_plan_pages.snapshot_n` nullable.
   - E2 swaps the Publish email's wording ("tick 2–3 things" → "here's the plan, one tap to answer"), so the new page and the old send path agree during the overlap.
8. **Gating and tests.**
   - The gate is adult + `meeting_planner.edit` (loadPlannerPage `right: 'edit'`), never `holdsLeaderCapability`.
   - The claim RPC and the webhook follow D-051/D-239.
   - The Sent log loads through `createAdminClient` behind the capability check.
   - `sendNextEmail` checks that the batch belongs to this meeting and that the caller may send.
   - Added tests:
     - `LeaderWithoutPlannerRights_CannotOpenEmails()`
     - `Sender_TimeoutIsUnknown_NotFailed()`
     - `Sender_RetrySameRow_SendsOnce()` (idempotency key)
     - `AnswerParam_Reload_DoesNotReapply()`
     - `AnswerParam_Out_NeedsAConfirmingTap()`
     - `Merge_CarriesExclusionsSuggestionsHelpers()`
     - `SendNext_RefusesAForeignBatch()`
     - `Drift_IgnoresTheFamilysOwnUntick()`

## Open Questions

None. Ready to build E1.

## What exists today (checked 2026-10-29)

- **Email provider:** Resend (`src/lib/email.ts`). `vercel.json` has no crons; region cle1.
- **Three separate send paths** on This week (`/planner`):
  - **Publish snapshot** (`lib/plan-publish.ts`): one email per family. It lists the night's options and marks the suggested ones, with a scoped magic link to the family page (`/i/plan/[token]`) where they tick 2–3 things (PLAN_PICK_CAP 3). Republishing emails only the families whose options changed.
  - **Remind everyone…:** reminders, batched (REMINDER_BATCH, a time budget, caps).
  - **Ask by email:** in the teacher slot; sends the teacher digest (`lib/meeting-invite-digest*.ts`). Caps: DIGEST_INVITE_CAP 200, DIGEST_EMAIL_CAP 100.
- **Since v1.257.0, groups can have several teachers.** `twSetTeacherAction` adds or removes one person; `meeting_topic_teachers` allows several.
- **Where the prototype disagrees with what's built:**
  - The prototype's scout invite is per scout, for one group, with buttons Yes, coming / Pick something else / Not this week.
  - The built snapshot is per family: an options list plus the link page.

## Questions for Patrick (each with a recommendation)

**How it fits with what's built**

1. **Does the Emails screen replace Publish snapshot?**
   - *Recommend:* the Scouts and families tab sends the snapshot email we built, one row per family.
     - "Yes, coming" sets Coming and ticks the suggested group.
     - "Pick something else" opens their page.
     - "Not this week" sets Can't come.
   - The This week header gets an **Emails (N not sent)** link in place of the Publish button.
   - "Families are seeing an earlier version" becomes a row status, "Sent an earlier version", so those families can be selected and resent.
2. **"Sending a scout invite puts that scout in that group on the plan."** Placement already puts every scout in a group. Does sending mean:
   - (a) lock it in as a planner's hand placement, so a later focus change doesn't move them, or
   - (b) nothing extra?
   - *Recommend (a).* "Let placement decide" still undoes it.
3. **Remind everyone… and Ask by email** move into the Coming? reminders and Teachers tabs. *Recommend* removing them from This week, so all sending happens in one place.
4. **Teachers tab with several teachers per group.** *Recommend* listing every qualified candidate, plus anyone already asked; a Yes adds them rather than replacing anyone. Should it list only groups with no teacher, or every group?

**Sending and scheduling**

5. **Scheduled sends need a job on a timer.** Options: a Vercel cron (Hobby plan = one run a day), Supabase pg_cron calling an endpoint hourly, or a GitHub Action.
   - *Recommend* Supabase pg_cron, hourly.
   - Are "Sat 9:00 am" and "Sun 8:00 am" fixed (the day before at 9 am, the meeting day at 8 am), or a time picker?
6. **How "Send now" runs.**
   - *Recommend:* Send writes every email to the log as queued, then the open page sends them one at a time, so each lands in the Sent log live.
   - The scheduled job drains the same queue. This removes the 60-second batch limit.
   - If the tab closes mid-send, the next hourly run finishes the rest, and the screen says so. Is that fallback OK?
7. **Caps.** *Recommend* one cap per Send (say 150 emails), shown on the confirmation, plus Resend's 2-a-second limit, which one-at-a-time sending already respects.

**Open tracking**

8. **Recommend Resend's own open and delivery tracking:** a pixel, plus delivered / opened / bounced events sent to a webhook. Patrick needs to:
   - turn on open tracking for the sending domain in Resend;
   - add the webhook signing secret to Vercel.

   Caveat: Apple Mail fetches images automatically, so iPhone families often show "Opened" whether or not they read it. Should the label be "Opened (may be automatic on Apple Mail)", or just "Opened"?

**Smaller items**

9. **Who can use it:** adult planners with the email right (the same people who can Publish today). Scouts on the planning team can see the Sent log but not send. OK?
10. **"Edit this email":** the edited wording is saved with that email's log entry. One edit covers a family email for two scouts. OK?
11. **History:** the old reminder and digest logs aren't moved into the new Sent log; it starts empty. OK?

## Answers

**2026-10-29, after Patrick revised `Family.dc.html`:**

- **Q1 (replace Publish snapshot):** yes. Families no longer pick. They accept the plan unless they say otherwise. Drop the options list, PLAN_PICK_CAP and meeting_add_pick_capped.
- **Q2 (does sending lock placement):** no. Sending never changes the plan.
- **Q3 (move Remind everyone… and Ask by email into the Emails tabs):** yes. Remove both from This week.
- **Q8 (open tracking):** on, with the footer line. The wording for Apple Mail's automatic opens is still open.
- **New questions from the family page:**
  - **N1. Placement is predetermined.** The plan sets each scout's group, and it stands unless someone changes it. This reverses the earlier versions, where families picked. A family's answer accepts the plan or changes it; it never builds it.
  - **N2. An untick applies right away:** the scout stops being assigned that requirement. Additions are suggestions, flagged for planners.
  - **N3.** A scout who finished everything (Kevin) gets an email, using the "finished everything" version. His "a leader can pick" answer lands in "Not assigned & available".
  - **N4.** "Help teach" from the Merit badge group makes the scout a **helper** under the group, not a teacher in its slot (for now).
  - **N5.** Each email button maps to exactly one choice on the page. "Pick something else" opens the page with "Coming · but change the plan" selected.
  - **N6.** The badge reads "✓ Coming" until a change is actually saved. Choosing change and then changing nothing counts as "looks good".
  - **N7.** Up to 5 suggestions per scout, enforced on the server and shown on the page.
  - **N8.** The teacher's "Not this week" note shows on the group's teacher slot on This week.
- **Q4:** (b). List every group, with no-teacher groups first and marked "No teacher yet". A Yes adds a teacher.
- **Q5:** no scheduled sends. Send always sends at once, as today. Drop the When choice (Now · Sat 9:00 am · Sun 8:00 am) and the Scheduled / Cancel / Cancelled statuses.
- **Q6:** as recommended. Send writes the emails to the log as Queued, and the open page sends them one at a time, live.
- **Q7:** a cap of 150 per Send, shown on the confirmation, with any overflow shown. **Every limit and behavior is written on the screen**, subtle but easy to find, as a reminder for whoever forgets how it works: the cap, one at a time, what answers do to the plan, open tracking, link expiry, and the suggestion limit.
- **Q8:** plain "Opened", with no Apple Mail caveat.
- **Q9: adults only.** Only adult planners who hold the email right can open the Emails screen, including the Sent log. Scouts on the planning team don't see it.
- **Q10, Q11:** as recommended.
- **Interrupted send:** no timer. If a send stops partway, the next visit to Emails shows a strip: "N emails didn't finish sending · Send them now".
