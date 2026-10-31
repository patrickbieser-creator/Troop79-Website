# Handoff: Meeting Planner III — plan from a focus, then fill the gaps

## Overview
Design III changes how a meeting gets planned. Design II (`prototypes/meeting-plan-II/`) planned **from individual requests and offers**: scouts asked, adults offered, the board matched them. Our first real use showed the gap in that approach: some scouts ended up with **nothing planned for them**.

Design III plans **centrally, up front**:

1. The planning team picks the night's **focus**: one or more **focus sets**, for example "First aid", or "Camping" plus "Citizenship".
2. The planner puts **every active scout** in a group for the rank they're working on. Each group shows the focus requirements that rank has open.
3. A **checklist grid** shows, for each scout, which of those requirements they could work on. A scout with no boxes checked is a gap, and gaps are what the planning team fills by hand.
4. Requests and offers (Design II) become the **gap filler**, not the starting point.

The internal target is the **60-40 rule**: get at least 60% of the scouts working on Scout through First Class onto a rank requirement in the focus, then fill in the rest. 60% is a **matching goal only**. It is never shown in the UI as a target, a badge or a "meets / below" label.

Read `Plans/Meeting-Requests-And-Teaching-Offers.md`, `Plans/Completed/Meeting-Planner-II.md` and `Plans/Completed/Build-A-Plan.md` first. Design III keeps their domain rules, except where this README says otherwise. Following the repo convention, write `Plans/Meeting-Planner-III.md` from `Plans/Plan_Template.md` before building, and review it with Patrick.

## Design files
| Screen | File | Fidelity |
|---|---|---|
| This week: Plan view, checklist grid and Live view | `This Week.dc.html` | **High.** Layout, copy, colors, interactions |
| Emails: invites, reminders and the sent log | `Emails.dc.html` | **High.** Layout, copy, interactions. The send pipeline behind it is new work (see below). |
| Family page: what families, scouts and teachers see from the email link | `Family.dc.html` | **High.** Layout, copy, the one-tap answer model, scout plan limits and adult teaching limits. Uses the **public** palette, not the workspace one. |
| Suggestions: a planner tab after Has/Needs | `Suggestions.dc.html` | **High.** Brings back the retired Build a Plan Suggestions mode, adapted to III. |
| Theme calendar (a run of weeks) | `Theme Calendar.dc.html` | **Directional.** It still uses an older, shorter theme list and the old rank bands. Rebuild it on focus sets and the group rules below. |

These are HTML prototypes holding sample data, not production code. To view them, serve the folder (`npx serve .`) and open a `.dc.html` file. `support.js` is the prototype runtime only. Rebuild in the Next.js app using its existing patterns: the shared admin components, the `--admin-*` tokens, CSS modules, and the server actions and loaders already under `src/app/(public)/planner/` and `src/lib/meeting-*`.

The live design canvas (Claude Design) is "Meeting Planning — Design III". The Design II snapshot is saved separately as "Meeting Planning — Design II (snapshot Oct 27)".

## Where this lands in the app (verify before building)
The planner today lives at `/planner` (`next-app/src/app/(public)/planner/`), with these tabs:
- Build a Plan: `build/`
- Who's coming: `page.tsx` and `board-view.tsx`
- `live/`
- `focus-sets/`
- `has-needs/`
- `invite/`
- `rotations/`

Focus sets already exist: `focus-actions.ts` (`focusSetsAction`, `focusSearchAction`, `focusSaveSetAction`) and `lib/meeting-focus*.ts`. Build a Plan already adds a focus set to a meeting (`plannerAddFocusSetAction`). Live already has editing actions (`live-actions.ts`).

Design III most likely **replaces the main view of Build a Plan** with the This week screen, and **keeps Live** as a view of the same plan. Confirm with Patrick whether Who's coming stays a separate tab.

## Domain rules (changed or new in Design III)

### Groups
- There is **one group per rank a scout is working on**: Scout, Tenderfoot, Second Class and First Class. A group's name is the rank whose requirements it works, so the First Class group's columns are FC 7a–7f, and so on.
  - New scouts with no rank → **Scout** group
  - Scout → **Tenderfoot** group
  - Tenderfoot → **Second Class** group
  - Second Class → **First Class** group
