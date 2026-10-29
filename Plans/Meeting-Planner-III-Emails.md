# Meeting Planner III: Emails screen

**Status:** QUESTIONS OPEN. Waiting on Patrick's answers before the plan is written and built (2026-10-29).
**Source:** `prototypes/meeting-plan-III/README.md` → "Screen: Emails", and `prototypes/meeting-plan-III/Emails.dc.html`.

## Resume here

1. Patrick answers the 11 questions below.
2. Then fill in this plan from `Plans/Plan_Template.md`. Phases: log and queue → the screen → scheduling → tracking.
3. tech-lead reviews it, then build.

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

(Patrick's answers go here.)
