# Handoff: Meeting Planning — This Sunday board (1a), Person drawer, Meeting Live, Focus sets

## Overview
A redesign of the leader-side meeting planning tools for Troop 79 (repo `patrickbieser-creator/Troop79-Website`, Next.js app in `next-app/`). It replaces the current **Admin › Advancement › Meeting Plan › This Sunday** tab (`next-app/src/app/admin/(workspace)/advancement/meeting-plan/this-sunday.tsx`) and adds two new screens.

| Screen | File | Purpose |
|---|---|---|
| This Sunday board, **design 1a only** | `This Sunday Board.dc.html` (`#1a`) | Midweek planning: what's ready, unmatched requests, unclaimed offers, non-responders, entering answers on someone's behalf |
| Person / action drawer | `PersonDrawer.dc.html` | One side panel used for: edit a person's answer + picks/teaching, seed a meeting, nudge families, send reminders |
| Meeting Live | `Meeting Live.dc.html` | At the meeting: sessions by block, drag-and-drop people and sessions, attendance |
| Focus sets | `Focus Sets.dc.html` (+ `focus-catalog.js` sample data) | Build reusable, labeled groups of rank and merit badge requirements; seed a meeting from a set |

`This Sunday Board.dc.html` also contains directions **1b** and **1c**. They are exploration only. **Do not build them.** Only parts of 1b that were moved into 1a matter: the attendance bars and the Everyone wall.

Domain rules come from `Plans/Meeting-Requests-And-Teaching-Offers.md`. Follow it wherever this README doesn't say otherwise.

## About the design files
These files are **design references written in HTML**. They are prototypes that show the intended look and behavior, not production code to copy. Rebuild them in the existing Next.js app using its patterns:
- shared admin components: Button, TabStrip, DataTable, ActionsMenu, PageTitle
- `--admin-*` CSS tokens and CSS modules
- server actions and loaders already in `meeting-plan/actions.ts` and `lib/meeting-board*.ts`

To open them locally, serve the folder (`npx serve .`) and open a `.dc.html` file. `support.js` is only the prototype runtime and isn't part of the design.

All data in the prototypes is sample data held in component state.

## Fidelity
**High fidelity** for layout, hierarchy, copy, colors, hit sizes and interactions. Visual values come from the app's existing palette (navy, forest, bark, danger, and the moss and sky tints). Where an admin token already exists, use the token, not the hex values below.

---

## Screen 1: This Sunday board (design 1a)

**Layout.** One artboard, designed at 1280px wide. Background `#f4f5f6`.
1. **Header** (white, bottom border `#e3e7ea`, padding 20px 28px).
   - Left: "Sunday, October 25 · Troop meeting" (22px, 700, navy `#1e3a4a`). Below it: "Sign-ups open until Sun 5:30 pm · ● Live" (13.5px, `#5f6b73`, with "Live" in forest `#3d5a3e`).
   - Right: two **stacked attendance bars**, 320px wide each, one for Scouts and one for Adults.
     - Each bar is 14px tall, radius 7, on a `#e3e7ea` track.
     - Segments: coming (forest `#3d5a3e` for scouts, `#2a6a8e` for adults), not sure `#d9b44a`, can't `#b86b6b`. "No answer" is the empty part of the track.
     - Legend under each bar: "● N coming · N not sure · N can't · N no answer" (12.5px).