- **Merit badge group**: everyone holding First Class, Star or Life. There are no separate Star or Life groups. Each of these scouts either **teaches** or **takes the night's merit badge**. They don't count toward the 60%.
- **Working ahead is fine. Out-of-order work is not a problem in this troop.** If a scout has finished their own rank's part of the focus, the planner automatically puts them in the next group when that group has open work for them. No leader approval is needed, and the screen doesn't label or explain the move: the name's rank color makes it obvious.
- Groups are not patrols.

### The 60% (internal only)
- Count = scouts in the Scout, Tenderfoot, Second Class and First Class groups. That's the whole **active roster**, not only scouts who said they're coming.
- A scout counts once they have at least one open focus requirement where they're placed. **Starting** a requirement is the goal. Finishing it in one meeting isn't expected.
- The coverage bar and the "with nothing assigned" count are shown. The 60% target is not.

### Teachers
- Each group has a teacher slot. **Teachers are often unknown until a day or two before, or the last minute.** An empty slot is flagged ("No teacher yet") but never blocks anything.
- Candidates are adults whose teaching skills match the focus, plus any Merit badge group scout set to Teach.

### No locking, and snapshots instead
- The plan is **never locked**. It changes fluidly right up to the meeting.
- **Publish snapshot** sends the current plan to families. After any change, a notice says families are seeing an earlier version, and the button becomes **Publish new snapshot**. Publishing says nothing about whether the plan is final.
- **Live is the same plan, not a copy.** Every edit anywhere in the flow (focus, groups, teachers, gap fills) shows in Live right away.

## Screen: This week (`This Week.dc.html`)

**Header:** "Sunday, Nov 1 · {focus names}", a Theme calendar link, the Publish snapshot button, a Plan / Live at the meeting switch, and a strip of the coming weeks.

**1. "What do you want the focus to be?"**
- The first control is a **Focus set ▾** button. It opens a popover (not a full-screen modal) with:
  - A search box, label filter pills (Fall, Outdoor skills, Ceremonies, Indoor night…), and the list of sets.
  - Each row shows the set's name, its labels, its requirement count, "Last used Oct 11" or "Not used yet", and an **Add / ✓ Added** toggle.
  - The list will grow to dozens of sets, so search and filtering matter.
- Picked sets show as chips next to the button, each with an ×.
- **+ Add a focus set**, at the foot of the popover, opens an inline builder modeled on Design II's Focus Sets screen. It has:
  - Name and labels.
  - "Find requirements": search by code or words, with rank pills for All, Scout, Tenderfoot, Second Class and First Class.
  - "In this set": the chosen requirements grouped by rank, each removable.
  - Save follows the house rules: a blocked save stays enabled, marks the bad field, and shows "Can't save yet: … (+N more)". A saved set is added to tonight's focus.
  - Design II's catalog also had **merit badge requirements**. Add them to the builder search; the prototype only searches rank requirements.
- Below that is a **Merit badge group** row for picking the night's merit badge. It defaults to the badge paired with the first focus set.

**2. Coverage strip:** rank-work count and %, a bar, "N with nothing assigned" and "N groups without a teacher".

**3. Two-column body (≥1100px; it stacks on narrow screens)**
- **Column 1**: one card per group that has scouts, stacked. Each card has:
  - A header in the rank color, with "Working on…" as the subtitle and a scout count.
  - The group's requirements, each with "N need it".
  - Name chips. **A scout who's coming is tinted green, a scout who can't come is gray, and everyone else is white.** No other RSVP text appears.
  - The teacher slot.

  Below the group cards is the **Merit badge group** card, with a Teach / Merit badge switch per scout.
