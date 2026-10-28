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

## Gaps: what's intentionally open
- **Placing a "Nothing assigned" scout.** The prototype dropped the separate "Done with this focus" panel at Patrick's request. Its actions (pick from requests and offers, or help teach) need a new home, probably a click on a tinted row. **Ask Patrick before building this part.**
- **Do grid checkboxes assign?** They're display-only now (could work on it). Ask whether checking or unchecking should assign a specific requirement to a scout.
- **Theme calendar**: rebuild on real focus sets and the new groups, keeping the per-week coverage and the group × week grid ("who the run covers"), with no 60% labels.
- **Eagle**: none in the sample. Eagle scouts presumably join the Merit badge group. Confirm.

## Sample data in the prototype (not rules)
The roster is the Design II names with sample ranks. Finn P and Veronica K are Star, per Patrick. Violet B and Winnie B are new scouts. Kevin P and Lucy L are forced to "finished everything on offer" so the gap state shows. Completion and RSVPs come from a seeded hash. Focus sets are 11 samples built on real BSA Scout–First Class requirement codes. Real data comes from the advancement ledger and the existing focus-set tables.