2. **Meeting focus strip** (background `#fffdf7`, bottom border `#eadfbf`, padding 12px 28px). See "Seeding" below.
3. **Body grid**: `minmax(0,1fr) 380px`, gap 24px, padding 24px 28px 32px.
   - **Left column**: stacked cards with gap 20px. Each card is white, radius 8, shadow `0 1px 3px rgba(30,58,74,.12)`. Each has a solid header band (padding 12px 18px, white text, 28px circle badge, 17px/700 title, summary on the right).
     1. **Ready to teach** (band forest `#3d5a3e`, badge ✓). Always first. It starts empty each week. Empty copy: "Nothing is ready yet. A session shows up here once it has a teacher and at least one scout."
        - Each row: grid `1fr 200px`. Left: code (12.5px/700 bark `#8b6914`), title (16px/700), scout chips. Right: teacher (14px/700 `#2a4f63`), "N scouts · M min", and "Undo assignment" if the assignment was just made.
     2. **1 · Requests with no teacher** (band danger `#8c3b3b`). See "Teacher list" below.
     3. **2 · Offered, no takers yet** (band bark `#8b6914`).
        - Each row: code, "Offered by {teacher}", title (17px/700), "Likely fits:" chips.
        - Right: a 240px button "Choose families to nudge…" (background `#fdf6e3`, border bark, text `#6b500c`, 44px tall). After sending it reads "✓ Nudged N families · just now".
     4. **3 · Haven't answered** (band slate `#4a5961`).
        - Scout and adult name buttons (38px tall, radius 6). Adult buttons are tinted `#eef3f7`.
        - A "Choose who to remind…" button (navy, 44px) opens the reminder drawer.
   - **Right column** (380px):
     - **Enter for someone** card (navy background).
       - Text input "Type a name…" (44px), then Everyone / Scouts / Adults filter pills.
       - The results list appears only once you type or pick a filter. Rows are 42px: name, role (Scout in forest / Adult in `#2a4f63`), and current answer. Max height 300px, then it scrolls.
       - Built for 20–40 scouts plus 10–15 adults.
     - **Who's coming** card: Scouts, then Adults.
       - Rows are compact (40px min, padding 4px 18px). Name is 14.5px/700. The detail line shows picks or "Teaching: …" in `#5f6b73`.
       - When the person has nothing yet, the detail line is bark `#8b6914`: "Nothing picked: will be placed by rank" or "Not teaching yet: free to assign".
       - Optional "Here?" check-in toggle (see Tweaks).
     - **Not sure yet** / **Can't make it** chip lists. Can't-make-it chips show "Todd M · 3 saved for later".
4. **Everyone wall** at the bottom (padding 0 28px 32px).
   - Header: "Everyone" plus the reminder action.
   - Two cards: Scouts (header `#e4ede4`) and Adults (header `#e3ecf2`). Each is a 4-column grid, `1.2fr .7fr .6fr 2fr`: Coming · Not sure · Can't · No answer, each with a count.
   - Tiles are 38px+ tall, radius 6. They show the name (600) and a small tag: "2 picks", "Picks saved", "Teaching 1", "Free", "Can teach", or the rank being worked on.

**Teacher list (inside "Requests with no teacher")**
- Each topic row is a grid `minmax(0,1fr) 340px`.
- **Left side:**
  - code, a kind tag ("Rank" `#eef2ee`/`#3d5a3e` or "Merit badge" `#e8eef2`/`#1e3a4a`), and "about N min"
  - a **Focus** tag if the topic was seeded
  - title (17px/700)
  - a red line: "N scouts waiting · asked 3 weeks running"
  - "Focus · seeded by X" when seeded
  - wanter chips (36px tall, radius 18, `#eef2ee`). Clicking a chip opens that person's drawer.