- **Columns 2–3: the Scout checklist grid.** This is the core of the redesign.
  - It has one section per group: a group label, then **requirement codes as column headers** (4a, 4b, 4c…), then one row per scout. Columns align within a section, and different sections have different headers.
  - A cell shows ✓ (filled) when the scout could work on that requirement tonight. An empty cell means it's signed off or not offered. Several ✓ on a row means the scout could take any of those.
  - A row with no ✓ is tinted and reads **"Nothing assigned"**. If the scout has finished every requirement on offer, it reads "Nothing assigned · every offered requirement is done". Spotting these rows quickly is the screen's main job.
  - **Name chips use the scout's current rank color** (see below), even when the scout sits in a different group's section. There's no Rank column, no RSVP column and no "moved up" text.
  - The Merit badge group section shows "Teaching" or "{badge} merit badge" for each scout.
  - The toolbar has an Everyone / Nothing assigned filter and a **Legend** link. The legend unfolds inline and explains the rank colors and the tinted rows. Never use a full-screen modal here: an earlier version got stuck over the canvas.

**4. Live view** (same screen, Plan / Live switch): one session card per group with its teacher, plus a merit badge session, a Helping teach session, and a From requests and offers session. Tap a name to check the scout in. It's derived entirely from the plan state.

### Rank colors (name chips), from Troop 79 workspace tokens
| Rank | Background | Ink |
|---|---|---|
| New scout (no rank) | `#ffffff` + 1px `#9ba1aa` ring | `#3a3f47` |
| Scout | `admin-tint-sky-bg` `#eaf1f6` | `admin-tint-sky-ink` `#274d69` |
| Tenderfoot | `admin-cat-1-bg` `#d6efef` | `admin-cat-1-fg` `#186e72` |
| Second Class | `admin-tint-moss-bg` `#eef5eb` | `admin-tint-moss-ink` `#2c5a27` |
| First Class | `admin-tint-wheat-bg` `#f8f0dc` | `admin-tint-wheat-ink` `#6b4b0b` |
| Star | `admin-cat-6-bg` `#ece0f0` | `admin-cat-6-fg` `#6b3f7a` |
| Life | `admin-cat-8-bg` `#e6e6ea` | `admin-cat-8-fg` `#4a4a5a` |
| Eagle | `admin-navy` `#1e3a4a` | `#ffffff` |

A group header uses the color of the rank it works toward. The Merit badge group uses `admin-tint-stone`. Hovering a name shows its rank spelled out (title / accessible name). The color is never the only cue.

RSVP tints on group-card chips: coming = `admin-cat-mb-bg` `#e3eee5` / `#2e6038`; can't come = `admin-gray-100` / `admin-gray-500`; everyone else white.

## Screen: Emails (`Emails.dc.html`)

**Why.** Today invites and reminders go out mostly out of sight:
- Batched: `REMINDER_BATCH`, a time budget, and caps of 40 people per invite send and 100 per reminder send.
- The leader barely sees who got what, and there's no audit trail a leader can read.

This screen makes every email visible and deliberate. **Nothing sends until a leader presses Send.** The button always says how many emails will go, the confirmation lists every recipient by name, and every email is logged.

**Tabs:** Scouts and families · Teachers · Coming? reminders · Sent log. Each tab shows its count.

**List rows:**
- A checkbox.
- The name, in its rank color.
- What it's about. Scouts: "Second Class group · First aid · 2C 6a, 6c". Teachers: "Teach Second Class group · First aid (…)". Reminders: "Coming Sunday? · no answer yet".
- Who it goes to.
- Status: Not sent yet · Scheduled Sat 9:00 am · Sent … · not opened · Opened Wed 7:05 pm · Answered yes · Said not this week · Can't send (with the reason, e.g. "no parent email on file", "nothing planned for them yet"). A blocked row can't be ticked.
- **Nothing is ticked by default.** "Select all not sent yet" and "Clear" are quick actions. Filters: Everyone / Not sent yet / Sent.

**Selection counts emails, not rows:**
- One email per recipient per kind, across all tabs.
- Brothers and sisters with the same parents share one email. The preview says so: "One email covers Lily P and Simon P".
- Recipients follow the existing rules: a scout's active parents with an address, plus the scout from age 13. That's `lib/meeting-invites-db.ts`, Decision 11.

**Preview pane (sticky):**
- The To list, with a checkbox per recipient, so you can send to one parent and not the other.
- The subject and the full rendered body, using the existing templates in `lib/meeting-invite-email.ts` (teacher, scout pick, reminder).
- The answer buttons. As today, they're added outside the template and can't be edited away.
- **Edit this email**: a one-off wording change for this email only, marked "Edited for this email only", with "Use the standard wording" to undo it.
- **Edit the template for everyone**: a link to Admin › Lookups › Email templates.
- A **History** panel: every email about this meeting that reached this person, with its result.

**Sending:**
- "Review and send N emails" opens an inline confirmation, never a full-screen modal. It lists every recipient and offers When: **Now · Sat 9:00 am · Sun 8:00 am**.
- Emails go out **one at a time**, and each appears in the Sent log as it lands, or fails with its reason. This replaces the silent batching. Keep the existing per-email timeout and per-send safety caps, but **show** the caps and any overflow on screen, never apply them silently.
- **Sending never changes the plan.** The plan already places every scout in a group; that placement stands unless a leader changes it, the scout picks something else, or someone says they won't attend. The email only tells families what's planned. Answers flow back to the plan: "Not this week" takes the scout out of their group (and marks them not coming), "Pick something else" flags them for the planners, and a teacher's "Yes, I can teach" fills the group's teacher slot. The confirmation says this in one line.

**Sent log (audit trail):**
- One line per recipient: when · to · about · kind · sent by (the signed-in leader) · result.
- The result updates through **Delivered → Opened (time) → Answered yes / Said not this week**, or **Failed · reason** (bounce, timeout), or **Scheduled** (with **Cancel** until it goes) → **Cancelled**.

**Open tracking: yes (Patrick's decision).**
- Track opens per recipient, through a tracking pixel and/or the email provider's webhooks.
- Every email's footer says "Troop 79 can see when this email is opened."
- Clicking an answer button counts as an open even when images are blocked.

**New work this needs:** a per-recipient send log (or extend the existing invite table, which already logs reminders for dedupe), scheduled sends (a job that runs at the chosen time and respects cancel), delivery and open events from the provider, and per-email body overrides stored with the log entry so the log shows exactly what was sent.

## Screen: Family page (`Family.dc.html`)

**Where it lives.** This page is what the email's button opens. Today that's `/i/plan/<token>` (no sign-in) and `/member/meeting` (signed in), both built on `family-week.tsx`. It's family-facing, so it uses the **public** palette and type: newsprint ground, warm-white cards, Playfair Display headings, Lora for the lede, Open Sans for controls. It's a single 680px column that's designed for a phone first.

**The prototype bar is not part of the page.** The yellow "Prototype only · show the page for…" bar exists only to demo the prototype. Don't build it. It has:
- seven scenarios: Parent · two scouts, Parent · scout finished everything, Star scout, Parent who teaches, Adult teacher, Adult · nothing assigned, Junior Leader
- **↻ Return visit**, which simulates coming back to the page or refreshing it
- **↺ Reset form**

### One card per person, one consistent flow
Every card follows the same pattern, whether it's for a scout, an adult or a Junior Leader. The cards that differ are noted below.

1. **Title: first name only.** "Lily's plan", "Patrick's plan". Never "Your plan", even when the viewer is that person.
2. **The line under the name shows the group only.** No teacher name, no head count, no list of requirements.
   - Scouts: "Second Class group", "Merit badge group".
   - Adults and Junior Leaders keep one variation: teaching or helping teach. "Teaching the Second Class group", "Helping teach the Tenderfoot group", or both: "Teaching the Scout group · helping teach the Tenderfoot group". An adult with nothing yet: "Not teaching a group yet".
3. **Status badge** on the right: Needs an answer · ✓ Plan looks good · ✓ Changes sent · Can't make it · Not sure yet.
4. **The plan**, as a ticked list with **one line per item**: label · code · minutes (teachers also see the scout count). The list of sub-requirements a class covers is **not** shown here; it appears only inside "Change my plan" and the class sign-up lists. Requests show in this list too, with a **Requested** tag.
5. **One question with three answers**, the same on every card:
   - **This plan looks good**
   - **Change my plan** (opens the edit area inside the card)
   - **Can't make it this week**
6. **"Not sure yet? Clear {name}'s answer"** link under the answers once there is one (details below).

The word **"Coming" is gone everywhere.** Answering "This plan looks good" or "Change my plan" implies coming. Sub-lines under each answer vary by card ("We'll plan on Lily in the Second Class group", "A leader will pick something good for Kevin", and so on).

**Ledes (top of page):**
- Family: "Here's what's planned for {scouts} Sunday. One tap per card tells us whether the plan works."
- A scout answering for themself: "Here's what's planned for you Sunday. One tap tells us whether the plan works."
- Adult teacher: "Hi {first}. Here's what you're teaching Sunday. One tap tells us whether the plan works."
- Junior Leader: "Hi {first}, here's what we have planned for you this Sunday. One tap tells us whether this works." No "Junior Leader" pill on the card.

**Household one-tap.** When the page has two or more cards and any are unanswered, the top shows "✓ All of these plans look good". It answers every card with "This plan looks good", and each card can still be changed. Once every card is answered: "✓ You're all set for Sunday."

**Not sure yet isn't an answer button.** An unanswered card stays **Needs an answer**, the same as today's undecided state, so reminders still go out.

### Scout cards
**Change my plan** opens "Change {name}'s plan":
- The planned items become checkboxes. Unticking one is a *change*.
- **Also on Sunday** lists options that fit the scout (work ahead with the next group, the merit badge, help teach). Each has a **+ Request** button.
- **Request something not on the list** searches the scout's requestable items (today's `scout.requestable`). Results also use **+ Request**.
- **A request joins the plan checklist**, ticked, with a **Requested** tag, and leaves the Also list. Unticking it withdraws the request.
- Every tap saves immediately: "✓ Saved · 1 change, 2 requests sent to the planners". There is no Send button.
- Anything outside the plan is a request, not a guarantee (Patrick's rule): "Anything outside the plan goes to the planners as a request. It isn't guaranteed, and a leader will let you know before Sunday if it can't fit." Planners see requests on This week.

**Minutes on every scout item.** Each item shows its expected length from the class-duration lookup, written as `{code} - {N} min`, for example "Second Class 6b - 15 min". This applies to planned items, requests, Also options and search results. Help-teach options show minutes too. The values in the prototype (`CLASS_MIN`) are placeholders; use the real lookup table.

**Scout plan limits (enforced):** at most **4 things** and at most **60 minutes** (one meeting), counting planned items still ticked plus requests.
- A counter shows "3 of 4 things · 30 of 60 min", with minutes left. It turns yellow when either limit is reached: "Lily's plan is full: 4 things is the most for one meeting…" or "Lily's plan fills the whole 60-minute meeting…".
- At the item limit, every + Request becomes "Limit reached" and is disabled.
- A request that would go over the minutes is disabled and says why: "Needs 45 min · 30 left".
- An unticked planned item that no longer fits can't be ticked back: "untick something to add this back" / "too long to fit · untick something to make room".
- Confirm the meeting length with Patrick; the prototype uses 60.

**Clearing a scout's answer** sets it back to Not sure yet with no prompt; their plan edits stay saved.

### Adult and Junior Leader cards
**Change my plan** opens "{name}'s Sunday", with:
- **Classes that need a teacher · Sun, Nov 1**: classes on the plan with no teacher, each with its minutes and the requirements it covers, and an **I'll teach this** button.
- **Classes with a teacher · help teach one**: **I'll help teach**.
- **Scouts are asking for these · take one on**: requests from scouts.
- **Offer something** (skill, requirement or free text, with dates and an optional note).
- Some classes are **Adults only** (for example CPR, the merit badge with registered counselors); Junior Leaders see them but can't take them.
- The "outside your teaching skills" flag is **removed for now**. It may come back later.

**Teaching limits (enforced), the same for adults and Junior Leaders:** at most **3 classes** and **60 minutes** of teaching on a Sunday, using the class-duration lookup. Pre-assigned classes, classes taken on, help-teach classes and offers for this Sunday all count.
- A load meter shows "2 of 3 classes · 45 of 60 minutes" and turns yellow at the limit: "{name}'s Sunday is full. To take on something else, drop a class first."
- A class that won't fit is disabled and says why: "You're at 3 classes, the most for one Sunday. Drop one to take this." or "This would make 75 minutes. Teaching is capped at 60 minutes on a Sunday."
- An offer for this Sunday is refused at the class limit.
- Purpose: nobody over-commits and then can't deliver.
- When there's room, a nudge on the card says how many classes still need a teacher.

**Can't make it** opens an optional note: "No problem. Anything you'd like us to know?" Up to 3 lines and 240 characters, a characters-left counter, and its own **Send** button.

**An adult with nothing assigned (Mark)** gets a different first visit:
- The text: "Hi Mark, you're not signed up for anything yet. Can you help teach any of the items below?"
- No "This plan looks good" or "Change my plan". The class list is **already open**: classes with **no teacher first**, classes that already have a teacher below. Only **Can't make it this week** sits under it.
- Signing up for a class answers the card.
- **On a return visit or refresh**, once they've signed up for something, the card switches to the standard pattern (the plan list, the three answers, the load line).

**Clearing an adult's answer ("Not sure yet? Clear…")** always gives back anything they signed up for on this page (classes taken on, help-teach classes, offers).
- **No pre-assigned class (Mark):** clears straight away.
- **Pre-assigned to a class (Dan, Patrick, Henry):** a yellow panel asks first: "Should we take you off Sunday's plan for now?" It explains that a leader can then ask another adult to cover the class, and invites them to come back to this page as soon as they know more.
  - **Yes, take me off the plan for now** → off the plan; their pre-assigned class shows as open for another adult. Card: "Not sure yet. We've taken you off Sunday's plan for now, and that class is open for another adult. Come back as soon as you know more. If a class is still open, you can pick it again."
  - **No, keep me on the plan while I decide** → stays on the pre-assigned class; only the sign-ups from this page are released. Card: "Not sure yet. You're still on the plan for {class}…"
  - **Never mind, keep my answer** → nothing changes.
  - Answering again after "Yes" puts the pre-assigned class back (if it's still theirs).
- When a parent views someone else's card, the copy uses that person's first name instead of "you".

### Footer
- "Plans can change before Sunday. If a group or teacher changes, we'll email you."
- "You opened this from an email link, so there's no sign-in. The link works until 6:00 PM on Sunday, Nov 1. Questions? Email a leader."

### This differs from the current code
`family-week.tsx` today asks families to "Pick two or three things", with planned items only marked "Suggested for {name}". In Design III **the planned requirements come already ticked**, because the plan stands unless someone changes it. Replace the pick-count prompt with the 4-thing and 60-minute limits above. Today's teach board (scouts-are-asking list, offer form) moves inside the adult card's "Change my plan".

### Sample data
Lily and Simon P (Second Class group, one household, parent Laura P), Kevin P (finished everything on offer), Finn P (Star, answering for himself, Merit badge group), Patrick B (parent of Anjali, also teaching the Tenderfoot group), Dan V (adult teaching the Second Class group), Mark F (adult with nothing assigned), and Henry E (Junior Leader helping teach the Tenderfoot group). The minutes, the open classes and the requestable lists are samples.

## Screen: Suggestions (`Suggestions.dc.html`), a new planner tab

**Why.** Build a Plan's Suggestions mode (`/planner/build?view=suggestions`) was removed along with the Build a Plan tab in the P6 retirement (commits `3d711622` and `b1dd02b1`, Oct 28). Patrick relied on it, and Design III needs it back. Add it as a **tab after Has/Needs**: This week · Emails · Focus sets · Has/Needs · **Suggestions** (`planner-tabs.tsx`). Give it the same viewing rights as Has/Needs. Add, tick and save-as-set controls need the Seed right.

**What to reuse.**
- **The engine still exists**: `lib/meeting-suggest/engine.ts`. It picks each scout's next three or fewer top-level requirements, prefers needs several scouts share, gives older scouts merit badge requirements (Eagle-required first, one top-level requirement each), and leaves out classes a meeting can't hold. Don't rewrite it.
- **Deleted, but recoverable** as a starting point:
  - `lib/build-plan-suggest.ts`, which shapes the engine's output into lenses and filters (pure).
  - `lib/build-plan-suggest-db.ts` (cached engine read) and `lib/build-plan-orphans-db.ts`: from `b1dd02b1^`.
  - `app/(public)/planner/build/suggestions.tsx` and `.module.css` (661 lines): from `3d711622^`.
  - Their tests: `build-plan-b5-*`, `build-plan-b9-*`.

  For example: `git show 3d711622^:"next-app/src/app/(public)/planner/build/suggestions.tsx"`. The design rules are in `Plans/Completed/Build-A-Plan.md`, under B5 and B9.

**Layout.** Workspace palette. A sticky toolbar holds:
- **For**: the next 4 meetings, defaulting to the next one.
- **View** tabs: **Group sessions · By scout · Teaching**.
- Rank pills in the rank colors: All · Scout · Tenderfoot · Second Class · First Class · Merit badges.
- **Only this week's focus ({focus sets})**, new in III.
- **Show what's on the plan**.

When anything is ticked, a second bar appears: "N ticked · **Add N to the {date} plan** · **Save as a focus set…** (inline name field, never a modal) · Clear". Ticks carry across views.

**Group sessions** (the default):
- A section per **III group**: Scout, Tenderfoot, Second Class, First Class, Merit badge. These are the groups for the rank the scouts are working on, the same as This week, in group colors.
- A card per requirement two or more scouts need, most-needed first. Each card shows:
  - The code and title.
  - Tags: "In this week's focus" and "Eagle required".
  - "N need it", and the scouts as **rank-colored name chips**.
  - **Best teacher** and the others qualified. For merit badges, that's the counselor.
  - A tick and **+ Add to {date}**, or "✓ On {date} plan · {group} group" if it's already there.
- The old patrol split for cohorts over 8 can stay as card sub-groups. The prototype leaves it out.
- **Solo needs** (collapsed footer): things only one scout needs, each with a tick.

**By scout:** every active scout, with their rank-colored name, group and patrol, and up to three suggestions as tick chips ("· N need it" or "✓ on plan"). A scout with nothing says why in words:
- "No merit badge in progress or with a counselor".
- "Everything left needs another setting: Pool, Campout".
- "Nothing left to suggest at a meeting".

**Teaching:**
- A row per adult and per older youth instructor (a Star or Life scout who can teach Tenderfoot and Second Class), showing their skills, plus "Edit teaching skills in Lookups".
- Each row's chips are the requirements scouts need this week that match those skills, best first.
- Clicking a chip opens an inline confirm:
  - Not on the plan yet: "Add {req} to the {date} plan ({group} group), with {name} teaching?"
  - Already on the plan: "Make {name} its teacher?"
- Chips show "on plan" and "✓ teaching" states.

**Needs another setting** (collapsed footer, every view): requirements a meeting can't cover, grouped by class (Campout, Pool, Hike, Service project, 30 days at home…), with who needs each. These can't be added. Use `lib/requirement-class` as before.

**How it feeds the plan.** Adding puts the requirement into the right **group** on that meeting's plan. A planner-added extra is the same as This week's own add, so the checklist grid and Live update right away. A confirmation names the groups it went to, with a link to This week. The whole page is one engine read (cached, the same as before). Lens, filter and tick changes are client state only.

## Gaps: what's intentionally open
- **Placing a "Nothing assigned" scout.** The prototype dropped the separate "Done with this focus" panel at Patrick's request. Its actions (pick from requests and offers, or help teach) need a new home, probably a click on a tinted row. **Ask Patrick before building this part.**
- **Do grid checkboxes assign?** They're display-only now (could work on it). Ask whether checking or unchecking should assign a specific requirement to a scout.
- **Theme calendar**: rebuild on real focus sets and the new groups, keeping the per-week coverage and the group × week grid ("who the run covers"), with no 60% labels.
- **Eagle**: none in the sample. Eagle scouts presumably join the Merit badge group. Confirm.

## Sample data in the prototype (not rules)
The roster is the Design II names with sample ranks. Finn P and Veronica K are Star, per Patrick. Violet B and Winnie B are new scouts. Kevin P and Lucy L are forced to "finished everything on offer" so the gap state shows. Completion and RSVPs come from a seeded hash. Focus sets are 11 samples built on real BSA Scout–First Class requirement codes. Real data comes from the advancement ledger and the existing focus-set tables.