- **Right side:** "N people can teach this", described as "grouped by their answer".
  - Show **everyone qualified**. A list can run to 10–15 people, and there is **no "best fit" ranking yet** (that's a future feature).
  - The list scrolls at a max height of 256px, inside a 1px `#dde3e7` border with radius 6. Rows must not shrink (`flex: none`).
  - Group headers (11.5px/700 uppercase, background `#f7f8f9`): **Coming · N** (forest), **Not sure yet · N** (bark), **Haven't answered · N** (slate). Within each group, sort by name.
  - People who **can't make it** are left out.
  - **"Haven't answered" is the normal case.** Those rows read "Hasn't answered · a request invites them".
  - Each row is 42px+: name (14.5px/700 navy), status line (12px), then two buttons:
    - **Send request**: navy, 36px. Starts the existing email invite process (see `invite-teachers.tsx`). Becomes "✓ Request sent".
    - **Assign**: white with border. For the day of the meeting. Marks the adult as Coming and moves the topic to Ready to teach (or to No takers if it has no scouts).
  - Assigning an adult to more than 2 topics is allowed. The drawer just notes it.

**Seeding (Meeting focus strip)**
- Label "MEETING FOCUS" (12px/700 uppercase `#6b500c`), then one chip per seeded topic: title plus "{teacher|no teacher} · N scouts".
  - Chip colors: `#eef2ee`/`#c5d6c6` when matched, `#fdf6e3`/`#e6d29a` otherwise.
- Right side: a "Focus sets" link and a **Seed this meeting** button (bark `#8b6914`, 40px).
  - Only the **SPL, Mindy, Jason and Patrick** may seed.
  - Everyone else sees a dashed, disabled button with "Only the planning team (SPL, Mindy, Jason, Patrick) can seed a meeting." Enforce this on the server too, not just in the UI.
- A seeded topic with no teacher appears under **Requests with no teacher** even with 0 scouts ("Seeded focus · no scouts picked it yet"). Once it has a teacher and still no scouts, it appears under **No takers**.
- Scouts see seeded topics marked "meeting focus" in their pick list.

**Data shown on the board (rank and merit badge topics mixed)**
- Topic: `{ id/topic_key, code, title, kind: 'rank'|'mb', minutes, weeksAsked, skill, forRank, seededBy? }`
- Pickers: scouts whose picks include the topic and whose answer isn't Can't. Picks imply Coming.
- Teacher: a single person, or null.
- Qualified teachers: adults whose teaching skills cover the topic. For merit badges, a counselor note.
- Likely fits (for nudges): scouts working on the topic's rank who haven't picked it and aren't Can't.
- The Rank / Merit badge / Closed board-mode switch is **removed** from this screen. Topics carry their own kind tag, so a meeting can mix both.

## Screen 2: Person / action drawer (`PersonDrawer.dc.html`)
- **Layout:** a right-side panel, 440px wide, white, radius 8px 0 0 8px, shadow `-8px 0 28px rgba(20,32,40,.22)`, over a `rgba(20,32,40,.38)` backdrop. Clicking the backdrop closes it.
  - Height is capped (860px in the prototype). In the app, use a fixed full-viewport-height side panel or modal.
  - The header, quick-select buttons and the primary action must always be visible, and only the list scrolls.
- **Sections:**
  1. Role label (12px uppercase), name (24px/700 navy), subtitle, and a 40px close button.
  2. Optional **"Coming Sunday?"**: a three-button segmented control (Coming forest / Not sure bark / Can't danger; 44px; the active button is filled).
  3. Optional note (`#fdf6e3`/`#7a5c10`).
  4. List title and subtitle, optional quick buttons (34px), then the scrollable list. Rows are 54px+, with a 24px checkbox square (navy fill + ✓ when on), a title (14.5px/600) and a meta line (12.5px).
  5. Optional primary action (full width, 46px). It is disabled-looking until something is selected.
  6. Footer line (12.5px forest).
- **Modes:**
  - **Scout**: answer + up to 5 picks ("Picks · n of 5", "They'll work on one or two"). A Can't-make-it scout with picks shows "Picks are saved for a later meeting."
  - **Adult**: answer + teaching toggles. Topics matching the adult's skills are listed first. The note "Teaching N. Most adults take 1–2, but this is allowed." appears when N > 2.
  - **Seed meeting** (planners only): every topic, with toggles that save immediately.
  - **Nudge families** (for a topic with no takers):
    - Starts with **nobody selected**. Quick buttons: "Select likely fits (N)" and "Clear".
    - Shows a message preview. The action reads "Send to N families".
    - Pool: scouts not Can't who haven't picked the topic. Likely fits are listed first.
  - **Send a reminder** (non-responders):
    - Starts with nobody selected. Quick buttons: "All scouts (N)", "All adults (N)", "Clear".
    - Shows a message preview. The action reads "Send to N".
    - A scout's reminder goes to their family.
- Every edit saves as you go and records who entered it ("recorded as entered by you"), matching `entered_by_person_id` in the plan.

## Screen 3: Meeting Live (`Meeting Live.dc.html`)
- **Purpose:** live at the meeting. Sessions by block, and who's where.
- **Header:** navy bar, "Sunday, Oct 25 · Sessions ● Live". On the right, a red "N overlaps to fix" badge only when there are conflicts. Below it, a one-line help strip.
- **Columns:** grid `minmax(300px,1.2fr) 1fr 1fr {Session 3}`, gap 16, padding 18px 28px.
  - **Not scheduled** (background `#e4e7e9`).
  - **Session 1** and **Session 2** (background `#fafbfb`).
  - **Session 3**: a 180px dashed grey column marked "rarely used" until it holds a card. Then it widens to 1fr.
  - Don't show times. Most meetings use only Sessions 1 and 2.
- **Not scheduled column:** a top box, **"Coming, nothing assigned · N"** (dashed `#eadfbf`). It holds scout chips, "+ Add a scout", and works as a drop target to unassign a scout. Below it, unscheduled session cards.
- **Session card:** white, radius 8, a 4px top border (forest for rank, `#2a6a8e` for MB, grey when unscheduled), and the whole card can be dragged.
  - Code (12.5px/700 bark) and title (18px/700), plus a ⋮⋮ drag handle.
  - **Teacher** button (navy tint, 34px, "Name ▾"):
    - Drag it onto another card to **swap** the two teachers.
    - Click it to open a **teacher picker**, which scrolls at 260px. Each adult is tagged "current", "teaching in session N", "busy: {title}" (red, already teaching in the same session, sorted last), or their answer.
  - **Scout chips** (34px, radius 17): draggable onto any card or back to the "Nothing assigned" box.
    - Every assigned scout is **present by default**: green `#eef2ee` / `#9dbb9e` / `#2f4a30` with "✓ Name".
    - A click marks the scout **not present**: white background, **dotted** `#9aa6ad` border, grey text, name only. Click again to undo.
  - "+ Add" opens an inline search of roster scouts who aren't on the board. If the name isn't found, it offers "+ Add '{name}' as a visitor".
  - Conflict lines (12.5px/700 danger on `#fbf0ee`): "Owen R also in Build and light a fire", "{teacher} is also teaching X in this session".
  - "Move to — / 1 / 2 / 3" buttons (32px) as the non-drag fallback (touch, keyboard).
- **Drop feedback:** the target column gets background `#e8eef2` and a navy border. A target card gets a `0 0 0 3px #1e3a4a` ring. The dragged card fades to 0.45 opacity.
- **Drag payloads:**
  - `{type:'card', id}` → column
  - `{type:'scout', name, from}` → card or pool
  - `{type:'teacher', name, from}` → card, which swaps teachers
- **Attendance** written here is real attendance (Roll Call). Answers from the board stay only a soft signal.

## Screen 4: Focus sets (`Focus Sets.dc.html`)
- **Purpose:** planners group and label requirements from **several thousand** rank and merit badge requirements, then seed meetings from those sets.
- **Header:** navy, with the breadcrumb "Meeting plan › Focus sets", the title, and the viewer's name and role.
  - Non-planners get a `#fdf6e3` view-only banner, and every edit control is hidden.
- **Grid:** `250px minmax(0,1fr) 350px`, gap 20, padding 20px 28px. Minimum page width 1000px.
  - **Left, Sets:**
    - "+ New set" button and label filter pills (no wrapping).
    - Set rows (60px+): name, "N requirements · used Oct 11", label tags (11px/700 on `#fdf6e3`). The active row has background `#e8eef2` and a 4px inset navy bar on the left.
  - **Middle, Find requirements:**
    - Search input (46px). Matching is token AND across `source + code + label + parent group`, so "Tenderfoot 4a" and "First Aid 9" both work.
    - All / Rank / Merit badge segmented control, and an active source chip with ✕.
    - With no query, a browse view:
      - Ranks: `auto-fill minmax(150px,1fr)` tiles with counts.
      - Merit badges: `auto-fill minmax(200px,1fr)` tiles showing name, "Eagle ·" and count.
    - Results are grouped by source (ranks in rank order, then badges A–Z). Each group has a sticky header with a kind tag, name, match count and "Add all N".
    - Each group shows its first 6 rows ("Show N more in X"). Ten groups show at a time ("Show 10 more of N remaining sources").
    - Rows are 46px: checkbox, code (bark), label, and a parent-requirement meta line.
    - **In production, search on the server** (a paginated query against `rank_requirements` and the MB requirement tables). Don't load the whole catalog into the browser the way the prototype does.
  - **Right, the active set:**
    - Name input. Label chips with ✕, "Add a label…" (Enter adds it), and suggested labels.
    - "In this set · N" grouped by source, with a ✕ remove per row. Scrolls at 360px.
    - **Seed a meeting with this set**: a select of upcoming meetings plus a "Seed" button (bark). Seeding adds each requirement as a focus topic on that meeting and keeps existing focus topics. It confirms with "✓ Seeded Sun, Oct 25 with N focus topics · open the board".
    - Duplicate / Delete set.
- **Permissions:** only the SPL, Mindy, Jason and Patrick can create, edit or seed sets. This needs a capability check on the server (see `admin-nav-capabilities` and the people capability model).

---

## State and data (new and changed)
- `meeting_focus_topics(calendar_entry_id, topic_key, seeded_by_person_id, seeded_at)`, or a `seeded_by` column on `meeting_topics`. A seeded topic may have 0 picks and 0 teachers.
- `focus_sets(id, name, created_by, updated_at)`, `focus_set_labels(set_id, label)`, `focus_set_items(set_id, topic_key)`, and a usage log `(set_id, calendar_entry_id, seeded_at)`.
- Teacher requests: `(calendar_entry_id, topic_key, person_id, requested_by, requested_at, status)`, which feeds the email invite.
- Nudges and reminders: a log of `(kind, calendar_entry_id, topic_key?, recipient_person_ids[], sent_by, sent_at)`. Sending is always an explicit selection, never everyone at once.
- Live placement: block (1–3 or none) per session, the teacher per session, and scout membership per session. Attendance goes to Roll Call.
- Effective answer: a stored intent, otherwise "coming" if the person has a pick or a teaching commitment, otherwise "no answer". This is already a loader rule in the plan.

## Design tokens used
- **Colors:**
  - navy `#1e3a4a`, `#2a4f63`, `#163040`
  - forest `#3d5a3e`, tint `#eef2ee` / edge `#c5d6c6`
  - bark `#8b6914`, `#6b500c`, tint `#fdf6e3` / edge `#e6d29a` / `#eadfbf`
  - danger `#8c3b3b` / tint `#fbf0ee`
  - info tint `#e8eef2` / `#9fb6c4`
  - slate `#4a5961`
  - text `#1f2a30`, meta `#5f6b73`
  - borders `#e3e7ea`, `#eceff1`, `#c9d1d6`, `#b8c4cb`
  - page `#f4f5f6`
- **Type:** Open Sans 400/600/700 (the app's `--font-ui`). Sizes 11–24px. Body 14–14.5px, meta 12–13px, card titles 16–18px.
- **Radii:** 4–8px, pills 15–18px.
- **Shadows:** card `0 1px 3px rgba(30,58,74,.12)`, drawer `-8px 0 28px rgba(20,32,40,.22)`.
- **Hit targets:** 34px minimum for chips, 40–48px for primary actions. Small name buttons were the main complaint about the old screen.

## Tweaks in the prototypes (for review only)
- Board: `scenario` (Midweek sample / Early week), `viewer` (to test the planner restriction), `showCheckIn`.
- Focus sets: `viewer`.

## Screenshots
- `screenshots/01-board-1a.png`: This Sunday board, design 1a, full length (sample midweek data)
- `screenshots/02-drawer-nudge.png`: nudge families drawer with likely fits selected
- `screenshots/03-drawer-person.png`: person drawer for a scout (answer + picks)
- `screenshots/04-meeting-live.png`: Meeting Live sessions board
- `screenshots/05-focus-sets-search.png`: Focus sets, searching "first aid"
- `screenshots/06-focus-sets-browse.png`: Focus sets, browse view

Some captures show small wrapping artifacts from the capture tool. The HTML files are the source of truth.

## Files
- `This Sunday Board.dc.html`: build `#1a` only.
- `PersonDrawer.dc.html`
- `Meeting Live.dc.html`
- `Focus Sets.dc.html` and `focus-catalog.js` (a sample of 1,571 requirements taken from `data/advancement.json`).
- `support.js`: the prototype runtime, needed only to open the files.

## Not built yet / open
- Real email sending for Send request, nudges and reminders. These are UI only.
- A way to rank the "best" teacher (future).
- The SPL's identity: tie the planner permission to a person or role, not a label.
